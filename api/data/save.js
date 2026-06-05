export const config = { runtime: 'edge' };

import {
  jsonResponse,
  handleOptions,
  authenticate,
  createRedis,
  getRedisJson,
  setRedisJson,
} from '../lib/auth-utils.js';

function mergeDrawMessage(incomingMessage, existingMessage) {
  if (!incomingMessage || !existingMessage) return incomingMessage;
  if (incomingMessage.role !== 'assistant' || existingMessage.role !== 'assistant') {
    return incomingMessage;
  }

  const imageUrl = incomingMessage.imageUrl || existingMessage.imageUrl || '';

  return {
    ...incomingMessage,
    imageUrl,
    error: imageUrl ? undefined : incomingMessage.error || existingMessage.error || undefined,
    taskId: incomingMessage.taskId || existingMessage.taskId || undefined,
    durationSeconds:
      typeof incomingMessage.durationSeconds === 'number'
        ? incomingMessage.durationSeconds
        : existingMessage.durationSeconds,
  };
}

function mergeDrawConversations(incomingConversations = [], existingConversations = []) {
  if (!Array.isArray(incomingConversations)) return [];
  if (!Array.isArray(existingConversations) || !existingConversations.length) {
    return incomingConversations;
  }

  const existingById = new Map(existingConversations.map((conversation) => [conversation.id, conversation]));

  return incomingConversations.map((incomingConversation) => {
    const existingConversation = existingById.get(incomingConversation.id);
    if (!existingConversation) return incomingConversation;

    const existingMessagesById = new Map(
      (existingConversation.messages || []).map((message) => [message.id, message]),
    );

    return {
      ...incomingConversation,
      messages: (incomingConversation.messages || []).map((message) =>
        mergeDrawMessage(message, existingMessagesById.get(message.id)),
      ),
    };
  });
}

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

  const { conversations, settings, activeConversationId, drawConversations, activeDrawConversationId } = body;

  if (!Array.isArray(conversations) || !settings) {
    return jsonResponse(400, { error: '数据格式错误' });
  }

  const dataKey = `data:${auth.username}`;
  const existingData = (await getRedisJson(redis, dataKey)) || {};
  const mergedDrawConversations = mergeDrawConversations(
    drawConversations || [],
    existingData.drawConversations || [],
  );

  await setRedisJson(redis, dataKey, {
    conversations,
    settings,
    activeConversationId,
    drawConversations: mergedDrawConversations,
    activeDrawConversationId: activeDrawConversationId || null,
    updatedAt: Date.now(),
  });

  return jsonResponse(200, { ok: true });
}
