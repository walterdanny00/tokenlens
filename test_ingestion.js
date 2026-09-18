const { getTokenRecord } = require("./ingestion");
const { scoreToken } = require("./scoring");
const { generateVerdictCopy } = require("./copyGenerator");

function mockJsonResponse(body) {
  return { json: async () => body };
}

// --- Scenario 1: DEX endpoint works normally ---
async function fetchDexSuccess(url) {
  return mockJsonResponse({
    status: { error_code: "0" },
    data: {
      contract_age_hours: 500,
      is_honeypot: false,
      mint_function_active: false,
      liquidity_locked: true,
      liquidity_lock_days: 90,
      liquidity_usd: 75000,
      ownership_renounced: true,
      top10_holder_pct: 22,
    },
  });
}

// --- Scenario 2: DEX endpoint returns 1006 (plan doesn't support), fallback succeeds ---
async function fetchDex1006ThenFallback(url) {
  if (url.includes("/v1/dex/")) {
    return mockJsonResponse({
      status: { error_code: "1006", error_message: "Your API Key subscription plan doesn't support this endpoint." },
    });
  }
  return mockJsonResponse({
    status: { error_code: "0" },
    data: {
      TEST: {
        date_added: new Date(Date.now() - 1000 * 60 * 60 * 10).toISOString(), // 10h ago
        quote: { USD: { market_cap: 1200000, volume_24h: 300000, price: 0.0042 } },
      },
    },
  });
}

// --- Scenario 3: both DEX and fallback fail ---
async function fetchTotalFailure(url) {
  return mockJsonResponse({
    status: { error_code: "500", error_message: "Internal server error" },
  });
}

async function run() {
  console.log("--- Scenario 1: DEX working normally ---");
  const r1 = await getTokenRecord("fake-key", { networkId: 1, tokenAddress: "0xabc" }, fetchDexSuccess);
  console.log("source:", r1.source);
  const s1 = scoreToken(r1);
  console.log(generateVerdictCopy(s1));

  console.log("\n--- Scenario 2: DEX 1006, degrades to fallback ---");
  const r2 = await getTokenRecord("fake-key", { networkId: 1, tokenAddress: "0xdef", symbol: "TEST" }, fetchDex1006ThenFallback);
  console.log("source:", r2.source, "| degraded_reason:", r2.degraded_reason);
  const s2 = scoreToken(r2);
  console.log(generateVerdictCopy(s2));

  console.log("\n--- Scenario 3: total failure ---");
  const r3 = await getTokenRecord("fake-key", { networkId: 1, tokenAddress: "0xbad", symbol: "BAD" }, fetchTotalFailure);
  console.log("source:", r3.source, "| error:", r3.error);
  const s3 = scoreToken(r3);
  console.log(generateVerdictCopy(s3));
}

run();
