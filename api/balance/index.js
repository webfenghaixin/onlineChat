export const config = { runtime: 'edge' };

import {
  jsonResponse,
  handleOptions,
  authenticate,
  createRedis,
  getUserBalance,
  rechargeUser,
} from '../lib/auth-utils.js';

export default async function handler(request) {
  if (request.method === 'OPTIONS') return handleOptions();

  const redis = createRedis();
  if (!redis) return jsonResponse(500, { error: '数据库未配置，请联系管理员' });

  const auth = await authenticate(request);
  if (auth.error) return auth.error;

  // GET：查询余额
  if (request.method === 'GET') {
    const balance = await getUserBalance(redis, auth.username);
    return jsonResponse(200, { balance, username: auth.username });
  }

  // POST：充值（简化版：直接加金额。生产环境应接入支付回调）
  if (request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { error: '请求格式错误' });
    }

    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return jsonResponse(400, { error: '充值金额必须为正数' });
    }
    if (amount > 10000) {
      return jsonResponse(400, { error: '单次充值上限 10000 元' });
    }

    const result = await rechargeUser(redis, auth.username, amount);
    if (!result.ok) {
      return jsonResponse(400, { error: result.reason || '充值失败' });
    }
    return jsonResponse(200, { balance: result.balance, ok: true });
  }

  return jsonResponse(405, { error: '仅支持 GET / POST 请求' });
}
