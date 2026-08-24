export const config = {
  maxDuration: 10,
};

import { createRedis, getRedisJson, setRedisJson, verifyJWT, refundUser, COST_DRAW } from '../lib/auth-utils.js';
import { getLimiter, limitRequest } from '../lib/ratelimit.js';

const TASK_TTL_SECONDS = 24 * 60 * 60;
const TASK_RUNNING_TIMEOUT_MS = 5 * 60 * 1000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Only GET is allowed.' });
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

  const limiter = getLimiter('draw-status', 30, '1m');
  const rateLimit = await limitRequest(limiter, auth.username);
  if (!rateLimit.ok) {
    sendJson(res, 429, { error: '操作过于频繁，请稍后再试' });
    return;
  }

  const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const taskId = requestUrl.searchParams.get('id') || '';
  if (!taskId) {
    sendJson(res, 400, { error: '缺少任务 ID' });
    return;
  }

  const taskKey = `drawTask:${auth.username}:${taskId}`;
  let task = await getRedisJson(redis, taskKey);
  if (!task) {
    sendJson(res, 404, { error: '任务不存在或已过期' });
    return;
  }

  // 僵尸任务检测：后台 waitUntil 任务被 Vercel 在 maxDuration 强制终止时，
  // runTask 的 catch/finally 来不及写入 failed 状态，Redis 里会永久卡在
  // queued 或 running。若该状态超过 5 分钟，判定为超时失败并回写 Redis，
  // 让前端轮询能正常停止。
  const now = Date.now();
  if (
    (task.status === 'running' || task.status === 'queued') &&
    typeof task.updatedAt === 'number' &&
    now - task.updatedAt > TASK_RUNNING_TIMEOUT_MS
  ) {
    task = {
      ...task,
      status: 'failed',
      error: '图片生成超时（已超过 5 分钟），服务端任务已停止。',
      completedAt: now,
      updatedAt: now,
    };
    await redis.set(taskKey, JSON.stringify(task), { ex: TASK_TTL_SECONDS }).catch(() => {});
    // 任务已预扣费，判死时退款
    const refundAmount = Number(task.charged) > 0 ? Number(task.charged) : COST_DRAW;
    try {
      const refund = await refundUser(redis, auth.username, refundAmount);
      if (!refund.ok) {
        console.error('[draw-task] refund failed', auth.username, task.id, refundAmount, refund.reason || '');
      }
    } catch (refundError) {
      console.error('[draw-task] refund failed', auth.username, task.id, refundAmount, refundError instanceof Error ? refundError.message : String(refundError));
    }
  }

  // This handler is deliberately read-only. Running the task from a status
  // poll turns one poll into a long request; when the browser aborts it, the
  // UI reports "Load failed" although the background task later succeeds.
  sendJson(res, 200, {
    taskId: task.id,
    status: task.status,
    imageUrl: task.imageUrl || '',
    sourceImageUrl: task.sourceImageUrl || '',
    blobUrl: task.blobUrl || '',
    blobUploadError: task.blobUploadError || '',
    error: task.error || '',
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt || null,
  });
}
