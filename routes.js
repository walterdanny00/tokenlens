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

// networkId is optional: when omitted, the network is auto-detected from
// the token address (deepest liquidity wins if it exists on several).
async function handleCheck(apiKey, { tokenAddress, networkId, symbol }) {
  let network;
  if (networkId !== undefined && networkId !== null && networkId !== "") {
    network = Number(networkId);
    if (!Number.isFinite(network)) {
      return { status: 400, body: { error: "networkId must be a number." } };
    }
  }

  const identifier = { networkId: network, tokenAddress, symbol };
  const record = await getTokenRecord(apiKey, identifier);
  const result = scoreToken(record);
  const copy = generateVerdictCopy(result);

  return {
    status: 200,
    body: {
      tokenAddress,
      networkId: record.network_id ?? network ?? null,
      networkName: record.network_name || null,
      alsoOnNetworks: record.also_on_networks || [],
      verdict: result.verdict,
      reasons: result.reasons,
      caveats: result.caveats || [],
      message: copy,
      dataSource: record.source,
      degradedReason: record.degraded_reason || record.error || record.security_fetch_error || null,
      data: buildData(record),
    },
  };
}

async function handleWatch(apiKey, watchlist, { networkId, tokenAddress, symbol }) {
  if (!networkId || !tokenAddress) {
    return { status: 400, body: { error: "networkId and tokenAddress are required." } };
  }

  const identifier = { networkId: Number(networkId), tokenAddress, symbol };
  const record = await getTokenRecord(apiKey, identifier);
  const result = scoreToken(record);

  const key = `${networkId}:${tokenAddress}`;
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
