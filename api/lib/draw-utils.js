const RIGHTAPI_BASE = 'https://rightapi.ai';
const DRAW_GENERATIONS_ENDPOINT = `${RIGHTAPI_BASE}/v1/images/generations`;
const DRAW_EDITS_ENDPOINT = `${RIGHTAPI_BASE}/v1/images/edits`;

// rightapi.ai 异步任务轮询参数
const RIGHTAPI_TASK_POLL_INTERVAL_MS = 3000;
// 留 20 秒缓冲给 Vercel maxDuration=300s，避免函数被强制终止
const RIGHTAPI_TASK_MAX_WAIT_MS = 280000;

export function cleanDrawOptions(options = {}) {
  const rawRefImages = Array.isArray(options.referenceImages)
    ? options.referenceImages
    : (typeof options.referenceImage === 'string' && options.referenceImage ? [options.referenceImage] : []);

  const referenceImages = rawRefImages
    .filter((url) => typeof url === 'string' && url.trim())
    .map((url) => url.trim())
    .slice(0, 7);

  return {
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

    // 失败状态
    if (['failed', 'expired', 'canceled'].includes(data.status)) {
      const rawError = (data.error && (data.error.message || data.error)) || '图片生成失败';
      const errorMsg = typeof rawError === 'string' ? rawError : '图片生成失败';
      throw new Error(normalizeDrawErrorMessage(errorMsg, 200));
    }

    // 完成状态：OpenAI 生成返回 data[].url，Gemini 生成返回 candidates[].content.parts[].text
    const imageUrl = extractImageUrlFromPayload(data);
    if (imageUrl) {
      return { imageUrl };
    }

    // queued / in_progress / processing：继续轮询
    await new Promise((resolve) => setTimeout(resolve, RIGHTAPI_TASK_POLL_INTERVAL_MS));
  }

  throw new Error('图片生成超时，请稍后重试。');
}

// 将 http(s) URL 参考图下载并转为 data URL，rightapi.ai 的 image 字段需要 data URL。
// 已是 data URL 的直接保留。
async function resolveReferenceImagesToDataUrls(referenceImages) {
  if (!Array.isArray(referenceImages) || referenceImages.length === 0) return [];

  return Promise.all(
    referenceImages.filter(Boolean).map(async (url) => {
      if (url.startsWith('data:')) return url;
      if (!url.startsWith('http')) return url;

      const imageResponse = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!imageResponse.ok) {
        throw new Error(`下载参考图失败 (${imageResponse.status})`);
      }
      const buffer = Buffer.from(await imageResponse.arrayBuffer());
      const contentType = imageResponse.headers.get('content-type') || 'image/png';
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    }),
  );
}

export async function runDrawRequest({ apiKey, options, signal }) {
  const cleaned = cleanDrawOptions(options);
  const headers = {
    'Content-Type': 'application/json',
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  // 参考图持久化在对象存储（http URL），图片编辑接口需要 data URL，这里转换
  cleaned.referenceImages = await resolveReferenceImagesToDataUrls(cleaned.referenceImages);

  // 有参考图走图片编辑接口，无参考图走文生图接口
  const hasReferenceImages = cleaned.referenceImages.length > 0;
  const endpoint = hasReferenceImages ? DRAW_EDITS_ENDPOINT : DRAW_GENERATIONS_ENDPOINT;
  const body = hasReferenceImages ? buildEditsBody(cleaned) : buildGenerationBody(cleaned);

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

  const data = await response.json();

  // 提交阶段失败
  if (['failed', 'expired', 'canceled'].includes(data.status)) {
    const rawError = (data.error && (data.error.message || data.error)) || '图片生成失败';
    const errorMsg = typeof rawError === 'string' ? rawError : '图片生成失败';
    throw new Error(normalizeDrawErrorMessage(errorMsg, 200));
  }

  // 同步模式：响应直接包含图片 URL（向后兼容）
  const imageUrl = extractImageUrlFromPayload(data);
  if (imageUrl) {
    return { imageUrl };
  }

  // 异步模式：响应包含 task_id，需轮询 /v1/tasks/{task_id} 获取结果
  if (data.task_id) {
    return pollRightApiTask({ apiKey, taskId: data.task_id, signal });
  }

  throw new Error(createNoImageMessage(JSON.stringify(data).slice(0, 500), 'Images API'));
}

function buildGenerationBody(options) {
  return {
    model: options.model,
    prompt: options.prompt,
    n: 1,
    size: options.size,
    quality: options.quality,
    async: true,
  };
}

function buildEditsBody(options) {
  return {
    model: options.model,
    prompt: options.prompt,
    images: options.referenceImages,
    n: 1,
    size: options.size,
    quality: options.quality,
    async: true,
  };
}


