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

  const url = new URL(request.url);
  const conversationId = url.searchParams.get('id');

  if (!conversationId) {
    return jsonResponse(400, { error: '缺少对话ID参数' });
  }

  const data = await getRedisJson(redis, `data:${auth.username}`);
  if (!data || !Array.isArray(data.conversations)) {
    return jsonResponse(404, { error: '对话不存在' });
  }

  const conversation = data.conversations.find((c) => c.id === conversationId);
  if (!conversation) {
    return jsonResponse(404, { error: '对话不存在' });
  }

  return jsonResponse(200, {
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    messages: conversation.messages || [],
  });
}
