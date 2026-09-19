/**
 * TokenLens risk scoring engine.
 * Pure function: takes a normalized token record, returns a verdict + reasons.
 * No network calls, no side effects — fully testable in isolation.
 *
 * IMPORTANT: security-scan/holder-concentration data (honeypot, mint,
 * liquidity-lock, ownership, top10 holder %) is not always obtainable from
 * CMC's DEX API (see docs/session-04.md). This engine works with whatever
 * subset of fields is actually present:
 *   - If security_scan_available is true, full RED-check logic runs.
 *   - If it's false but liquidity/age data IS available, the verdict is
 *     capped at YELLOW at most — we can still flag bad liquidity/age
 *     signals, but we can never call something GREEN without having
 *     verified honeypot/mint/lock/ownership status.
 *   - If NEITHER security nor liquidity/age data is available, it's UNKNOWN.
 */

function scoreToken(record) {
  const reasons = [];
  const hasSecurityScan = record.security_scan_available === true;
  const hasLiquidityData = typeof record.liquidity_usd === "number";

  // --- No usable data at all ---
  if (!hasSecurityScan && !hasLiquidityData) {
    return {
      verdict: "unknown",
      reasons: ["Not enough data is available yet to assess this token."],
    };
  }

  // --- Full security-scan path: hard RED checks first ---
  if (hasSecurityScan) {
    if (record.is_honeypot === true) {
      reasons.push("This token can be bought but not sold — a honeypot.");
      return { verdict: "red", reasons };
    }

    if (record.mint_function_active === true) {
      reasons.push("The creators can still generate unlimited new coins, which can crash the price.");
      return { verdict: "red", reasons };
    }

    if (record.liquidity_locked === false) {
      reasons.push("Liquidity isn't locked — funds could be pulled out at any time.");
      return { verdict: "red", reasons };
    }

    if (record.ownership_renounced === false && record.contract_age_hours < 48) {
      reasons.push("This is a brand-new token and the creators still fully control the contract.");
      return { verdict: "red", reasons };
    }

    if (record.top10_holder_pct > 50) {
      reasons.push("A small number of wallets hold most of the supply.");
    }

    if (typeof record.liquidity_lock_days === "number" && record.liquidity_lock_days < 30) {
      reasons.push("Liquidity is locked, but only for a short period.");
    }
  } else {
    // Security data unavailable — we can never confirm this is safe.
    reasons.push("Contract security couldn't be verified (honeypot, mint, and ownership checks unavailable) — treat with caution regardless of the signals below.");
  }

  // --- Liquidity/age checks: run whenever we have the data, regardless of security-scan availability ---
  if (hasLiquidityData) {
    if (record.liquidity_usd < 10000) {
      reasons.push("Liquidity is thin, so the price can swing sharply on a single trade.");
    }
  }

  if (typeof record.contract_age_hours === "number" && record.contract_age_hours < 168) {
    reasons.push("This token is new, with limited trading history.");
  }

  // --- Verdict assignment ---
  if (!hasSecurityScan) {
    // Capped at yellow — never green without a verified security scan.
    return { verdict: "yellow", reasons };
  }

  if (reasons.length > 0) {
    return { verdict: "yellow", reasons };
  }

  return {
    verdict: "green",
    reasons: ["Liquidity is locked, ownership looks clean, and supply is reasonably distributed."],
  };
}

module.exports = { scoreToken };
