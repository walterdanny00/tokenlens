/**
 * TokenLens data ingestion layer.
 *
 * Liquidity and market-cap data comes from CMC's /v1/dex/search (query
 * parameter is `q` — `keyword` is silently ignored and returns a default
 * list). Security/holder data comes from GoPlus's free public API (see
 * goplus.js). If GoPlus fails, security_scan_available stays false and
 * scoring.js caps the verdict at YELLOW rather than guessing or defaulting
 * to GREEN.
 *
 * Note (session 5): CMC's /v1/dex/security/detail responds correctly to
 * `platformName` + `address` — not yet wired in here.
 */

const { fetchSecurityData } = require("./goplus");

const BASE_URL = "https://pro-api.coinmarketcap.com";
const REQUEST_TIMEOUT_MS = 15000;

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

// CMC timestamps are epoch milliseconds, sometimes as strings. The earliest
// positive one is the best proxy for when the token first existed.
function earliestTimestamp(...values) {
  const nums = values.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return nums.length > 0 ? Math.min(...nums) : null;
}

// EVM addresses are case-insensitive; Solana (base58) addresses are not.
function sameAddress(a, b) {
  if (!a || !b) return false;
  if (a.startsWith("0x") && b.startsWith("0x")) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/**
 * Picks the search result for tokenAddress. The same address can exist on
 * several networks, so if a networkId is given only that network matches;
 * otherwise the match with the deepest liquidity wins.
 * Returns { match, others } — `others` are the same address on other networks.
 */
function pickMatch(results, { tokenAddress, networkId }) {
  if (!tokenAddress) return { match: results[0] || null, others: [] };

  const net = networkId === undefined || networkId === null ? NaN : Number(networkId);
  const sameToken = results.filter((t) => sameAddress(t.addr, tokenAddress));
  const candidates = Number.isFinite(net) ? sameToken.filter((t) => t.pltId === net) : sameToken;
  const ranked = [...candidates].sort((a, b) => (Number(b.liq) || 0) - (Number(a.liq) || 0));
  const match = ranked[0] || null;

  return { match, others: match ? sameToken.filter((t) => t !== match) : [] };
}

/**
 * Searches CMC's DEX search endpoint for a token by keyword (symbol, name,
 * or contract address all work as search terms) and returns the entry
 * matching tokenAddress (on networkId, if given), or the first result
 * when searching by keyword only.
 */
async function fetchDexRecord(apiKey, { tokenAddress, networkId, keyword }, fetchImpl = fetch) {
  const searchTerm = keyword || tokenAddress;
  const res = await fetchImpl(
    `${BASE_URL}/v1/dex/search?q=${encodeURIComponent(searchTerm)}`,
    { headers: authHeaders(apiKey), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
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

  const { match, others } = pickMatch(results, { tokenAddress, networkId });

  if (!match) {
    const err = new Error(
      networkId !== undefined && networkId !== null
        ? "Token address not found on this network."
        : "Token address not found among DEX search results."
    );
    err.code = "NOT_FOUND";
    throw err;
  }

  // Base record from CMC's search data.
  const baseRecord = {
    source: "dex",
    address: match.addr,
    symbol: match.s,
    name: match.n,
    network_id: match.pltId,
    network_name: match.plt,
    also_on_networks: others.map((t) => t.plt),
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
    contract_age_hours: hoursSince(earliestTimestamp(match.pt, match.fpt, match.fpct)),
  };

  // Try to enrich with GoPlus security data. Non-fatal if it fails —
  // the record above is still useful with security_scan_available: false.
  try {
    const securityData = await fetchSecurityData(match.pltId, match.addr, fetchImpl);
    return { ...baseRecord, ...securityData, security_source: "goplus" };
  } catch (securityErr) {
    return { ...baseRecord, security_fetch_error: securityErr.message };
  }
}

/**
 * Degraded-mode fallback: standard Basic-tier cryptocurrency data only.
 * Used if the DEX search itself fails (network issue, symbol not found,
 * etc.) — even more limited than the DEX-search path above.
 */
async function fetchFallbackRecord(apiKey, { symbol }, fetchImpl = fetch) {
  const res = await fetchImpl(
    `${BASE_URL}/v1/cryptocurrency/quotes/latest?symbol=${encodeURIComponent(symbol)}`,
    { headers: authHeaders(apiKey), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
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
        error: `DEX search failed (${dexErr.code || "error"}: ${dexErr.message}) and the fallback lookup failed too (${fallbackErr.message}).`,
      };
    }
  }
}

module.exports = { getTokenRecord, fetchDexRecord, fetchFallbackRecord };
