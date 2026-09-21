/**
 * Tests for the safeguards that make the public API safe to leave open:
 * the answer cache, the per-visitor rate limiter, the shared lookup budget,
 * and the watchlist cap. No network needed: fetch is mocked.
 * Run: node test_protection.js
 */
const assert = require("assert");
const { TtlCache } = require("./cache");
const { createRateLimiter, combineLimiters, rateLimitMiddleware } = require("./rateLimit");
const { handleCheck, handleWatch, makeWatchlist } = require("./routes");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// A clock we control, so expiry tests don't need to wait.
const fakeClock = () => {
  let t = 1000000;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
};

// ---------- cache ----------

test("cache: stores, expires and evicts the oldest", () => {
  const now = fakeClock();
  const c = new TtlCache({ maxEntries: 2, now });
  c.set("a", 1, 1000);
  c.set("b", 2, 1000);
  assert.equal(c.get("a"), 1);
  c.set("c", 3, 1000); // full: oldest ("a") goes
  assert.equal(c.get("a"), undefined);
  assert.equal(c.get("b"), 2);
  now.advance(1001);
  assert.equal(c.get("b"), undefined);
});

test("cache.wrap: second call is a hit and compute runs once", async () => {
  const c = new TtlCache({ now: fakeClock() });
  let calls = 0;
  const compute = async () => { calls++; return { n: calls }; };
  const first = await c.wrap("k", compute, () => 1000);
  const second = await c.wrap("k", compute, () => 1000);
  assert.deepEqual([first.hit, second.hit], [false, true]);
  assert.equal(calls, 1);
  assert.equal(second.value.n, 1);
});

test("cache.wrap: simultaneous requests share one computation", async () => {
  const c = new TtlCache({ now: fakeClock() });
  let calls = 0;
  const compute = () => new Promise((resolve) => { calls++; setTimeout(() => resolve("v"), 20); });
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => c.wrap("k", compute, () => 1000)));
  assert.equal(calls, 1);
  assert.equal(results.filter((r) => !r.hit).length, 1);
  assert.ok(results.every((r) => r.value === "v"));
});

test("cache.wrap: a ttl of 0 is not stored, and failures are never stored", async () => {
  const c = new TtlCache({ now: fakeClock() });
  let calls = 0;
  await c.wrap("k", async () => { calls++; return "x"; }, () => 0);
  await c.wrap("k", async () => { calls++; return "x"; }, () => 0);
  assert.equal(calls, 2);

  await assert.rejects(c.wrap("bad", async () => { throw new Error("boom"); }, () => 1000), /boom/);
  const ok = await c.wrap("bad", async () => "recovered", () => 1000);
  assert.equal(ok.value, "recovered");
  assert.equal(ok.hit, false);
});

// ---------- rate limiter ----------

test("limiter: allows up to max, then blocks with a retry time, then resets", () => {
  const now = fakeClock();
  const l = createRateLimiter({ windowMs: 60000, max: 3, now });
  assert.deepEqual([1, 2, 3].map(() => l.hit("ip").allowed), [true, true, true]);
  const blocked = l.hit("ip");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.retryAfterSec, 60);
  now.advance(30000);
  assert.equal(l.hit("ip").retryAfterSec, 30);
  now.advance(30001);
  assert.equal(l.hit("ip").allowed, true);
});

test("limiter: visitors are counted separately", () => {
  const l = createRateLimiter({ windowMs: 60000, max: 1, now: fakeClock() });
  assert.equal(l.hit("a").allowed, true);
  assert.equal(l.hit("a").allowed, false);
  assert.equal(l.hit("b").allowed, true);
});

test("limiter: memory stays bounded when many keys arrive", () => {
  const l = createRateLimiter({ windowMs: 60000, max: 5, now: fakeClock(), maxKeys: 100 });
  for (let i = 0; i < 1000; i++) l.hit(`ip-${i}`);
  // still works, and an old key is simply forgotten (allowed again) rather than crashing
  assert.equal(l.hit("ip-0").allowed, true);
});

test("middleware: sets headers, passes allowed requests, answers 429 in plain words", () => {
  const l = createRateLimiter({ windowMs: 60000, max: 1, now: fakeClock() });
  const mw = rateLimitMiddleware(l);
  const mk = () => {
    const res = { headers: {}, code: null, body: null };
    res.set = (k, v) => { res.headers[k] = v; return res; };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  };
  let passed = 0;
  const r1 = mk(); mw({ ip: "1.1.1.1" }, r1, () => passed++);
  assert.equal(passed, 1);
  assert.equal(r1.headers["RateLimit-Remaining"], "0");
  const r2 = mk(); mw({ ip: "1.1.1.1" }, r2, () => passed++);
  assert.equal(passed, 1);
  assert.equal(r2.code, 429);
  assert.equal(r2.headers["Retry-After"], "60");
  assert.match(r2.body.error, /too fast\. Please wait 60 seconds/);
  const r3 = mk(); mw({ ip: "2.2.2.2" }, r3, () => passed++);
  assert.equal(passed, 2);
  const r4 = mk(); mw({}, r4, () => passed++); // no IP at all must not crash
  assert.equal(passed, 3);
});

