const DRAW_BASE = 'https://www.rightapi.ai/draw';
const RIGHTAPI_BASE = 'https://www.rightapi.ai';
export const ALLOWED_DRAW_PATHS = ['/v1/images/generations', '/v1/chat/completions'];

// rightapi.ai 异步任务轮询参数
const RIGHTAPI_TASK_POLL_INTERVAL_MS = 3000;
// 留 20 秒缓冲给 Vercel maxDuration=300s，避免函数被强制终止
const RIGHTAPI_TASK_MAX_WAIT_MS = 280000;

export function resolveDrawPath(apiMode) {
  return apiMode === 'chat' ? '/v1/chat/completions' : '/v1/images/generations';
}

export function resolveDrawEndpoint(apiMode) {
  return `${DRAW_BASE}${resolveDrawPath(apiMode)}`;
}

export function cleanDrawOptions(options = {}) {
  const rawRefImages = Array.isArray(options.referenceImages)
    ? options.referenceImages
    : (typeof options.referenceImage === 'string' && options.referenceImage ? [options.referenceImage] : []);

  const referenceImages = rawRefImages
    .filter((url) => typeof url === 'string' && url.trim())
    .map((url) => url.trim())
    .slice(0, 7);

  return {
    apiMode: options.apiMode === 'chat' ? 'chat' : 'images',
    source: options.source === 'luxee' ? 'luxee' : 'rightcode',
    prompt: String(options.prompt || '').trim(),
    referenceImages,
    size: options.size || '1024x1024',
    quality: options.quality || 'medium',
    model: options.model || 'gpt-image-2',
  };
}

export function extractImageUrlFromContent(content) {
  if (!content || typeof content !== 'string') return null;

  const mdMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
  if (mdMatch) return mdMatch[1];

  const mdDataMatch = content.match(/!\[.*?\]\((data:image\/[^;]+;base64,[^\s)]+)\)/);
  if (mdDataMatch) return mdDataMatch[1];

  const urlMatch = content.match(/(https?:\/\/[^\s"'<>]+\.(?:png|jpg|jpeg|webp|gif)[^\s"'<>]*)/i);
  if (urlMatch) return urlMatch[1];

  const dataMatch = content.match(/(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)/);
  if (dataMatch) return dataMatch[1];

  return null;
}

export function extractTextFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return '';

  if (typeof payload.delta === 'string') return payload.delta;

  if (Array.isArray(payload.choices)) {
    return payload.choices
      .map((choice) => {
        const delta = choice?.delta;
        const message = choice?.message;
        return (
          collectText(delta?.content) ||
          collectText(delta?.text) ||
          collectText(message?.content) ||
          ''
        );
      })
      .join('');
  }

  return collectText(payload.message?.content) || collectText(payload.content) || '';
}

function collectText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item?.type === 'text' && typeof item.text === 'string') return item.text;
        if (typeof item?.content === 'string') return item.content;
        return '';
      })
      .join('');
  }
  if (typeof value?.text === 'string') return value.text;
  if (typeof value?.content === 'string') return value.content;
  return '';
}

export function extractImageUrlFromPayload(payload) {
  if (!payload) return null;

  if (typeof payload === 'string') {
    return extractImageUrlFromContent(payload);
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const url = extractImageUrlFromPayload(item);
      if (url) return url;
    }
    return null;
  }

  if (typeof payload !== 'object') return null;

  if (typeof payload.url === 'string' && (payload.url.startsWith('http') || payload.url.startsWith('data:image/'))) {
    return payload.url;
  }

  if (typeof payload.b64_json === 'string') {
    return `data:image/png;base64,${payload.b64_json}`;
  }

  if (typeof payload.image_url === 'string') return payload.image_url;
  if (typeof payload.image_url?.url === 'string') return payload.image_url.url;

  const priorityKeys = ['data', 'images', 'image', 'output', 'content', 'message', 'choices'];
  for (const key of priorityKeys) {
    const url = extractImageUrlFromPayload(payload[key]);
    if (url) return url;
  }

  return null;
}

export function createNoImageMessage(rawText, apiModeLabel = '当前模式') {
  return normalizeDrawErrorMessage(rawText, 200, apiModeLabel);
}

export function normalizeDrawErrorMessage(rawText, status, apiModeLabel = '当前模式') {
  const text = String(rawText || '').trim();

  if (status === 413 || /FUNCTION_PAYLOAD_TOO_LARGE|Request Entity Too Large/i.test(text)) {
    return '参考图过大，画图请求超过平台大小限制。请换一张更小的图片，或先裁剪/压缩后再试。';
  }

  if (status === 504 || /FUNCTION_INVOCATION_TIMEOUT/i.test(text)) {
    return '图片生成代理超时。绘图生成耗时较长，请稍后重试，或降低质量/换个尺寸再试。';
  }

  if (/excessive\s+system\s+load|system\s+load|Progressing/i.test(text)) {
    return '绘图服务当前负载较高，图片还没有成功生成。请稍后重试，或降低质量/换个尺寸再试。';
  }

  if (/content_filter|content.policy|safety.policy|image.policy|violat(?:ed|es?).+(?:policy|content|safety)|policy.+violat/i.test(text)) {
    return '这次图片请求可能触发了内容策略，服务端没有返回图片。请调整提示词或参考图后重试。';
  }

  if (/violat(?:ed|e)|content_filter/i.test(text)) {
    return '这次图片请求可能触发了内容策略，服务端没有返回图片。请调整提示词或参考图后重试。';
  }

  if (text) {
    const snippet = text.length > 200 ? text.slice(0, 200) + '…' : text;
    return `${apiModeLabel} 没有返回可用图片。服务端响应：${snippet}`;
  }

  return `${apiModeLabel} 没有返回可用图片，请稍后重试。`;
}

