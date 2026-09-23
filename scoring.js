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
 *
 * Security fields are tri-state: true / false / null (null or missing =
 * unknown, which is never treated as safe — absence of evidence is never
 * read as evidence of safety). GREEN is only returned when every security
 * field is answered and clean, and its explanation lists only what was
 * actually confirmed.
 *
 * Two different kinds of "unknown" are treated differently:
 *   - A per-token unknown (the check exists and was attempted for this
 *     specific token, but came back empty) is always a YELLOW reason. It is
 *     never excused, because it says nothing about tokens in general — only
 *     that this particular check failed for this particular token.
 *   - A structural coverage gap (the data source doesn't run that check on
 *     this chain AT ALL — e.g. GoPlus has no honeypot simulator for Solana,
 *     so is_honeypot is null for every Solana token) says nothing about the
 *     token either. The ESTABLISHED_OVERRIDE below may excuse this kind of
 *     gap into a caveat instead of a YELLOW reason, but ONLY when the token
 *     clears a high bar of corroborating evidence elsewhere (age, liquidity,
 *     holders, distribution, clean mint and ownership) — a coverage gap is
 *     never enough justification for GREEN on its own. This currently
 *     applies to two structural gaps: liquidity-lock verification on
 *     concentrated-pool-heavy tokens, and honeypot detection on Solana. Both
 *     can be excused independently, each with its own caveat, and each is
 *     re-checked against the same bar every time — clearing it once for one
 *     gap doesn't automatically excuse the other.
 */

const BRAND_NEW_HOURS = 48;          // still-owned contract this young => RED
const ESTABLISHED_HOURS = 24 * 30;   // unlocked liquidity is RED below this age
const NEW_HOURS = 168;               // "new token" caution

// "Established token" override. Excuses a STRUCTURAL coverage gap (never a
// known-bad result, and never a per-token unknown) into a caveat, only when
// every bar below is cleared. Every other RED/YELLOW check still runs at
// full strength regardless.
const ESTABLISHED_OVERRIDE = {
  minAgeHours: 24 * 90,
  minLiquidityUsd: 250000,
  minHolders: 10000,
  maxTop10Pct: 50,
  minConcentratedPct: 80,
};

const isUnknown = (v) => v === null || v === undefined;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// The shared bar: real age and liquidity, a broad holder base, and mint and
// ownership both confirmed (not just unknown) clean. Doesn't look at the
// specific gap being excused — callers check that separately.
function isWellEstablished(record, age) {
  const t = ESTABLISHED_OVERRIDE;
  return (
    record.mint_function_active === false &&
    record.ownership_renounced === true &&
    age !== null && age >= t.minAgeHours &&
    isNum(record.liquidity_usd) && record.liquidity_usd >= t.minLiquidityUsd &&
    isNum(record.holder_count) && record.holder_count >= t.minHolders &&
    isNum(record.top10_holder_pct) && record.top10_holder_pct <= t.maxTop10Pct
  );
}

function lockUnverifiableButEstablished(record, age) {
  const t = ESTABLISHED_OVERRIDE;
  return (
    isUnknown(record.liquidity_locked) &&
    record.is_honeypot !== true &&
    isWellEstablished(record, age) &&
    isNum(record.concentrated_liquidity_pct) && record.concentrated_liquidity_pct >= t.minConcentratedPct
  );
}

// Sellability (is_honeypot) is unknown for a structural reason (the chain's
// data source has no honeypot check at all — see honeypot_check_supported in
// goplus.js), not because this token's check failed. A genuine per-token
// unknown (honeypot_check_supported === true) is never excused this way.
function honeypotUnverifiableButEstablished(record, age) {
  return record.honeypot_check_supported === false && isWellEstablished(record, age);
}

