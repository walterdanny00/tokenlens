/**
 * TokenLens risk scoring engine.
 * Pure function: takes a normalized token record, returns a verdict + reasons.
 * No network calls, no side effects — fully testable in isolation.
 */

function scoreToken(record) {
  const reasons = [];

  // --- Missing / insufficient data (checked first, never falls through to Green) ---
  if (record.security_scan_available === false) {
    return {
      verdict: "unknown",
      reasons: ["Security scan data isn't available yet for this token."],
    };
  }

  if (record.contract_age_hours < 1 && record.holder_data_available === false) {
    return {
      verdict: "unknown",
      reasons: ["This token is too new — not enough data to assess it yet."],
    };
  }

  // --- Hard RED checks: any one triggers immediate Red, no averaging ---
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

  // --- YELLOW checks: collect all that apply, none individually fatal ---
  if (record.top10_holder_pct > 50) {
    reasons.push("A small number of wallets hold most of the supply.");
  }

  if (record.liquidity_lock_days < 30) {
    reasons.push("Liquidity is locked, but only for a short period.");
  }

  if (record.liquidity_usd < 10000) {
    reasons.push("Liquidity is thin, so the price can swing sharply on a single trade.");
  }

  if (record.contract_age_hours < 168) {
    reasons.push("This token is new, with limited trading history.");
  }

  if (reasons.length > 0) {
    return { verdict: "yellow", reasons };
  }

  // --- GREEN: none of the above triggered ---
  return {
    verdict: "green",
    reasons: ["Liquidity is locked, ownership looks clean, and supply is reasonably distributed."],
  };
}

module.exports = { scoreToken };
