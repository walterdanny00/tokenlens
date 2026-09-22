/**
 * TokenLens route logic, extracted from server.js so it can be tested
 * without needing a live Express server or network access.
 * server.js just wires these into actual routes.
 */

const { getTokenRecord } = require("./ingestion");
const { scoreToken } = require("./scoring");
const { generateVerdictCopy } = require("./copyGenerator");

function makeWatchlist() {
  return new Map(); // key: `${networkId}:${tokenAddress}` -> entry
}

// The raw numbers behind a verdict, in the shape the frontend's
// "see the data" panel wants. null always means "unknown", never "no".
function buildData(record) {
  return {
    symbol: record.symbol ?? null,
    name: record.name ?? null,
    liquidityUsd: record.liquidity_usd ?? null,
    marketCapUsd: record.market_cap ?? null,
    volume24hUsd: record.volume_24h ?? null,
    priceUsd: record.price_usd == null ? null : Number(record.price_usd),
    contractAgeHours: record.contract_age_hours ?? null,
    holderCount: record.holder_count ?? null,
    top10HolderPct: record.top10_holder_pct ?? null,
    isHoneypot: record.is_honeypot ?? null,
    mintFunctionActive: record.mint_function_active ?? null,
    liquidityLocked: record.liquidity_locked ?? null,
    liquidityLockedPct: record.liquidity_locked_pct ?? null,
    concentratedLiquidityPct: record.concentrated_liquidity_pct ?? null,
    ownershipRenounced: record.ownership_renounced ?? null,
    securityScanAvailable: record.security_scan_available === true,
    securitySource: record.security_source || null,
  };
}

const CACHE_TTL_MS = 60 * 1000; // a good answer is reused for a minute
const DEGRADED_TTL_MS = 10 * 1000; // a partial answer only briefly, so a hiccup clears fast
const MAX_WATCHLIST = 500;

const BUSY = { error: "TokenLens is very busy right now. Please try again in a little while." };

// EVM addresses are case-insensitive; Solana addresses are not.
function cacheKey(tokenAddress, network, symbol) {
  const address = tokenAddress.startsWith("0x") ? tokenAddress.toLowerCase() : tokenAddress;
  return `${address}|${network ?? "auto"}|${String(symbol || "").toLowerCase()}`;
}

/**
 * networkId is optional: when omitted, the network is auto-detected from the
 * token address (deepest liquidity wins if it exists on several).
 *
 * `protection` is optional and switches on the safeguards a public API needs:
 *   cache  - a TtlCache; identical checks are answered from memory
 *   budget - a rate limiter shared by everyone; every lookup that reaches the
 *            paid upstream APIs spends one unit, cached answers spend none
 * Without it, behaviour is exactly as before (handy for tests).
 */
async function handleCheck(apiKey, { tokenAddress, networkId, symbol }, protection = {}) {
  const { cache, budget, simulator, ttlMs = CACHE_TTL_MS, degradedTtlMs = DEGRADED_TTL_MS } = protection;

  let network;
  if (networkId !== undefined && networkId !== null && networkId !== "") {
    network = Number(networkId);
    if (!Number.isFinite(network)) {
      return { status: 400, body: { error: "networkId must be a number." } };
    }
  }

  // Turns a token record into the API's answer. The same code serves real and
  // simulated tokens, so a simulated verdict is scored by the real rules.
  const respond = (record, extraCaveats = []) => {
    const result = scoreToken(record);
    const caveats = [...(result.caveats || []), ...extraCaveats];
    const body = {
      tokenAddress,
      networkId: record.network_id ?? network ?? null,
      networkName: record.network_name || null,
      alsoOnNetworks: record.also_on_networks || [],
      verdict: result.verdict,
      reasons: result.reasons,
      caveats,
      message: generateVerdictCopy({ ...result, caveats }),
      dataSource: record.source,
      degradedReason: record.degraded_reason || record.error || record.security_fetch_error || null,
      data: buildData(record),
    };
    if (record.simulated === true) body.simulated = true;
    return { status: 200, body };
  };

  // The simulated demo token: never cached (a flip must show at once), never
  // charged to the lookup budget, and never sent to an upstream API.
  if (simulator && simulator.isSimulated(tokenAddress)) {
    return respond(simulator.record(), [simulator.note]);
  }

  const compute = async () => {
    if (budget) {
      const spent = budget.hit("lookups");
      if (!spent.allowed) return { status: 503, body: BUSY, retryAfterSec: spent.retryAfterSec };
    }

    const identifier = { networkId: network, tokenAddress, symbol };
    const record = await getTokenRecord(apiKey, identifier);
    return respond(record);
  };

  if (!cache) return compute();

  const { value, hit } = await cache.wrap(
    cacheKey(tokenAddress, network, symbol),
    compute,
    (res) => (res.status !== 200 ? 0 : res.body.degradedReason ? degradedTtlMs : ttlMs)
  );
  return { ...value, cached: hit };
}

async function handleWatch(
  apiKey,
  watchlist,
  { networkId, tokenAddress, symbol },
  { budget, maxWatchlist = MAX_WATCHLIST } = {}
) {
  if (!networkId || !tokenAddress) {
    return { status: 400, body: { error: "networkId and tokenAddress are required." } };
  }

  const key = `${networkId}:${tokenAddress}`;
  if (!watchlist.has(key) && watchlist.size >= maxWatchlist) {
    return { status: 503, body: { error: "The watchlist is full right now. Please try again later." } };
  }
  if (budget) {
    const spent = budget.hit("lookups");
    if (!spent.allowed) return { status: 503, body: BUSY, retryAfterSec: spent.retryAfterSec };
  }

  const identifier = { networkId: Number(networkId), tokenAddress, symbol };
  const record = await getTokenRecord(apiKey, identifier);
  const result = scoreToken(record);

  watchlist.set(key, {
    identifier,
    lastVerdict: result.verdict,
    lastReasons: result.reasons,
    addedAt: new Date().toISOString(),
  });

  return {
    status: 200,
    body: {
      watching: true,
      tokenAddress,
      networkId: Number(networkId),
      initialVerdict: result.verdict,
      message: generateVerdictCopy(result),
    },
  };
}

function handleWatchlist(watchlist) {
  const entries = Array.from(watchlist.entries()).map(([key, value]) => ({
    key,
    ...value,
  }));
  return { status: 200, body: { count: entries.length, entries } };
}

module.exports = { makeWatchlist, handleCheck, handleWatch, handleWatchlist };
