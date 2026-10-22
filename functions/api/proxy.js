const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Source, X-Pricing',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UPSTREAM_ENDPOINT = 'https://www.rightapi.ai/v1/chat/completions';

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

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Only POST is allowed.' });
  }

  const serverApiKey = env.API_KEY_CHAT || '';
  const contentType = request.headers.get('content-type') || 'application/json';
  const authorization = serverApiKey ? `Bearer ${serverApiKey}` : '';

  let requestBody;
  try {
    requestBody = await request.text();
  } catch {
    return jsonResponse(400, { error: 'Failed to read request body.' });
  }

  const upstreamHeaders = {
    'Content-Type': contentType,
  };
  if (authorization) {
    upstreamHeaders.Authorization = authorization;
  }

  try {
    const upstreamResponse = await fetch(UPSTREAM_ENDPOINT, {
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

    const cacheControl = upstreamResponse.headers.get('cache-control');
    if (cacheControl) {
      responseHeaders['Cache-Control'] = cacheControl;
    }

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
      error: 'Proxy request failed.',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