function scoreToken(record) {
  const reasons = [];
  const caveats = [];
  const hasSecurityScan = record.security_scan_available === true;
  const hasLiquidityData = typeof record.liquidity_usd === "number";
  // null = age unknown. Never compare null with < or > (null < 48 is true in JS).
  const age = typeof record.contract_age_hours === "number" ? record.contract_age_hours : null;

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
    } else if (isUnknown(record.is_honeypot)) {
      if (honeypotUnverifiableButEstablished(record, age)) {
        // A coverage gap, not evidence either way — but never hidden.
        caveats.push(
          "We couldn't verify whether this token can be sold: honeypot detection isn't available on this network. This doesn't mean it's a honeypot — this token is well established (90+ days, 10,000+ holders, real liquidity, clean mint and ownership), so we treat the missing check as a known coverage gap rather than a red flag."
        );
      } else {
        reasons.push(
          "We couldn't confirm whether this token can be sold. This doesn't mean it's a honeypot — we just don't have enough evidence to say either way."
        );
      }
    }

    if (record.mint_function_active === true) {
      reasons.push("The creators can still generate unlimited new coins, which can crash the price.");
      return { verdict: "red", reasons };
    }

    if (record.liquidity_locked === false) {
      // Unlocked liquidity is the classic rug-pull setup, so it's RED for new
      // (or unknown-age) tokens. For tokens that have traded for a while it's a
      // caution, not an alarm.
      if (age === null || age < ESTABLISHED_HOURS) {
        reasons.push("Liquidity isn't locked — funds could be pulled out at any time.");
        return { verdict: "red", reasons };
      }
      reasons.push("Liquidity isn't locked, so it could be pulled out. This token has been trading for a while, which lowers that risk but doesn't remove it.");
    } else if (isUnknown(record.liquidity_locked)) {
      if (lockUnverifiableButEstablished(record, age)) {
        // Known limit, not a red flag — but never hidden from the user.
        caveats.push(
          `Liquidity lock can't be verified: about ${Math.round(record.concentrated_liquidity_pct)}% of it sits in concentrated pools, where locks work differently. This token is well established (90+ days, 10,000+ holders, real liquidity), so we treat that as a known limit rather than a red flag.`
        );
      } else {
        reasons.push("We couldn't confirm whether liquidity is locked.");
      }
    }

    if (record.ownership_renounced === false) {
      if (age !== null && age < BRAND_NEW_HOURS) {
        reasons.push("This is a brand-new token and the creators still fully control the contract.");
        return { verdict: "red", reasons };
      }
      reasons.push("The creators still control the contract and could change how it works.");
    } else if (isUnknown(record.ownership_renounced)) {
      reasons.push("We couldn't confirm who controls the contract.");
    }

    if (isUnknown(record.mint_function_active)) {
      reasons.push("We couldn't confirm whether new coins can still be created.");
    }

    if (typeof record.top10_holder_pct === "number" && record.top10_holder_pct > 50) {
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
  if (hasLiquidityData && record.liquidity_usd < 10000) {
    reasons.push("Liquidity is thin, so the price can swing sharply on a single trade.");
  }

  if (age !== null && age < NEW_HOURS) {
    reasons.push("This token is new, with limited trading history.");
  }

  // --- Verdict assignment ---
  if (!hasSecurityScan) {
    // Capped at yellow — never green without a verified security scan.
    return { verdict: "yellow", reasons };
  }

  if (reasons.length > 0) {
    return withCaveats({ verdict: "yellow", reasons }, caveats);
  }

  // GREEN: say only what was actually confirmed.
  const confirmed = [];
  if (record.is_honeypot === false) confirmed.push("it can be sold normally");
  if (record.mint_function_active === false) confirmed.push("no one can create new coins");
  if (record.liquidity_locked === true) confirmed.push("liquidity is locked");
  if (record.ownership_renounced === true) confirmed.push("the creators have given up control of the contract");
  if (typeof record.top10_holder_pct === "number") confirmed.push("supply isn't concentrated in a few wallets");

  return withCaveats(
    {
      verdict: "green",
      reasons: [
        confirmed.length > 0
          ? `Checked and clear: ${confirmed.join(", ")}.`
          : "None of the checks we could run raised a concern.",
      ],
    },
    caveats
  );
}

// `caveats` is only present when there is one, so plain results keep their shape.
function withCaveats(result, caveats) {
  return caveats.length > 0 ? { ...result, caveats } : result;
}

module.exports = { scoreToken };
