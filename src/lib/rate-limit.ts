/**
 * Simple sliding-window limiter keyed by client IP.
 * In-memory: resets on cold starts (serverless). For strict global limits use Redis (e.g. Upstash).
 */

type Bucket = { windowStart: number; count: number };

const buckets = new Map<string, Bucket>();
const IP_RE = /^(?:\d{1,3}\.){3}\d{1,3}$|^[a-f0-9:]+$/i;

function windowMs(): number {
  return 60_000;
}

function maxHits(): number {
  const n = parseInt(process.env.RATE_LIMIT_AI_PER_MINUTE || '24', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 300) : 24;
}

export function getRequestIp(req: { headers: Headers }): string {
  const real = req.headers.get('x-real-ip')?.trim();
  if (real && IP_RE.test(real)) return real;

  const xf = req.headers.get('x-forwarded-for');
  if (xf) {
    const forwarded = xf
      .split(',')
      .map((part) => part.trim())
      .filter((part) => IP_RE.test(part));
    const last = forwarded.at(-1);
    if (last) return last;
  }

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
