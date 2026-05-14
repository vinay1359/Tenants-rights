/**
 * Simple sliding-window limiter keyed by client IP.
 * In-memory: resets on cold starts (serverless). For strict global limits use Redis (e.g. Upstash).
 */

type Bucket = { windowStart: number; count: number };

const buckets = new Map<string, Bucket>();

function windowMs(): number {
  return 60_000;
}

function maxHits(): number {
  const n = parseInt(process.env.RATE_LIMIT_AI_PER_MINUTE || '24', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 300) : 24;
}

export function getRequestIp(req: { headers: Headers }): string {
  const xf = req.headers.get('x-forwarded-for');
  if (xf) {
    const first = xf.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

/** Returns true if request is allowed (and consumes one hit). */
export function consumeAnalyzeRateLimit(ip: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const win = windowMs();
  const max = maxHits();
  let b = buckets.get(ip);
  if (!b || now - b.windowStart >= win) {
    b = { windowStart: now, count: 0 };
    buckets.set(ip, b);
  }
  if (b.count >= max) {
    const retryAfterSec = Math.ceil((b.windowStart + win - now) / 1000);
    return { ok: false, retryAfterSec: Math.max(1, retryAfterSec) };
  }
  b.count += 1;
  return { ok: true };
}
