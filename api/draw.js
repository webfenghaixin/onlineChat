export const config = {
  runtime: 'edge',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Source',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DRAW_ENDPOINT = 'https://www.right.codes/draw';

function jsonResponse(statusCode, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Only POST is allowed.' });
  }

  const source = (request.headers.get('x-source') || 'rightcode').toLowerCase();
  const envKey = source === 'rightcode' ? 'API_KEY_RIGHTCODE' : 'API_KEY_LUXEE';
  const serverApiKey = process.env[envKey] || '';

  let requestBody;
  try {
    requestBody = await request.text();
  } catch {
    return jsonResponse(400, { error: 'Failed to read request body.' });
  }

  const upstreamHeaders = {
    'Content-Type': 'application/json',
  };
  if (serverApiKey) {
    upstreamHeaders.Authorization = `Bearer ${serverApiKey}`;
  }

  try {
    const upstreamResponse = await fetch(DRAW_ENDPOINT, {
      method: 'POST',
      headers: upstreamHeaders,
      body: requestBody,
    });

    const responseContentType =
      upstreamResponse.headers.get('content-type') || 'application/octet-stream';

    const responseHeaders = {
      ...CORS_HEADERS,
      'Content-Type': responseContentType,
    };

    if (!upstreamResponse.body) {
      const text = await upstreamResponse.text();
      return new Response(text, {
        status: upstreamResponse.status,
        headers: responseHeaders,
      });
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return jsonResponse(502, {
      error: 'Image generation request failed.',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
