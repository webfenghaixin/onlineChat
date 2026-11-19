export const config = { maxDuration: 300 };

import { createRedis, getRedisJson } from '../../lib/auth-utils.js';
import { cleanDrawOptions } from '../../lib/draw-utils.js';
import { extractApiKey, verifyApiKey } from '../../lib/ai-auth.js';
import { getLimiter, limitRequest } from '../../lib/ratelimit.js';
import { setTask, runTask, sendJson, setCorsHeaders, readJsonBody } from '../draw-task/start.js';
import { waitUntil } from '@vercel/functions';

// 外部 AI 调用的任务统一挂在这个虚拟 owner 下，与真实用户数据完全隔离
const AI_OWNER = 'ai-api';
const AI_TASK_PREFIX = 'aiDrawTask:';
const AI_TASK_TTL_HINT = '24 小时';
const AI_TASK_TIMEOUT_MS = 5 * 60 * 1000;
const AI_MAX_REFERENCE_IMAGES = 5;
const AI_MAX_COUNT = 20;
const AI_MAX_PROMPT_LENGTH = 4000;
const MODEL_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;

function taskKeyOf(taskId) {
  return `${AI_TASK_PREFIX}${taskId}`;
}

function validateBody(body) {
  const prompt = String(body?.prompt || '').trim();
  if (!prompt) return '缺少 prompt';
  if (prompt.length > AI_MAX_PROMPT_LENGTH) return `prompt 不能超过 ${AI_MAX_PROMPT_LENGTH} 个字符`;

  const model = body?.model;
  if (model != null && model !== '' && !MODEL_NAME_PATTERN.test(String(model))) return 'model 非法';

  const referenceImages = body?.referenceImages;
  if (referenceImages != null && !Array.isArray(referenceImages)) return 'referenceImages 必须是数组';
  if (Array.isArray(referenceImages)) {
    if (referenceImages.length > AI_MAX_REFERENCE_IMAGES) {
      return `referenceImages 最多 ${AI_MAX_REFERENCE_IMAGES} 张`;
    }
    const invalid = referenceImages.find(
      (url) => typeof url !== 'string' || !/^(https?:\/\/|data:image\/)/i.test(url.trim()),
    );
    if (invalid !== undefined) return 'referenceImages 只支持 http(s) URL 或 data:image base64';
  }

  const count = Number(body?.count ?? 1);
  if (!Number.isInteger(count) || count < 1 || count > AI_MAX_COUNT) {
    return `count 必须是 1-${AI_MAX_COUNT} 的整数`;
  }

  return null;
}

async function handleStatus(req, redis) {
  const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const taskId = requestUrl.searchParams.get('id') || requestUrl.searchParams.get('taskId') || '';
  if (!taskId) return { status: 400, body: { error: '缺少任务 ID' } };

  let task = await getRedisJson(redis, taskKeyOf(taskId));
  if (!task) return { status: 404, body: { error: `任务不存在或已过期（保留 ${AI_TASK_TTL_HINT}）` } };

  // 僵尸任务：后台任务被平台强制终止时状态会长期停在 queued/running
  if (
    (task.status === 'queued' || task.status === 'running')
    && typeof task.updatedAt === 'number'
    && Date.now() - task.updatedAt > AI_TASK_TIMEOUT_MS
  ) {
    const now = Date.now();
    task = {
      ...task,
      status: 'failed',
      error: '图片生成超时（已超过 5 分钟），服务端任务已停止。',
      completedAt: now,
      updatedAt: now,
    };
    await setTask(redis, taskKeyOf(taskId), task).catch(() => {});
  }

  return {
    status: 200,
    body: {
      taskId,
      status: task.status,
      imageUrl: task.imageUrl || null,
      error: task.error || null,
      model: task.options?.model || null,
      size: task.options?.size || null,
      quality: task.options?.quality || null,
      createdAt: task.createdAt || null,
      completedAt: task.completedAt || null,
    },
  };
}

async function handleCreate(req, res, redis) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: '请求体不是合法 JSON' });
  }

  const validationError = validateBody(body);
  if (validationError) return sendJson(res, 400, { error: validationError });

  const options = cleanDrawOptions(body);
  const count = Number(body?.count ?? 1);
  const tasks = [];

  for (let index = 0; index < count; index += 1) {
    const taskId = crypto.randomUUID();
    const now = Date.now();
    const task = {
      id: taskId,
      owner: AI_OWNER,
      status: 'queued',
      options,
      metadata: null,
      source: 'ai-api',
      createdAt: now,
      updatedAt: now,
    };

    await setTask(redis, taskKeyOf(taskId), task);
    // 与前端任务共用同一套执行逻辑（含对象存储镜像），但不扣费、不写用户会话
    waitUntil(
      runTask({
        redis,
        taskKey: taskKeyOf(taskId),
        task,
        apiKey: process.env.API_KEY_DRAW || '',
        refundOnFailure: false,
      }),
    );

    tasks.push({ taskId, index });
  }

  const payload = count === 1
    ? { taskId: tasks[0].taskId, tasks }
    : { tasks };

  return sendJson(res, 202, payload);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  const redis = createRedis();
  if (!redis) {
    sendJson(res, 500, { error: '数据库未配置，请联系管理员' });
    return;
  }

  const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const auth = verifyApiKey(extractApiKey(req.headers, requestUrl.searchParams));
  if (auth.error) {
    sendJson(res, auth.status, { error: auth.error });
    return;
  }

  const forwarded = String(req.headers['x-forwarded-for'] || '');
  const ip = forwarded.split(',')[0].trim() || 'unknown';
  const limiter = getLimiter('ai-draw', 60, '1m');
  const rateLimit = await limitRequest(limiter, ip);
  if (!rateLimit.ok) {
    sendJson(res, 429, { error: '请求过于频繁，请稍后再试' });
    return;
  }

  if (req.method === 'GET') {
    const result = await handleStatus(req, redis);
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: '只支持 GET / POST' });
    return;
  }

  await handleCreate(req, res, redis);
}
