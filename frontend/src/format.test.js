import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatUsd, formatPrice, formatAge, formatPct, formatCount, shortAddress, joinList, buildRows,
} from "./format.js";

test("formatUsd is compact and honest about null", () => {
  assert.equal(formatUsd(32567734.37), "$32.6M");
  assert.equal(formatUsd(929143), "$929K");
  assert.equal(formatUsd(1.69e9), "$1.69B");
  assert.equal(formatUsd(null), null);
  assert.equal(formatUsd(undefined), null);
});

test("formatPrice keeps tiny prices readable", () => {
  assert.equal(formatPrice(1234.5), "$1,234.50");
  assert.equal(formatPrice(0.000004), "$0.000004");
  assert.equal(formatPrice(0.0000041234), "$0.00000412");
  assert.equal(formatPrice("nope"), null);
});

test("formatAge picks a sensible unit", () => {
  assert.equal(formatAge(0.2), "under an hour");
  assert.equal(formatAge(1), "1 hour");
  assert.equal(formatAge(20), "20 hours");
  assert.equal(formatAge(24 * 6), "6 days");
  assert.equal(formatAge(24 * 90), "3 months");
  assert.equal(formatAge(24 * 365 * 3.4), "3.4 years");
  assert.equal(formatAge(null), null);
  assert.equal(formatAge(-5), null);
});

test("formatPct, formatCount, shortAddress, joinList", () => {
  assert.equal(formatPct(38.81), "38.8%");
  assert.equal(formatPct(94.45, 0), "94%");
  assert.equal(formatPct(0.009), "under 0.1%");
  assert.equal(formatPct(0), "0.0%");
  assert.equal(formatPct(null), null);
  assert.equal(formatCount(1019104), "1,019,104");
  assert.equal(shortAddress("0x6982508145454ce325ddbe47a25d4ec3d2311933"), "0x6982…1933");
  assert.equal(shortAddress("short"), "short");
  assert.equal(joinList(["A"]), "A");
  assert.equal(joinList(["A", "B"]), "A and B");
  assert.equal(joinList(["A", "B", "C"]), "A, B and C");
  assert.equal(joinList([]), "");
});

const pepe = {
  priceUsd: 0.000004, liquidityUsd: 32567734, marketCapUsd: 1.69e9, volume24hUsd: 5e7,
  contractAgeHours: 24 * 365 * 3.4, holderCount: 593337, top10HolderPct: null,
  isHoneypot: false, mintFunctionActive: false, ownershipRenounced: true,
  liquidityLocked: false, liquidityLockedPct: 0.009, concentratedLiquidityPct: 0.47,
  securityScanAvailable: true, securitySource: "goplus",
};

const bonk = {
  ...pepe, isHoneypot: null, liquidityLocked: null, liquidityLockedPct: null,
  concentratedLiquidityPct: 94.45, top10HolderPct: 38.8,
};

const byKey = (rows) => Object.fromEntries(rows.map((r) => [r.key, r]));

test("PEPE-like data: unlocked liquidity is a problem, and says how little is locked", () => {
  const { safety, market } = buildRows(pepe);
  const s = byKey(safety);
  assert.deepEqual([s.sell.tone, s.mint.tone, s.owner.tone, s.lock.tone], ["good", "good", "good", "bad"]);
  assert.equal(s.lock.value, "No, only under 0.1% is");
  assert.equal(s.scan.value, "GoPlus");
  assert.equal(byKey(market).top10.value, "Unknown");
  assert.equal(byKey(market).top10.tone, "unknown");
});

test("BONK-like data: unknown is shown as unknown, never as good", () => {
  const { safety, market } = buildRows(bonk);
  const s = byKey(safety);
  assert.equal(s.sell.value, "Not checked");
  assert.equal(s.sell.tone, "unknown");
  assert.equal(s.lock.value, "Can't be verified");
  assert.equal(s.lock.tone, "unknown");
  assert.equal(s.concentrated.value, "94%");
  assert.equal(byKey(market).top10.value, "38.8%");
});

test("dangerous values are flagged", () => {
  const s = byKey(buildRows({ ...pepe, isHoneypot: true, mintFunctionActive: true, ownershipRenounced: false }).safety);
  assert.deepEqual([s.sell.tone, s.mint.tone, s.owner.tone], ["bad", "bad", "bad"]);
});

test("empty data never claims anything is safe", () => {
  const { safety, market } = buildRows({});
  for (const r of [...safety, ...market]) assert.notEqual(r.tone, "good", r.key);
  assert.equal(byKey(safety).scan.value, "Not available");
  assert.equal(buildRows().market.length, 7);
});

test("zero locked liquidity reads as a plain No", () => {
  const s = byKey(buildRows({ ...pepe, liquidityLocked: false, liquidityLockedPct: 0 }).safety);
  assert.equal(s.lock.value, "No");
  assert.equal(s.lock.tone, "bad");
});
