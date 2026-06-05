export const config = {
  maxDuration: 300,
};

import { createRedis, getRedisJson, setRedisJson, verifyJWT } from '../lib/auth-utils.js';
import { cleanDrawOptions, runDrawRequest } from '../lib/draw-utils.js';
import { waitUntil } from '@vercel/functions';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TASK_TTL_SECONDS = 24 * 60 * 60;

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

    await setTask(redis, taskKey, {
      ...runningTask,
      status: 'succeeded',
      imageUrl: result.imageUrl,
      updatedAt: Date.now(),
      completedAt: Date.now(),
    });
    await upsertDrawTaskRecord(redis, task.owner, task.metadata, {
      imageUrl: result.imageUrl,
      error: undefined,
    });
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
      });
    } catch {}
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
