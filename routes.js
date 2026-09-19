/**
 * TokenLens route logic, extracted from server.js so it can be tested
 * without needing a live Express server or network access.
 * server.js just wires these into actual routes.
 */

const { getTokenRecord } = require("./ingestion");
const { scoreToken } = require("./scoring");
const { generateVerdictCopy } = require("./copyGenerator");

function makeWatchlist() {
  return new Map(); // key: `${networkId}:${tokenAddress}` -> entry
}

async function handleCheck(apiKey, { tokenAddress, networkId, symbol }) {
  if (!networkId) {
    return { status: 400, body: { error: "networkId query parameter is required." } };
  }

  const identifier = { networkId: Number(networkId), tokenAddress, symbol };
  const record = await getTokenRecord(apiKey, identifier);
  const result = scoreToken(record);
  const copy = generateVerdictCopy(result);

  return {
    status: 200,
    body: {
      tokenAddress,
      networkId: Number(networkId),
      verdict: result.verdict,
      reasons: result.reasons,
      message: copy,
      dataSource: record.source,
      degradedReason: record.degraded_reason || null,
    },
  };
}

async function handleWatch(apiKey, watchlist, { networkId, tokenAddress, symbol }) {
  if (!networkId || !tokenAddress) {
    return { status: 400, body: { error: "networkId and tokenAddress are required." } };
  }

  const identifier = { networkId: Number(networkId), tokenAddress, symbol };
  const record = await getTokenRecord(apiKey, identifier);
  const result = scoreToken(record);

  const key = `${networkId}:${tokenAddress}`;
  watchlist.set(key, {
    identifier,
    lastVerdict: result.verdict,
    lastReasons: result.reasons,
    addedAt: new Date().toISOString(),
  });

  return {
    status: 200,
    body: {
      watching: true,
      tokenAddress,
      networkId: Number(networkId),
      initialVerdict: result.verdict,
      message: generateVerdictCopy(result),
    },
  };
}

function handleWatchlist(watchlist) {
  const entries = Array.from(watchlist.entries()).map(([key, value]) => ({
    key,
    ...value,
  }));
  return { status: 200, body: { count: entries.length, entries } };
}

module.exports = { makeWatchlist, handleCheck, handleWatch, handleWatchlist };
