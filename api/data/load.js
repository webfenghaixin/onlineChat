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

  const username = auth.username;
  const meta = await getRedisJson(redis, `data:${username}:meta`);

  if (!meta) {
    return jsonResponse(200, {
      conversations: [],
      settings: null,
      activeConversationId: null,
      drawConversations: [],
      activeDrawConversationId: null,
    });
  }

  const conversations = meta.conversations || [];
  const drawConversations = meta.drawConversations || [];
  const activeId = meta.activeConversationId || (conversations[0]?.id ?? null);
  const activeDrawId = meta.activeDrawConversationId || (drawConversations[0]?.id ?? null);

  // load 只返回会话目录。完整消息由客户端选中会话后通过
  // /api/data/conversation 或 /api/data/draw-conversation 按需加载。
  const resultConversations = conversations.map((conv) => ({
    ...conv,
    messages: [],
  }));
  const resultDrawConversations = drawConversations.map((conv) => ({
    ...conv,
    messages: [],
  }));

  return jsonResponse(200, {
    conversations: resultConversations,
    settings: meta.settings || null,
    activeConversationId: activeId,
    drawConversations: resultDrawConversations,
    activeDrawConversationId: activeDrawId,
  });
}
