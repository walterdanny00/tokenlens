/**
 * Tests routes.js logic directly — no Express, no network, no npm installs
 * required. Mocks ingestion.js's getTokenRecord to simulate different
 * token states and verifies the route logic responds correctly.
 */

const ingestionPath = require.resolve("./ingestion");
const originalIngestion = require(ingestionPath);

require.cache[ingestionPath].exports = {
  ...originalIngestion,
  getTokenRecord: async (apiKey, identifier) => {
    if (identifier.tokenAddress.includes("clean")) {
      return {
        source: "dex",
        security_scan_available: true,
        holder_data_available: true,
        contract_age_hours: 1000,
        is_honeypot: false,
        mint_function_active: false,
        liquidity_locked: true,
        liquidity_lock_days: 90,
        liquidity_usd: 100000,
        ownership_renounced: true,
        top10_holder_pct: 15,
      };
    }
    return {
      source: "fallback",
      security_scan_available: false,
      holder_data_available: false,
      contract_age_hours: null,
      degraded_reason: "mocked degraded response",
    };
  },
};

const { makeWatchlist, handleCheck, handleWatch, handleWatchlist } = require("./routes");

async function run() {
  const FAKE_KEY = "test-key-not-real";
  const watchlist = makeWatchlist();

  console.log("--- handleCheck: clean token ---");
  const r1 = await handleCheck(FAKE_KEY, { tokenAddress: "0xcleanAddress", networkId: "1" });
  console.log(r1.status, r1.body);

  console.log("\n--- handleCheck: risky/unknown token ---");
  const r2 = await handleCheck(FAKE_KEY, { tokenAddress: "0xriskyAddress", networkId: "1" });
  console.log(r2.status, r2.body);

  console.log("\n--- handleCheck: missing networkId (should 400) ---");
  const r3 = await handleCheck(FAKE_KEY, { tokenAddress: "0xnoNetwork" });
  console.log(r3.status, r3.body);

  console.log("\n--- handleWatch: add a clean token ---");
  const r4 = await handleWatch(FAKE_KEY, watchlist, { networkId: 1, tokenAddress: "0xcleanWatched", symbol: "CLEAN" });
  console.log(r4.status, r4.body);

  console.log("\n--- handleWatch: missing tokenAddress (should 400) ---");
  const r5 = await handleWatch(FAKE_KEY, watchlist, { networkId: 1 });
  console.log(r5.status, r5.body);

  console.log("\n--- handleWatchlist: should show 1 entry ---");
  const r6 = handleWatchlist(watchlist);
  console.log(r6.status, r6.body);
}

run();
