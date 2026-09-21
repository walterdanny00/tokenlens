/**
 * Tests for the Telegram bot, the watchlist store and the alert loop.
 * Nothing touches the network: Telegram, Upstash and the check pipeline are faked.
 * Run: node test_alerts.js
 */
const assert = require("assert");
const { WatchStore, createMemoryAdapter, createUpstashAdapter } = require("./store");
const { createTelegramClient, TelegramError, isChatGone } = require("./telegram");
const { createBot, parseTokenArgs } = require("./bot");
const { createWatcher } = require("./watcher");
const { createRateLimiter } = require("./rateLimit");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const quiet = { log() {}, error() {} };

const PEPE = "0x6982508145454ce325ddbe47a25d4ec3d2311933";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const OTHER = "0x1111111111111111111111111111111111111111";
const WEB = "https://tokenlens-eight.vercel.app";

// ---------- fakes ----------

function fakeTelegram() {
  const t = { sent: [], answered: [], failFor: new Map() };
  t.sendMessage = async (chatId, text, opts = {}) => {
    if (t.failFor.has(chatId)) throw t.failFor.get(chatId);
    t.sent.push({ chatId, text, buttons: opts.buttons });
  };
  t.answerCallbackQuery = async (id, text) => { t.answered.push({ id, text }); };
  return t;
}

const verdictBody = ({ verdict = "yellow", symbol = "PEPE", networkId = 1, networkName = "Ethereum", degradedReason = null, dataSource = "dex", message, caveats = [] } = {}) => ({
  tokenAddress: PEPE, networkId, networkName, alsoOnNetworks: [], verdict,
  reasons: ["reason"], caveats,
  message: message || `MSG(${verdict}) This is an automated check, not financial advice.`,
  dataSource, degradedReason, data: { symbol },
});

// check(): answers come from a function so a test can change them over time.
function fakeCheck(answer) {
  const calls = [];
  const check = async (params) => { calls.push(params); return answer(params); };
  check.calls = calls;
  return check;
}
const ok = (body) => ({ status: 200, body });

const newStore = (opts = {}) => new WatchStore({ logger: quiet, ...opts });

const msg = (chatId, text, extra = {}) => ({ update_id: Math.floor(Math.random() * 1e9), message: { chat: { id: chatId, type: "private" }, text, ...extra } });

function botFor({ answer = () => ok(verdictBody()), store = newStore(), limiter } = {}) {
  const telegram = fakeTelegram();
  const check = fakeCheck(answer);
  const bot = createBot({ telegram, store, check, webAppUrl: WEB, limiter, intervalMinutes: 30, logger: quiet });
  return { bot, telegram, store, check };
}

// ---------- store ----------

test("store: add, list, exists, per-user and distinct-token limits", () => {
  let t = 1000;
  const s = newStore({ maxPerUser: 2, maxTokens: 2, now: () => t++ });
  assert.equal(s.add({ chatId: 1, networkId: 1, address: PEPE }).result, "added");
  assert.equal(s.add({ chatId: 1, networkId: 1, address: PEPE.toUpperCase().replace("0X", "0x") }).result, "exists");
  assert.equal(s.add({ chatId: 1, networkId: 16, address: BONK }).result, "added");
  assert.equal(s.add({ chatId: 1, networkId: 1, address: OTHER }).result, "user_limit");
  // a second person watching an existing token doesn't count as a new token
  assert.equal(s.add({ chatId: 2, networkId: 1, address: PEPE }).result, "added");
  // ...but a third distinct token does
  assert.equal(s.add({ chatId: 2, networkId: 1, address: OTHER }).result, "token_limit");
  assert.equal(s.tokens().length, 2);
  assert.equal(s.watchersOf(1, PEPE).length, 2);
  assert.deepEqual(s.list(1).map((w) => w.address), [PEPE, BONK]);
});

