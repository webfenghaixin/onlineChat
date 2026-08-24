export const config = { runtime: 'edge' };

import {
  jsonResponse,
  handleOptions,
  authenticate,
  hashPasswordV2,
  verifyPassword,
  createRedis,
  getRedisJson,
  setRedisJson,
} from '../lib/auth-utils.js';

export default async function handler(request) {
  if (request.method === 'OPTIONS') return handleOptions();
  if (request.method !== 'POST') return jsonResponse(405, { error: '仅支持 POST 请求' });

  const redis = createRedis();
  if (!redis) return jsonResponse(500, { error: '数据库未配置，请联系管理员' });

  const auth = await authenticate(request);
  if (auth.error) return auth.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: '请求格式错误' });
  }

  const { oldPassword, newPassword } = body;

  if (!oldPassword || !newPassword || typeof oldPassword !== 'string' || typeof newPassword !== 'string') {
    return jsonResponse(400, { error: '请输入旧密码和新密码' });
  }

  if (newPassword.length < 6) {
    return jsonResponse(400, { error: '新密码至少 6 位' });
  }

  const userKey = `user:${auth.username}`;
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
