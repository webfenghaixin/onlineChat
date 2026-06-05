import { getToken } from './auth';

const SSE_BOUNDARY = '\n\n';
const DRAW_TASK_POLL_INTERVAL_MS = 10000;
const DRAW_TASK_POLL_INTERVAL_AFTER_30S_MS = 3000;
const DRAW_TASK_SLOW_POLL_WINDOW_MS = 30000;

function normalizeDrawErrorMessage(rawText, status, apiModeLabel = '当前模式') {
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

  if (/violat(?:ed|e)|policy|policies|content_filter/i.test(text)) {
    return '这次图片请求可能触发了内容策略，服务端没有返回图片。请调整提示词或参考图后重试。';
  }

  return text || `${apiModeLabel} 没有返回可用图片，请稍后重试。`;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function collectTextFromValue(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (item?.type === 'text' && typeof item?.text === 'string') {
          return item.text;
        }
        if (typeof item?.text?.value === 'string') {
          return item.text.value;
        }
        if (typeof item?.content === 'string') {
          return item.content;
        }
        return '';
      })
      .join('');
  }

  if (typeof value?.text === 'string') {
    return value.text;
  }

  if (typeof value?.content === 'string') {
    return value.content;
  }

  return '';
}

function normalizeMessageContent(content) {
  if (Array.isArray(content)) {
    return content;
  }

  return [
    {
      type: 'text',
      text: typeof content === 'string' ? content : '',
    },
  ];
}

function extractTextFromEvent(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  if (typeof payload.delta === 'string') {
    return payload.delta;
  }

  if (Array.isArray(payload.choices)) {
    return payload.choices
      .map((choice) => {
        const delta = choice?.delta;
        const message = choice?.message;
        return (
          collectTextFromValue(delta?.content) ||
          collectTextFromValue(delta?.text) ||
          collectTextFromValue(message?.content) ||
          ''
        );
      })
      .join('');
  }

  if (payload.type === 'response.output_text.delta' && typeof payload.delta === 'string') {
    return payload.delta;
  }

  if (payload.type === 'response.completed') {
    return extractTextFromEvent(payload.response);
  }

  if (Array.isArray(payload.output)) {
    return payload.output
      .map((item) => {
        if (Array.isArray(item?.content)) {
          return item.content
            .map((contentItem) => {
              if (contentItem?.type === 'output_text' && typeof contentItem?.text === 'string') {
                return contentItem.text;
              }
              if (contentItem?.type === 'text' && typeof contentItem?.text === 'string') {
                return contentItem.text;
              }
              return '';
            })
            .join('');
        }
        return '';
      })
      .join('');
  }

  return (
    collectTextFromValue(payload.message?.content) ||
    collectTextFromValue(payload.output_text) ||
    collectTextFromValue(payload.content) ||
    ''
  );
}

function buildMessagesPayload(messages, systemPrompt) {
  const normalized = messages.map((message) => ({
    role: message.role,
    content: normalizeMessageContent(message.content),
  }));

  if (!systemPrompt.trim()) {
    return normalized;
  }

  return [
    {
      role: 'system',
      content: [
        {
          type: 'text',
          text: systemPrompt.trim(),
        },
      ],
    },
    ...normalized,
  ];
}

function buildRequestBody(settings, messages) {
  const { model, temperature, maxOutputTokens, stream, systemPrompt } = settings;
  const normalizedMessages = buildMessagesPayload(messages, systemPrompt);
  const isDaily = settings.source === 'rightcode' && settings.rightcodePricing === 'daily';

  if (isDaily) {
    return {
      model: model || undefined,
      input: normalizedMessages.map((message) => {
        const text = message.content
          .filter((item) => item.type === 'text')
          .map((item) => item.text || '')
          .join('\n');
        return {
          role: message.role,
          content: text,
        };
      }),
      temperature,
      max_output_tokens: Number(maxOutputTokens) || undefined,
      stream,
    };
  }

  return {
    model: model || undefined,
    messages: normalizedMessages,
    temperature,
    max_tokens: Number(maxOutputTokens) || undefined,
    stream,
  };
}

function cleanUndefinedValues(value) {
  if (Array.isArray(value)) {
    return value.map(cleanUndefinedValues);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined && item !== '')
      .map(([key, item]) => [key, cleanUndefinedValues(item)]),
  );
}

