const SSE_BOUNDARY = '\n\n';

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

function resolveDrawProxyUrl(settings) {
  if (settings.useProxy) {
    const proxyPath = settings.proxyPath?.trim() || '/api/proxy';
    // 将 /proxy 替换为 /draw
    const drawPath = proxyPath.replace(/\/proxy\/?$/, '/draw').replace(/\/proxy$/, '/draw');
    if (/^https?:\/\//i.test(drawPath)) {
      return drawPath;
    }
    return drawPath.startsWith('/') ? drawPath : `/${drawPath}`;
  }
  return 'https://www.right.codes/draw';
}

function buildDrawHeaders(settings) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (settings.useProxy) {
    headers['X-Source'] = settings.source || 'rightcode';
  } else if (settings.apiKey.trim()) {
    headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
  }

  return headers;
}

export async function generateImage({ settings, prompt, size, quality, signal, onImage }) {
  const url = resolveDrawProxyUrl(settings);
  const body = JSON.stringify({
    model: 'gpt-image-2',
    prompt,
    n: 1,
    size: size || '1024x1024',
    quality: quality || 'medium',
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: buildDrawHeaders(settings),
    body,
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '请求失败');
    throw new Error(`图片生成接口返回 ${response.status}：${errorText}`);
  }

  const data = await response.json();

  // 兼容多种返回格式
  if (Array.isArray(data?.data) && data.data.length > 0) {
    const item = data.data[0];
    if (item.b64_json) {
      onImage(`data:image/png;base64,${item.b64_json}`);
      return;
    }
    if (item.url) {
      onImage(item.url);
      return;
    }
  }

  // 兼容直接返回 url 或 b64_json 的情况
  if (data?.url) {
    onImage(data.url);
    return;
  }
  if (data?.b64_json) {
    onImage(`data:image/png;base64,${data.b64_json}`);
    return;
  }

  throw new Error('图片生成接口未返回有效的图片数据。');
}
