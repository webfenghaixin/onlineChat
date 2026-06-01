'use strict';

const SOURCE_ENV_MAP = {
  luxee: {
    key: 'API_KEY_LUXEE',
    endpoint: 'API_ENDPOINT_LUXEE',
  },
  rightcode: {
    key: 'API_KEY_RIGHTCODE',
    endpoint: 'API_ENDPOINT_RIGHTCODE',
  },
};

exports.main = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod || 'POST';

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Source',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    };
  }

  if (method !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        error: 'Only POST is allowed.',
      }),
    };
  }

  const headers = event.headers || {};
  const source = (headers['x-source'] || headers['X-Source'] || 'luxee').toLowerCase();
  const sourceConfig = SOURCE_ENV_MAP[source];

  if (!sourceConfig) {
    return {
      statusCode: 400,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        error: `Unknown source: ${source}. Available: luxee, rightcode.`,
      }),
    };
  }

  const serverApiKey = process.env[sourceConfig.key] || '';
  const serverEndpoint = process.env[sourceConfig.endpoint] || '';

  if (!serverEndpoint) {
    return {
      statusCode: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        error: `Server endpoint not configured for source: ${source}.`,
      }),
    };
  }

  const requestBody = typeof event.body === 'string' ? event.body : JSON.stringify(event.body || {});

  const upstreamHeaders = {
    'Content-Type': headers['content-type'] || headers['Content-Type'] || 'application/json',
  };
  if (serverApiKey) {
    upstreamHeaders.Authorization = `Bearer ${serverApiKey}`;
  }

  try {
    const response = await fetch(serverEndpoint, {
      method: 'POST',
      headers: upstreamHeaders,
      body: requestBody,
    });

    const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8';
    const text = await response.text();

    return {
      statusCode: response.status,
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
      },
      body: text,
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        error: 'Proxy request failed.',
        detail: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};
