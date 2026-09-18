// Example: how to load the CMC API key safely.
// Run: node example_usage.js  (after creating a real .env from .env.example)

require("dotenv").config();
const { getTokenRecord } = require("./ingestion");
const { scoreToken } = require("./scoring");
const { generateVerdictCopy } = require("./copyGenerator");

const CMC_API_KEY = process.env.CMC_API_KEY;

if (!CMC_API_KEY) {
  console.error("Missing CMC_API_KEY. Copy .env.example to .env and fill in your key.");
  process.exit(1);
}

async function main() {
  // Example identifier — swap for a real token address/network once testing live.
  const identifier = { networkId: 1, tokenAddress: "0xExampleAddress", symbol: "EXAMPLE" };

  const record = await getTokenRecord(CMC_API_KEY, identifier);
  const result = scoreToken(record);
  console.log(generateVerdictCopy(result));
}

main();
