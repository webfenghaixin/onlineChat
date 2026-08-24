import { Ratelimit } from '@upstash/ratelimit';
import { createRedis } from './auth-utils.js';

const limiterCache = new Map();
let unavailableWarned = false;

function warnUnavailable() {
  if (unavailableWarned) return;
  unavailableWarned = true;
  console.warn('[ratelimit] Redis 不可用，限流已跳过');
}

export function getLimiter(name, limit, window) {
  const cached = limiterCache.get(name);
  if (cached) return cached;

  const redis = createRedis();
  if (!redis) {
    warnUnavailable();
    return null;
  }

  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window),
    prefix: `ratelimit:${name}`,
  });
  limiterCache.set(name, limiter);
  return limiter;
}

export async function limitRequest(limiter, identifier) {
  if (!limiter) return { ok: true, remaining: Infinity };
  try {
    const result = await limiter.limit(identifier);
    return { ok: result.success, remaining: result.remaining };
  } catch (error) {
    console.warn('[ratelimit] 限流检查失败，已放行', error instanceof Error ? error.message : String(error));
    return { ok: true, remaining: Infinity };
  }
}

export function getRequestIp(request) {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  const ip = forwarded.split(',')[0].trim();
  return ip || 'unknown';
}
