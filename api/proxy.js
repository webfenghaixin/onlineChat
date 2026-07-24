export const config = {
  runtime: 'edge',
};

import {
  verifyJWT,
  createRedis,
  getRedisJson,
  chargeUser,
  COST_CHAT,
} from './lib/auth-utils.js';
import { waitUntil } from '@vercel/functions';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Source, X-Model, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GEMINI_BASE_URL = 'https://www.rightapi.ai/gemini';
const GEMINI_DEFAULT_MODEL = 'gemini-3.1-pro';
const GEMINI_MODEL_PREFIX = 'gemini-';

const SOURCE_ENV_MAP = {
  luxee: {
    key: 'API_KEY_LUXEE',
    endpoint: 'https://api.luxee.ai/v1/chat/completions',
  },
  rightcode: {
    key: 'API_KEY_RIGHTCODE',
    endpoint: 'https://www.rightapi.ai/codex/v1/chat/completions',
  },
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

function isGeminiModel(model) {
  return String(model || '').toLowerCase().startsWith(GEMINI_MODEL_PREFIX);
}

async function authenticateEdge(request) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return { error: jsonResponse(401, { error: '未登录，请重新登录' }) };

  const jwtSecret = process.env.JWT_SECRET || '';
  if (!jwtSecret) return { error: jsonResponse(500, { error: '服务端未配置 JWT_SECRET' }) };

  const payload = await verifyJWT(token, jwtSecret);
  if (!payload || !payload.username) {
    return { error: jsonResponse(401, { error: '登录已过期，请重新登录' }) };
  }
  return { username: payload.username };
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { error: 'Only POST is allowed.' });
  }

  // 鉴权
  const auth = await authenticateEdge(request);
  if (auth.error) return auth.error;

  // 余额预检：低于单次费用直接拒绝
  const redis = createRedis();
  if (redis) {
    const user = await getRedisJson(redis, `user:${auth.username}`);
    const balance = Number.isFinite(Number(user?.balance)) ? Number(user.balance) : 0;
    if (balance < COST_CHAT - 0.0001) {
      return jsonResponse(402, {
        error: '余额不足',
        code: 'INSUFFICIENT_BALANCE',
        balance,
        cost: COST_CHAT,
      });
    }
  }

  const source = (request.headers.get('x-source') || 'luxee').toLowerCase();
  const requestedModel = request.headers.get('x-model') || '';
  const sourceConfig = SOURCE_ENV_MAP[source];

  if (!sourceConfig) {
    return jsonResponse(400, { error: `Unknown source: ${source}. Available: luxee, rightcode.` });
  }

  const serverApiKey = process.env[sourceConfig.key] || '';
  const contentType = request.headers.get('content-type') || 'application/json';

  let requestBody;
  try {
    requestBody = await request.text();
  } catch {
    return jsonResponse(400, { error: 'Failed to read request body.' });
  }

  let parsedBody = null;
  if (contentType.includes('application/json')) {
    try {
      parsedBody = JSON.parse(requestBody || '{}');
    } catch {
      parsedBody = null;
    }
  }
  const hasGeminiPayloadShape = Array.isArray(parsedBody?.contents);
  const geminiModel = requestedModel || parsedBody?.model || GEMINI_DEFAULT_MODEL;
  const useGeminiEndpoint = source === 'rightcode' && (isGeminiModel(requestedModel) || hasGeminiPayloadShape);
  const targetUrl = useGeminiEndpoint
    ? `${GEMINI_BASE_URL}/v1beta/models/${geminiModel}:streamGenerateContent?alt=sse`
    : sourceConfig.endpoint || '';

  if (!targetUrl) {
    return jsonResponse(500, { error: `Server endpoint not configured for source: ${source}.` });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    return jsonResponse(500, { error: 'Invalid server endpoint configuration.' });
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return jsonResponse(500, { error: 'Server endpoint must use http or https.' });
  }

  const upstreamHeaders = {
    'Content-Type': contentType,
    Accept: useGeminiEndpoint ? 'text/event-stream' : request.headers.get('accept') || '*/*',
  };
  if (serverApiKey) {
    if (useGeminiEndpoint) {
      upstreamHeaders['x-goog-api-key'] = serverApiKey;
    } else {
      upstreamHeaders.Authorization = `Bearer ${serverApiKey}`;
    }
  }

  try {
    const upstreamResponse = await fetch(targetUrl, {
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

    // 仅当上游返回 2xx 时扣费；失败/错误响应不扣费
    if (upstreamResponse.ok && redis && auth.username) {
      const username = auth.username;
      waitUntil(
        chargeUser(redis, username, COST_CHAT).catch(() => {}),
      );
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
