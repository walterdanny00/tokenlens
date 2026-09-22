/**
 * Tests for the simulated demo token: it must be clearly labelled, never touch an
 * upstream API, be scored by the real rules, and only be changeable by the owner.
 * Nothing touches the network. Run: node test_simulation.js
 */
const assert = require("assert");
const { createSimulator, SIM_ADDRESS, SIM_NETWORK_ID, NOTE } = require("./simulation");
const { handleCheck } = require("./routes");
const { TtlCache } = require("./cache");
const { createRateLimiter } = require("./rateLimit");
const { WatchStore } = require("./store");
const { createBot } = require("./bot");
const { createWatcher } = require("./watcher");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const quiet = { log() {}, error() {} };

// Anything that reaches an upstream API fails the test.
let upstream = 0;
global.fetch = async () => { upstream++; throw new Error("the simulated token must never reach an upstream API"); };

const OWNER = 111;
const GUEST = 222;
const REAL = "0x6982508145454ce325ddbe47a25d4ec3d2311933";

function fakeTelegram() {
  const t = { sent: [] };
  t.sendMessage = async (chatId, text, opts = {}) => { t.sent.push({ chatId, text, buttons: opts.buttons }); };
  t.answerCallbackQuery = async () => {};
  return t;
}
const msg = (chatId, text) => ({ update_id: Math.floor(Math.random() * 1e9), message: { chat: { id: chatId, type: "private" }, text } });

// The real pieces wired together the way server.js does it, with a fake Telegram.
function rig({ noOwner = false } = {}) {
  const simulator = createSimulator("green");
  const telegram = fakeTelegram();
  const store = new WatchStore({ maxPerUser: 5, maxTokens: 20, logger: quiet });
  const checked = [];
  const cache = new TtlCache();
  const budget = createRateLimiter({ windowMs: 600000, max: 1000 });
  const check = async (params) => {
    checked.push(params.tokenAddress.toLowerCase());
    return handleCheck("key", params, { simulator, cache, budget });
  };
  const watcher = createWatcher({ store, check, telegram, webAppUrl: "https://web.test", sleepImpl: async () => {}, logger: quiet });
  const bot = createBot({
    telegram, store, check, webAppUrl: "https://web.test", intervalMinutes: 30, logger: quiet,
    simulator, ownerChatId: noOwner ? undefined : OWNER,
    runSimulationCycle: () => watcher.runCycle({ only: (t) => simulator.isSimulated(t.address) }),
  });
  return { simulator, telegram, store, checked, watcher, bot, check };
}

// ---------- the simulated answer ----------

test("simulator: recognises its address in any letter case, and only that address", () => {
  const s = createSimulator();
  assert.equal(s.isSimulated(SIM_ADDRESS), true);
  assert.equal(s.isSimulated(SIM_ADDRESS.toUpperCase().replace("0X", "0x")), true);
  assert.equal(s.isSimulated(REAL), false);
  assert.equal(s.isSimulated(undefined), false);
  assert.equal(s.set("purple"), false);
  assert.equal(s.state, "green");
  assert.equal(s.set("red"), true);
  assert.equal(s.state, "red");
});

test("check: each state is scored by the REAL rules, and is labelled simulated", async () => {
  const s = createSimulator();
  const expected = { green: "green", yellow: "yellow", red: "red", unknown: "unknown" };
  for (const [state, verdict] of Object.entries(expected)) {
    s.set(state);
    const r = await handleCheck("key", { tokenAddress: SIM_ADDRESS }, { simulator: s });
    assert.equal(r.status, 200);
    assert.equal(r.body.verdict, verdict, state);
    assert.equal(r.body.simulated, true);
    assert.equal(r.body.dataSource, "simulation");
    assert.equal(r.body.networkName, "Simulated");
    assert.equal(r.body.networkId, SIM_NETWORK_ID);
    assert.equal(r.body.degradedReason, null);
    assert.ok(r.body.caveats.includes(NOTE), state);
    assert.ok(r.body.message.includes(NOTE), state);
    assert.equal(r.body.data.securitySource, "simulation");
  }
  assert.equal(upstream, 0, "no upstream call was made");
});

