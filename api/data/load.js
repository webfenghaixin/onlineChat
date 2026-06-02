export const config = { runtime: 'edge' };

import {
  jsonResponse,
  handleOptions,
  authenticate,
  createRedis,
  getRedisJson,
} from '../lib/auth-utils.js';

export default async function handler(request) {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET') return jsonResponse(405, { error: '仅支持 GET 请求' });

  const redis = createRedis();
  if (!redis) return jsonResponse(500, { error: '数据库未配置，请联系管理员' });

  const auth = await authenticate(request);
  if (auth.error) return auth.error;

  const data = await getRedisJson(redis, `data:${auth.username}`);
  if (!data) {
    return jsonResponse(200, { conversations: [], settings: null, activeConversationId: null });
  }

  return jsonResponse(200, {
    conversations: data.conversations || [],
    settings: data.settings || null,
    activeConversationId: data.activeConversationId || null,
  });
}
