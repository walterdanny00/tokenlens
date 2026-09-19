/**
 * TokenLens backend server.
 * Thin Express wrapper — all real logic lives in routes.js so it's
 * testable without a live server. This file just wires HTTP to it.
 */

require("dotenv").config();
const express = require("express");
const { makeWatchlist, handleCheck, handleWatch, handleWatchlist } = require("./routes");

const app = express();
app.use(express.json());

const CMC_API_KEY = process.env.CMC_API_KEY;
if (!CMC_API_KEY) {
  console.error("Missing CMC_API_KEY in environment. Check your .env file.");
  process.exit(1);
}

const watchlist = makeWatchlist();

app.get("/check/:tokenAddress", async (req, res) => {
  const { tokenAddress } = req.params;
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`TokenLens backend running on port ${PORT}`);
});
