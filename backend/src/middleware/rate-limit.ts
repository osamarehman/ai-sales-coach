import type { Request, Response, NextFunction, RequestHandler } from "express";

// A dependency-free fixed-window limiter. The webhook is the one publicly reachable,
// unauthenticated surface, so it needs a throttle to blunt abuse (token guessing,
// floods). State is in-memory — correct for a single backend instance; scaling to
// multiple replicas would need a shared store (Redis) keyed the same way.
export interface RateLimitOptions {
  windowMs: number;
  max: number;
  // Bucket key. Default: client IP (honours X-Forwarded-For when `trust proxy` is set).
  keyFn?: (req: Request) => string;
  // Injectable clock so the window logic is unit-testable without real time.
  now?: () => number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function rateLimit(opts: RateLimitOptions): RequestHandler {
  const { windowMs, max } = opts;
  const keyFn = opts.keyFn ?? ((req) => req.ip ?? "unknown");
  const now = opts.now ?? (() => Date.now());
  const buckets = new Map<string, Bucket>();

  // Sweep expired buckets so idle keys don't leak memory. unref() so the timer never
  // keeps the process alive on its own.
  const sweep = setInterval(() => {
    const t = now();
    for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k);
  }, windowMs);
  (sweep as { unref?: () => void }).unref?.();

  return (req: Request, res: Response, next: NextFunction) => {
    const t = now();
    const key = keyFn(req);
    let b = buckets.get(key);
    if (!b || b.resetAt <= t) {
      b = { count: 0, resetAt: t + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    const resetSec = Math.ceil((b.resetAt - t) / 1000);
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - b.count)));
    res.setHeader("RateLimit-Reset", String(resetSec));
    if (b.count > max) {
      res.setHeader("Retry-After", String(resetSec));
      res.status(429).json({ error: "rate limited" });
      return;
    }
    next();
  };
}