test("combined limits: all must allow, and a refusal doesn't use up the later limits", () => {
  const now = fakeClock();
  const short = createRateLimiter({ windowMs: 600000, max: 2, now });
  const daily = createRateLimiter({ windowMs: 86400000, max: 3, now });
  const both = combineLimiters(short, daily);
  assert.equal(both.hit("k").allowed, true);
  assert.equal(both.hit("k").allowed, true);
  const refused = both.hit("k"); // the 10-minute limit says no
  assert.equal(refused.allowed, false);
  assert.equal(refused.retryAfterSec, 600);
  assert.equal(daily.hit("other").remaining, 2, "the refused request did not touch the daily count");
  assert.equal(daily.hit("k").remaining, 0, "daily count is exactly the 2 allowed requests plus this probe");
});

test("combined limits: the daily cap still holds after the short window resets", () => {
  const now = fakeClock();
  const both = combineLimiters(
    createRateLimiter({ windowMs: 600000, max: 2, now }),
    createRateLimiter({ windowMs: 86400000, max: 3, now })
  );
  assert.equal(both.hit("k").allowed && both.hit("k").allowed, true); // 2 used today
  assert.equal(both.hit("k").allowed, false); // 10-minute limit
  now.advance(600001); // a new 10-minute window
  assert.equal(both.hit("k").allowed, true); // 3rd of the day
  const capped = both.hit("k"); // short window has room, the day does not
  assert.equal(capped.allowed, false);
  assert.ok(capped.retryAfterSec > 80000, `retry in ${capped.retryAfterSec}s should be most of a day`);
});

// ---------- handleCheck with the safeguards on ----------

const PEPE = "0x6982508145454ce325ddbe47a25d4ec3d2311933";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const stamp = String(Date.now() - 1000 * 3600 * 24000);
const searchResults = [
  { pltId: 1, plt: "Ethereum", addr: PEPE, s: "PEPE", n: "Pepe", liq: 3.2e7, mc: 1.6e9, v24h: 5e6, pu: "0.000004", pt: stamp, fpt: stamp, fpct: stamp },
  { pltId: 16, plt: "Solana", addr: BONK, s: "Bonk", n: "Bonk", liq: 9e5, mc: 2e9, v24h: 1e6, pu: "0.00002", pt: stamp, fpt: stamp, fpct: stamp },
];
const goplusEvm = { code: 1, result: { [PEPE]: { is_honeypot: "0", is_mintable: "0", owner_address: "0x0", holder_count: "500000", lp_holders: [{ percent: "1", is_locked: 0 }] } } };

let upstream = { search: 0, goplus: 0 };
let failGoplus = false;
global.fetch = async (url) => {
  const u = String(url);
  const ok = (o) => ({ json: async () => o });
  if (u.includes("/v1/dex/search")) { upstream.search++; return ok({ status: { error_code: "0" }, data: { tks: searchResults } }); }
  if (u.includes("token_security/1")) { upstream.goplus++; return failGoplus ? ok({ code: 2, message: "down" }) : ok(goplusEvm); }
  if (u.includes("solana/token_security")) { upstream.goplus++; return ok({ code: 2, message: "down" }); }
  throw new Error("unexpected " + u);
};
const reset = () => { upstream = { search: 0, goplus: 0 }; failGoplus = false; };

test("check: an identical repeat is answered from the cache with no upstream calls", async () => {
  reset();
  const cache = new TtlCache({ now: fakeClock() });
  const a = await handleCheck("k", { tokenAddress: PEPE, networkId: "1" }, { cache });
  const b = await handleCheck("k", { tokenAddress: PEPE, networkId: "1" }, { cache });
  assert.deepEqual([a.cached, b.cached], [false, true]);
  assert.equal(upstream.search, 1);
  assert.equal(upstream.goplus, 1);
  assert.deepEqual(a.body, b.body);
});

test("check: EVM addresses share a cache entry regardless of letter case; networks do not", async () => {
  reset();
  const cache = new TtlCache({ now: fakeClock() });
  await handleCheck("k", { tokenAddress: PEPE, networkId: "1" }, { cache });
  const upper = await handleCheck("k", { tokenAddress: "0x" + PEPE.slice(2).toUpperCase(), networkId: "1" }, { cache });
  assert.equal(upper.cached, true);
  const auto = await handleCheck("k", { tokenAddress: PEPE }, { cache });
  assert.equal(auto.cached, false); // "auto-detect" is a different question
  assert.equal(upstream.search, 2);
});

