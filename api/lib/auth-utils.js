import { Redis } from '@upstash/redis';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function jsonResponse(statusCode, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

export function handleOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function base64urlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
}

export async function signJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const data = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sigB64 = base64urlEncode(String.fromCharCode(...new Uint8Array(signature)));
  return `${data}.${sigB64}`;
}

export async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  const data = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const sigBytes = Uint8Array.from(base64urlDecode(sigB64), (c) => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
  if (!valid) return null;

  try {
    const payload = JSON.parse(base64urlDecode(payloadB64));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(salt + password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateSalt() {
  return crypto.randomUUID().replace(/-/g, '');
}

export function createRedis() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    process.env.REDIS_REST_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export function parseRedisJson(value) {
  if (value == null || value === '') return null;

  if (typeof value === 'string') {
    try {
      return parseRedisJson(JSON.parse(value));
    } catch {
      return null;
    }
  }

  return value;
}

export async function getRedisJson(redis, key) {
  return parseRedisJson(await redis.get(key));
}

export async function setRedisJson(redis, key, value) {
  await redis.set(key, JSON.stringify(value));
}

export async function setRedisJsonNx(redis, key, value) {
  return redis.set(key, JSON.stringify(value), { nx: true });
}

export async function authenticate(request) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return { error: jsonResponse(401, { error: '未登录，请重新登录' }) };

  const jwtSecret = process.env.JWT_SECRET || '';
  if (!jwtSecret) return { error: jsonResponse(500, { error: '服务端未配置 JWT_SECRET' }) };

  const payload = await verifyJWT(token, jwtSecret);
  if (!payload || !payload.username) {
    return { error: jsonResponse(401, { error: '登录已过期，请重新登录' }) };
  }

  return { username: payload.username };
}
