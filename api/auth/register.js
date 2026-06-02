export const config = { runtime: 'edge' };

import {
  jsonResponse,
  handleOptions,
  hashPassword,
  generateSalt,
  signJWT,
  createRedis,
  redisGet,
  redisSet,
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

  const { username, password, inviteCode } = body;

  if (!username || typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return jsonResponse(400, { error: '用户名需要3-20位字母、数字或下划线' });
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    return jsonResponse(400, { error: '密码长度至少6个字符' });
  }

  const validInviteCode = process.env.INVITE_CODE || '';
  if (!validInviteCode || inviteCode !== validInviteCode) {
    return jsonResponse(400, { error: '邀请码不正确' });
  }

  const existingUser = await redisGet(redis, `user:${username}`);
  if (existingUser) {
    return jsonResponse(409, { error: '用户名已存在' });
  }

  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);

  await redisSet(redis, `user:${username}`, {
    salt,
    passwordHash,
    createdAt: Date.now(),
  });

  const jwtSecret = process.env.JWT_SECRET || '';
  if (!jwtSecret) return jsonResponse(500, { error: '服务端未配置 JWT_SECRET' });

  const token = await signJWT(
    { username, exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600 },
    jwtSecret,
  );

  return jsonResponse(200, { token, username });
}
