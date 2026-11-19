export const config = { runtime: 'edge' };

// 账号相关合并接口：改密码 / 查余额 / 充值 / 保存用户数据
// GET  ?action=balance
// POST { action: 'change-password' | 'recharge' | 'save-data', ... }
import {
  jsonResponse,
  handleOptions,
  authenticate,
  hashPasswordV2,
  verifyPassword,
  createRedis,
  getRedisJson,
  setRedisJson,
  getUserBalance,
  rechargeUser,
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

async function handleChangePassword(redis, username, body) {
  const { oldPassword, newPassword } = body;

  if (!oldPassword || !newPassword || typeof oldPassword !== 'string' || typeof newPassword !== 'string') {
    return jsonResponse(400, { error: '请输入旧密码和新密码' });
  }
  if (newPassword.length < 6) {
    return jsonResponse(400, { error: '新密码至少 6 位' });
  }

  const userKey = `user:${username}`;
  const user = await getRedisJson(redis, userKey);
  if (!user || !user.salt || !user.passwordHash) {
    return jsonResponse(404, { error: '用户不存在' });
  }
  if (!(await verifyPassword(user, oldPassword))) {
    return jsonResponse(400, { error: '旧密码不正确' });
  }

  const v2 = await hashPasswordV2(newPassword);
  user.salt = v2.salt;
  user.passwordHash = v2.hash;
  user.passwordAlgo = v2.algo;
  user.passwordIterations = v2.iterations;
  await setRedisJson(redis, userKey, user);

  return jsonResponse(200, { ok: true });
}

async function handleRecharge(redis, username, body) {
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return jsonResponse(400, { error: '充值金额必须为正数' });
  }
  if (amount > 10000) {
    return jsonResponse(400, { error: '单次充值上限 10000 元' });
  }

  const expectedCode = process.env.RECHARGE_CODE || '';
  if (!expectedCode) {
    return jsonResponse(503, { error: '充值通道未开启' });
  }

  const inputCode = typeof body?.code === 'string' ? body.code : '';
  let codeMatch = false;
  if (inputCode.length === expectedCode.length) {
    let diff = 0;
    for (let i = 0; i < expectedCode.length; i += 1) {
      diff |= inputCode.charCodeAt(i) ^ expectedCode.charCodeAt(i);
    }
    codeMatch = diff === 0;
  }
  if (!codeMatch) {
    return jsonResponse(403, { error: '充值码错误' });
  }

  const result = await rechargeUser(redis, username, amount);
  if (!result.ok) {
    return jsonResponse(400, { error: result.reason || '充值失败' });
  }
  return jsonResponse(200, { balance: result.balance, ok: true });
}

async function handleSaveData(redis, username, body) {
  const { conversations, settings, activeConversationId, drawConversations, activeDrawConversationId } = body;

  if (!Array.isArray(conversations) || !settings) {
    return jsonResponse(400, { error: '数据格式错误' });
  }

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

export default async function handler(request) {
  if (request.method === 'OPTIONS') return handleOptions();

  const redis = createRedis();
  if (!redis) return jsonResponse(500, { error: '数据库未配置，请联系管理员' });

  const auth = await authenticate(request);
  if (auth.error) return auth.error;

  if (request.method === 'GET') {
    const balance = await getUserBalance(redis, auth.username);
    return jsonResponse(200, { balance, username: auth.username });
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { error: '仅支持 GET / POST 请求' });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: '请求格式错误' });
  }

  // 显式 action 优先，兼容旧调用按字段推断
  const action = body?.action
    || (body?.oldPassword !== undefined ? 'change-password'
      : body?.amount !== undefined ? 'recharge'
        : body?.conversations !== undefined ? 'save-data' : '');

  if (action === 'change-password') return handleChangePassword(redis, auth.username, body);
  if (action === 'recharge') return handleRecharge(redis, auth.username, body);
  if (action === 'save-data') return handleSaveData(redis, auth.username, body);

  return jsonResponse(400, { error: '缺少 action 参数' });
}