test("check: real reasons come from the real scoring code", async () => {
  const s = createSimulator();
  s.set("red");
  assert.match((await handleCheck("k", { tokenAddress: SIM_ADDRESS }, { simulator: s })).body.reasons[0], /honeypot/);
  s.set("yellow");
  assert.match((await handleCheck("k", { tokenAddress: SIM_ADDRESS }, { simulator: s })).body.reasons[0], /Liquidity isn't locked/);
  s.set("green");
  assert.match((await handleCheck("k", { tokenAddress: SIM_ADDRESS }, { simulator: s })).body.reasons[0], /^Checked and clear/);
});

test("check: a flip shows immediately (never cached) and costs no lookup budget", async () => {
  const s = createSimulator();
  const cache = new TtlCache();
  const budget = createRateLimiter({ windowMs: 600000, max: 0 }); // budget already spent
  const p = { simulator: s, cache, budget };
  assert.equal((await handleCheck("k", { tokenAddress: SIM_ADDRESS }, p)).body.verdict, "green");
  s.set("red");
  const r = await handleCheck("k", { tokenAddress: SIM_ADDRESS }, p);
  assert.equal(r.body.verdict, "red");
  assert.equal(r.status, 200);
  assert.equal(r.cached, undefined, "the cache is not involved");
  assert.equal(cache.size, 0);
});

test("check: real tokens are unchanged, with no simulated marker", async () => {
  const s = createSimulator();
  global.fetch = async (url) => {
    const u = String(url);
    const ok = (o) => ({ json: async () => o });
    if (u.includes("/v1/dex/search")) return ok({ status: { error_code: "0" }, data: { tks: [{ pltId: 1, plt: "Ethereum", addr: REAL, s: "PEPE", n: "Pepe", liq: 3e7, mc: 1e9, v24h: 1e6, pu: "0.000004", pt: "1000", fpt: "1000", fpct: "1000" }] } });
    return ok({ code: 2, message: "Chain not supported" });
  };
  const r = await handleCheck("k", { tokenAddress: REAL, networkId: "1" }, { simulator: s });
  assert.equal("simulated" in r.body, false);
  assert.notEqual(r.body.dataSource, "simulation");
  assert.ok(!r.body.caveats.includes(NOTE));
  global.fetch = async () => { upstream++; throw new Error("no upstream in simulation tests"); };
});

// ---------- the bot ----------

test("bot: 'demo' is shorthand for the simulated token and it is labelled everywhere", async () => {
  const { bot, telegram, store } = rig();
  await bot.handleUpdate(msg(GUEST, "/check demo"));
  assert.match(telegram.sent[0].text, /^DEMO on Simulated \(0x0d3a…0d3a\)/);
  assert.ok(telegram.sent[0].text.includes(NOTE));
  await bot.handleUpdate(msg(GUEST, "/watch demo"));
  const w = store.list(GUEST)[0];
  assert.equal(w.networkId, SIM_NETWORK_ID);
  assert.equal(w.symbol, "DEMO");
  assert.equal(w.lastVerdict, "green");
  assert.match(telegram.sent[1].text, /^Watching DEMO on Simulated/);
});

test("bot: the web app's deep link watches the simulated token", async () => {
  const { bot, store } = rig();
  await bot.handleUpdate(msg(GUEST, `/start w_${SIM_NETWORK_ID}_${SIM_ADDRESS}`));
  assert.equal(store.list(GUEST).length, 1);
});

test("bot: /simulate is invisible to everyone except the owner", async () => {
  const { bot, telegram, simulator } = rig();
  await bot.handleUpdate(msg(GUEST, "/simulate red"));
  assert.match(telegram.sent[0].text, /I don't know that command/);
  assert.equal(simulator.state, "green", "a guest cannot change it");

  const noOwner = rig({ noOwner: true });
  await noOwner.bot.handleUpdate(msg(OWNER, "/simulate red"));
  assert.match(noOwner.telegram.sent[0].text, /I don't know that command/);
  assert.equal(noOwner.simulator.state, "green", "with no owner configured nobody can");
});

test("bot: /myid tells anyone their own chat ID, and how to become the owner when none is set", async () => {
  const withOwner = rig();
  await withOwner.bot.handleUpdate(msg(GUEST, "/myid"));
  assert.equal(withOwner.telegram.sent[0].text, "Your chat ID is 222.");
  const noOwner = rig({ noOwner: true });
  await noOwner.bot.handleUpdate(msg(OWNER, "/myid"));
  assert.match(noOwner.telegram.sent[0].text, /Your chat ID is 111\. .*TELEGRAM_OWNER_CHAT_ID/);
});

test("bot: /simulate with no or a bad state explains itself and changes nothing", async () => {
  const { bot, telegram, simulator } = rig();
  await bot.handleUpdate(msg(OWNER, "/simulate"));
  assert.match(telegram.sent[0].text, /simulated token is 🟢 Green right now/);
  await bot.handleUpdate(msg(OWNER, "/simulate purple"));
  assert.match(telegram.sent[1].text, /^Use \/simulate green, yellow, red or unknown/);
  assert.equal(simulator.state, "green");
});

// ---------- the live alert, end to end ----------

test("live alert: watch, flip, and a real alert arrives through the real loop", async () => {
  const r = rig();
  await r.bot.handleUpdate(msg(OWNER, "/watch demo")); // baseline: green
  await r.bot.handleUpdate(msg(GUEST, "/watch demo")); // a second watcher
  r.telegram.sent.length = 0;

  await r.bot.handleUpdate(msg(OWNER, "/simulate red"));

  const toOwner = r.telegram.sent.filter((s) => s.chatId === OWNER).map((s) => s.text);
  const toGuest = r.telegram.sent.filter((s) => s.chatId === GUEST).map((s) => s.text);
  assert.match(toOwner[0], /^Simulated token set to 🔴 Red/);
  const alert = toOwner.find((t) => t.startsWith("🧪 Simulated demo token. Not real data."));
  assert.ok(alert, "the owner receives the alert");
  assert.match(alert, /🔔 DEMO on Simulated changed from Green to Red\./);
  assert.match(alert, /honeypot/);
  assert.ok(alert.includes(NOTE));
  assert.equal(toGuest.length, 1, "the other watcher gets exactly one alert");
  assert.match(toGuest[0], /changed from Green to Red/);
  assert.match(toOwner.at(-1), /^Done: 2 alerts sent\./);
  assert.equal(r.store.list(OWNER)[0].lastVerdict, "red");
  const buttons = r.telegram.sent.find((s) => s.text.startsWith("🧪")).buttons;
  assert.equal(buttons[0][0].url, `https://web.test/?token=${SIM_ADDRESS}&network=${SIM_NETWORK_ID}`);

  // the same state again is not a change, so there's no second alert
  r.telegram.sent.length = 0;
  await r.bot.handleUpdate(msg(OWNER, "/simulate red"));
  assert.match(r.telegram.sent.at(-1).text, /nobody's verdict changed/);
  assert.ok(!r.telegram.sent.some((s) => s.text.startsWith("🧪")));

  // and back again
  r.telegram.sent.length = 0;
  await r.bot.handleUpdate(msg(OWNER, "/simulate green"));
  assert.ok(r.telegram.sent.some((s) => /changed from Red to Green/.test(s.text)));
  assert.equal(upstream, 0);
});

test("live alert: only the simulated token is re-checked, real watches are left alone", async () => {
  const r = rig();
  r.store.add({ chatId: OWNER, networkId: 1, address: REAL, symbol: "PEPE", verdict: "yellow" });
  await r.bot.handleUpdate(msg(OWNER, "/watch demo"));
  r.checked.length = 0;
  await r.bot.handleUpdate(msg(OWNER, "/simulate yellow"));
  assert.ok(r.checked.length > 0 && r.checked.every((a) => a === SIM_ADDRESS), `checked: ${r.checked}`);
});

test("live alert: flipping while a re-check is already running asks for a retry, and the state still changes", async () => {
  const r = rig();
  await r.bot.handleUpdate(msg(OWNER, "/watch demo"));
  let release;
  const gate = new Promise((res) => { release = res; });
  const slowWatcher = createWatcher({
    store: r.store, telegram: r.telegram, webAppUrl: "https://web.test", sleepImpl: async () => {}, logger: quiet,
    check: async (p) => { await gate; return handleCheck("k", p, { simulator: r.simulator }); },
  });
  const running = slowWatcher.runCycle();
  const bot = createBot({
    telegram: r.telegram, store: r.store, check: r.check, webAppUrl: "https://web.test", logger: quiet,
    simulator: r.simulator, ownerChatId: OWNER, runSimulationCycle: () => slowWatcher.runCycle({ only: () => true }),
  });
  r.telegram.sent.length = 0;
  await bot.handleUpdate(msg(OWNER, "/simulate red"));
  assert.match(r.telegram.sent.at(-1).text, /middle of a re-check/);
  assert.equal(r.simulator.state, "red");
  release();
  await running;
});

// ---------- the watcher option ----------

test("watcher: runCycle({ only }) checks just the tokens it accepts", async () => {
  const store = new WatchStore({ logger: quiet });
  store.add({ chatId: 1, networkId: 1, address: REAL, verdict: "green" });
  store.add({ chatId: 1, networkId: SIM_NETWORK_ID, address: SIM_ADDRESS, verdict: "green" });
  const seen = [];
  const watcher = createWatcher({
    store, telegram: fakeTelegram(), webAppUrl: "https://web.test", sleepImpl: async () => {}, logger: quiet,
    check: async (p) => { seen.push(p.tokenAddress); return { status: 200, body: { verdict: "green", dataSource: "dex", degradedReason: null } }; },
  });
  await watcher.runCycle({ only: (t) => t.address === SIM_ADDRESS });
  assert.deepEqual(seen, [SIM_ADDRESS]);
  await watcher.runCycle();
  assert.equal(seen.length, 3);
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
  console.log(`\ntest_simulation: all ${tests.length} passed`);
})();
