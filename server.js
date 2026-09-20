/**
 * TokenLens backend server.
 * Thin Express wrapper — all real logic lives in routes.js so it's
 * testable without a live server. This file just wires HTTP to it.
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { makeWatchlist, handleCheck, handleWatch, handleWatchlist } = require("./routes");

const app = express();
// Public read API. Set CORS_ORIGIN (e.g. the Vercel URL) to lock it down.
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

const CMC_API_KEY = process.env.CMC_API_KEY;
if (!CMC_API_KEY) {
  console.error("Missing CMC_API_KEY in environment. Check your .env file.");
  process.exit(1);
}

const watchlist = makeWatchlist();

// EVM (0x + 40 hex) and Solana (base58, 32-44 chars) addresses both fit this.
const ADDRESS_RE = /^[A-Za-z0-9]{20,70}$/;

app.get(["/", "/health"], (req, res) => {
  res.json({ ok: true, service: "tokenlens" });
});

app.get("/check/:tokenAddress", async (req, res) => {
  const { tokenAddress } = req.params;
  if (!ADDRESS_RE.test(tokenAddress)) {
    return res.status(400).json({ error: "That doesn't look like a token contract address." });
  }
  const { networkId, symbol } = req.query;
  const { status, body } = await handleCheck(CMC_API_KEY, { tokenAddress, networkId, symbol });
  res.status(status).json(body);
});

app.post("/watch", async (req, res) => {
  const { status, body } = await handleWatch(CMC_API_KEY, watchlist, req.body);
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
