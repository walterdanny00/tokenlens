/**
 * GoPlus Security API integration.
 * Free, no API key required. Used as the security-data source since CMC's
 * own /v1/dex/security/detail and /v1/dex/holders/list endpoints have not
 * returned usable responses during the hackathon window (see docs/session-04.md).
 *
 * GoPlus uses real EVM chain IDs (Ethereum=1, BSC=56, etc.) — different from
 * CMC's own internal network_id scheme — so CMC_NETWORK_TO_GOPLUS maps
 * between them. Solana isn't EVM and uses a separate GoPlus endpoint.
 *
 * Every field below is tri-state: true / false / null. null means GoPlus gave
 * no answer — never treat it as "safe". Field handling was checked against
 * real GoPlus responses (session 5): PEPE on Ethereum, BONK on Solana.
 */

const GOPLUS_BASE = "https://api.gopluslabs.io/api/v1";
const GOPLUS_TIMEOUT_MS = 12000;

// Maps CMC's internal network_id (from /v1/dex/platform/list) to GoPlus's
// EVM chain ID, or { solana: true } for Solana's separate endpoint.
// NOTE: the CMC ids on the left are not yet verified against a live response.
const CMC_NETWORK_TO_GOPLUS = {
  1: { evmChainId: "1" },     // Ethereum
  14: { evmChainId: "56" },   // BSC
  16: { solana: true },       // Solana
  199: { evmChainId: "8453" },// Base
  51: { evmChainId: "42161" },// Arbitrum
  28: { evmChainId: "43114" },// Avalanche
};

// Share of LP tokens that must be locked/burned to call liquidity "locked".
// GoPlus lists only the top LP holders, so the share is a lower bound.
const LP_LOCKED_MIN_SHARE = 0.5;

// Concentrated-liquidity pools (Uniswap V3/V4-style, Orca Whirlpools, Raydium
// CLMM, Meteora DLMM) hold positions as NFTs/bins rather than one fungible LP
// token, so the classic "LP tokens locked/burned" check can't see them.
const CONCENTRATED_RE = /v[34]\b|v[34]$|clmm|dlmm|whirlpool|concentrated|slipstream/i;

// Share (0-100) of the listed pool liquidity that sits in concentrated pools,
// or null when GoPlus lists no usable pools. `pools` entries are read via
// typeOf(pool) and sizeOf(pool).
function concentratedLiquidityPct(pools, typeOf, sizeOf) {
  if (!Array.isArray(pools)) return null;
  let total = 0;
  let concentrated = 0;
  for (const pool of pools) {
    const size = parseFloat(sizeOf(pool));
    if (!Number.isFinite(size) || size <= 0) continue;
    total += size;
    if (CONCENTRATED_RE.test(String(typeOf(pool) || ""))) concentrated += size;
  }
  return total > 0 ? (concentrated / total) * 100 : null;
}

function isZeroOrEmptyAddress(addr) {
  if (!addr) return true;
  return /^0x0*$/i.test(addr);
}

// GoPlus encodes booleans as "1"/"0" strings (sometimes numbers, sometimes
// missing). Returns true/false, or null when GoPlus gave no answer.
function flag(v) {
  if (v === "1" || v === 1 || v === true) return true;
  if (v === "0" || v === 0 || v === false) return false;
  return null;
}

// Solana authority objects look like { authority: [...], status: "0" }.
function authorityActive(field) {
  return field && typeof field === "object" ? flag(field.status) : null;
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// GoPlus reports each holder's share as a fraction (0.0883 = 8.83%).
function topHoldersPct(holders, n = 10) {
  if (!Array.isArray(holders) || holders.length === 0) return null;
  return holders.slice(0, n).reduce((sum, h) => sum + (parseFloat(h.percent) || 0), 0) * 100;
}

// Fraction of LP tokens (among the listed holders) that are locked/burned,
// or null when GoPlus has no LP-token data (e.g. Uniswap V3/V4 positions).
function lockedLpShare(lpHolders) {
  if (!Array.isArray(lpHolders) || lpHolders.length === 0) return null;
  return lpHolders
    .filter((h) => flag(h.is_locked) === true)
    .reduce((sum, h) => sum + (parseFloat(h.percent) || 0), 0);
}

// A single quick retry smooths over the odd blip (a timeout, a rate-limit hiccup,
// a 5xx) without slowing anything down when GoPlus answers first time. Answers
// that will never change, like an unsupported chain, are not retried.
const RETRY_DELAY_MS = 600;
const isPermanent = (message) => /not supported|invalid/i.test(String(message || ""));

async function fetchGoPlusJson(url, fetchImpl, label) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(GOPLUS_TIMEOUT_MS) });
      const body = await res.json();
      if (body.code === 1) return body;
      const err = new Error(body.message || `${label} error`);
      err.code = body.code;
      err.permanent = isPermanent(body.message);
      throw err;
    } catch (err) {
      lastError = err;
      if (err.permanent) break;
    }
  }
  throw lastError;
}

