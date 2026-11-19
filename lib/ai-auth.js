// 供外部 AI / MCP 调用制图接口时使用的固定服务端 Key 鉴权。
// Key 通过环境变量 DRAW_API_KEY 配置，不涉及用户登录与余额。

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const maxLen = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < maxLen; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function extractApiKey(headers = {}, searchParams = null) {
  const authHeader = String(headers.authorization || '');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (bearer) return bearer;

  const headerKey = String(headers['x-api-key'] || '').trim();
  if (headerKey) return headerKey;

  // 部分 MCP 客户端无法自定义请求头，允许用 ?key= 传递
  return searchParams ? String(searchParams.get('key') || '').trim() : '';
}

export function verifyApiKey(provided) {
  const expected = process.env.DRAW_API_KEY || '';
  if (!expected) return { error: '服务端未配置 DRAW_API_KEY', status: 500 };
  if (!provided) return { error: '缺少 API Key', status: 401 };
  if (!safeEqual(provided, expected)) return { error: 'API Key 无效', status: 401 };
  return { ok: true };
}
