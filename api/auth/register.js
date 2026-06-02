export const config = { runtime: 'edge' };

import {
  jsonResponse,
  handleOptions,
  hashPassword,
  generateSalt,
  signJWT,
  createRedis,
  setRedisJsonNx,
  getRedisJson,
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
  const normalizedUsername = typeof username === 'string' ? username.trim() : '';

  if (!normalizedUsername || !/^[a-zA-Z0-9_]{3,20}$/.test(normalizedUsername)) {
    return jsonResponse(400, { error: '用户名需要 3-20 位字母、数字或下划线' });
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    return jsonResponse(400, { error: '密码长度至少 6 个字符' });
  }

  const validInviteCode = process.env.INVITE_CODE || '';
  if (!validInviteCode || inviteCode !== validInviteCode) {
    return jsonResponse(400, { error: '邀请码不正确' });
  }

  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);
  const userKey = `user:${normalizedUsername}`;
  const userRecord = {
    salt,
    passwordHash,
    createdAt: Date.now(),
  };

  const setResult = await setRedisJsonNx(redis, userKey, userRecord);
  if (!setResult) {
    return jsonResponse(409, { error: '用户名已存在' });
  }

  const savedUser = await getRedisJson(redis, userKey);
  if (!savedUser || savedUser.passwordHash !== passwordHash) {
    return jsonResponse(500, { error: '用户写入数据库失败，请检查 Redis 配置' });
  }

  const jwtSecret = process.env.JWT_SECRET || '';
  if (!jwtSecret) return jsonResponse(500, { error: '服务端未配置 JWT_SECRET' });

  const token = await signJWT(
    { username: normalizedUsername, exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600 },
    jwtSecret,
  );

  return jsonResponse(200, { token, username: normalizedUsername });
}
