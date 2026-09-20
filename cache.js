/**
 * A small in-memory TTL cache with "single flight": if several requests ask
 * for the same key while it is being computed, they share one computation
 * instead of each one hitting the upstream APIs.
 *
 * Kept deliberately simple: entries live for a short time, the oldest are
 * dropped when the cache is full, and nothing is written to disk.
 */

class TtlCache {
  constructor({ maxEntries = 500, now = Date.now } = {}) {
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map(); // key -> { value, expires }
    this.inflight = new Map(); // key -> Promise
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    this.entries.delete(key); // re-insert so the newest entries sit last
    this.entries.set(key, { value, expires: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value); // drop the oldest
    }
  }

  get size() {
    return this.entries.size;
  }

  /**
   * Returns { value, hit }. On a miss, runs compute() once (even if many callers
   * arrive together) and stores the result for ttlFor(value) milliseconds;
   * a ttl of 0 means "don't store it". A failed compute() is never stored.
   */
  async wrap(key, compute, ttlFor) {
    const cached = this.get(key);
    if (cached !== undefined) return { value: cached, hit: true };

    const running = this.inflight.get(key);
    if (running) return { value: await running, hit: true };

    const promise = (async () => {
      const value = await compute();
      const ttl = ttlFor(value);
      if (ttl > 0) this.set(key, value, ttl);
      return value;
    })();

    this.inflight.set(key, promise);
    try {
      return { value: await promise, hit: false };
    } finally {
      this.inflight.delete(key);
    }
  }
}

module.exports = { TtlCache };
