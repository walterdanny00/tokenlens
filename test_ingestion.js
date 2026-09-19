const { getTokenRecord } = require("./ingestion");
const { scoreToken } = require("./scoring");
const { generateVerdictCopy } = require("./copyGenerator");

function mockJsonResponse(body) {
  return { json: async () => body };
}

// --- Scenario 1: CMC search succeeds AND GoPlus succeeds (full data) ---
async function fetchFullSuccess(url) {
  if (url.includes("/v1/dex/search")) {
    return mockJsonResponse({
      status: { error_code: "0" },
      data: {
        tks: [
          {
            addr: "0xClean",
            pltId: 1, // Ethereum
            s: "CLEAN",
            n: "Clean Token",
            liq: 500000,
            mc: 3000000,
            v24h: 80000,
            pu: 1.2,
            pc24h: 0.01,
            fpt: String(Date.now() - 1000 * 60 * 60 * 2000),
          },
        ],
      },
    });
  }
  if (url.includes("gopluslabs.io")) {
    return mockJsonResponse({
      code: 1,
      result: {
        "0xclean": {
          is_honeypot: "0",
          is_mintable: "0",
          owner_address: "0x0000000000000000000000000000000000dead",
          holders: [{ percent: "0.05" }, { percent: "0.03" }],
          lp_holders: [{ is_locked: "1" }],
        },
      },
    });
  }
}

// --- Scenario 2: CMC search succeeds, GoPlus fails (should still be usable, capped at Yellow) ---
async function fetchGoPlusFails(url) {
  if (url.includes("/v1/dex/search")) {
    return mockJsonResponse({
      status: { error_code: "0" },
      data: {
        tks: [
          {
            addr: "0xNoSecurity",
            pltId: 1,
            s: "NOSEC",
            n: "No Security Data Token",
            liq: 200000,
            mc: 1000000,
            v24h: 40000,
            pu: 0.5,
            pc24h: -0.02,
            fpt: String(Date.now() - 1000 * 60 * 60 * 1000),
          },
        ],
      },
    });
  }
  if (url.includes("gopluslabs.io")) {
    return mockJsonResponse({ code: 0, message: "Chain not supported" });
  }
}

// --- Scenario 3: CMC search itself fails, degrades to cryptocurrency fallback ---
async function fetchSearchFailsEntirely(url) {
  if (url.includes("/v1/dex/search")) {
    return mockJsonResponse({ status: { error_code: "400", error_message: "BAD_REQUEST" } });
  }
  return mockJsonResponse({
    status: { error_code: "0" },
    data: {
      TEST: {
        date_added: new Date(Date.now() - 1000 * 60 * 60 * 10).toISOString(),
        quote: { USD: { market_cap: 1200000, volume_24h: 300000, price: 0.0042 } },
      },
    },
  });
}

async function run() {
  console.log("--- Scenario 1: full data (CMC + GoPlus both succeed) ---");
  const r1 = await getTokenRecord("fake-key", { tokenAddress: "0xClean" }, fetchFullSuccess);
  console.log("source:", r1.source, "| security_source:", r1.security_source, "| liq:", r1.liquidity_usd);
  console.log(generateVerdictCopy(scoreToken(r1)));

  console.log("\n--- Scenario 2: CMC succeeds, GoPlus fails (capped at Yellow) ---");
  const r2 = await getTokenRecord("fake-key", { tokenAddress: "0xNoSecurity" }, fetchGoPlusFails);
  console.log("source:", r2.source, "| security_fetch_error:", r2.security_fetch_error);
  console.log(generateVerdictCopy(scoreToken(r2)));

  console.log("\n--- Scenario 3: CMC search fails entirely, degrades to cryptocurrency fallback ---");
  const r3 = await getTokenRecord("fake-key", { tokenAddress: "0xGhi", symbol: "TEST" }, fetchSearchFailsEntirely);
  console.log("source:", r3.source, "| degraded_reason:", r3.degraded_reason);
  console.log(generateVerdictCopy(scoreToken(r3)));
}

run();
