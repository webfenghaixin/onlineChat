export const config = { runtime: 'edge' };

import {
  jsonResponse,
  handleOptions,
  authenticate,
  createRedis,
  setRedisJson,
} from '../lib/auth-utils.js';

export default async function handler(request) {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'POST') return jsonResponse(405, { error: '仅支持 POST 请求' });

  const redis = createRedis();
  if (!redis) return jsonResponse(500, { error: '数据库未配置，请联系管理员' });

  const auth = await authenticate(request);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: '请求格式错误' });
  }

  const { conversations, settings, activeConversationId } = body;

  if (!Array.isArray(conversations) || !settings) {
    return jsonResponse(400, { error: '数据格式错误' });
  }

  await setRedisJson(redis, `data:${auth.username}`, {
    conversations,
    settings,
    activeConversationId,
    updatedAt: Date.now(),
  });

  return jsonResponse(200, { ok: true });
}
