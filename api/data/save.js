export const config = { runtime: 'edge' };

import {
  jsonResponse,
  handleOptions,
  authenticate,
  createRedis,
  getRedisJson,
  setRedisJson,
} from '../lib/auth-utils.js';

function buildLastPreview(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' || messages[i].role === 'user') {
      const content = Array.isArray(messages[i].content)
        ? messages[i].content.filter((p) => p?.type === 'text').map((p) => p.text).join(' ')
        : (typeof messages[i].content === 'string' ? messages[i].content : '');
      return content.slice(0, 40);
    }
  }
  return '';
}

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

function shouldWriteMessages(conversation, messages) {
  if (conversation?.messagesLoaded === true) return true;
  if (conversation?.messagesLoaded === false) return false;
  // 兼容旧客户端：未传 messagesLoaded 时延续原来的非空数组写入规则。
  return messages.length > 0;
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

  const username = auth.username;
  const metaKey = `data:${username}:meta`;
  const existingMeta = (await getRedisJson(redis, metaKey)) || {};

  // --- 清理已删除对话的分 key ---
  const incomingConvIds = new Set(conversations.map((c) => c.id));
  const incomingDrawConvIds = new Set((drawConversations || []).map((c) => c.id));
  const existingConvIds = new Set((existingMeta.conversations || []).map((c) => c.id));
  const existingDrawConvIds = new Set((existingMeta.drawConversations || []).map((c) => c.id));

  const deletePromises = [];
  for (const oldId of existingConvIds) {
    if (!incomingConvIds.has(oldId)) {
      deletePromises.push(redis.del(`data:${username}:conv:${oldId}`));
    }
  }
  for (const oldId of existingDrawConvIds) {
    if (!incomingDrawConvIds.has(oldId)) {
      deletePromises.push(redis.del(`data:${username}:draw:${oldId}`));
    }
  }
  if (deletePromises.length) await Promise.all(deletePromises);

  // --- 保存有消息的聊天对话到分 key ---
  const existingConvMeta = new Map((existingMeta.conversations || []).map((c) => [c.id, c]));
  const convSummaries = [];
  const convWritePromises = [];

  for (const conv of conversations) {
    const msgs = conv.messages || [];
    if (shouldWriteMessages(conv, msgs)) {
      convWritePromises.push(
        setRedisJson(redis, `data:${username}:conv:${conv.id}`, {
          id: conv.id,
          title: conv.title,
          updatedAt: conv.updatedAt || Date.now(),
          messages: msgs,
        }),
      );
      convSummaries.push({
        id: conv.id,
        title: conv.title || '新的对话',
        updatedAt: conv.updatedAt || Date.now(),
        messageCount: msgs.length,
        lastPreview: buildLastPreview(msgs),
      });
    } else {
      // 未加载或未变更正文的对话，保留 meta 中已有的摘要。
      const existing = existingConvMeta.get(conv.id);
      convSummaries.push(existing || {
        id: conv.id,
        title: conv.title || '新的对话',
        updatedAt: conv.updatedAt || Date.now(),
        messageCount: 0,
        lastPreview: '',
      });
    }
  }
  if (convWritePromises.length) await Promise.all(convWritePromises);

  // --- 保存有消息的画图对话到分 key（带 merge 逻辑） ---
  const existingDrawMeta = new Map((existingMeta.drawConversations || []).map((c) => [c.id, c]));
  const drawConvSummaries = [];

  // 先读取需要 merge 的画图对话
  const drawConvIdsWithMessages = (drawConversations || [])
    .filter((conv) => {
      const messages = conv.messages || [];
      return shouldWriteMessages(conv, messages) && messages.length > 0;
    })
    .map((conv) => conv.id);

  const existingDrawDataMap = new Map();
  if (drawConvIdsWithMessages.length) {
    const existingDrawResults = await Promise.all(
      drawConvIdsWithMessages.map((id) => getRedisJson(redis, `data:${username}:draw:${id}`)),
    );
    drawConvIdsWithMessages.forEach((id, i) => {
      if (existingDrawResults[i]) existingDrawDataMap.set(id, existingDrawResults[i]);
    });
  }

  const drawWritePromises = [];
  for (const conv of (drawConversations || [])) {
    const msgs = conv.messages || [];
    if (shouldWriteMessages(conv, msgs)) {
      // merge 保留画图任务状态（imageUrl/taskId 等）
      const existing = existingDrawDataMap.get(conv.id);
      let messagesToSave = msgs;
      if (existing && Array.isArray(existing.messages)) {
        const existingById = new Map(existing.messages.map((m) => [m.id, m]));
        messagesToSave = msgs.map((m) => mergeDrawMessage(m, existingById.get(m.id)));
      }
      drawWritePromises.push(
        setRedisJson(redis, `data:${username}:draw:${conv.id}`, {
          id: conv.id,
          title: conv.title,
          updatedAt: conv.updatedAt || Date.now(),
          messages: messagesToSave,
        }),
      );
      drawConvSummaries.push({
        id: conv.id,
        title: conv.title || '新的画图',
        updatedAt: conv.updatedAt || Date.now(),
        messageCount: messagesToSave.length,
        imageCount: messagesToSave.filter((m) => m.role === 'assistant' && m.imageUrl).length,
      });
    } else {
      const existing = existingDrawMeta.get(conv.id);
      drawConvSummaries.push(existing || {
        id: conv.id,
        title: conv.title || '新的画图',
        updatedAt: conv.updatedAt || Date.now(),
        messageCount: 0,
        imageCount: 0,
      });
    }
  }
  if (drawWritePromises.length) await Promise.all(drawWritePromises);

  // --- 保存 meta ---
  await setRedisJson(redis, metaKey, {
    settings,
    activeConversationId,
    activeDrawConversationId: activeDrawConversationId || null,
    conversations: convSummaries,
    drawConversations: drawConvSummaries,
    updatedAt: Date.now(),
  });

  return jsonResponse(200, { ok: true });
}
