/**
 * TokenLens backend server.
 * Thin Express wrapper — all real logic lives in routes.js so it's
 * testable without a live server. This file just wires HTTP to it,
 * plus the safeguards a public API needs (rate limit, cache, lookup budget).
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { makeWatchlist, handleCheck, handleWatch, handleWatchlist } = require("./routes");
const { TtlCache } = require("./cache");
const { createRateLimiter, rateLimitMiddleware } = require("./rateLimit");

const app = express();

// Behind Render's proxy, req.ip is the proxy's address unless we trust it.
// TRUST_PROXY is how many proxy hops to trust (1 on Render; 0 when running
// locally with no proxy). Check GET /ip after deploying — see README.
const proxyHops = Number(process.env.TRUST_PROXY ?? 1);
app.set("trust proxy", Number.isInteger(proxyHops) && proxyHops > 0 ? proxyHops : false);

// Public read API. Set CORS_ORIGIN (e.g. the Vercel URL) to lock it down.
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

const CMC_API_KEY = process.env.CMC_API_KEY;
if (!CMC_API_KEY) {
  console.error("Missing CMC_API_KEY in environment. Check your .env file.");
  process.exit(1);
}

function envNumber(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const watchlist = makeWatchlist();

// Safeguards, tunable from the environment without touching code:
//   RATE_LIMIT_PER_MIN      checks allowed per visitor per minute
//   MAX_LOOKUPS_PER_10_MIN  lookups that reach CoinMarketCap/GoPlus, for everyone combined
//   CACHE_TTL_SECONDS       how long a good answer is reused
const cache = new TtlCache({ maxEntries: 500 });
const budget = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: envNumber("MAX_LOOKUPS_PER_10_MIN", 100),
});
const perVisitor = createRateLimiter({
  windowMs: 60 * 1000,
  max: envNumber("RATE_LIMIT_PER_MIN", 30),
});
const protection = { cache, budget, ttlMs: envNumber("CACHE_TTL_SECONDS", 60) * 1000 };

// EVM (0x + 40 hex) and Solana (base58, 32-44 chars) addresses both fit this.
const ADDRESS_RE = /^[A-Za-z0-9]{20,70}$/;

// Health check and keep-alive target: cheap, never touches the upstream APIs.
app.get(["/", "/health"], (req, res) => {
  res.json({ ok: true, service: "tokenlens" });
});

// Shows the address the server sees for you. Used once to confirm TRUST_PROXY.
app.get("/ip", (req, res) => {
  res.json({ ip: req.ip });
});

app.use(["/check", "/watch", "/watchlist"], rateLimitMiddleware(perVisitor));

app.get("/check/:tokenAddress", async (req, res) => {
  const { tokenAddress } = req.params;
  if (!ADDRESS_RE.test(tokenAddress)) {
    return res.status(400).json({ error: "That doesn't look like a token contract address." });
  }
  const { networkId, symbol } = req.query;
  const { status, body, cached, retryAfterSec } = await handleCheck(
    CMC_API_KEY,
    { tokenAddress, networkId, symbol },
    protection
  );
  if (cached !== undefined) res.set("X-Cache", cached ? "HIT" : "MISS");
  if (retryAfterSec) res.set("Retry-After", String(retryAfterSec));
  res.status(status).json(body);
});

app.post("/watch", async (req, res) => {
  const { status, body, retryAfterSec } = await handleWatch(CMC_API_KEY, watchlist, req.body || {}, { budget });
  if (retryAfterSec) res.set("Retry-After", String(retryAfterSec));
  res.status(status).json(body);
});

app.get("/watchlist", (req, res) => {
  const { status, body } = handleWatchlist(watchlist);
  res.status(status).json(body);
});

// Last-resort handler so an unexpected error is a clean JSON 500, not a crash.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

const PORT = process.env.PORT || 3000;
// Express 5 passes listen errors (e.g. port already in use) to this callback.
app.listen(PORT, (err) => {
  if (err) {
    console.error(`Could not start on port ${PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`TokenLens backend running on port ${PORT}`);
});
