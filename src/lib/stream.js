import { getToken } from './auth';
import { DEFAULT_PROXY_PATH } from './constants';

const SSE_BOUNDARY = '\n\n';
const DRAW_TASK_FIRST_POLL_DELAY_MS = 30000;
const DRAW_TASK_POLL_INTERVAL_MS = 5000;
const DRAW_TASK_MAX_DURATION_MS = 5 * 60 * 1000;
const GEMINI_MODEL_PREFIX = 'gemini-';

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

function isGeminiModel(model) {
  return String(model || '').toLowerCase().startsWith(GEMINI_MODEL_PREFIX);
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

// 剥离历史消息中的图片 data URL，只保留最后一条用户消息的图片
// 用于控制请求体大小，避免 Vercel 4.5MB 限制
export function stripHistoricalImages(messages, keepLastUserImages = true) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages;
  }

  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  return messages.map((message, index) => {
    if (typeof message.content !== 'object' || !Array.isArray(message.content)) {
      return message;
    }

    // 非最后一条用户消息：剥离图片
    if (!keepLastUserImages || index !== lastUserIndex) {
      const textOnlyContent = message.content.filter((part) => part?.type !== 'image_url');
      if (textOnlyContent.length === 0) {
        return { ...message, content: [{ type: 'text', text: '[图片]' }] };
      }
      return { ...message, content: textOnlyContent };
    }

    // 最后一条用户消息：保留图片
    return message;
  });
}

function extractTextFromEvent(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  if (Array.isArray(payload.candidates)) {
    return payload.candidates
      .map((candidate) =>
        (candidate?.content?.parts || [])
          .map((part) => (typeof part?.text === 'string' ? part.text : ''))
          .join(''),
      )
      .join('');
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

function dataUrlToInlineData(url) {
  if (typeof url !== 'string') {
    return null;
  }

  const match = url.match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    return null;
  }

  return {
    mime_type: match[1],
    data: match[2],
  };
}

function buildGeminiRequestBody(settings, messages) {
  const normalizedMessages = buildMessagesPayload(messages, settings.systemPrompt);
  const systemMessage = normalizedMessages.find((message) => message.role === 'system');
  const conversationMessages = normalizedMessages.filter((message) => message.role !== 'system');

  const contents = conversationMessages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: message.content
      .map((item) => {
        if (item?.type === 'text' && typeof item.text === 'string' && item.text) {
          return { text: item.text };
        }

        if (item?.type === 'image_url') {
          const inlineData = dataUrlToInlineData(item.image_url?.url);
          if (inlineData) {
            return { inline_data: inlineData };
          }
        }

        return null;
      })
      .filter(Boolean),
  }));

  return {
    contents,
    systemInstruction: systemMessage
      ? {
          parts: systemMessage.content
            .filter((item) => item?.type === 'text' && item.text)
            .map((item) => ({ text: item.text })),
        }
      : undefined,
    generationConfig: {
      temperature: settings.temperature,
      maxOutputTokens: Number(settings.maxOutputTokens) || undefined,
    },
  };
}

