/**
 * GoPlus Security API integration.
 * Free, no API key required. Used as the security-data source since CMC's
 * own /v1/dex/security/detail and /v1/dex/holders/list endpoints have not
 * returned usable responses during the hackathon window (see docs/session-04.md).
 *
 * GoPlus uses real EVM chain IDs (Ethereum=1, BSC=56, etc.) — different from
 * CMC's own internal network_id scheme — so CMC_NETWORK_TO_GOPLUS maps
 * between them. Solana isn't EVM and uses a separate GoPlus endpoint.
 */

const GOPLUS_BASE = "https://api.gopluslabs.io/api/v1";

// Maps CMC's internal network_id (from /v1/dex/platform/list) to GoPlus's
// EVM chain ID, or { solana: true } for Solana's separate endpoint.
const CMC_NETWORK_TO_GOPLUS = {
  1: { evmChainId: "1" },     // Ethereum
  14: { evmChainId: "56" },   // BSC
  16: { solana: true },       // Solana
  199: { evmChainId: "8453" },// Base
  51: { evmChainId: "42161" },// Arbitrum
  28: { evmChainId: "43114" },// Avalanche
};

function isZeroOrEmptyAddress(addr) {
  if (!addr) return true;
  return /^0x0*$/i.test(addr);
}

/**
 * Fetches and normalizes GoPlus security data for an EVM token.
 * Throws on failure — caller decides how to handle it.
 */
async function fetchGoPlusEvm(evmChainId, tokenAddress, fetchImpl = fetch) {
  const res = await fetchImpl(
    `${GOPLUS_BASE}/token_security/${evmChainId}?contract_addresses=${tokenAddress}`
  );
  const body = await res.json();

  if (body.code !== 1) {
    const err = new Error(body.message || "GoPlus API error");
    err.code = body.code;
    throw err;
  }

  const data = body.result && body.result[tokenAddress.toLowerCase()];
  if (!data) {
    const err = new Error("Token not found in GoPlus results.");
    err.code = "NOT_FOUND";
    throw err;
  }

  const holders = Array.isArray(data.holders) ? data.holders : [];
  const top10Pct = holders
    .slice(0, 10)
    .reduce((sum, h) => sum + (parseFloat(h.percent) || 0), 0) * 100;

  const lpHolders = Array.isArray(data.lp_holders) ? data.lp_holders : [];
  const liquidityLocked = lpHolders.some((h) => h.is_locked === "1" || h.is_locked === 1);

  return {
    security_scan_available: true,
    holder_data_available: holders.length > 0,
    is_honeypot: data.is_honeypot === "1",
    mint_function_active: data.is_mintable === "1",
    ownership_renounced: isZeroOrEmptyAddress(data.owner_address),
    liquidity_locked: liquidityLocked,
    liquidity_lock_days: null, // GoPlus doesn't reliably expose lock duration
    top10_holder_pct: holders.length > 0 ? top10Pct : null,
  };
}

/**
 * Fetches and normalizes GoPlus security data for a Solana token.
 * Solana's response shape differs from EVM's — simpler, no lp_holders array
 * in the same form, so this is intentionally more conservative.
 */
async function fetchGoPlusSolana(tokenAddress, fetchImpl = fetch) {
  const res = await fetchImpl(
    `${GOPLUS_BASE}/solana/token_security?contract_addresses=${tokenAddress}`
  );
  const body = await res.json();

  if (body.code !== 1) {
    const err = new Error(body.message || "GoPlus Solana API error");
    err.code = body.code;
    throw err;
  }

  const data = body.result && body.result[tokenAddress];
  if (!data) {
    const err = new Error("Token not found in GoPlus Solana results.");
    err.code = "NOT_FOUND";
    throw err;
  }

  return {
    security_scan_available: true,
    holder_data_available: typeof data.holder_count === "number",
    is_honeypot: data.is_honeypot === "1" || data.is_honeypot === 1,
    mint_function_active: data.mintable && data.mintable.status === "1",
    ownership_renounced: !data.balance_mutable_authority || data.balance_mutable_authority.status !== "1",
    liquidity_locked: null, // not reliably exposed for Solana in the same shape
    liquidity_lock_days: null,
    top10_holder_pct: null, // Solana response doesn't give a simple top-10 breakdown
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