test("check: Solana addresses are case-sensitive in the cache key", async () => {
  reset();
  const cache = new TtlCache({ now: fakeClock() });
  await handleCheck("k", { tokenAddress: BONK, networkId: "16" }, { cache });
  const other = await handleCheck("k", { tokenAddress: BONK.toLowerCase(), networkId: "16" }, { cache });
  assert.equal(other.cached, false);
});

test("check: entries expire, and a partial answer is only kept briefly", async () => {
  reset();
  const now = fakeClock();
  const cache = new TtlCache({ now });
  await handleCheck("k", { tokenAddress: PEPE, networkId: "1" }, { cache, ttlMs: 60000, degradedTtlMs: 10000 });
  now.advance(59000);
  assert.equal((await handleCheck("k", { tokenAddress: PEPE, networkId: "1" }, { cache, ttlMs: 60000 })).cached, true);
  now.advance(2000);
  assert.equal((await handleCheck("k", { tokenAddress: PEPE, networkId: "1" }, { cache, ttlMs: 60000 })).cached, false);

  reset();
  failGoplus = true; // security scan fails => degraded answer
  const cache2 = new TtlCache({ now });
  const d1 = await handleCheck("k", { tokenAddress: PEPE, networkId: "1" }, { cache: cache2, ttlMs: 60000, degradedTtlMs: 10000 });
  assert.ok(d1.body.degradedReason);
  now.advance(9000);
  assert.equal((await handleCheck("k", { tokenAddress: PEPE, networkId: "1" }, { cache: cache2, degradedTtlMs: 10000 })).cached, true);
  now.advance(2000);
  failGoplus = false; // the hiccup is over: the next check recovers and gets the full answer
  const d3 = await handleCheck("k", { tokenAddress: PEPE, networkId: "1" }, { cache: cache2, degradedTtlMs: 10000 });
  assert.equal(d3.cached, false);
  assert.equal(d3.body.degradedReason, null);
});

test("check: bad input and busy answers are never cached", async () => {
  reset();
  const cache = new TtlCache({ now: fakeClock() });
  const bad = await handleCheck("k", { tokenAddress: PEPE, networkId: "abc" }, { cache });
  assert.equal(bad.status, 400);
  assert.equal(cache.size, 0);
});

test("check: the lookup budget caps upstream calls, but cached answers stay free", async () => {
  reset();
  const cache = new TtlCache({ now: fakeClock() });
  const budget = createRateLimiter({ windowMs: 600000, max: 2, now: fakeClock() });
  const p = { cache, budget };
  assert.equal((await handleCheck("k", { tokenAddress: PEPE, networkId: "1" }, p)).status, 200); // spends 1
  assert.equal((await handleCheck("k", { tokenAddress: BONK, networkId: "16" }, p)).status, 200); // spends 2
  const busy = await handleCheck("k", { tokenAddress: PEPE, networkId: "56" }, p); // new question, budget gone
  assert.equal(busy.status, 503);
  assert.match(busy.body.error, /very busy/);
  assert.equal(busy.retryAfterSec, 600);
  const before = { ...upstream };
  const again = await handleCheck("k", { tokenAddress: PEPE, networkId: "1" }, p); // cached: still served
  assert.equal(again.status, 200);
  assert.equal(again.cached, true);
  assert.deepEqual(upstream, before);
  // the busy answer was not cached: once budget returns, the same question works
  assert.equal(cache.get("0x6982508145454ce325ddbe47a25d4ec3d2311933|56|"), undefined);
});

test("check: without safeguards it behaves exactly as before", async () => {
  reset();
  const a = await handleCheck("k", { tokenAddress: PEPE, networkId: "1" });
  assert.deepEqual(Object.keys(a).sort(), ["body", "status"]);
  await handleCheck("k", { tokenAddress: PEPE, networkId: "1" });
  assert.equal(upstream.search, 2);
});

// ---------- handleWatch ----------

test("watch: the watchlist has a size cap and a shared lookup budget", async () => {
  reset();
  const wl = makeWatchlist();
  const full = await handleWatch("k", wl, { networkId: 1, tokenAddress: PEPE }, { maxWatchlist: 1 });
  assert.equal(full.status, 200);
  const second = await handleWatch("k", wl, { networkId: 16, tokenAddress: BONK }, { maxWatchlist: 1 });
  assert.equal(second.status, 503);
  assert.match(second.body.error, /watchlist is full/);
  const again = await handleWatch("k", wl, { networkId: 1, tokenAddress: PEPE }, { maxWatchlist: 1 }); // re-watching is fine
  assert.equal(again.status, 200);

  const budget = createRateLimiter({ windowMs: 600000, max: 0, now: fakeClock() });
  const busy = await handleWatch("k", makeWatchlist(), { networkId: 1, tokenAddress: PEPE }, { budget });
  assert.equal(busy.status, 503);
  assert.match(busy.body.error, /very busy/);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log("ok   -", name);
    } catch (e) {
      failed++;
      console.log("FAIL -", name, "\n      ", e.message);
    }
  }
  if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
  console.log(`\ntest_protection: all ${tests.length} passed`);
})();