test("store: remove by number or address, and removeChat", () => {
  const s = newStore();
  s.add({ chatId: 1, networkId: 1, address: PEPE });
  s.add({ chatId: 1, networkId: 16, address: BONK });
  assert.equal(s.remove(1, "9"), null);
  assert.equal(s.remove(1, "1").address, PEPE);
  assert.equal(s.remove(1, BONK).address, BONK);
  assert.equal(s.list(1).length, 0);
  s.add({ chatId: 3, networkId: 1, address: PEPE });
  s.add({ chatId: 3, networkId: 16, address: BONK });
  assert.equal(s.removeChat(3), 2);
  assert.equal(s.size, 0);
});

function fakeAdapter() {
  const a = { kind: "fake", persistent: true, saved: null, saves: 0, failLoad: false, failSave: false };
  a.load = async () => { if (a.failLoad) throw new Error("down"); return a.saved ? JSON.parse(a.saved) : null; };
  a.save = async (state) => { if (a.failSave) throw new Error("down"); a.saves++; a.saved = JSON.stringify(state); };
  return a;
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test("store: changes are saved, and a new store loads them back", async () => {
  const a = fakeAdapter();
  const s = newStore({ adapter: a });
  await s.init();
  s.add({ chatId: 1, networkId: 1, address: PEPE, symbol: "PEPE", verdict: "yellow" });
  await s.persist();
  const s2 = newStore({ adapter: a });
  await s2.init();
  assert.equal(s2.size, 1);
  assert.equal(s2.list(1)[0].lastVerdict, "yellow");
  assert.equal(s2.persistent, true);
});

test("store: a burst of changes is coalesced into few writes and the last state wins", async () => {
  const a = fakeAdapter();
  const s = newStore({ adapter: a, maxPerUser: 50 });
  await s.init();
  for (let i = 0; i < 10; i++) s.add({ chatId: 1, networkId: 1, address: `0x${String(i).padStart(40, "0")}` });
  await s.writing;
  assert.ok(a.saves <= 2, `saves: ${a.saves}`);
  assert.equal(JSON.parse(a.saved).watches.length, 10);
});

test("store: if saved state can't be read, it is never overwritten; it merges once readable", async () => {
  const a = fakeAdapter();
  a.saved = JSON.stringify({ v: 1, watches: [{ chatId: 9, networkId: 1, address: OTHER, symbol: "OLD", addedAt: 1 }] });
  a.failLoad = true;
  const s = newStore({ adapter: a });
  assert.equal(await s.init(), false);
  s.add({ chatId: 1, networkId: 1, address: PEPE });
  await s.writing;
  assert.equal(a.saves, 0, "must not write while the saved state is unreadable");
  assert.equal(s.needsRetry, true);

  a.failLoad = false;
  await s.persistIfNeeded();
  await s.writing;
  const merged = JSON.parse(a.saved).watches.map((w) => w.address).sort();
  assert.deepEqual(merged, [OTHER, PEPE].sort());
  assert.equal(s.needsRetry, false);
});

test("store: a failed save is retried later", async () => {
  const a = fakeAdapter();
  const s = newStore({ adapter: a });
  await s.init();
  a.failSave = true;
  s.add({ chatId: 1, networkId: 1, address: PEPE });
  await s.writing;
  assert.equal(s.needsRetry, true);
  a.failSave = false;
  await s.persistIfNeeded();
  await s.writing;
  assert.equal(JSON.parse(a.saved).watches.length, 1);
});

test("upstash adapter: sends the command as a JSON array with the token, and never leaks it", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    const [cmd] = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ result: cmd === "GET" ? JSON.stringify({ v: 1, watches: [] }) : "OK" }) };
  };
  const adapter = createUpstashAdapter({ url: "https://x.upstash.io/", token: "SECRET-TOKEN", key: "k", fetchImpl });
  assert.deepEqual(await adapter.load(), { v: 1, watches: [] });
  await adapter.save({ v: 1, watches: [{ a: 1 }] });
  assert.equal(calls[0].url, "https://x.upstash.io");
  assert.equal(calls[0].opts.method, "POST");
  assert.equal(calls[0].opts.headers.Authorization, "Bearer SECRET-TOKEN");
  assert.deepEqual(calls[0].body, ["GET", "k"]);
  assert.equal(calls[1].body[0], "SET");
  assert.deepEqual(JSON.parse(calls[1].body[2]), { v: 1, watches: [{ a: 1 }] });

  const empty = createUpstashAdapter({ url: "https://x", token: "T", fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ result: null }) }) });
  assert.equal(await empty.load(), null);

  const bad = createUpstashAdapter({ url: "https://x", token: "SECRET-TOKEN", fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: "WRONGPASS" }) }) });
  await assert.rejects(bad.load(), (e) => /WRONGPASS/.test(e.message) && !/SECRET-TOKEN/.test(e.message));
  const down = createUpstashAdapter({ url: "https://x", token: "SECRET-TOKEN", fetchImpl: async () => { throw new Error("connect https://x with SECRET-TOKEN"); } });
  await assert.rejects(down.load());
});

