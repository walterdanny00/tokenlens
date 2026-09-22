// Turns the backend's `data` object into plain-language rows for the UI.
// null always means "unknown", never "no" and never "safe".

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumSignificantDigits: 3,
});
const usdSmall = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumSignificantDigits: 3,
});
const usdPrice = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const counts = new Intl.NumberFormat("en-US");

export function formatUsd(n) {
  return isNum(n) ? usdCompact.format(n) : null;
}

export function formatPrice(n) {
  if (!isNum(n)) return null;
  return n >= 1 ? usdPrice.format(n) : usdSmall.format(n);
}

export function formatCount(n) {
  return isNum(n) ? counts.format(n) : null;
}

export function formatPct(n, digits = 1) {
  if (!isNum(n)) return null;
  if (n > 0 && n < 0.1) return "under 0.1%";
  return `${n.toFixed(digits)}%`;
}

function plural(n, unit) {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

export function formatAge(hours) {
  if (!isNum(hours) || hours < 0) return null;
  if (hours < 1) return "under an hour";
  if (hours < 48) return plural(Math.round(hours), "hour");
  const days = hours / 24;
  if (days < 60) return plural(Math.round(days), "day");
  const months = days / 30.44;
  if (months < 24) return plural(Math.round(months), "month");
  return `${(months / 12).toFixed(1)} years`;
}

export function shortAddress(address) {
  if (!address) return "";
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

export function joinList(items) {
  const list = (items || []).filter(Boolean);
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

const SOURCE_NAMES = { goplus: "GoPlus", simulation: "A simulation (not real)" };

// tone: "good" | "bad" | "unknown" | "info"
const row = (key, label, value, tone) => ({ key, label, value, tone });
const plainRow = (key, label, value) =>
  value === null ? row(key, label, "Unknown", "unknown") : row(key, label, value, "info");

export function buildRows(data = {}) {
  const market = [
    plainRow("price", "Price", formatPrice(data.priceUsd)),
    plainRow("liquidity", "Liquidity", formatUsd(data.liquidityUsd)),
    plainRow("marketCap", "Market cap", formatUsd(data.marketCapUsd)),
    plainRow("volume", "Trading volume, 24 hours", formatUsd(data.volume24hUsd)),
    plainRow("age", "Token age", formatAge(data.contractAgeHours)),
    plainRow("holders", "Holders", formatCount(data.holderCount)),
    plainRow("top10", "Held by the top 10 wallets", formatPct(data.top10HolderPct, 1)),
  ];

  const lockedPct = formatPct(data.liquidityLockedPct, 0);
  const concentrated = formatPct(data.concentratedLiquidityPct, 0);

  const safety = [
    data.isHoneypot === true
      ? row("sell", "Can you sell it?", "No, buyers get stuck (honeypot)", "bad")
      : data.isHoneypot === false
        ? row("sell", "Can you sell it?", "Yes, no sell block found", "good")
        : row("sell", "Can you sell it?", "Not checked", "unknown"),

    data.mintFunctionActive === true
      ? row("mint", "Can more coins be created?", "Yes", "bad")
      : data.mintFunctionActive === false
        ? row("mint", "Can more coins be created?", "No", "good")
        : row("mint", "Can more coins be created?", "Unknown", "unknown"),

    data.ownershipRenounced === true
      ? row("owner", "Do the creators still control it?", "No, control was given up", "good")
      : data.ownershipRenounced === false
        ? row("owner", "Do the creators still control it?", "Yes", "bad")
        : row("owner", "Do the creators still control it?", "Unknown", "unknown"),

    data.liquidityLocked === true
      ? row("lock", "Is the liquidity locked?", lockedPct ? `Yes, ${lockedPct} of it` : "Yes", "good")
      : data.liquidityLocked === false
        ? row("lock", "Is the liquidity locked?", lockedPct && data.liquidityLockedPct > 0 ? `No, only ${lockedPct} is` : "No", "bad")
        : row("lock", "Is the liquidity locked?", "Can't be verified", "unknown"),
  ];

  if (concentrated) {
    safety.push(row("concentrated", "Liquidity in concentrated pools", concentrated, "info"));
  }

  safety.push(
    data.securityScanAvailable
      ? row("scan", "Security scan by", SOURCE_NAMES[data.securitySource] || "A security provider", "info")
      : row("scan", "Security scan", "Not available", "unknown")
  );

  return { market, safety };
}