function buildRequestBody(settings, messages) {
  const { model, temperature, maxOutputTokens, stream, systemPrompt } = settings;
  if (isGeminiModel(model)) {
    return buildGeminiRequestBody(settings, messages);
  }

  const normalizedMessages = buildMessagesPayload(messages, systemPrompt);

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
  if (settings.useProxy !== false) {
    const proxyPath = settings.proxyPath?.trim() || DEFAULT_PROXY_PATH;
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

  if (settings.useProxy !== false) {
    headers['X-Source'] = settings.source || 'luxee';
    headers['X-Model'] = settings.model || '';
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
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
  // 归一化换行符，兼容服务端以 \r\n 分隔事件的情况
  let workingBuffer = buffer.replace(/\r\n/g, '\n');

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

    // 非 JSON 的 data 行视为脏数据丢弃，避免原文透传到聊天区
    console.warn('[sse] unparseable data line', joined.slice(0, 100));
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

    // 非 JSON 行视为脏数据丢弃，避免原文透传到聊天区
    console.warn('[sse] unparseable json line', line.slice(0, 100));
  }

  return remaining;
}

export async function streamChatCompletion({ settings, messages, signal, onText }) {
  const strippedMessages = stripHistoricalImages(messages);
  const response = await fetch(resolveRequestUrl(settings), {
    method: 'POST',
    headers: buildRequestHeaders(settings),
    body: JSON.stringify(cleanUndefinedValues(buildRequestBody(settings, strippedMessages))),
    signal,
  });

  if (!response.ok) {
    const errorText = await readAsText(response);
    let code;
    try {
      const parsed = JSON.parse(errorText);
      code = parsed?.code;
    } catch {}
    const err = new Error(`接口返回 ${response.status}：${errorText}`);
    err.status = response.status;
    err.code = code;
    throw err;
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

    // 流式模式下无换行的裸 chunk 无法判定格式，丢弃避免把 JSON 碎片当正文透传；
    // 非流式（stream === false）仍按原文兜底输出
    if (settings.stream === false) {
      onText(buffer);
    } else {
      console.warn('[sse] drop bare chunk without newline', buffer.slice(0, 100));
    }
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
    const proxyPath = settings.proxyPath?.trim() || DEFAULT_PROXY_PATH;
    const drawPath = proxyPath.replace(/\/proxy\/?$/, '/draw').replace(/\/proxy$/, '/draw');
    if (/^https?:\/\//i.test(drawPath)) {
      return drawPath;
    }
    return drawPath.startsWith('/') ? drawPath : `/${drawPath}`;
  }
  const basePath = 'https://www.rightapi.ai/draw';
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
  const proxyPath = settings.proxyPath?.trim() || DEFAULT_PROXY_PATH;
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
  let code;
  try {
    const parsed = JSON.parse(errorText);
    code = parsed?.code;
  } catch {}
  const err = new Error(normalizeDrawErrorMessage(errorText, response.status));
  err.status = response.status;
  err.code = code;
  throw err;
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
  referenceImages,
  size,
  quality,
  signal,
  onImage,
  onTaskStart,
  taskMetadata,
}) {
  const apiMode = 'images'; // 写死 Images API
  const startedAt = Date.now();
  const startResponse = await fetch(resolveDrawTaskUrl(settings, 'start'), {
    method: 'POST',
    headers: getAuthorizedHeaders(),
    body: JSON.stringify({
      apiMode,
      source: settings.source || 'rightcode',
      prompt,
      referenceImages: Array.isArray(referenceImages) ? referenceImages : [],
      size: size || '1024x1024',
      quality: quality || 'medium',
      model: settings.drawModel || 'gpt-image-2',
      taskMetadata,
    }),
    signal,
  });

  const startData = await readJsonResponse(startResponse);
  if (!startResponse.ok) {
    const err = new Error(
      normalizeDrawErrorMessage(
        startData.error || `创建绘图任务失败 (${startResponse.status})`,
        startResponse.status,
      ),
    );
    err.status = startResponse.status;
    err.code = startData.code;
    throw err;
  }

  const taskId = startData.taskId;
  if (!taskId) {
    throw new Error('创建绘图任务失败：服务端没有返回任务 ID。');
  }
  onTaskStart?.(taskId);

  return pollDrawTask({ settings, taskId, startedAt, signal, onImage });
}