function resolveRequestUrl(settings) {
  if (settings.useProxy) {
    const proxyPath = settings.proxyPath?.trim() || '/api/proxy';
    if (/^https?:\/\//i.test(proxyPath)) {
      return proxyPath;
    }
    return proxyPath.startsWith('/') ? proxyPath : `/${proxyPath}`;
  }

  return settings.endpoint.trim();
}

function buildRequestHeaders(settings) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (settings.useProxy) {
    headers['X-Source'] = settings.source || 'luxee';
    if (settings.source === 'rightcode' && settings.rightcodePricing) {
      headers['X-Pricing'] = settings.rightcodePricing;
    }
  } else {
    if (settings.apiKey.trim()) {
      headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
    }
  }

  return headers;
}

async function readAsText(response) {
  try {
    return await response.text();
  } catch (error) {
    return '请求失败，且无法读取错误信息。';
  }
}

function parseSseChunk(buffer, onText) {
  let workingBuffer = buffer;

  while (workingBuffer.includes(SSE_BOUNDARY)) {
    const boundaryIndex = workingBuffer.indexOf(SSE_BOUNDARY);
    const rawEvent = workingBuffer.slice(0, boundaryIndex);
    workingBuffer = workingBuffer.slice(boundaryIndex + SSE_BOUNDARY.length);

    const dataLines = rawEvent
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());

    if (!dataLines.length) {
      continue;
    }

    const joined = dataLines.join('\n');
    if (joined === '[DONE]') {
      continue;
    }

    const parsed = safeJsonParse(joined);
    if (parsed) {
      const text = extractTextFromEvent(parsed);
      if (text) {
        onText(text);
      }
      continue;
    }

    onText(joined);
  }

  return workingBuffer;
}

function parseJsonLinesChunk(buffer, onText) {
  const parts = buffer.split('\n');
  const remaining = parts.pop() ?? '';

  for (const part of parts) {
    const line = part.trim();
    if (!line) {
      continue;
    }

    const parsed = safeJsonParse(line);
    if (parsed) {
      const text = extractTextFromEvent(parsed);
      if (text) {
        onText(text);
      }
      continue;
    }

    onText(line);
  }

  return remaining;
}

export async function streamChatCompletion({ settings, messages, signal, onText }) {
  const response = await fetch(resolveRequestUrl(settings), {
    method: 'POST',
    headers: buildRequestHeaders(settings),
    body: JSON.stringify(cleanUndefinedValues(buildRequestBody(settings, messages))),
    signal,
  });

  if (!response.ok) {
    const errorText = await readAsText(response);
    throw new Error(`接口返回 ${response.status}：${errorText}`);
  }

  if (!response.body) {
    const plainText = await response.text();
    if (plainText) {
      const parsed = safeJsonParse(plainText);
      if (parsed) {
        const text = extractTextFromEvent(parsed);
        onText(text || plainText);
      } else {
        onText(plainText);
      }
    }
    return;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!settings.stream || contentType.includes('application/json')) {
    const plainText = await response.text();
    const parsed = safeJsonParse(plainText);
    if (parsed) {
      const text = extractTextFromEvent(parsed);
      onText(text || plainText);
    } else if (plainText) {
      onText(plainText);
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    if (contentType.includes('text/event-stream') || buffer.includes('data:')) {
      buffer = parseSseChunk(buffer, onText);
      continue;
    }

    if (buffer.includes('\n')) {
      buffer = parseJsonLinesChunk(buffer, onText);
      continue;
    }

    onText(buffer);
    buffer = '';
  }

  const tail = buffer.trim();
  if (!tail) {
    return;
  }

  const parsed = safeJsonParse(tail);
  if (parsed) {
    const text = extractTextFromEvent(parsed);
    if (text) {
      onText(text);
    }
    return;
  }

  onText(tail);
}

function resolveDrawProxyUrl(settings, apiMode) {
  if (settings.useProxy) {
    const proxyPath = settings.proxyPath?.trim() || '/api/proxy';
    const drawPath = proxyPath.replace(/\/proxy\/?$/, '/draw').replace(/\/proxy$/, '/draw');
    if (/^https?:\/\//i.test(drawPath)) {
      return drawPath;
    }
    return drawPath.startsWith('/') ? drawPath : `/${drawPath}`;
  }
  const basePath = 'https://www.right.codes/draw';
  return apiMode === 'chat'
    ? `${basePath}/v1/chat/completions`
    : `${basePath}/v1/images/generations`;
}

function buildDrawHeaders(settings, apiMode) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (settings.useProxy) {
    headers['X-Source'] = settings.source || 'rightcode';
    headers['X-Draw-Path'] = apiMode === 'chat'
      ? '/v1/chat/completions'
      : '/v1/images/generations';
  } else if (settings.apiKey.trim()) {
    headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
  }

  return headers;
}

