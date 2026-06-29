export const config = { runtime: 'edge' };

import {
  jsonResponse,
  handleOptions,
  hashPassword,
  signJWT,
  createRedis,
  getRedisJson,
  setRedisJson,
  BALANCE_INITIAL,
} from '../lib/auth-utils.js';

export default async function handler(request) {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'POST') return jsonResponse(405, { error: '仅支持 POST 请求' });

  const redis = createRedis();
  if (!redis) return jsonResponse(500, { error: '数据库未配置，请联系管理员' });

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: '请求格式错误' });
  }

  const { username, password } = body;

  if (!username || typeof username !== 'string' || !password || typeof password !== 'string') {
    return jsonResponse(400, { error: '请输入用户名和密码' });
  }

  const normalizedUsername = username.trim();
  const user = await getRedisJson(redis, `user:${normalizedUsername}`);
  if (!user || !user.salt || !user.passwordHash) {
    return jsonResponse(401, { error: '用户名或密码错误' });
  }

  const passwordHash = await hashPassword(password, user.salt);
  if (passwordHash !== user.passwordHash) {
    return jsonResponse(401, { error: '用户名或密码错误' });
  }

  // 老用户兜底：未设置余额字段的，按初始额度补发
  let balance = Number(user.balance);
  if (!Number.isFinite(balance)) {
    balance = BALANCE_INITIAL;
    user.balance = balance;
    await setRedisJson(redis, `user:${normalizedUsername}`, user);
  }

  const jwtSecret = process.env.JWT_SECRET || '';
  if (!jwtSecret) return jsonResponse(500, { error: '服务端未配置 JWT_SECRET' });

  const token = await signJWT(
    { username: normalizedUsername, exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600 },
    jwtSecret,
  );

  return jsonResponse(200, { token, username: normalizedUsername, balance: Math.round(balance * 100) / 100 });
}