// 轮询 rightapi.ai 异步任务，直到完成或超时
async function pollRightApiTask({ apiKey, taskId, signal }) {
  const url = `${RIGHTAPI_BASE}/v1/tasks/${encodeURIComponent(taskId)}`;
  const headers = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const deadline = Date.now() + RIGHTAPI_TASK_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('请求已取消');

    let response;
    try {
      response = await fetch(url, { method: 'GET', headers });
    } catch {
      // 网络错误，等待后重试
      await new Promise((resolve) => setTimeout(resolve, RIGHTAPI_TASK_POLL_INTERVAL_MS));
      continue;
    }

    if (!response.ok) {
      if (response.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, RIGHTAPI_TASK_POLL_INTERVAL_MS));
        continue;
      }
      const errorText = await response.text().catch(() => '任务查询失败');
      throw new Error(normalizeDrawErrorMessage(errorText, response.status));
    }

    const data = await response.json();

    // 完成状态：直接取图片 URL（兼容 Images 和 Gemini 两种响应格式）
    const imageUrl = extractImageUrlFromPayload(data);
    if (imageUrl) {
      return { imageUrl };
    }

    // 失败状态
    if (data.status === 'failed') {
      const rawError = (data.error && (data.error.message || data.error)) || '图片生成失败';
      const errorMsg = typeof rawError === 'string' ? rawError : '图片生成失败';
      throw new Error(normalizeDrawErrorMessage(errorMsg, 200));
    }

    // queued / in_progress / processing：继续轮询
    await new Promise((resolve) => setTimeout(resolve, RIGHTAPI_TASK_POLL_INTERVAL_MS));
  }

  throw new Error('图片生成超时，请稍后重试。');
}

export async function runDrawRequest({ apiKey, options, signal }) {
  const cleaned = cleanDrawOptions(options);
  const endpoint = resolveDrawEndpoint(cleaned.apiMode);
  const headers = {
    'Content-Type': 'application/json',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const body = cleaned.apiMode === 'chat'
    ? buildChatBody(cleaned)
    : buildImagesBody(cleaned);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '请求失败');
    throw new Error(normalizeDrawErrorMessage(errorText, response.status));
  }

  if (cleaned.apiMode === 'images') {
    const data = await response.json();

    // 同步模式：响应直接包含图片 URL（向后兼容）
    const imageUrl = extractImageUrlFromPayload(data);
    if (imageUrl) {
      return { imageUrl };
    }

    // 异步模式：响应包含 task_id，需轮询 /v1/tasks/{task_id} 获取结果
    if (data.task_id) {
      return pollRightApiTask({ apiKey, taskId: data.task_id, signal });
    }

    // 既没有图片 URL 也没有 task_id，检查是否失败
    if (data.status === 'failed') {
      const rawError = (data.error && (data.error.message || data.error)) || '图片生成失败';
      const errorMsg = typeof rawError === 'string' ? rawError : '图片生成失败';
      throw new Error(normalizeDrawErrorMessage(errorMsg, 200));
    }

    throw new Error(createNoImageMessage(JSON.stringify(data).slice(0, 500), 'Images API'));
  }

  const fullText = await readChatResponseText(response);
  const imageUrl = extractImageUrlFromContent(fullText);
  if (imageUrl) {
    return { imageUrl };
  }
  throw new Error(createNoImageMessage(fullText, 'Chat API'));
}

function buildImagesBody(options) {
  const images = Array.isArray(options.referenceImages) ? options.referenceImages.filter(Boolean) : [];
  return {
    model: options.model,
    prompt: options.prompt,
    image: images.length > 0 ? images : undefined,
    size: options.size,
    quality: options.quality,
    async: true,
    response_format: 'url',
  };
}

function buildChatBody(options) {
  const images = Array.isArray(options.referenceImages) ? options.referenceImages.filter(Boolean) : [];
  const sizeHint = options.size ? `，图片尺寸${options.size}` : '';
  const qualityHint = options.quality ? `，画质${options.quality}` : '';
  const refHint = images.length > 0 ? `请参考这${images.length}张图片，` : '请根据以下描述生成图片：';
  const textPart = `${refHint}${options.prompt}${sizeHint}${qualityHint}`;

  let userContent;
  if (images.length > 0) {
    userContent = [
      { type: 'text', text: textPart },
      ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
    ];
  } else {
    userContent = textPart;
  }

  return {
    model: options.model,
    messages: [
      {
        role: 'user',
        content: userContent,
      },
    ],
    stream: true,
    size: options.size,
    quality: options.quality,
  };
}

async function readChatResponseText(response) {
  const contentType = response.headers.get('content-type') || '';

  if (!response.body || (!contentType.includes('text/event-stream') && !contentType.includes('text/plain'))) {
    const plainText = await response.text();
    try {
      const parsed = JSON.parse(plainText);
      const imageUrl = extractImageUrlFromPayload(parsed);
      if (imageUrl) return imageUrl;
      return extractTextFromPayload(parsed) || plainText;
    } catch {
      return plainText;
    }
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    while (buffer.includes('\n\n')) {
      const boundaryIndex = buffer.indexOf('\n\n');
      const rawEvent = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);

      const dataLines = rawEvent
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());

      const joined = dataLines.join('\n');
      if (!joined || joined === '[DONE]') continue;

      try {
        const parsed = JSON.parse(joined);
        const imageUrl = extractImageUrlFromPayload(parsed);
        if (imageUrl) return imageUrl;
        fullText += extractTextFromPayload(parsed);
      } catch {
        fullText += joined;
      }
    }
  }

  return fullText || buffer;
}
