export const config = {
  maxDuration: 300,
};

import { createRedis, getRedisJson, setRedisJson, verifyJWT, chargeUser, COST_DRAW, getUserBalance } from '../lib/auth-utils.js';
import { cleanDrawOptions, runDrawRequest } from '../lib/draw-utils.js';
import { waitUntil } from '@vercel/functions';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TASK_TTL_SECONDS = 24 * 60 * 60;
const IMAGE_TTL_SECONDS = 30 * 24 * 60 * 60;
const DRAW_DATA_LOCK_TTL_SECONDS = 15;
const DRAW_DATA_LOCK_WAIT_MS = 8000;
const DRAW_DATA_LOCK_RETRY_MS = 50;
const RELEASE_DRAW_DATA_LOCK_SCRIPT = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  end
  return 0
`;

function setCorsHeaders(res) {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }
}

function sendJson(res, statusCode, body) {
  setCorsHeaders(res);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function authenticateNodeRequest(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return { error: { status: 401, message: '未登录，请重新登录' } };

  const jwtSecret = process.env.JWT_SECRET || '';
  if (!jwtSecret) return { error: { status: 500, message: '服务端未配置 JWT_SECRET' } };

  const payload = await verifyJWT(token, jwtSecret);
  if (!payload?.username) return { error: { status: 401, message: '登录已过期，请重新登录' } };

  return { username: payload.username };
}

async function setTask(redis, key, task) {
  await redis.set(key, JSON.stringify(task), { ex: TASK_TTL_SECONDS });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withDrawDataLock(redis, username, action) {
  const lockKey = `drawDataLock:${username}`;
  const token = crypto.randomUUID();
  const deadline = Date.now() + DRAW_DATA_LOCK_WAIT_MS;

  while (Date.now() < deadline) {
    const acquired = await redis.set(lockKey, token, {
      nx: true,
      ex: DRAW_DATA_LOCK_TTL_SECONDS,
    });
    if (acquired) {
      try {
        return await action();
      } finally {
        await redis.eval(RELEASE_DRAW_DATA_LOCK_SCRIPT, [lockKey], [token]).catch(() => {});
      }
    }
    await wait(DRAW_DATA_LOCK_RETRY_MS);
  }

  throw new Error('画图记录更新繁忙，请稍后重试。');
}

function resolveTaskLockKey(task) {
  if (!task?.owner || !task?.id) return null;
  return `drawTaskLock:${task.owner}:${task.id}`;
}

function normalizeTaskMetadata(metadata, taskId) {
  if (!metadata || typeof metadata !== 'object') return null;
  const conversationId = String(metadata.conversationId || '');
  const userMessage = metadata.userMessage;
  const assistantMessage = metadata.assistantMessage;

  if (!conversationId || !userMessage?.id || !assistantMessage?.id) return null;

  const sanitizedUserMessage = userMessage.referenceImage
    ? { ...userMessage, referenceImage: undefined }
    : userMessage;

  return {
    conversationId,
    conversationTitle: String(metadata.conversationTitle || userMessage.content || '新的画图').slice(0, 18),
    activeDrawConversationId: String(metadata.activeDrawConversationId || conversationId),
    userMessage: sanitizedUserMessage,
    assistantMessage: {
      ...assistantMessage,
      taskId,
    },
  };
}

async function upsertDrawTaskRecord(redis, username, metadata, patch = {}) {
  if (!metadata) return;
  return withDrawDataLock(redis, username, () => (
    upsertDrawTaskRecordUnlocked(redis, username, metadata, patch)
  ));
}

async function upsertDrawTaskRecordUnlocked(redis, username, metadata, patch = {}) {
  if (!metadata) return;

  // Keep background task updates in the same split Redis keys used by the
  // data load/save APIs. The legacy `data:{username}` key is not read by the
  // current client, so writing there loses task updates after a page reload.
  {
    const conversationKey = `data:${username}:draw:${metadata.conversationId}`;
    const existingConversation = await getRedisJson(redis, conversationKey);
    const conversation = {
      id: metadata.conversationId,
      title: metadata.conversationTitle || existingConversation?.title || 'New drawing',
      updatedAt: Date.now(),
      messages: Array.isArray(existingConversation?.messages)
        ? [...existingConversation.messages]
        : [],
    };

    if (!conversation.messages.some((message) => message.id === metadata.userMessage.id)) {
      conversation.messages.push(metadata.userMessage);
    }

    const assistantIndex = conversation.messages.findIndex(
      (message) => message.id === metadata.assistantMessage.id,
    );
    if (assistantIndex >= 0) {
      conversation.messages[assistantIndex] = {
        ...conversation.messages[assistantIndex],
        ...patch,
      };
    } else {
      conversation.messages.push({
        ...metadata.assistantMessage,
        ...patch,
      });
    }

    conversation.updatedAt = Date.now();
    await setRedisJson(redis, conversationKey, conversation);

    const metaKey = `data:${username}:meta`;
    const meta = (await getRedisJson(redis, metaKey)) || {};
    const existingSummaries = Array.isArray(meta.drawConversations) ? meta.drawConversations : [];
    const summary = {
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messages.length,
      imageCount: conversation.messages.filter((message) => message.role === 'assistant' && message.imageUrl).length,
    };
    await setRedisJson(redis, metaKey, {
      ...meta,
      drawConversations: [summary, ...existingSummaries.filter((item) => item.id !== conversation.id)],
      activeDrawConversationId: meta.activeDrawConversationId || metadata.activeDrawConversationId,
      updatedAt: Date.now(),
    });
    return;
  }

  const dataKey = `data:${username}`;
  const data = (await getRedisJson(redis, dataKey)) || {
    conversations: [],
    settings: null,
    activeConversationId: null,
    drawConversations: [],
    activeDrawConversationId: null,
  };

  const drawConversations = Array.isArray(data.drawConversations)
    ? [...data.drawConversations]
    : [];

  let conversationIndex = drawConversations.findIndex((item) => item.id === metadata.conversationId);
  if (conversationIndex < 0) {
    drawConversations.unshift({
      id: metadata.conversationId,
      title: metadata.conversationTitle || '新的画图',
      updatedAt: Date.now(),
      messages: [],
    });
    conversationIndex = 0;
  }

  const conversation = {
    ...drawConversations[conversationIndex],
    messages: Array.isArray(drawConversations[conversationIndex].messages)
      ? [...drawConversations[conversationIndex].messages]
      : [],
  };

  if (!conversation.messages.some((message) => message.id === metadata.userMessage.id)) {
    conversation.messages.push(metadata.userMessage);
  }

  const assistantIndex = conversation.messages.findIndex(
    (message) => message.id === metadata.assistantMessage.id,
  );
  if (assistantIndex >= 0) {
    conversation.messages[assistantIndex] = {
      ...conversation.messages[assistantIndex],
      ...patch,
    };
  } else {
    conversation.messages.push({
      ...metadata.assistantMessage,
      ...patch,
    });
  }

  conversation.updatedAt = Date.now();
  drawConversations[conversationIndex] = conversation;

  await setRedisJson(redis, dataKey, {
    ...data,
    drawConversations,
    activeDrawConversationId: data.activeDrawConversationId || metadata.activeDrawConversationId,
    updatedAt: Date.now(),
  });
}

export async function runTask({ redis, taskKey, task, apiKey }) {
  const lockKey = resolveTaskLockKey(task);
  let lockAcquired = false;
  if (lockKey) {
    lockAcquired = Boolean(await redis.set(lockKey, '1', { nx: true, ex: 600 }));
    if (!lockAcquired) return;
  }

  const runningTask = {
    ...task,
    status: 'running',
    updatedAt: Date.now(),
  };

  try {
    await setTask(redis, taskKey, runningTask);

    const result = await runDrawRequest({
      apiKey,
      options: task.options,
    });

    const sourceImageUrl = result.imageUrl || '';
    let persistentImageUrl = sourceImageUrl;
    let blobUrl = '';
    let blobUploadError = '';

    if (sourceImageUrl && sourceImageUrl.startsWith('http')) {
      try {
        const token = process.env.BLOB_READ_WRITE_TOKEN || '';
        if (!token) {
          throw new Error('服务端未配置 BLOB_READ_WRITE_TOKEN');
        }

        const imageResponse = await fetch(sourceImageUrl, {
          signal: AbortSignal.timeout(30000),
        });
        if (!imageResponse.ok) {
          throw new Error(`下载源图片失败 (${imageResponse.status})`);
        }

        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        const contentType = imageResponse.headers.get('content-type') || 'image/png';
        const ext = contentType.includes('webp') ? 'webp'
          : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg'
          : 'png';
        const { put } = await import('@vercel/blob');
        const blob = await put(`draw/${task.id}.${ext}`, imageBuffer, {
          access: 'public',
          contentType,
          token,
          addRandomSuffix: false,
        });
        blobUrl = blob.url;
        persistentImageUrl = blob.url;
      } catch (uploadError) {
        blobUploadError = uploadError instanceof Error ? uploadError.message : String(uploadError);
        console.error('Vercel Blob upload failed:', blobUploadError);
      }
    }

    await setTask(redis, taskKey, {
      ...runningTask,
      status: 'succeeded',
      imageUrl: persistentImageUrl,
      sourceImageUrl,
      blobUrl,
      blobUploadError,
      updatedAt: Date.now(),
      completedAt: Date.now(),
    });
    await upsertDrawTaskRecord(redis, task.owner, task.metadata, {
      imageUrl: persistentImageUrl,
      sourceImageUrl,
      blobUrl,
      blobUploadError,
      error: undefined,
      pending: false,
    });
    // 图片成功后扣费 0.3 元；扣费失败不阻塞成功状态
    if (persistentImageUrl) {
      try {
        await chargeUser(redis, task.owner, COST_DRAW);
      } catch {}
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      await setTask(redis, taskKey, {
        ...runningTask,
        status: 'failed',
        error: errorMessage,
        updatedAt: Date.now(),
        completedAt: Date.now(),
      });
      await upsertDrawTaskRecord(redis, task.owner, task.metadata, {
        error: errorMessage,
        pending: false,
      });
    } catch {}
  } finally {
    if (lockKey && lockAcquired) {
      await redis.del(lockKey).catch(() => {});
    }
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Only POST is allowed.' });
    return;
  }

  const redis = createRedis();
  if (!redis) {
    sendJson(res, 500, { error: '数据库未配置，请联系管理员' });
    return;
  }

  const auth = await authenticateNodeRequest(req);
  if (auth.error) {
    sendJson(res, auth.error.status, { error: auth.error.message });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: '请求格式错误' });
    return;
  }

  const options = cleanDrawOptions(body);
  if (!options.prompt) {
    sendJson(res, 400, { error: '请输入图片描述' });
    return;
  }

  // 余额预检
  const balance = await getUserBalance(redis, auth.username);
  if (balance < COST_DRAW - 0.0001) {
    sendJson(res, 402, {
      error: '余额不足，请充值后再画图',
      code: 'INSUFFICIENT_BALANCE',
      balance,
      cost: COST_DRAW,
    });
    return;
  }

  const envKey = options.source === 'rightcode' ? 'API_KEY_RIGHTCODE' : 'API_KEY_LUXEE';
  const apiKey = process.env[envKey] || '';
  const taskId = crypto.randomUUID();
  const metadata = normalizeTaskMetadata(body.taskMetadata, taskId);
  const taskKey = `drawTask:${auth.username}:${taskId}`;
  const now = Date.now();
  const task = {
    id: taskId,
    owner: auth.username,
    status: 'queued',
    options,
    metadata,
    createdAt: now,
    updatedAt: now,
  };

  await setTask(redis, taskKey, task);
  await upsertDrawTaskRecord(redis, auth.username, metadata);
  waitUntil(runTask({ redis, taskKey, task, apiKey }));

  sendJson(res, 202, {
    taskId,
    status: 'queued',
    pollAfterMs: 1000,
  });
}
