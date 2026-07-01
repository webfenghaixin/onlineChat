export const config = { runtime: 'edge' };

import {
  jsonResponse,
  handleOptions,
  authenticate,
  createRedis,
  getRedisJson,
} from '../lib/auth-utils.js';

function buildConversationSummary(conversation) {
  const messages = conversation.messages || [];
  const firstUserMsg = messages.find((m) => m.role === 'user');
  let lastPreview = '';
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' || messages[i].role === 'user') {
      const content = Array.isArray(messages[i].content)
        ? messages[i].content.filter((p) => p?.type === 'text').map((p) => p.text).join(' ')
        : (typeof messages[i].content === 'string' ? messages[i].content : '');
      lastPreview = content.slice(0, 40);
      break;
    }
  }
  return {
    id: conversation.id,
    title: conversation.title || '新的对话',
    updatedAt: conversation.updatedAt || Date.now(),
    messageCount: messages.length,
    lastPreview,
    messages: [],
  };
}

function buildDrawConversationSummary(conversation) {
  const messages = conversation.messages || [];
  return {
    id: conversation.id,
    title: conversation.title || '新的画图',
    updatedAt: conversation.updatedAt || Date.now(),
    messageCount: messages.length,
    imageCount: messages.filter((m) => m.role === 'assistant' && m.imageUrl).length,
    messages: [],
  };
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'GET') return jsonResponse(405, { error: '仅支持 GET 请求' });

  const redis = createRedis();
  if (!redis) return jsonResponse(500, { error: '数据库未配置，请联系管理员' });

  const auth = await authenticate(request);
  if (auth.error) return auth.error;

  const data = await getRedisJson(redis, `data:${auth.username}`);
  if (!data) {
    return jsonResponse(200, {
      conversations: [],
      settings: null,
      activeConversationId: null,
      drawConversations: [],
      activeDrawConversationId: null,
    });
  }

  const allConversations = data.conversations || [];
  const allDrawConversations = data.drawConversations || [];
  const activeId = data.activeConversationId || (allConversations[0]?.id ?? null);
  const activeDrawId = data.activeDrawConversationId || (allDrawConversations[0]?.id ?? null);

  const conversations = allConversations.map((conv) => {
    if (conv.id === activeId) {
      return { ...conv, messageCount: (conv.messages || []).length };
    }
    return buildConversationSummary(conv);
  });

  const drawConversations = allDrawConversations.map((conv) => {
    if (conv.id === activeDrawId) {
      return { ...conv, imageCount: (conv.messages || []).filter((m) => m.role === 'assistant' && m.imageUrl).length, messageCount: (conv.messages || []).length };
    }
    return buildDrawConversationSummary(conv);
  });

  return jsonResponse(200, {
    conversations,
    settings: data.settings || null,
    activeConversationId: activeId,
    drawConversations,
    activeDrawConversationId: activeDrawId,
  });
}
