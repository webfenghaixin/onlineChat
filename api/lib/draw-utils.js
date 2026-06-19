const DRAW_BASE = 'https://www.right.codes/draw';
export const ALLOWED_DRAW_PATHS = ['/v1/images/generations', '/v1/chat/completions'];

export function resolveDrawPath(apiMode) {
  return apiMode === 'chat' ? '/v1/chat/completions' : '/v1/images/generations';
}

export function resolveDrawEndpoint(apiMode) {
  return `${DRAW_BASE}${resolveDrawPath(apiMode)}`;
}

export function cleanDrawOptions(options = {}) {
  return {
    apiMode: options.apiMode === 'chat' ? 'chat' : 'images',
    source: options.source === 'luxee' ? 'luxee' : 'rightcode',
    prompt: String(options.prompt || '').trim(),
    referenceImage: typeof options.referenceImage === 'string' ? options.referenceImage : '',
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
    const imageUrl = extractImageUrlFromPayload(data);
    if (imageUrl) {
      return { imageUrl };
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
  return {
    model: options.model,
    prompt: options.prompt,
    image: options.referenceImage ? [options.referenceImage] : undefined,
    size: options.size,
    quality: options.quality,
    response_format: 'url',
  };
}

function buildChatBody(options) {
  const sizeHint = options.size ? `，图片尺寸${options.size}` : '';
  const qualityHint = options.quality ? `，画质${options.quality}` : '';
  const textPart = options.referenceImage
    ? `请参考这张图片，${options.prompt}${sizeHint}${qualityHint}`
    : `请根据以下描述生成图片：${options.prompt}${sizeHint}${qualityHint}`;

  return {
    model: options.model,
    messages: [
      {
        role: 'user',
        content: options.referenceImage
          ? [
              { type: 'text', text: textPart },
              { type: 'image_url', image_url: { url: options.referenceImage } },
            ]
          : textPart,
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
