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
  return 'https://www.right.codes/draw/v1/chat/completions';
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

function extractImageUrlFromContent(content) {
  if (!content || typeof content !== 'string') return null;

  // 匹配 markdown 图片语法 ![...](url)
  const mdMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
  if (mdMatch) return mdMatch[1];

  // 匹配 markdown 图片语法 ![...](data:image/...)
  const mdDataMatch = content.match(/!\[.*?\]\((data:image\/[^;]+;base64,[^\s)]+)\)/);
  if (mdDataMatch) return mdDataMatch[1];

  // 匹配纯 URL（以 http 开头，常见图片后缀或不含后缀的 CDN 链接）
  const urlMatch = content.match(/(https?:\/\/[^\s"'<>]+\.(?:png|jpg|jpeg|webp|gif)[^\s"'<>]*)/i);
  if (urlMatch) return urlMatch[1];

  // 匹配 data:image base64
  const dataMatch = content.match(/(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)/);
  if (dataMatch) return dataMatch[1];

  return null;
}

export async function generateImage({ settings, prompt, referenceImage, size, quality, signal, onImage }) {
  const url = resolveDrawProxyUrl(settings);

  // 构建 user content：图生图时用数组格式，纯文生图用字符串
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
    model: 'gpt-image-2',
    messages: [
      {
        role: 'user',
        content: userContent,
      },
    ],
    stream: true,
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

  // 流式读取，收集完整文本后提取图片
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

      // 解析 SSE 格式
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
          const text = extractTextFromEvent(parsed);
          if (text) fullText += text;
        }
      }
    }

    // 处理 buffer 中剩余内容
    if (buffer.trim()) {
      const parsed = safeJsonParse(buffer.trim());
      if (parsed) {
        const text = extractTextFromEvent(parsed);
        if (text) fullText += text;
      }
    }
  } else {
    // 非流式响应
    const plainText = await response.text();
    const parsed = safeJsonParse(plainText);
    if (parsed) {
      fullText = extractTextFromEvent(parsed) || plainText;
    } else {
      fullText = plainText;
    }
  }

  // 从完整文本中提取图片 URL
  const imageUrl = extractImageUrlFromContent(fullText);
  if (imageUrl) {
    onImage(imageUrl);
    return;
  }

  // 如果文本本身就是 base64 图片数据
  if (fullText.includes('data:image/') || fullText.includes('base64')) {
    const dataMatch = fullText.match(/(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)/);
    if (dataMatch) {
      onImage(dataMatch[1]);
      return;
    }
  }

  // 如果没有提取到图片，可能是纯文本描述，也把完整内容传回
  throw new Error(`图片生成完成但未提取到图片。接口返回内容：${fullText.slice(0, 200)}`);
}
