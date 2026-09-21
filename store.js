/**
 * The watchlist: who is watching which token, and the last verdict we saw.
 *
 * State lives in memory. A small "adapter" saves it somewhere durable so it
 * survives restarts: Upstash Redis when its two environment variables are set,
 * otherwise nothing (memory only, lost on every restart).
 */

const STATE_VERSION = 1;

// EVM addresses are case-insensitive; Solana addresses are not.
const normAddress = (a) => (String(a).startsWith("0x") ? String(a).toLowerCase() : String(a));
const tokenKey = (networkId, address) => `${networkId}|${normAddress(address)}`;
const watchKey = (w) => `${w.chatId}|${tokenKey(w.networkId, w.address)}`;

/** Keeps everything in memory only. */
function createMemoryAdapter() {
  return { kind: "memory", persistent: false, async load() { return null; }, async save() {} };
}

/** Stores the whole state as one JSON value in Upstash Redis, over its REST API. */
function createUpstashAdapter({
  url,
  token,
  key = "tokenlens:state:v1",
  fetchImpl = fetch,
  timeoutMs = 8000,
}) {
  async function command(args) {
    const res = await fetchImpl(url.replace(/\/+$/, ""), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      // handled below
    }
    if (!res.ok || !body || body.error) {
      // Never include the token or URL in an error message.
      throw new Error(`Upstash request failed (${body && body.error ? body.error : `HTTP ${res.status}`})`);
    }
    return body.result;
  }

  return {
    kind: "upstash",
    persistent: true,
    async load() {
      const raw = await command(["GET", key]);
      return raw ? JSON.parse(raw) : null;
    },
    async save(state) {
      await command(["SET", key, JSON.stringify(state)]);
    },
  };
}

class WatchStore {
  constructor({
    adapter = createMemoryAdapter(),
    maxPerUser = 5,
    maxTokens = 20,
    maxTotal = 200,
    now = Date.now,
    logger = console,
  } = {}) {
    this.adapter = adapter;
    this.maxPerUser = maxPerUser;
    this.maxTokens = maxTokens;
    this.maxTotal = maxTotal;
    this.now = now;
    this.logger = logger;
    this.watches = new Map(); // watchKey -> watch
    this.loaded = false;
    this.dirty = false;
    this.writing = null;
    this.needsRetry = false;
  }

  /** Loads saved state. If that fails we carry on in memory and never overwrite what's saved. */
  async init() {
    await this.#tryLoad();
    return this.loaded;
  }

  async #tryLoad() {
    try {
      const saved = await this.adapter.load();
      if (saved && Array.isArray(saved.watches)) {
        for (const w of saved.watches) {
          const k = watchKey(w);
          if (!this.watches.has(k)) this.watches.set(k, w); // local changes win
        }
      }
      this.loaded = true;
    } catch (err) {
      this.loaded = false;
      this.logger.error(`watchlist: could not load saved state (${err.message}); running from memory`);
    }
  }

  get persistent() {
    return !!this.adapter.persistent;
  }

  get size() {
    return this.watches.size;
  }

  list(chatId) {
    return [...this.watches.values()].filter((w) => w.chatId === chatId).sort((a, b) => a.addedAt - b.addedAt);
  }

  /** Distinct tokens being watched (many people watching one token cost one lookup). */
  tokens() {
    const seen = new Map();
    for (const w of this.watches.values()) {
      const k = tokenKey(w.networkId, w.address);
      if (!seen.has(k)) seen.set(k, { networkId: w.networkId, address: w.address, symbol: w.symbol });
    }
    return [...seen.values()];
  }

  watchersOf(networkId, address) {
    const k = tokenKey(networkId, address);
    return [...this.watches.values()].filter((w) => tokenKey(w.networkId, w.address) === k);
  }

  /** Returns { result: "added" | "exists" | "user_limit" | "token_limit" | "total_limit", watch? }. */
  add({ chatId, networkId, address, symbol = null, networkName = null, verdict = null }) {
    const k = watchKey({ chatId, networkId, address });
    const existing = this.watches.get(k);
    if (existing) return { result: "exists", watch: existing };

    if (this.list(chatId).length >= this.maxPerUser) return { result: "user_limit" };
    if (this.watches.size >= this.maxTotal) return { result: "total_limit" };
    const isNewToken = this.watchersOf(networkId, address).length === 0;
    if (isNewToken && this.tokens().length >= this.maxTokens) return { result: "token_limit" };

    const watch = {
      chatId,
      networkId,
      address,
      symbol,
      networkName,
      lastVerdict: verdict,
      lastCheckedAt: verdict ? this.now() : null,
      addedAt: this.now(),
    };
    this.watches.set(k, watch);
    this.persist();
    return { result: "added", watch };
  }

  /** `ref` is a 1-based position in list(chatId), or a token address. Returns the removed watch or null. */
  remove(chatId, ref) {
    const mine = this.list(chatId);
    let target = null;
    if (/^\d{1,3}$/.test(String(ref))) target = mine[Number(ref) - 1] || null;
    else target = mine.find((w) => normAddress(w.address) === normAddress(ref)) || null;
    if (!target) return null;
    this.watches.delete(watchKey(target));
    this.persist();
    return target;
  }

  removeChat(chatId) {
    let n = 0;
    for (const [k, w] of this.watches) {
      if (w.chatId === chatId) {
        this.watches.delete(k);
        n++;
      }
    }
    if (n) this.persist();
    return n;
  }

  setVerdict(watch, verdict) {
    watch.lastVerdict = verdict;
    watch.lastCheckedAt = this.now();
    this.dirty = true;
  }

  serialize() {
    return { v: STATE_VERSION, watches: [...this.watches.values()] };
  }

  /** Saves in the background; overlapping requests are merged into one write. */
  persist() {
    this.dirty = true;
    if (!this.writing) this.writing = this.#flush();
    return this.writing;
  }

  /** Called on a timer: retries a failed save. */
  persistIfNeeded() {
    return this.dirty || this.needsRetry ? this.persist() : Promise.resolve();
  }

  async #flush() {
    try {
      while (this.dirty) {
        this.dirty = false;
        if (!this.loaded) await this.#tryLoad(); // never write over state we couldn't read
        if (!this.loaded) {
          this.needsRetry = true;
          return;
        }
        try {
          await this.adapter.save(this.serialize());
          this.needsRetry = false;
        } catch (err) {
          this.needsRetry = true;
          this.logger.error(`watchlist: could not save (${err.message}); will retry`);
        }
      }
    } finally {
      this.writing = null;
    }
  }
}

module.exports = { WatchStore, createMemoryAdapter, createUpstashAdapter, normAddress, tokenKey };
