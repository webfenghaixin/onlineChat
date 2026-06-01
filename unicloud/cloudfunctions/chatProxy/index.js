'use strict';

exports.main = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod || 'POST';

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Target-URL',
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
  const targetUrl = headers['x-target-url'] || headers['X-Target-URL'];

  if (!targetUrl) {
    return {
      statusCode: 400,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        error: 'Missing X-Target-URL header.',
      }),
    };
  }

  const requestBody = typeof event.body === 'string' ? event.body : JSON.stringify(event.body || {});

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': headers['content-type'] || headers['Content-Type'] || 'application/json',
        Authorization: headers.authorization || headers.Authorization || '',
      },
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
