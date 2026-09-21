/**
 * TokenLens regression tests built from REAL responses captured during
 * session 5 (CMC /v1/dex/search, GoPlus EVM + Solana, CMC platform list).
 * No network access needed: fetch is mocked with those captured shapes.
 * Run: node test_realdata.js
 */
const assert = require("assert");

async function routesAndIngestion() {
  const { handleCheck } = require("./routes");
  const { getTokenRecord } = require("./ingestion");

const PEPE = "0x6982508145454ce325ddbe47a25d4ec3d2311933";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const now = Date.now();
const H = (h) => String(now - h * 3600e3);

// Search results shaped like the real CMC response pasted from Termux.
const tks = [
  { pltId: 1, plt: "Ethereum", addr: PEPE, s: "PEPE", n: "Pepe", liq: 32567734.37, mc: 1.69e9, v24h: 5e7, pu: "0.0000040", pt: H(20000), fpt: H(14000), fpct: H(30000) },
  { pltId: 189, plt: "PulseChain", addr: PEPE, s: "PEPE", n: "Pepe", liq: 5321.6, mc: 1e3, v24h: 10, pu: "0.1", pt: H(9000), fpt: H(9000), fpct: H(9000) },
  { pltId: 246, plt: "Unichain", addr: PEPE, s: "PEPE", n: "Pepe", liq: null, pt: H(5000), fpt: H(5000), fpct: H(5000) },
  { pltId: 16, plt: "Solana", addr: BONK, s: "Bonk", n: "Bonk", liq: 929143, mc: 2e9, v24h: 1e7, pu: "0.00002", pt: H(30000), fpt: H(30000), fpct: H(30000) },
  { pltId: 16, plt: "Solana", addr: BONK.toLowerCase(), s: "FAKE", n: "Fake", liq: 1e9, pt: H(1), fpt: H(1), fpct: H(1) }, // case-different Solana address must NOT match
];

const goplusPepe = { code: 1, result: { [PEPE]: { is_honeypot: "0", is_mintable: "0", owner_address: "0x0000000000000000000000000000000000000000",
  can_take_back_ownership: "0", hidden_owner: "0", holder_count: "593337",
  lp_holders: [{ percent: "0.997", is_locked: 0 }, { percent: "0.00009", is_locked: 1 }],
  holders: [{ percent: "0.05" }, { percent: "0.03" }] } } };
const goplusBonk = { code: 1, result: { [BONK]: { balance_mutable_authority: { status: "0" }, freezable: { status: "0" }, mintable: { status: "0" },
  holder_count: "1019104", holders: [{ percent: "0.0883" }, { percent: "0.0656" }], lp_holders: [],
  dex: [{ type: "Concentrated", tvl: "700000" }, { type: "Standard", tvl: "40000" }] } } };

const calls = [];
global.fetch = async (url, opts) => {
  calls.push(url);
  assert(opts && opts.signal, "every request should carry a timeout signal");
  const u = String(url);
  const ok = (o) => ({ json: async () => o });
  if (u.includes("/v1/dex/search?q=")) return ok({ status: { error_code: "0" }, data: { tks, total: tks.length } });
  if (u.includes("token_security/1?")) return ok(goplusPepe);
  if (u.includes("token_security/") ) return ok({ code: 2, message: "Chain not supported" });
  if (u.includes("solana/token_security")) return ok(goplusBonk);
  if (u.includes("cryptocurrency/quotes/latest")) return ok({ status: { error_code: "400", error_message: "BAD_REQUEST" } });
  throw new Error("unexpected url " + u);
};


  // 1. PEPE on Ethereum with explicit network
  let r = await handleCheck("k", { tokenAddress: PEPE, networkId: "1" });
  console.log(r.body.verdict, r.body.networkName, r.body.reasons);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.networkId, 1);
  assert.strictEqual(r.body.networkName, "Ethereum");
  assert.strictEqual(r.body.verdict, "yellow");
  assert.strictEqual(r.body.data.holderCount, 593337);
  assert.deepStrictEqual(r.body.caveats, []);
  assert.strictEqual(r.body.data.liquidityLocked, false);
  assert(r.body.data.contractAgeHours > 13000, "age should use the earliest timestamp (~30000h), got " + r.body.data.contractAgeHours);
  assert.deepStrictEqual(r.body.alsoOnNetworks, ["PulseChain", "Unichain"]);

  // 2. No networkId => auto-detect deepest liquidity (Ethereum)
  r = await handleCheck("k", { tokenAddress: PEPE });
  assert.strictEqual(r.body.networkId, 1);
  assert.strictEqual(r.body.networkName, "Ethereum");

  // 3. Explicit other network (PulseChain: GoPlus unsupported mapping => YELLOW/unknown-ish, never crash)
  r = await handleCheck("k", { tokenAddress: PEPE, networkId: 189 });
  console.log(r.body.networkName, r.body.verdict, r.body.degradedReason);
  assert.strictEqual(r.body.networkId, 189);
  assert.strictEqual(r.body.verdict, "yellow");
  assert(/No GoPlus mapping/.test(r.body.degradedReason));

  // 4. Network where the token doesn't exist
  r = await handleCheck("k", { tokenAddress: PEPE, networkId: 56 });
  console.log(r.body.dataSource, r.body.degradedReason || r.body.data);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.verdict, "unknown");
  assert(/not found on this network/.test(r.body.degradedReason), r.body.degradedReason);

  // 5. Solana BONK (exact-case match only)
  r = await handleCheck("k", { tokenAddress: BONK, networkId: 16 });
  console.log(r.body.verdict, r.body.caveats.length, r.body.data.concentratedLiquidityPct);
  assert.strictEqual(r.body.networkName, "Solana");
  assert.strictEqual(r.body.data.symbol, "Bonk");
  assert.strictEqual(r.body.verdict, "green");
  assert.strictEqual(r.body.caveats.length, 1);
  assert(Math.abs(r.body.data.concentratedLiquidityPct - 94.59) < 0.05, r.body.data.concentratedLiquidityPct);
  assert(r.body.message.includes("Liquidity lock can't be verified"));
  const rLower = await getTokenRecord("k", { tokenAddress: BONK.toLowerCase(), networkId: 16 });
  assert.strictEqual(rLower.symbol, "FAKE");

  // 6. bad networkId
  r = await handleCheck("k", { tokenAddress: PEPE, networkId: "abc" });
  assert.strictEqual(r.status, 400);

  // 7. searches use q=, never keyword=
  assert(calls.filter((c) => c.includes("dex/search")).every((c) => c.includes("?q=") && !c.includes("keyword")));
  console.log("ALL PASS");
}

