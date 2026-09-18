const { scoreToken } = require("./scoring");
const { generateVerdictCopy } = require("./copyGenerator");

const mockRecords = [
  {
    label: "Honeypot scam token",
    record: {
      security_scan_available: true,
      contract_age_hours: 5,
      holder_data_available: true,
      is_honeypot: true,
      mint_function_active: false,
      liquidity_locked: true,
      ownership_renounced: true,
      top10_holder_pct: 20,
      liquidity_lock_days: 90,
      liquidity_usd: 50000,
    },
  },
  {
    label: "Unlocked liquidity, new deploy",
    record: {
      security_scan_available: true,
      contract_age_hours: 3,
      holder_data_available: true,
      is_honeypot: false,
      mint_function_active: false,
      liquidity_locked: false,
      ownership_renounced: false,
      top10_holder_pct: 80,
      liquidity_lock_days: 0,
      liquidity_usd: 2000,
    },
  },
  {
    label: "Shaky but not a hard scam (concentrated + thin liquidity)",
    record: {
      security_scan_available: true,
      contract_age_hours: 200,
      holder_data_available: true,
      is_honeypot: false,
      mint_function_active: false,
      liquidity_locked: true,
      ownership_renounced: true,
      top10_holder_pct: 65,
      liquidity_lock_days: 90,
      liquidity_usd: 8000,
    },
  },
  {
    label: "Looks clean",
    record: {
      security_scan_available: true,
      contract_age_hours: 2000,
      holder_data_available: true,
      is_honeypot: false,
      mint_function_active: false,
      liquidity_locked: true,
      ownership_renounced: true,
      top10_holder_pct: 25,
      liquidity_lock_days: 180,
      liquidity_usd: 500000,
    },
  },
  {
    label: "Too new to assess",
    record: {
      security_scan_available: true,
      contract_age_hours: 0.5,
      holder_data_available: false,
      is_honeypot: false,
      mint_function_active: false,
      liquidity_locked: true,
      ownership_renounced: false,
      top10_holder_pct: 0,
      liquidity_lock_days: 0,
      liquidity_usd: 0,
    },
  },
  {
    label: "No security scan available",
    record: {
      security_scan_available: false,
      contract_age_hours: 10,
      holder_data_available: false,
    },
  },
];

for (const { label, record } of mockRecords) {
  const result = scoreToken(record);
  const copy = generateVerdictCopy(result);
  console.log(`\n--- ${label} ---`);
  console.log(`Verdict: ${result.verdict}`);
  console.log(copy);
}