function extractImageUrlFromContent(content) {
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

function resolveDrawTaskUrl(settings, path) {
  const proxyPath = settings.proxyPath?.trim() || '/api/proxy';
  let basePath = proxyPath.replace(/\/proxy\/?$/, '').replace(/\/proxy$/, '');
  if (!basePath) basePath = '';

  const taskPath = `${basePath}/draw-task/${path}`;
  if (/^https?:\/\//i.test(taskPath)) {
    return taskPath;
  }
  return taskPath.startsWith('/') ? taskPath : `/${taskPath}`;
}

function extractImageUrlFromPayload(payload) {
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

  if (typeof payload !== 'object') {
    return null;
  }

  if (typeof payload.url === 'string' && (payload.url.startsWith('http') || payload.url.startsWith('data:image/'))) {
    return payload.url;
  }

  if (typeof payload.b64_json === 'string') {
    return `data:image/png;base64,${payload.b64_json}`;
  }

  if (typeof payload.image_url === 'string') {
    return payload.image_url;
  }

  if (typeof payload.image_url?.url === 'string') {
    return payload.image_url.url;
  }

  const priorityKeys = ['data', 'images', 'image', 'output', 'content', 'message', 'choices'];
  for (const key of priorityKeys) {
    const url = extractImageUrlFromPayload(payload[key]);
    if (url) return url;
  }

  return null;
}

async function throwDrawResponseError(response) {
  const errorText = await response.text().catch(() => '请求失败');
  throw new Error(normalizeDrawErrorMessage(errorText, response.status));
}

function createNoImageError(rawText, apiModeLabel = '当前模式') {
  return new Error(normalizeDrawErrorMessage(rawText, 200, apiModeLabel));
}

function getAuthorizedHeaders() {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const timer = window.setTimeout(resolve, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function resolveDrawTaskPollInterval(startedAt) {
  const elapsedMs = Date.now() - Number(startedAt || Date.now());
  return elapsedMs < DRAW_TASK_SLOW_POLL_WINDOW_MS
    ? DRAW_TASK_POLL_INTERVAL_MS
    : DRAW_TASK_POLL_INTERVAL_AFTER_30S_MS;
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || `请求失败 (${response.status})` };
  }
}

async function generateImageViaTaskApi({
  settings,
  prompt,
  referenceImage,
  size,
  quality,
  signal,
  onImage,
  onTaskStart,
  taskMetadata,
}) {
  const apiMode = settings.drawApiMode || 'images';
  const startedAt = Date.now();
  const startResponse = await fetch(resolveDrawTaskUrl(settings, 'start'), {
    method: 'POST',
    headers: getAuthorizedHeaders(),
    body: JSON.stringify({
      apiMode,
      source: settings.source || 'rightcode',
      prompt,
      referenceImage,
      size: size || '1024x1024',
      quality: quality || 'medium',
      model: 'gpt-image-2',
      taskMetadata,
    }),
    signal,
  });

  const startData = await readJsonResponse(startResponse);
  if (!startResponse.ok) {
    throw new Error(
      normalizeDrawErrorMessage(
        startData.error || `创建绘图任务失败 (${startResponse.status})`,
        startResponse.status,
      ),
    );
  }

  const taskId = startData.taskId;
  if (!taskId) {
    throw new Error('创建绘图任务失败：服务端没有返回任务 ID。');
  }
  onTaskStart?.(taskId);

  return pollDrawTask({ settings, taskId, startedAt, signal, onImage });
}

export async function pollDrawTask({ settings, taskId, startedAt, signal, onImage }) {
  while (true) {
    await abortableDelay(resolveDrawTaskPollInterval(startedAt), signal);

    const statusUrl = new URL(resolveDrawTaskUrl(settings, 'status'), window.location.origin);
    statusUrl.searchParams.set('id', taskId);

    const statusResponse = await fetch(statusUrl.toString(), {
      method: 'GET',
      headers: getAuthorizedHeaders(),
      signal,
    });
    const statusData = await readJsonResponse(statusResponse);

    if (!statusResponse.ok) {
      throw new Error(
        normalizeDrawErrorMessage(
          statusData.error || `查询绘图任务失败 (${statusResponse.status})`,
          statusResponse.status,
        ),
      );
    }

    if (statusData.status === 'succeeded' && statusData.imageUrl) {
      onImage(statusData.imageUrl, {
        createdAt: statusData.createdAt,
        completedAt: statusData.completedAt,
      });
      return;
    }

    if (statusData.status === 'failed') {
      throw new Error(normalizeDrawErrorMessage(statusData.error || '图片生成失败，请稍后重试。'));
    }
  }
}

// /v1/images/generations 模式：非流式，直接返回 JSON
async function generateImageViaImagesApi({ url, headers, model, prompt, referenceImage, size, quality, signal, onImage }) {
  const body = JSON.stringify({
    model,
    prompt,
    image: referenceImage ? [referenceImage] : undefined,
    size: size || '1024x1024',
    quality: quality || 'medium',
    response_format: 'url',
  });

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal,
  });

  if (!response.ok) {
    await throwDrawResponseError(response);
  }

  const data = await response.json();
  const imageUrl = extractImageUrlFromPayload(data);
  if (imageUrl) {
    onImage(imageUrl);
    return;
  }

  throw createNoImageError(JSON.stringify(data).slice(0, 500), 'Images API');
}