async function scoringAndGoplus() {
  const { scoreToken } = require("./scoring");
  const { generateVerdictCopy } = require("./copyGenerator");
  const gp = require("./goplus");

// ---- real dex lists pasted from Termux ----
const bonkDex = [
  ["orca","Concentrated",297141.86],["orca","Concentrated",145551.89],["raydium","Concentrated",133863.97],
  ["orca","Concentrated",80070.12],["orca","Concentrated",34811.12],["raydium","Concentrated",24092.14],
  ["raydium","Standard",23709.29],["raydium","Standard",18750.46],["raydium","Concentrated",4823.99],["orca","Concentrated",2293.95],
].map(([dex_name,type,tvl]) => ({ dex_name, type, tvl: String(tvl), burn_percent: null }));
const pepeDex = [
  ["UniV2","14696395.67480047"],["UniV3","36249.536588058004"],["UniV4","13728.368629639451"],["UniV3","10278.186587975713"],
  ["UniV3","3750.917214891048"],["UniV4","3085.452351539112"],["UniV4","2089.201957748430"],["UniV2","10.00499777"],["UniV2","0.02363035"],
].map(([liquidity_type, liquidity]) => ({ liquidity_type, liquidity }));

const mk = (o) => async () => ({ json: async () => o });

  const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", PEPE = "0x6982508145454ce325ddbe47a25d4ec3d2311933";
  const s = await gp.fetchGoPlusSolana(BONK, mk({ code: 1, result: { [BONK]: { mintable:{status:"0"}, freezable:{status:"0"}, balance_mutable_authority:{status:"0"}, holder_count:"1019104", holders:[{percent:"0.0883"}], dex: bonkDex } } }));
  const e = await gp.fetchGoPlusEvm("1", PEPE, mk({ code: 1, result: { [PEPE]: { is_honeypot:"0", owner_address:"0x0", dex: pepeDex } } }));
  console.log("BONK concentrated %:", s.concentrated_liquidity_pct.toFixed(2), "| PEPE concentrated %:", e.concentrated_liquidity_pct.toFixed(2));
  assert(Math.abs(s.concentrated_liquidity_pct - 94.45) < 0.05);
  assert(e.concentrated_liquidity_pct < 1);
  const none = await gp.fetchGoPlusSolana(BONK, mk({ code: 1, result: { [BONK]: { mintable:{status:"0"} } } }));
  assert.strictEqual(none.concentrated_liquidity_pct, null);

  // ---- scoring ----
  const bonk = { security_scan_available: true, is_honeypot: null, mint_function_active: false, ownership_renounced: true,
    liquidity_locked: null, concentrated_liquidity_pct: 94.45, top10_holder_pct: 38.8, holder_count: 1019104,
    liquidity_usd: 929143, contract_age_hours: 30000 };
  const T = (name, rec, verdict, opts = {}) => {
    const r = scoreToken(rec);
    console.log(`${r.verdict.toUpperCase().padEnd(7)} ${name}${r.caveats ? "  [+caveat]" : ""}`);
    assert.strictEqual(r.verdict, verdict, name + " -> " + JSON.stringify(r));
    assert.strictEqual(!!r.caveats, !!opts.caveat, name + " caveat presence");
    return r;
  };
  const g = T("BONK (established, CLMM-heavy)", bonk, "green", { caveat: true });
  assert(/94%/.test(g.caveats[0]));
  assert(/Checked and clear/.test(g.reasons[0]) && !/liquidity is locked/.test(g.reasons[0]));
  const msg = generateVerdictCopy(g);
  assert(/Liquidity lock can't be verified/.test(msg) && msg.endsWith("not financial advice."));
  console.log("  message:", msg);

  T("age 60 days", { ...bonk, contract_age_hours: 24 * 60 }, "yellow");
  T("age 89 days", { ...bonk, contract_age_hours: 24 * 89 }, "yellow");
  T("age exactly 90 days", { ...bonk, contract_age_hours: 24 * 90 }, "green", { caveat: true });
  T("age unknown", { ...bonk, contract_age_hours: null }, "yellow");
  T("concentrated 79%", { ...bonk, concentrated_liquidity_pct: 79 }, "yellow");
  T("concentrated 80%", { ...bonk, concentrated_liquidity_pct: 80 }, "green", { caveat: true });
  T("concentrated unknown", { ...bonk, concentrated_liquidity_pct: null }, "yellow");
  T("liquidity $249k", { ...bonk, liquidity_usd: 249000 }, "yellow");
  T("holders 9,999", { ...bonk, holder_count: 9999 }, "yellow");
  T("holders unknown", { ...bonk, holder_count: null }, "yellow");
  const t55 = T("top10 55%", { ...bonk, top10_holder_pct: 55 }, "yellow");
  assert(t55.reasons.some((x) => /small number of wallets/.test(x)) && t55.reasons.some((x) => /couldn't confirm whether liquidity/.test(x)));
  T("top10 unknown", { ...bonk, top10_holder_pct: null }, "yellow");
  T("mint unknown", { ...bonk, mint_function_active: null }, "yellow");
  T("ownership still held", { ...bonk, ownership_renounced: false }, "yellow");
  T("ownership unknown", { ...bonk, ownership_renounced: null }, "yellow");
  // known-unlocked is never excused
  T("PEPE-like: lock known false", { ...bonk, liquidity_locked: false, concentrated_liquidity_pct: 99 }, "yellow");
  // hard REDs beat the override
  T("honeypot", { ...bonk, is_honeypot: true }, "red");
  T("mint active", { ...bonk, mint_function_active: true }, "red");
  T("young + unlocked", { ...bonk, liquidity_locked: false, contract_age_hours: 10 }, "red");
  // additive: other yellow flags still apply next to an eligible override
  const lk = T("short lock days with lock known", { ...bonk, liquidity_locked: true, liquidity_lock_days: 5 }, "yellow");
  // no scan => still capped
  T("no scan", { ...bonk, security_scan_available: false }, "yellow");
  // plain green keeps its old shape (no caveats key)
  const plain = scoreToken({ security_scan_available:true, is_honeypot:false, mint_function_active:false, liquidity_locked:true, ownership_renounced:true, top10_holder_pct:20, liquidity_usd:1e6, contract_age_hours:5000 });
  assert.deepStrictEqual(Object.keys(plain).sort(), ["reasons","verdict"]);
  assert.strictEqual(plain.verdict, "green");
  assert.strictEqual(generateVerdictCopy({ verdict: "red", reasons: ["x."] }), "\uD83D\uDD34 Be careful with this one. x. This is an automated check, not financial advice.");
  console.log("ALL PASS");
}

// GoPlus sometimes blips (a timeout, a hiccup). One quick retry smooths that over,
// but answers that will never change (an unsupported chain) must not be retried.
async function goplusRetries() {
  const gp = require("./goplus");
  const PEPE = "0x6982508145454ce325ddbe47a25d4ec3d2311933";
  const good = { code: 1, result: { [PEPE]: { is_honeypot: "0", is_mintable: "0", owner_address: "0x0", holder_count: "1000" } } };
  // Plays back one step per call: an Error is thrown, anything else is returned as the JSON body.
  const script = (...steps) => {
    let i = 0;
    const f = async () => {
      const step = steps[Math.min(i++, steps.length - 1)];
      if (step instanceof Error) throw step;
      return { json: async () => step };
    };
    f.calls = () => i;
    return f;
  };

  let f = script(good);
  assert.strictEqual((await gp.fetchGoPlusEvm("1", PEPE, f)).is_honeypot, false);
  assert.strictEqual(f.calls(), 1, "no retry when the first answer is fine");

  f = script(new TypeError("fetch failed"), good);
  assert.strictEqual((await gp.fetchGoPlusEvm("1", PEPE, f)).holder_count, 1000);
  assert.strictEqual(f.calls(), 2, "a network blip is retried once");

  f = script({ code: 2, message: "Service busy" }, good);
  assert.strictEqual((await gp.fetchGoPlusEvm("1", PEPE, f)).is_honeypot, false);
  assert.strictEqual(f.calls(), 2, "a service hiccup is retried once");

  f = script(new TypeError("fetch failed"), { code: 2, message: "Service busy" });
  await assert.rejects(() => gp.fetchGoPlusEvm("1", PEPE, f), /Service busy/);
  assert.strictEqual(f.calls(), 2, "it gives up after one retry, with the latest error");

  f = script({ code: 2, message: "Chain not supported" }, good);
  await assert.rejects(() => gp.fetchGoPlusEvm("1", PEPE, f), /not supported/);
  assert.strictEqual(f.calls(), 1, "an unsupported chain is not retried");

  f = script({ code: 1, result: {} }, good);
  await assert.rejects(() => gp.fetchGoPlusEvm("1", PEPE, f), /not found/i);
  assert.strictEqual(f.calls(), 1, "a token GoPlus doesn't know is an answer, not a blip");
  console.log("GOPLUS RETRY PASS");
}

(async () => {
  await routesAndIngestion();
  await scoringAndGoplus();
  await goplusRetries();
  console.log("test_realdata: all passed");
})().catch((e) => { console.error("test_realdata FAILED", e); process.exit(1); });