// ---------- telegram client ----------

test("telegram client: builds requests, parses errors, and never leaks the bot token", async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  const tg = createTelegramClient({ token: "123:SECRET", fetchImpl });
  await tg.sendMessage(5, "hi", { buttons: [[{ text: "Go", url: "https://x" }]] });
  await tg.sendMessage(5, "x".repeat(9000));
  await tg.setWebhook("https://h/hook", "s3cret");
  assert.equal(seen[0].url, "https://api.telegram.org/bot123:SECRET/sendMessage");
  assert.deepEqual(seen[0].body.reply_markup.inline_keyboard[0][0], { text: "Go", url: "https://x" });
  assert.equal(seen[1].body.text.length, 4000);
  assert.equal(seen[2].body.secret_token, "s3cret");
  assert.deepEqual(seen[2].body.allowed_updates, ["message", "callback_query"]);

  const blocked = createTelegramClient({ token: "123:SECRET", fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }) }) });
  await assert.rejects(blocked.sendMessage(1, "x"), (e) => e instanceof TelegramError && e.code === 403 && isChatGone(e) && !/SECRET/.test(e.message));
  const offline = createTelegramClient({ token: "123:SECRET", fetchImpl: async () => { throw new Error("fetch failed https://api.telegram.org/bot123:SECRET/sendMessage"); } });
  await assert.rejects(offline.getMe(), (e) => e instanceof TelegramError && !/SECRET/.test(e.message) && !isChatGone(e));
});

// ---------- bot ----------

