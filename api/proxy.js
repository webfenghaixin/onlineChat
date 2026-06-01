export const config = {
  runtime: 'edge',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Target-URL',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

  const targetUrl = request.headers.get('x-target-url');
  if (!targetUrl || !targetUrl.trim()) {
    return jsonResponse(400, { error: 'Missing X-Target-URL header.' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return jsonResponse(400, { error: 'Invalid target URL.' });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return jsonResponse(400, { error: 'Target URL must use http or https.' });
  }

  const contentType = request.headers.get('content-type') || 'application/json';
  const authorization = request.headers.get('authorization') || '';

  let requestBody;
  try {
    requestBody = await request.text();
  } catch {
    return jsonResponse(400, { error: 'Failed to read request body.' });
  }

  try {
    const upstreamResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        Authorization: authorization,
      },
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