// /v1/chat/completions 模式：流式，从文本中提取图片
async function generateImageViaChatApi({ url, headers, model, prompt, referenceImage, size, quality, signal, onImage }) {
  const sizeHint = size ? `，图片尺寸${size}` : '';
  const qualityHint = quality ? `，画质${quality}` : '';
  const textPart = referenceImage
    ? `请参考这张图片，${prompt}${sizeHint}${qualityHint}`
    : `请根据以下描述生成图片：${prompt}${sizeHint}${qualityHint}`;

  let userContent;
  if (referenceImage) {
    userContent = [
      { type: 'text', text: textPart },
      { type: 'image_url', image_url: { url: referenceImage } },
    ];
  } else {
    userContent = textPart;
  }

  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: userContent }],
    stream: true,
    size: size || '1024x1024',
    quality: quality || 'medium',
  });

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal,
  });

  if (!response.ok) {
    await throwDrawResponseError(response);
  }

  const contentType = response.headers.get('content-type') || '';
  let fullText = '';

  if (response.body && (contentType.includes('text/event-stream') || contentType.includes('text/plain'))) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

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

        const parsed = safeJsonParse(joined);
        if (parsed) {
          const imageUrl = extractImageUrlFromPayload(parsed);
          if (imageUrl) {
            onImage(imageUrl);
            return;
          }
          const text = extractTextFromEvent(parsed);
          if (text) fullText += text;
        }
      }
    }

    if (buffer.trim()) {
      const parsed = safeJsonParse(buffer.trim());
      if (parsed) {
        const imageUrl = extractImageUrlFromPayload(parsed);
        if (imageUrl) {
          onImage(imageUrl);
          return;
        }
        const text = extractTextFromEvent(parsed);
        if (text) fullText += text;
      }
    }
  } else {
    const plainText = await response.text();
    const parsed = safeJsonParse(plainText);
    if (parsed) {
      const imageUrl = extractImageUrlFromPayload(parsed);
      if (imageUrl) {
        onImage(imageUrl);
        return;
      }
      fullText = extractTextFromEvent(parsed) || plainText;
    } else {
      fullText = plainText;
    }
  }

  const imageUrl = extractImageUrlFromContent(fullText);
  if (imageUrl) {
    onImage(imageUrl);
    return;
  }

  if (fullText.includes('data:image/') || fullText.includes('base64')) {
    const dataMatch = fullText.match(/(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)/);
    if (dataMatch) {
      onImage(dataMatch[1]);
      return;
    }
  }

  throw createNoImageError(fullText, 'Chat API');
}

export async function generateImage({
  settings,
  prompt,
  referenceImage,
  size,
  quality,
  signal,
  onImage,
  onTaskStart,
  taskMetadata,
}) {
  const apiMode = settings.drawApiMode || 'images';

  if (settings.useProxy) {
    return generateImageViaTaskApi({
      settings,
      prompt,
      referenceImage,
      size,
      quality,
      signal,
      onImage,
      onTaskStart,
      taskMetadata,
    });
  }

  const url = resolveDrawProxyUrl(settings, apiMode);
  const headers = buildDrawHeaders(settings, apiMode);
  const model = 'gpt-image-2';

  if (apiMode === 'chat') {
    return generateImageViaChatApi({ url, headers, model, prompt, referenceImage, size, quality, signal, onImage });
  }

  return generateImageViaImagesApi({ url, headers, model, prompt, referenceImage, size, quality, signal, onImage });
}