test("bot: parsing addresses and networks", () => {
  assert.deepEqual(parseTokenArgs([PEPE]), { address: PEPE, networkId: undefined });
  assert.deepEqual(parseTokenArgs([BONK, "Solana"]), { address: BONK, networkId: 16 });
  assert.deepEqual(parseTokenArgs([PEPE, "56"]), { address: PEPE, networkId: 56 });
  assert.match(parseTokenArgs([PEPE, "mars"]).error, /don't know the network/);
  assert.match(parseTokenArgs([]).error, /full contract address/);
  assert.match(parseTokenArgs(["PEPE"]).error, /full contract address/);
});

test("bot: a bare address gets a verdict with Watch and Open buttons", async () => {
  const { bot, telegram, check } = botFor();
  await bot.handleUpdate(msg(7, PEPE));
  assert.equal(telegram.sent.length, 1);
  const s = telegram.sent[0];
  assert.match(s.text, /^PEPE on Ethereum \(0x6982…1933\)\n\nMSG\(yellow\)/);
  assert.equal(s.buttons[0][0].callback_data, `w:1:${PEPE}`);
  assert.equal(s.buttons[1][0].url, `${WEB}/?token=${PEPE}&network=1`);
  assert.deepEqual(check.calls[0], { tokenAddress: PEPE, networkId: undefined });
});

test("bot: /check passes the network, and problems get plain replies", async () => {
  const { bot, telegram, check } = botFor();
  await bot.handleUpdate(msg(7, `/check ${BONK} sol`));
  assert.equal(check.calls[0].networkId, 16);
  await bot.handleUpdate(msg(7, "/check hello"));
  await bot.handleUpdate(msg(7, `/check ${PEPE} mars`));
  await bot.handleUpdate(msg(7, "what is this"));
  await bot.handleUpdate(msg(7, "/nope"));
  assert.match(telegram.sent[1].text, /full contract address/);
  assert.match(telegram.sent[2].text, /don't know the network/);
  assert.match(telegram.sent[3].text, /Send me a token's contract address/);
  assert.match(telegram.sent[4].text, /don't know that command/);
  assert.equal(check.calls.length, 1, "bad input never reaches the check");
});

test("bot: a busy or failing check is explained, not crashed on", async () => {
  let mode = "busy";
  const { bot, telegram } = botFor({
    answer: () => {
      if (mode === "busy") return { status: 503, body: { error: "TokenLens is very busy right now. Please try again in a few minutes." } };
      throw new Error("boom");
    },
  });
  await bot.handleUpdate(msg(7, PEPE));
  assert.match(telegram.sent[0].text, /very busy/);
  mode = "throw";
  await bot.handleUpdate(msg(7, PEPE));
  assert.match(telegram.sent[1].text, /Something went wrong on my side/);
});

test("bot: /watch adds a watch with a baseline, and explains the not-saved caveat", async () => {
  const { bot, telegram, store } = botFor();
  await bot.handleUpdate(msg(7, `/watch ${PEPE}`));
  const w = store.list(7)[0];
  assert.equal(w.lastVerdict, "yellow");
  assert.equal(w.networkId, 1);
  assert.match(telegram.sent[0].text, /^Watching PEPE on Ethereum \(0x6982…1933\)\. Right now it's 🟡 Yellow\./);
  assert.match(telegram.sent[0].text, /every 30 minutes/);
  assert.match(telegram.sent[0].text, /isn't saved between restarts/);
  await bot.handleUpdate(msg(7, `/watch ${PEPE}`));
  assert.match(telegram.sent[1].text, /already watching/);
});

test("bot: no persistence warning when the watchlist is saved", async () => {
  const store = newStore({ adapter: fakeAdapter() });
  const { bot, telegram } = botFor({ store });
  await bot.handleUpdate(msg(7, `/watch ${PEPE}`));
  assert.doesNotMatch(telegram.sent[0].text, /isn't saved/);
});

test("bot: a partial check watches without a baseline", async () => {
  const { bot, telegram, store } = botFor({ answer: () => ok(verdictBody({ degradedReason: "GoPlus down" })) });
  await bot.handleUpdate(msg(7, `/watch ${PEPE}`));
  assert.equal(store.list(7)[0].lastVerdict, null);
  assert.match(telegram.sent[0].text, /couldn't complete every check/);
});

test("bot: unknown tokens and limits", async () => {
  const unknown = botFor({ answer: () => ok(verdictBody({ networkId: null, networkName: null, verdict: "unknown", dataSource: "none", degradedReason: "not found" })) });
  await unknown.bot.handleUpdate(msg(7, `/watch ${PEPE}`));
  assert.match(unknown.telegram.sent[0].text, /couldn't find that token/);
  assert.equal(unknown.store.size, 0);

  const store = newStore({ maxPerUser: 1, maxTokens: 1 });
  const b = botFor({ store });
  await b.bot.handleUpdate(msg(7, `/watch ${PEPE}`));
  await b.bot.handleUpdate(msg(7, `/watch ${OTHER}`));
  assert.match(b.telegram.sent[1].text, /already watching 1 tokens/);
  await b.bot.handleUpdate(msg(8, `/watch ${OTHER}`));
  assert.match(b.telegram.sent[2].text, /as many different tokens as I can/);
});

test("bot: the web app's Telegram deep link starts a watch", async () => {
  const { bot, telegram, store, check } = botFor();
  await bot.handleUpdate(msg(7, `/start w_1_${PEPE}`));
  assert.equal(store.list(7).length, 1);
  assert.deepEqual(check.calls[0], { tokenAddress: PEPE, networkId: 1 });
  await bot.handleUpdate(msg(7, "/start w_1_"));
  await bot.handleUpdate(msg(7, "/start"));
  assert.match(telegram.sent[1].text, /checks a token before you buy it/);
  assert.match(telegram.sent[2].text, /checks a token before you buy it/);
  assert.equal(store.list(7).length, 1);
});

test("bot: the Watch button (callback) works and junk callbacks are ignored", async () => {
  const { bot, telegram, store } = botFor();
  await bot.handleUpdate({ update_id: 1, callback_query: { id: "cb1", data: `w:1:${PEPE}`, message: { chat: { id: 7 } } } });
  assert.equal(store.list(7).length, 1);
  assert.equal(telegram.answered[0].id, "cb1");
  assert.match(telegram.sent[0].text, /^Watching PEPE/);
  await bot.handleUpdate({ update_id: 2, callback_query: { id: "cb2", data: "evil", message: { chat: { id: 7 } } } });
  assert.equal(telegram.answered[1].id, "cb2");
  assert.equal(telegram.sent.length, 1);
});

test("bot: /list and /unwatch", async () => {
  const { bot, telegram, store } = botFor();
  await bot.handleUpdate(msg(7, "/list"));
  assert.match(telegram.sent[0].text, /not watching anything/);
  await bot.handleUpdate(msg(7, `/watch ${PEPE}`));
  await bot.handleUpdate(msg(7, "/list"));
  assert.match(telegram.sent[2].text, /1\. 🟡 PEPE on Ethereum \(0x6982…1933\)/);
  await bot.handleUpdate(msg(7, "/unwatch"));
  assert.match(telegram.sent[3].text, /Tell me which one/);
  await bot.handleUpdate(msg(7, "/unwatch 5"));
  assert.match(telegram.sent[4].text, /couldn't find that one/);
  await bot.handleUpdate(msg(7, "/unwatch 1"));
  assert.match(telegram.sent[5].text, /Stopped watching PEPE on Ethereum/);
  assert.equal(store.list(7).length, 0);
});

test("bot: /demo is clearly labelled as a sample and shows the real alert format", async () => {
  const { bot, telegram } = botFor();
  await bot.handleUpdate(msg(7, "/demo"));
  const t = telegram.sent[0].text;
  assert.match(t, /^🧪 Sample alert\. This is not a real token\./);
  assert.match(t, /🔔 SAMPLE on Ethereum changed from Green to Red\./);
  assert.match(t, /honeypot/);
});

test("bot: groups, non-text and duplicate updates are ignored; commands with @name work", async () => {
  const { bot, telegram, check } = botFor();
  await bot.handleUpdate({ update_id: 1, message: { chat: { id: 7, type: "group" }, text: PEPE } });
  await bot.handleUpdate({ update_id: 2, message: { chat: { id: 7, type: "private" } } });
  await bot.handleUpdate(null);
  assert.equal(telegram.sent.length, 0);
  const dup = msg(7, PEPE);
  await bot.handleUpdate(dup);
  await bot.handleUpdate(dup);
  assert.equal(check.calls.length, 1);
  await bot.handleUpdate(msg(7, "/help@TokenLensBot"));
  assert.match(telegram.sent.at(-1).text, /checks a token before you buy it/);
});

test("bot: a chat that floods it is slowed down", async () => {
  const limiter = createRateLimiter({ windowMs: 60000, max: 2 });
  const { bot, telegram, check } = botFor({ limiter });
  for (let i = 0; i < 4; i++) await bot.handleUpdate(msg(7, PEPE));
  assert.equal(check.calls.length, 2);
  assert.match(telegram.sent.at(-1).text, /going a bit fast/);
  await bot.handleUpdate(msg(8, PEPE)); // someone else is unaffected
  assert.equal(check.calls.length, 3);
});

// ---------- watcher ----------

function watcherFor({ answers, store = newStore({ maxPerUser: 20, maxTokens: 20 }) } = {}) {
  const telegram = fakeTelegram();
  const check = fakeCheck((p) => answers(p));
  const sleeps = [];
  const watcher = createWatcher({ store, check, telegram, webAppUrl: WEB, spacingMs: 7, sleepImpl: async (ms) => { sleeps.push(ms); }, logger: quiet });
  return { watcher, telegram, store, check, sleeps };
}

test("watcher: the first full check sets a baseline without sending an alert", async () => {
  const w = watcherFor({ answers: () => ok(verdictBody({ verdict: "green" })) });
  w.store.add({ chatId: 1, networkId: 1, address: PEPE, symbol: "PEPE", verdict: null });
  const stats = await w.watcher.runCycle();
  assert.equal(w.store.list(1)[0].lastVerdict, "green");
  assert.equal(w.telegram.sent.length, 0);
  assert.equal(stats.alerts, 0);
});

test("watcher: a change alerts everyone watching, with the new verdict and a link", async () => {
  let verdict = "yellow";
  const w = watcherFor({ answers: () => ok(verdictBody({ verdict, message: `NEW(${verdict})` })) });
  w.store.add({ chatId: 1, networkId: 1, address: PEPE, symbol: "PEPE", networkName: "Ethereum", verdict: "yellow" });
  w.store.add({ chatId: 2, networkId: 1, address: PEPE, symbol: "PEPE", networkName: "Ethereum", verdict: "yellow" });
  await w.watcher.runCycle();
  assert.equal(w.telegram.sent.length, 0, "no change, no alert");
  assert.equal(w.check.calls.length, 1, "one lookup for two watchers");

  verdict = "red";
  const stats = await w.watcher.runCycle();
  assert.equal(stats.alerts, 2);
  assert.deepEqual(w.telegram.sent.map((s) => s.chatId).sort(), [1, 2]);
  const t = w.telegram.sent[0];
  assert.match(t.text, /^🔔 PEPE on Ethereum changed from Yellow to Red\.\n\nNEW\(red\)/);
  assert.equal(t.buttons[0][0].url, `${WEB}/?token=${PEPE}&network=1`);
  assert.equal(w.store.list(1)[0].lastVerdict, "red");

  await w.watcher.runCycle(); // same again: no repeat
  assert.equal(w.telegram.sent.length, 2);
});

test("watcher: a partial check never raises a false alarm, and recovery is silent", async () => {
  let mode = "ok";
  const w = watcherFor({
    answers: () =>
      mode === "ok" ? ok(verdictBody({ verdict: "green" }))
      : mode === "partial" ? ok(verdictBody({ verdict: "yellow", degradedReason: "GoPlus down" }))
      : mode === "busy" ? { status: 503, body: { error: "busy" } }
      : (() => { throw new Error("boom"); })(),
  });
  w.store.add({ chatId: 1, networkId: 1, address: PEPE, verdict: "green" });
  for (mode of ["partial", "busy", "throw", "ok"]) {
    const stats = await w.watcher.runCycle();
    assert.equal(stats.alerts, 0, mode);
  }
  assert.equal(w.telegram.sent.length, 0);
  assert.equal(w.store.list(1)[0].lastVerdict, "green");
});

test("watcher: changes are saved; unchanged cycles write nothing", async () => {
  const a = fakeAdapter();
  let verdict = "green";
  const w = watcherFor({ answers: () => ok(verdictBody({ verdict })), store: newStore({ adapter: a }) });
  await w.store.init();
  w.store.add({ chatId: 1, networkId: 1, address: PEPE, verdict: "green" });
  await w.store.writing;
  const before = a.saves;
  await w.watcher.runCycle();
  assert.equal(a.saves, before, "nothing changed, nothing saved");
  verdict = "red";
  await w.watcher.runCycle();
  await w.store.writing;
  assert.equal(JSON.parse(a.saved).watches[0].lastVerdict, "red");
});

test("watcher: someone who blocked the bot is dropped, and the others still get their alert", async () => {
  const w = watcherFor({ answers: () => ok(verdictBody({ verdict: "red" })) });
  w.store.add({ chatId: 1, networkId: 1, address: PEPE, verdict: "green" });
  w.store.add({ chatId: 2, networkId: 1, address: PEPE, verdict: "green" });
  w.store.add({ chatId: 1, networkId: 16, address: BONK, verdict: "green" });
  w.telegram.failFor.set(1, new TelegramError("sendMessage", 403, "Forbidden: bot was blocked by the user"));
  const stats = await w.watcher.runCycle();
  assert.equal(stats.alerts, 1);
  assert.equal(w.telegram.sent[0].chatId, 2);
  assert.equal(w.store.list(1).length, 0, "all of chat 1's watches are removed");
  assert.equal(w.store.list(2).length, 1);
});

test("watcher: an alert that fails for another reason keeps the watch", async () => {
  const w = watcherFor({ answers: () => ok(verdictBody({ verdict: "red" })) });
  w.store.add({ chatId: 1, networkId: 1, address: PEPE, verdict: "green" });
  w.telegram.failFor.set(1, new TelegramError("sendMessage", 500, "oops"));
  await w.watcher.runCycle();
  assert.equal(w.store.list(1).length, 1);
});

test("watcher: one lookup per token, spaced out, and a failing token doesn't stop the rest", async () => {
  const w = watcherFor({
    answers: (p) => { if (p.tokenAddress === OTHER) throw new Error("boom"); return ok(verdictBody({ verdict: "red" })); },
  });
  w.store.add({ chatId: 1, networkId: 1, address: OTHER, verdict: "green" });
  w.store.add({ chatId: 1, networkId: 1, address: PEPE, verdict: "green" });
  w.store.add({ chatId: 1, networkId: 16, address: BONK, verdict: "green" });
  const stats = await w.watcher.runCycle();
  assert.equal(w.check.calls.length, 3);
  assert.deepEqual(w.sleeps, [7, 7]);
  assert.equal(stats.alerts, 2);
  assert.equal(stats.skipped, 1);
});

test("watcher: cycles never overlap", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const w = watcherFor({ answers: async () => { await gate; return ok(verdictBody()); } });
  w.store.add({ chatId: 1, networkId: 1, address: PEPE, verdict: "yellow" });
  const first = w.watcher.runCycle();
  const second = await w.watcher.runCycle();
  assert.equal(second.skipped, true);
  release();
  await first;
  assert.equal(w.check.calls.length, 1);
});

test("watcher: start() and stop() schedule cycles", async () => {
  const w = watcherFor({ answers: () => ok(verdictBody()) });
  const fast = createWatcher({ store: w.store, check: w.check, telegram: w.telegram, webAppUrl: WEB, intervalMs: 10, sleepImpl: async () => {}, logger: quiet });
  w.store.add({ chatId: 1, networkId: 1, address: PEPE, verdict: "yellow" });
  fast.start();
  fast.start(); // starting twice must not double the schedule
  await new Promise((r) => setTimeout(r, 55));
  fast.stop();
  const calls = w.check.calls.length;
  assert.ok(calls >= 2 && calls <= 7, `calls: ${calls}`);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(w.check.calls.length, calls, "stopped");
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log("ok   -", name);
    } catch (e) {
      failed++;
      console.log("FAIL -", name, "\n      ", e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n       ") : e);
    }
  }
  if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
  console.log(`\ntest_alerts: all ${tests.length} passed`);
})();