export async function pollDrawTask({ settings, taskId, startedAt, signal, onImage }) {
  let isFirstPoll = true;
  while (true) {
    const elapsed = Date.now() - Number(startedAt || Date.now());
    if (elapsed >= DRAW_TASK_MAX_DURATION_MS) {
      throw new Error('图片生成超时（已超过 5 分钟），已自动停止。');
    }

    let delay;
    if (isFirstPoll) {
      // 首次轮询：从请求发送算起 30 秒后开始（扣除 start 请求已耗时间）
      delay = Math.max(0, DRAW_TASK_FIRST_POLL_DELAY_MS - elapsed);
      isFirstPoll = false;
    } else {
      // 后续轮询：上一次轮询返回后等待 5 秒
      delay = DRAW_TASK_POLL_INTERVAL_MS;
    }

    // 等待时长不超过 5 分钟总时长剩余部分
    const remaining = DRAW_TASK_MAX_DURATION_MS - (Date.now() - Number(startedAt || Date.now()));
    if (remaining <= 0) {
      throw new Error('图片生成超时（已超过 5 分钟），已自动停止。');
    }
    await abortableDelay(Math.min(delay, remaining), signal);

    try {
      const statusUrl = new URL(resolveDrawTaskUrl(settings, 'status'), window.location.origin);
      statusUrl.searchParams.set('id', taskId);

      const statusResponse = await fetch(statusUrl.toString(), {
        method: 'GET',
        headers: getAuthorizedHeaders(),
        signal,
      });
      const statusData = await readJsonResponse(statusResponse);

      if (!statusResponse.ok) {
        // Authentication and a missing task cannot recover on their own.
        // A temporary gateway error must not turn a server-side task into a
        // client-side failure while the task is still running.
        if (statusResponse.status === 401 || statusResponse.status === 403 || statusResponse.status === 404) {
          throw new Error(
            normalizeDrawErrorMessage(
              statusData.error || `Task status lookup failed (${statusResponse.status})`,
              statusResponse.status,
            ),
          );
        }
        continue;
      }

      if (statusData.status === 'succeeded' && statusData.imageUrl) {
        onImage(statusData.imageUrl, {
          createdAt: statusData.createdAt,
          completedAt: statusData.completedAt,
        }, taskId);
        return;
      }

      if (statusData.status === 'failed') {
        throw new Error(normalizeDrawErrorMessage(statusData.error || 'Task failed.'));
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      // Browser fetch rejections such as "Load failed" only mean this poll
      // failed. The task lives on the server, so wait for its final state.
      if (error instanceof TypeError) continue;
      throw error;
    }
  }
}

// /v1/images/generations 模式：非流式，直接返回 JSON
async function generateImageViaImagesApi({ url, headers, model, prompt, referenceImages, size, quality, signal, onImage }) {
  const images = Array.isArray(referenceImages) ? referenceImages.filter(Boolean) : [];
  const body = JSON.stringify({
    model,
    prompt,
    image: images.length > 0 ? images : undefined,
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
async function generateImageViaChatApi({ url, headers, model, prompt, referenceImages, size, quality, signal, onImage }) {
  const images = Array.isArray(referenceImages) ? referenceImages.filter(Boolean) : [];
  const sizeHint = size ? `，图片尺寸${size}` : '';
  const qualityHint = quality ? `，画质${quality}` : '';
  const refHint = images.length > 0 ? `请参考这${images.length}张图片，` : '请根据以下描述生成图片：';
  const textPart = `${refHint}${prompt}${sizeHint}${qualityHint}`;

  let userContent;
  if (images.length > 0) {
    userContent = [
      { type: 'text', text: textPart },
      ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
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
  referenceImages,
  size,
  quality,
  signal,
  onImage,
  onTaskStart,
  taskMetadata,
}) {
  const apiMode = 'images'; // 写死 Images API

  if (settings.useProxy) {
    return generateImageViaTaskApi({
      settings,
      prompt,
      referenceImages,
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
  const model = settings.drawModel || 'gpt-image-2';

  if (apiMode === 'chat') {
    return generateImageViaChatApi({ url, headers, model, prompt, referenceImages, size, quality, signal, onImage });
  }

  return generateImageViaImagesApi({ url, headers, model, prompt, referenceImages, size, quality, signal, onImage });
}

// 批量制图：前端一次请求创建N个任务，后端异步执行，前端并行轮询
export async function generateImageBatch({
  settings,
  prompt,
  referenceImages,
  size,
  quality,
  count,
  signal,
  onImage,
  onTaskStart,
  onTasksCreated,
  taskMetadata,
}) {
  const startedAt = Date.now();
  const response = await fetch(resolveDrawTaskUrl(settings, 'batch'), {
    method: 'POST',
    headers: getAuthorizedHeaders(),
    body: JSON.stringify({
      apiMode: 'images', // 写死 Images API
      source: settings.source || 'rightcode',
      prompt,
      referenceImages: Array.isArray(referenceImages) ? referenceImages : [],
      size: size || '1024x1024',
      quality: quality || 'medium',
      model: settings.drawModel || 'gpt-image-2',
      count,
      taskMetadata,
    }),
    signal,
  });

  const data = await readJsonResponse(response);
  if (!response.ok) {
    const err = new Error(
      normalizeDrawErrorMessage(
        data.error || `批量创建绘图任务失败 (${response.status})`,
        response.status,
      ),
    );
    err.status = response.status;
    err.code = data.code;
    throw err;
  }

  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  if (tasks.length === 0) {
    throw new Error('创建绘图任务失败：服务端没有返回任务 ID。');
  }

  // 通知前端每个 message 对应的 taskId
  for (const { messageId, taskId } of tasks) {
    onTaskStart?.(taskId, messageId);
  }

  // 任务已创建完成，通知调用方可以释放提交锁（不等轮询完成）
  onTasksCreated?.();

  // 并行轮询所有任务（轮询是轻量 GET，无锁竞争）
  // 用 allSettled：单个任务失败不中断其他轮询，由调用方根据结果处理
  const results = await Promise.allSettled(
    tasks.map(({ messageId, taskId }) =>
      pollDrawTask({ settings, taskId, startedAt, signal, onImage })
        .then(() => ({ messageId, ok: true }))
        .catch((error) => {
          if (error?.name === 'AbortError') throw error;
          return { messageId, ok: false, error: error.message || '图片生成失败，请重试。' };
        })
    )
  );

  // AbortError 仍需抛出
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
  }

  return results.map((result) => result.value);
}