/**
 * Fetches and normalizes GoPlus security data for an EVM token.
 * Throws on failure — caller decides how to handle it.
 */
async function fetchGoPlusEvm(evmChainId, tokenAddress, fetchImpl = fetch) {
  const body = await fetchGoPlusJson(
    `${GOPLUS_BASE}/token_security/${evmChainId}?contract_addresses=${encodeURIComponent(tokenAddress)}`,
    fetchImpl,
    "GoPlus API"
  );

  const data = body.result && body.result[tokenAddress.toLowerCase()];
  if (!data) {
    const err = new Error("Token not found in GoPlus results.");
    err.code = "NOT_FOUND";
    throw err;
  }

  const isHoneypot = flag(data.is_honeypot);
  const lockedShare = lockedLpShare(data.lp_holders);
  const canReclaimOwnership =
    flag(data.can_take_back_ownership) === true || flag(data.hidden_owner) === true;
  const holders = Array.isArray(data.holders) ? data.holders : [];

  return {
    // No honeypot verdict from GoPlus (e.g. it couldn't simulate a trade) means
    // no real scan — scoring.js then caps the verdict at YELLOW.
    security_scan_available: isHoneypot !== null,
    holder_data_available: holders.length > 0,
    holder_count: toInt(data.holder_count),
    is_honeypot: isHoneypot,
    mint_function_active: flag(data.is_mintable),
    ownership_renounced:
      data.owner_address === undefined
        ? null
        : isZeroOrEmptyAddress(data.owner_address) && !canReclaimOwnership,
    liquidity_locked: lockedShare === null ? null : lockedShare >= LP_LOCKED_MIN_SHARE,
    liquidity_locked_pct: lockedShare === null ? null : lockedShare * 100,
    liquidity_lock_days: null, // GoPlus doesn't reliably expose lock duration
    concentrated_liquidity_pct: concentratedLiquidityPct(data.dex, (p) => p.liquidity_type, (p) => p.liquidity),
    top10_holder_pct: topHoldersPct(holders),
  };
}

/**
 * Fetches and normalizes GoPlus security data for a Solana token.
 * The Solana response has no honeypot verdict and no LP-lock data; its risk
 * signals are authorities (mint / freeze / balance-mutable) instead.
 */
async function fetchGoPlusSolana(tokenAddress, fetchImpl = fetch) {
  const body = await fetchGoPlusJson(
    `${GOPLUS_BASE}/solana/token_security?contract_addresses=${encodeURIComponent(tokenAddress)}`,
    fetchImpl,
    "GoPlus Solana API"
  );

  const data = body.result && body.result[tokenAddress];
  if (!data) {
    const err = new Error("Token not found in GoPlus Solana results.");
    err.code = "NOT_FOUND";
    throw err;
  }

  const mintActive = authorityActive(data.mintable);
  const powers = [mintActive, authorityActive(data.freezable), authorityActive(data.balance_mutable_authority)];
  const holders = Array.isArray(data.holders) ? data.holders : [];

  return {
    security_scan_available: powers.some((p) => p !== null),
    holder_data_available: holders.length > 0,
    holder_count: toInt(data.holder_count),
    is_honeypot: null, // GoPlus's Solana endpoint gives no honeypot verdict
    mint_function_active: mintActive,
    // "Renounced" = no mint, freeze or balance-mutable authority remains.
    ownership_renounced: powers.includes(true) ? false : powers.includes(null) ? null : true,
    liquidity_locked: null, // not exposed for Solana
    liquidity_locked_pct: null,
    liquidity_lock_days: null,
    concentrated_liquidity_pct: concentratedLiquidityPct(data.dex, (p) => p.type, (p) => p.tvl),
    top10_holder_pct: topHoldersPct(holders),
  };
}

/**
 * Main entry point: routes to the right GoPlus endpoint based on CMC's
 * network_id. Throws on any failure or unsupported network — caller
 * (ingestion.js) decides how to degrade.
 */
async function fetchSecurityData(cmcNetworkId, tokenAddress, fetchImpl = fetch) {
  const mapping = CMC_NETWORK_TO_GOPLUS[cmcNetworkId];
  if (!mapping) {
    const err = new Error(`No GoPlus mapping for CMC network_id ${cmcNetworkId}`);
    err.code = "UNSUPPORTED_NETWORK";
    throw err;
  }

  if (mapping.solana) {
    return fetchGoPlusSolana(tokenAddress, fetchImpl);
  }
  return fetchGoPlusEvm(mapping.evmChainId, tokenAddress, fetchImpl);
}

module.exports = { fetchSecurityData, fetchGoPlusEvm, fetchGoPlusSolana, CMC_NETWORK_TO_GOPLUS };
