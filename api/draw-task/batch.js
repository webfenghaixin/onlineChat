export const config = {
  maxDuration: 300,
};

import { createRedis, getUserBalance, COST_DRAW } from '../lib/auth-utils.js';
import { cleanDrawOptions } from '../lib/draw-utils.js';
import { waitUntil } from '@vercel/functions';
import {
  sendJson,
  setCorsHeaders,
  readJsonBody,
  authenticateNodeRequest,
  setTask,
  runTask,
  normalizeTaskMetadata,
  upsertBatchDrawTaskRecord,
} from './start.js';

const BATCH_MAX_COUNT = 20;

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

  const requestedCount = Math.min(
    BATCH_MAX_COUNT,
    Math.max(1, Number(body.count) || 1),
  );

  // 余额预检：一次性校验总费用
  const totalCost = Number((COST_DRAW * requestedCount).toFixed(2));
  const balance = await getUserBalance(redis, auth.username);
  if (balance < totalCost - 0.0001) {
    sendJson(res, 402, {
      error: `余额不足，生成 ${requestedCount} 张图需要 ${totalCost.toFixed(2)} 元，当前余额 ${balance.toFixed(2)} 元`,
      code: 'INSUFFICIENT_BALANCE',
      balance,
      cost: totalCost,
    });
    return;
  }

  const envKey = options.source === 'rightcode' ? 'API_KEY_RIGHTCODE' : 'API_KEY_LUXEE';
  const apiKey = process.env[envKey] || '';

  // 前端预生成 N 个 assistantMessage，后端为每个生成独立 taskId
  const rawMetadata = body.taskMetadata || {};
  const rawAssistantMessages = Array.isArray(rawMetadata.assistantMessages)
    ? rawMetadata.assistantMessages
    : [];

  if (rawAssistantMessages.length !== requestedCount) {
    sendJson(res, 400, { error: 'assistantMessages 数量与 count 不一致' });
    return;
  }

  const now = Date.now();
  const tasks = [];

  // 构造 baseMetadata：只含 userMessage 和会话信息，不含单个 assistantMessage
  const userMessage = rawMetadata.userMessage;
  if (!userMessage?.id) {
    sendJson(res, 400, { error: '缺少 userMessage' });
    return;
  }

  // 剥离 userMessage 中的参考图大字段（base64），避免写入会话历史时超过 Upstash 1MB 限制。
  // 参考图已由 task.options.referenceImages 携带；前端 retryDraw/editDrawMessage 读取的是
  // 本地 React state 的 userMsg（含完整 referenceImages），不依赖会话历史中的副本。
  const slimUserMessage = {
    id: userMessage.id,
    role: userMessage.role,
    content: userMessage.content,
    model: userMessage.model,
    size: userMessage.size,
    quality: userMessage.quality,
    batchId: userMessage.batchId,
    imageCount: userMessage.imageCount,
    createdAt: userMessage.createdAt,
    hasReferenceImages: Array.isArray(userMessage.referenceImages) && userMessage.referenceImages.length > 0,
  };

  const baseMetadata = {
    conversationId: String(rawMetadata.conversationId || ''),
    conversationTitle: String(rawMetadata.conversationTitle || userMessage.content || '新的画图').slice(0, 18),
    activeDrawConversationId: String(rawMetadata.activeDrawConversationId || rawMetadata.conversationId || ''),
    userMessage: slimUserMessage,
  };

  if (!baseMetadata.conversationId) {
    sendJson(res, 400, { error: '缺少 conversationId' });
    return;
  }

  // 先为每个 assistantMessage 生成 taskId，再一次性写入会话记录：
  // 云端消息必须持久化 taskId，否则前端在页面切回/重新打开、本地状态被
  // 云端数据覆盖后，无法恢复轮询，会一直卡在"制图中"。
  // 参考图（base64，可能数 MB）不存入 Redis（Upstash 单次请求限 1MB），
  // 改为通过 runTask 的 runtimeOptions 闭包传递，仅在执行画图请求时使用。
  const { referenceImages: _stripped, ...slimOptions } = options;
  const taskRecords = rawAssistantMessages.map((assistantMessage) => {
    const taskId = crypto.randomUUID();
    const taskKey = `drawTask:${auth.username}:${taskId}`;
    const task = {
      id: taskId,
      owner: auth.username,
      status: 'queued',
      options: slimOptions,
      metadata: normalizeTaskMetadata(
        {
          ...rawMetadata,
          userMessage: slimUserMessage,
          assistantMessage,
        },
        taskId,
      ),
      createdAt: now,
      updatedAt: now,
    };
    return { task, taskKey, messageId: assistantMessage.id };
  });

  // 一次性写入 userMessage + 所有 assistantMessages（只1次锁，无竞争）
  // task.metadata.assistantMessage 已携带 taskId（normalizeTaskMetadata 注入）
  await upsertBatchDrawTaskRecord(
    redis,
    auth.username,
    baseMetadata,
    taskRecords.map(({ task }) => task.metadata.assistantMessage),
  );

  // 循环创建 N 个 task 并异步执行
  // runtimeOptions 携带完整参考图，通过闭包传递给 runTask，不经过 Redis
  for (const { task, taskKey, messageId } of taskRecords) {
    await setTask(redis, taskKey, task);
    waitUntil(runTask({ redis, taskKey, task, apiKey, runtimeOptions: options }));
    tasks.push({ messageId, taskId: task.id });
  }

  sendJson(res, 202, { tasks });
}
