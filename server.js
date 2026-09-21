/**
 * TokenLens backend server.
 * Thin Express wrapper — all real logic lives in routes.js, bot.js and
 * watcher.js so it's testable without a live server. This file just wires HTTP
 * to it, plus the safeguards a public API needs (rate limit, cache, lookup budget).
 */

require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const { handleCheck } = require("./routes");
const { TtlCache } = require("./cache");
const { createRateLimiter, rateLimitMiddleware } = require("./rateLimit");
const { WatchStore, createMemoryAdapter, createUpstashAdapter } = require("./store");
const { createTelegramClient } = require("./telegram");
const { createBot } = require("./bot");
const { createWatcher } = require("./watcher");

const app = express();

// Requests reach the API through Cloudflare and then Render's own proxy; each
// appends an address to X-Forwarded-For (client, Cloudflare edge, Render), and
// Render does not strip values a client sends. So the real visitor is the 4th
// address counting from the app: trust exactly 3 hops (not "everything", which a
// visitor could spoof). Set TRUST_PROXY=0 when running locally with no proxy.
// Check GET /ip after deploying: it should show your own address.
const proxyHops = Number(process.env.TRUST_PROXY ?? 3);
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
const check = (params) => handleCheck(CMC_API_KEY, params, protection);

// EVM (0x + 40 hex) and Solana (base58, 32-44 chars) addresses both fit this.
const ADDRESS_RE = /^[A-Za-z0-9]{20,70}$/;

// Health check and keep-alive target: cheap, never touches the upstream APIs.
app.get(["/", "/health"], (req, res) => {
  res.json({ ok: true, service: "tokenlens" });
});

// Shows the address the server sees for you (and the raw header it was read
// from). Used to confirm TRUST_PROXY; it only ever echoes the caller's own request.
app.get("/ip", (req, res) => {
  res.json({ ip: req.ip, forwardedFor: req.headers["x-forwarded-for"] || null });
});

app.use("/check", rateLimitMiddleware(perVisitor));

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

// ---- Telegram bot: watch a token, get told when its verdict changes ----
//   TELEGRAM_BOT_TOKEN       from @BotFather (secret)
//   TELEGRAM_WEBHOOK_SECRET  a long random string (secret); Telegram sends it back on every call
//   PUBLIC_URL               this server's public address, so Telegram knows where to send updates
//   WEB_APP_URL              the web app, for "Open the full check" links
//   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   keep the watchlist across restarts (optional)
//   WATCH_INTERVAL_MINUTES, MAX_WATCHED_TOKENS, MAX_WATCHES_PER_USER   how much to watch
const WEB_APP_URL = process.env.WEB_APP_URL || "https://tokenlens-eight.vercel.app";
const WEBHOOK_PATH = "/telegram/webhook";
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET || "";

const adapter =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? createUpstashAdapter({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
    : createMemoryAdapter();

const store = new WatchStore({
  adapter,
  maxPerUser: envNumber("MAX_WATCHES_PER_USER", 5),
  maxTokens: envNumber("MAX_WATCHED_TOKENS", 20),
});

let bot = null;
let telegram = null;
let watcher = null;
const intervalMinutes = envNumber("WATCH_INTERVAL_MINUTES", 30);

if (process.env.TELEGRAM_BOT_TOKEN && webhookSecret) {
  telegram = createTelegramClient({ token: process.env.TELEGRAM_BOT_TOKEN });
  bot = createBot({
    telegram,
    store,
    check,
    webAppUrl: WEB_APP_URL,
    limiter: createRateLimiter({ windowMs: 60 * 1000, max: 12 }),
    intervalMinutes,
  });
  watcher = createWatcher({
    store,
    check,
    telegram,
    webAppUrl: WEB_APP_URL,
    intervalMs: intervalMinutes * 60 * 1000,
  });
} else if (process.env.TELEGRAM_BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is set but TELEGRAM_WEBHOOK_SECRET is not. The bot stays off until both are set.");
}

function secretMatches(given) {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(webhookSecret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Telegram calls this for every message. Only requests carrying our secret get in.
app.post(WEBHOOK_PATH, (req, res) => {
  if (!bot) return res.sendStatus(404);
  if (!secretMatches(req.get("x-telegram-bot-api-secret-token"))) return res.sendStatus(401);
  res.sendStatus(200); // answer at once; the work continues in the background
  bot.handleUpdate(req.body).catch((err) => console.error(`telegram update failed: ${err.message}`));
});

// Last-resort handler so an unexpected error is a clean JSON 500, not a crash.
app.use((err, req, res, next) => {
  if (err && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: "That request couldn't be read." }); // e.g. malformed JSON
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

async function startBot() {
  if (!bot) {
    console.log("Telegram bot: off (TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET not both set)");
    return;
  }
  const loaded = await store.init();
  console.log(
    `Watchlist: ${adapter.kind}${adapter.persistent ? "" : " (not saved between restarts)"}, ${store.size} watch(es) loaded${loaded ? "" : " [load failed]"}`
  );
  if (process.env.PUBLIC_URL) {
    try {
      await telegram.setWebhook(`${process.env.PUBLIC_URL.replace(/\/+$/, "")}${WEBHOOK_PATH}`, webhookSecret);
      console.log("Telegram bot: webhook set");
    } catch (err) {
      console.error(`Telegram bot: could not set the webhook (${err.message})`);
    }
  } else {
    console.log("Telegram bot: PUBLIC_URL not set, so the webhook was not registered");
  }
  watcher.start();
  console.log(`Telegram bot: on; re-checking watched tokens every ${intervalMinutes} minutes`);
}

const PORT = process.env.PORT || 3000;
// Express 5 passes listen errors (e.g. port already in use) to this callback.
app.listen(PORT, (err) => {
  if (err) {
    console.error(`Could not start on port ${PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`TokenLens backend running on port ${PORT}`);
  startBot().catch((e) => console.error(`Telegram bot failed to start: ${e.message}`));
});
