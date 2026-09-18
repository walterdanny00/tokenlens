/**
 * TokenLens data ingestion layer.
 *
 * Tries the real DEX endpoints first (liquidity, holder concentration,
 * security scan, LP lock). If those aren't accessible on the current plan
 * (error 1006) or fail for any other reason, degrades to whatever Basic-tier
 * cryptocurrency endpoints are available, and marks the record as partial
 * so the scoring engine correctly returns "unknown" instead of a false Green.
 *
 * Swapping to full DEX mode later (once tier access clears) requires no
 * changes to scoring.js or copyGenerator.js — only this file's DEX calls
 * need to go from "attempted, currently failing" to "attempted, succeeding."
 */

const BASE_URL = "https://pro-api.coinmarketcap.com";

function authHeaders(apiKey) {
  return {
    "X-CMC_PRO_API_KEY": apiKey,
    "Accept": "application/json",
    "User-Agent": "TokenLens/1.0",
  };
}

/**
 * Attempts the real DEX data path: network info + spot pair + security scan.
 * Throws on any failure — caller decides how to handle it (fallback).
 */
async function fetchDexRecord(apiKey, { networkId, tokenAddress }, fetchImpl = fetch) {
  const res = await fetchImpl(
    `${BASE_URL}/v1/dex/security/detail?network_id=${networkId}&address=${tokenAddress}`,
    { headers: authHeaders(apiKey) }
  );
  const body = await res.json();

  if (body.status && body.status.error_code && body.status.error_code !== "0") {
    const err = new Error(body.status.error_message || "DEX endpoint error");
    err.code = body.status.error_code;
    throw err;
  }

  const d = body.data;
  return {
    source: "dex",
    address: tokenAddress,
    network_id: networkId,
    security_scan_available: true,
    holder_data_available: true,
    contract_age_hours: d.contract_age_hours,
    is_honeypot: d.is_honeypot,
    mint_function_active: d.mint_function_active,
    liquidity_locked: d.liquidity_locked,
    liquidity_lock_days: d.liquidity_lock_days,
    liquidity_usd: d.liquidity_usd,
    ownership_renounced: d.ownership_renounced,
    top10_holder_pct: d.top10_holder_pct,
  };
}

/**
 * Degraded-mode path: standard Basic-tier cryptocurrency data only.
 * Cannot determine honeypot/mint/lock/holder-concentration — those fields
 * are left absent so scoring.js correctly falls into "unknown" rather than
 * guessing or defaulting to Green.
 */
async function fetchFallbackRecord(apiKey, { symbol, tokenAddress }, fetchImpl = fetch) {
  const res = await fetchImpl(
    `${BASE_URL}/v1/cryptocurrency/quotes/latest?symbol=${symbol}`,
    { headers: authHeaders(apiKey) }
  );
  const body = await res.json();

  if (body.status && body.status.error_code && body.status.error_code !== "0") {
    const err = new Error(body.status.error_message || "Fallback endpoint error");
    err.code = body.status.error_code;
    throw err;
  }

  const coin = body.data && body.data[symbol];

  return {
    source: "fallback",
    address: tokenAddress || null,
    symbol,
    security_scan_available: false, // triggers "unknown" verdict in scoring.js
    holder_data_available: false,
    contract_age_hours: coin ? hoursSince(coin.date_added) : null,
    market_cap: coin ? coin.quote.USD.market_cap : null,
    volume_24h: coin ? coin.quote.USD.volume_24h : null,
    price_usd: coin ? coin.quote.USD.price : null,
  };
}

function hoursSince(isoDateString) {
  if (!isoDateString) return null;
  const then = new Date(isoDateString).getTime();
  return (Date.now() - then) / (1000 * 60 * 60);
}

/**
 * Main entry point: try DEX first, fall back on any failure.
 * Always resolves to a record — never throws — so the polling loop never
 * crashes on a single bad token.
 */
async function getTokenRecord(apiKey, identifier, fetchImpl = fetch) {
  try {
    return await fetchDexRecord(apiKey, identifier, fetchImpl);
  } catch (dexErr) {
    try {
      const fallback = await fetchFallbackRecord(apiKey, identifier, fetchImpl);
      fallback.degraded_reason = `DEX data unavailable (${dexErr.code || "error"}): ${dexErr.message}`;
      return fallback;
    } catch (fallbackErr) {
      return {
        source: "none",
        address: identifier.tokenAddress || null,
        symbol: identifier.symbol || null,
        security_scan_available: false,
        holder_data_available: false,
        contract_age_hours: null,
        error: `Both DEX and fallback lookups failed: ${fallbackErr.message}`,
      };
    }
  }
}

module.exports = { getTokenRecord, fetchDexRecord, fetchFallbackRecord };
