export const config = {
  maxDuration: 30,
};

import { createRedis, getRedisJson, verifyJWT } from '../lib/auth-utils.js';

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

  const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const taskId = requestUrl.searchParams.get('id') || '';
  if (!taskId) {
    sendJson(res, 400, { error: '缺少任务 ID' });
    return;
  }

  const task = await getRedisJson(redis, `drawTask:${auth.username}:${taskId}`);
  if (!task) {
    sendJson(res, 404, { error: '任务不存在或已过期' });
    return;
  }

  sendJson(res, 200, {
    taskId: task.id,
    status: task.status,
    imageUrl: task.imageUrl || '',
    error: task.error || '',
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt || null,
  });
}
