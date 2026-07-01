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

  // 只加载活动聊天对话的完整消息
  const resultConversations = conversations.map((conv) => ({
    ...conv,
    messages: [],
  }));

  if (activeId) {
    const activeConvData = await getRedisJson(redis, `data:${username}:conv:${activeId}`);
    if (activeConvData && Array.isArray(activeConvData.messages)) {
      const idx = resultConversations.findIndex((c) => c.id === activeId);
      if (idx >= 0) {
        resultConversations[idx] = {
          ...resultConversations[idx],
          ...activeConvData,
          messages: activeConvData.messages,
        };
      }
    }
  }

  // 只加载活动画图对话的完整消息
  const resultDrawConversations = drawConversations.map((conv) => ({
    ...conv,
    messages: [],
  }));

  if (activeDrawId) {
    const activeDrawData = await getRedisJson(redis, `data:${username}:draw:${activeDrawId}`);
    if (activeDrawData && Array.isArray(activeDrawData.messages)) {
      const idx = resultDrawConversations.findIndex((c) => c.id === activeDrawId);
      if (idx >= 0) {
        resultDrawConversations[idx] = {
          ...resultDrawConversations[idx],
          ...activeDrawData,
          messages: activeDrawData.messages,
        };
      }
    }
  }

  return jsonResponse(200, {
    conversations: resultConversations,
    settings: meta.settings || null,
    activeConversationId: activeId,
    drawConversations: resultDrawConversations,
    activeDrawConversationId: activeDrawId,
  });
}
