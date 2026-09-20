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
 * unknown, which is never treated as safe). GREEN is only returned when
 * every security field is answered and clean, and its explanation lists
 * only what was actually confirmed.
 *
 * The one exception is the ESTABLISHED_OVERRIDE below: a token that clears a
 * high bar (age, liquidity, holders, clean authorities) may have an
 * unverifiable liquidity lock treated as a caveat instead of a YELLOW reason.
 */

const BRAND_NEW_HOURS = 48;          // still-owned contract this young => RED
const ESTABLISHED_HOURS = 24 * 30;   // unlocked liquidity is RED below this age
const NEW_HOURS = 168;               // "new token" caution

// "Established token" override. Only ever excuses ONE gap — a liquidity lock
// that can't be verified because most liquidity sits in concentrated pools —
// and only when every bar below is cleared. It never touches a known-unlocked
// result, and every other RED/YELLOW check still runs at full strength.
const ESTABLISHED_OVERRIDE = {
  minAgeHours: 24 * 90,
  minLiquidityUsd: 250000,
  minHolders: 10000,
  maxTop10Pct: 50,
  minConcentratedPct: 80,
};

const isUnknown = (v) => v === null || v === undefined;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function lockUnverifiableButEstablished(record, age) {
  const t = ESTABLISHED_OVERRIDE;
  return (
    isUnknown(record.liquidity_locked) &&
    record.is_honeypot !== true &&
    record.mint_function_active === false &&
    record.ownership_renounced === true &&
    age !== null && age >= t.minAgeHours &&
    isNum(record.liquidity_usd) && record.liquidity_usd >= t.minLiquidityUsd &&
    isNum(record.holder_count) && record.holder_count >= t.minHolders &&
    isNum(record.top10_holder_pct) && record.top10_holder_pct <= t.maxTop10Pct &&
    isNum(record.concentrated_liquidity_pct) && record.concentrated_liquidity_pct >= t.minConcentratedPct
  );
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
