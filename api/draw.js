export const config = {
  maxDuration: 300,
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Source, X-Draw-Path',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DRAW_BASE = 'https://www.right.codes/draw';
const ALLOWED_DRAW_PATHS = ['/v1/images/generations', '/v1/chat/completions'];

function sendJson(res, statusCode, body, extraHeaders = {}) {
  res.statusCode = statusCode;
  for (const [key, value] of Object.entries({
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders,
  })) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(body));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function setCorsHeaders(res, extraHeaders = {}) {
  for (const [key, value] of Object.entries({ ...CORS_HEADERS, ...extraHeaders })) {
    res.setHeader(key, value);
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Only POST is allowed.' });
    return;
  }

  const source = String(req.headers['x-source'] || 'rightcode').toLowerCase();
  const envKey = source === 'rightcode' ? 'API_KEY_RIGHTCODE' : 'API_KEY_LUXEE';
  const serverApiKey = process.env[envKey] || '';

  const requestedDrawPath = String(req.headers['x-draw-path'] || '/v1/images/generations');
  const drawPath = ALLOWED_DRAW_PATHS.includes(requestedDrawPath)
    ? requestedDrawPath
    : '/v1/images/generations';
  const drawEndpoint = `${DRAW_BASE}${drawPath}`;

  let requestBody;
  try {
    requestBody = await readRequestBody(req);
  } catch (error) {
    sendJson(res, 400, {
      error: 'Failed to read request body.',
      detail: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const upstreamHeaders = {
    'Content-Type': req.headers['content-type'] || 'application/json',
  };
  if (serverApiKey) {
    upstreamHeaders.Authorization = `Bearer ${serverApiKey}`;
  }

  try {
    const upstreamResponse = await fetch(drawEndpoint, {
      method: 'POST',
      headers: upstreamHeaders,
      body: requestBody,
    });

    setCorsHeaders(res, {
      'Content-Type': upstreamResponse.headers.get('content-type') || 'application/octet-stream',
    });
    res.statusCode = upstreamResponse.status;

    const cacheControl = upstreamResponse.headers.get('cache-control');
    if (cacheControl) {
      res.setHeader('Cache-Control', cacheControl);
    }

    if (!upstreamResponse.body) {
      const text = await upstreamResponse.text();
      res.end(text);
      return;
    }

    const reader = upstreamResponse.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (error) {
    sendJson(res, 502, {
      error: 'Image generation request failed.',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
