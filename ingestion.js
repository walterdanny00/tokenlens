/**
 * TokenLens data ingestion layer.
 *
 * As of session 4: CMC's /v1/dex/security/detail and /v1/dex/holders/list
 * endpoints reject every parameter combination we've tried (see
 * docs/session-04.md) — reported to CMC hackathon support. Liquidity and
 * market-cap data comes from CMC's /v1/dex/search (confirmed working);
 * security/holder data comes from GoPlus's free public API instead
 * (see goplus.js). If GoPlus also fails, security_scan_available stays
 * false and scoring.js correctly caps the verdict at YELLOW rather than
 * guessing or defaulting to GREEN.
 */

const { fetchSecurityData } = require("./goplus");

const BASE_URL = "https://pro-api.coinmarketcap.com";

function authHeaders(apiKey) {
  return {
    "X-CMC_PRO_API_KEY": apiKey,
    "Accept": "application/json",
    "User-Agent": "TokenLens/1.0",
  };
}

function hoursSince(epochMsOrIso) {
  if (!epochMsOrIso) return null;
  const then = typeof epochMsOrIso === "number" ? epochMsOrIso : new Date(epochMsOrIso).getTime();
  return (Date.now() - then) / (1000 * 60 * 60);
}

/**
 * Searches CMC's DEX search endpoint for a token by keyword (symbol, name,
 * or contract address all work as search terms) and returns the entry
 * matching tokenAddress if given, or the first result otherwise.
 */
async function fetchDexRecord(apiKey, { tokenAddress, keyword }, fetchImpl = fetch) {
  const searchTerm = keyword || tokenAddress;
  const res = await fetchImpl(
    `${BASE_URL}/v1/dex/search?keyword=${encodeURIComponent(searchTerm)}`,
    { headers: authHeaders(apiKey) }
  );
  const body = await res.json();

  if (body.status && body.status.error_code && body.status.error_code !== "0") {
    const err = new Error(body.status.error_message || "DEX search error");
    err.code = body.status.error_code;
    throw err;
  }

  const results = (body.data && body.data.tks) || [];
  if (results.length === 0) {
    const err = new Error("No matching token found in DEX search.");
    err.code = "NOT_FOUND";
    throw err;
  }

  const match = tokenAddress
    ? results.find((t) => t.addr && t.addr.toLowerCase() === tokenAddress.toLowerCase())
    : results[0];

  if (!match) {
    const err = new Error("Token address not found among DEX search results.");
    err.code = "NOT_FOUND";
    throw err;
  }

  // Base record from CMC's confirmed-working search data.
  const baseRecord = {
    source: "dex",
    address: match.addr,
    symbol: match.s,
    name: match.n,
    security_scan_available: false,
    holder_data_available: false,
    is_honeypot: null,
    mint_function_active: null,
    liquidity_locked: null,
    liquidity_lock_days: null,
    ownership_renounced: null,
    top10_holder_pct: null,
    liquidity_usd: match.liq,
    market_cap: match.mc,
    volume_24h: match.v24h,
    price_usd: match.pu,
    price_change_24h_pct: match.pc24h,
    contract_age_hours: hoursSince(Number(match.fpt || match.pt)),
  };

  // Try to enrich with GoPlus security data. Non-fatal if it fails —
  // the record above is still useful with security_scan_available: false.
  const cmcNetworkId = identifierNetworkId(match);
  try {
    const securityData = await fetchSecurityData(cmcNetworkId, match.addr, fetchImpl);
    return { ...baseRecord, ...securityData, security_source: "goplus" };
  } catch (securityErr) {
    return { ...baseRecord, security_fetch_error: securityErr.message };
  }
}

// The DEX search result doesn't directly return CMC's network_id, only
// pltId (platform ID) — which happens to match CMC's network_id scheme
// from /v1/dex/platform/list, so we reuse it directly.
function identifierNetworkId(searchMatch) {
  return searchMatch.pltId;
}

/**
 * Degraded-mode fallback: standard Basic-tier cryptocurrency data only.
 * Used if the DEX search itself fails (network issue, symbol not found,
 * etc.) — even more limited than the DEX-search path above.
 */
async function fetchFallbackRecord(apiKey, { symbol }, fetchImpl = fetch) {
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
    symbol,
    security_scan_available: false,
    holder_data_available: false,
    contract_age_hours: coin ? hoursSince(coin.date_added) : null,
    market_cap: coin ? coin.quote.USD.market_cap : null,
    volume_24h: coin ? coin.quote.USD.volume_24h : null,
    price_usd: coin ? coin.quote.USD.price : null,
    liquidity_usd: null, // not available from this endpoint
  };
}

/**
 * Main entry point: try DEX search first, fall back to plain cryptocurrency
 * data on any failure. Always resolves to a record — never throws.
 */
async function getTokenRecord(apiKey, identifier, fetchImpl = fetch) {
  try {
    return await fetchDexRecord(apiKey, identifier, fetchImpl);
  } catch (dexErr) {
    try {
      const fallback = await fetchFallbackRecord(apiKey, identifier, fetchImpl);
      fallback.degraded_reason = `DEX search unavailable (${dexErr.code || "error"}): ${dexErr.message}`;
      return fallback;
    } catch (fallbackErr) {
      return {
        source: "none",
        address: identifier.tokenAddress || null,
        symbol: identifier.symbol || null,
        security_scan_available: false,
        holder_data_available: false,
        contract_age_hours: null,
        error: `Both DEX search and fallback lookups failed: ${fallbackErr.message}`,
      };
    }
  }
}

module.exports = { getTokenRecord, fetchDexRecord, fetchFallbackRecord };
