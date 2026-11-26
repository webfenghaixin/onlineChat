import { z } from 'zod';

// 与前端 src/lib/constants.js 保持一致的制图可选项
const DRAW_MODELS = [
  'gpt-image-2',
  'gpt-image-2-vip',
  'gpt-image-2.5',
  'gpt-image-2.6',
  'gpt-image-2.6-sunburst',
];
const DRAW_SIZES = ['1024x1024', '1024x1536', '1024x1792', '1536x1024', '1792x1024'];
const DRAW_QUALITIES = ['low', 'medium', 'high', 'auto'];
const MAX_REFERENCE_IMAGES = 5;
const MAX_COUNT = 20;

function trimBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

export function createDrawClient({ baseUrl, apiKey }) {
  const root = trimBaseUrl(baseUrl);

  async function request(path, options = {}) {
    if (!root) throw new Error('未配置服务地址');
    if (!apiKey) throw new Error('未配置 DRAW_API_KEY');

    const response = await fetch(`${root}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const message = data?.error || `请求失败（HTTP ${response.status}）`;
      throw new Error(message);
    }
    return data;
  }

  return {
    createTask(payload) {
      return request('/api/ai/draw', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    getTask(taskId) {
      return request(`/api/ai/draw?id=${encodeURIComponent(taskId)}`);
    },
  };
}

function textResult(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
  };
}

export function registerDrawTools(server, client) {
  server.registerTool(
    'generate_image',
    {
      title: '生成图片',
      description: [
        '提交图片生成任务，立即返回 taskId（异步）。',
        '支持文生图与参考图；需要参考图时把图片 URL 或 data:image base64 放进 referenceImages。',
        '拿到 taskId 后需调用 get_image_task 轮询结果，建议间隔 5 秒，最长等待 5 分钟。',
      ].join(''),
      inputSchema: {
        prompt: z.string().min(1).max(4000).describe('图片描述，越具体效果越好'),
        model: z.string().optional().describe('模型名，默认 gpt-image-2'),
        size: z.enum(DRAW_SIZES).optional().describe('图片尺寸，默认 1024x1024'),
        quality: z.enum(DRAW_QUALITIES).optional().describe('质量档位，默认 medium'),
        count: z.number().int().min(1).max(MAX_COUNT).optional().describe('生成数量，默认 1'),
        referenceImages: z
          .array(z.string())
          .max(MAX_REFERENCE_IMAGES)
          .optional()
          .describe('参考图列表，支持 http(s) URL 或 data:image base64，最多 5 张；有参考图时自动走图片编辑接口'),
      },
    },
    async (args) => {
      try {
        const data = await client.createTask(args);
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_image_task',
    {
      title: '查询图片任务',
      description: '根据 taskId 查询图片生成任务状态。status 为 succeeded 时 imageUrl 即成品图片地址；failed 时看 error。',
      inputSchema: {
        taskId: z.string().min(1).describe('generate_image 返回的 taskId'),
      },
    },
    async ({ taskId }) => {
      try {
        const data = await client.getTask(taskId);
        return textResult(data);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_draw_options',
    {
      title: '查询制图可选项',
      description: '返回可用的制图模型、尺寸、质量档位与参数说明，调用 generate_image 前可先参考。',
      inputSchema: {},
    },
    async () => textResult({
      models: DRAW_MODELS,
      defaultModel: 'gpt-image-2',
      sizes: DRAW_SIZES,
      defaultSize: '1024x1024',
      qualities: DRAW_QUALITIES,
      defaultQuality: 'medium',
      maxCount: MAX_COUNT,
      maxReferenceImages: MAX_REFERENCE_IMAGES,
      referenceImageFormats: ['https://...', 'data:image/png;base64,...'],
      flow: ['generate_image 提交', 'get_image_task 轮询，间隔 5 秒，最长 5 分钟'],
    }),
  );
}
