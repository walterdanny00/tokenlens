/**
 * A dependency-free fixed-window rate limiter, plus an Express middleware.
 * Used two ways: per visitor (keyed by IP) and as one shared budget for
 * lookups that reach the paid upstream APIs.
 */

function createRateLimiter({ windowMs, max, now = Date.now, maxKeys = 50000 }) {
  const windows = new Map(); // key -> { count, resetAt }

  function sweep(t) {
    for (const [key, w] of windows) {
      if (w.resetAt <= t) windows.delete(key);
    }
    while (windows.size > maxKeys) {
      windows.delete(windows.keys().next().value); // still too many: drop the oldest
    }
  }

  function hit(key) {
    const t = now();
    let w = windows.get(key);
    if (!w || w.resetAt <= t) {
      w = { count: 0, resetAt: t + windowMs };
      windows.set(key, w);
      if (windows.size > maxKeys) sweep(t);
    }
    w.count += 1;
    const allowed = w.count <= max;
    return {
      allowed,
      limit: max,
      remaining: Math.max(0, max - w.count),
      retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((w.resetAt - t) / 1000)),
    };
  }

  return { hit };
}

// Several limits that must ALL allow a request, for example "per 10 minutes" and
// "per day". They are checked in the order given and it stops at the first one
// that says no, so a request that was refused never uses up the later limits.
function combineLimiters(...limiters) {
  return {
    hit(key) {
      let last;
      for (const limiter of limiters) {
        last = limiter.hit(key);
        if (!last.allowed) return last;
      }
      return last;
    },
  };
}

// Express middleware: answers 429 with a plain-language message when over the limit.
function rateLimitMiddleware(limiter, { keyFor = (req) => req.ip } = {}) {
  return (req, res, next) => {
    const result = limiter.hit(keyFor(req) || "unknown");
    res.set("RateLimit-Limit", String(result.limit));
    res.set("RateLimit-Remaining", String(result.remaining));
    if (result.allowed) return next();
    res.set("Retry-After", String(result.retryAfterSec));
    return res.status(429).json({
      error: `You're checking tokens too fast. Please wait ${result.retryAfterSec} seconds and try again.`,
    });
  };
}

module.exports = { createRateLimiter, combineLimiters, rateLimitMiddleware };
