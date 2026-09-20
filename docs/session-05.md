# Session 05 — 2026-09-20

## What happened this session

1. **Verified `goplus.js` against real GoPlus responses** (PEPE on Ethereum,
   BONK on Solana) — closing the session 04 open item. Found and fixed:
   - **False "liquidity locked" on PEPE:** `lp_holders.some(is_locked)` was
     true because 0.009% of LP tokens sit at the burn address. Now uses the
     locked *share* of LP tokens (>= 50% counts as locked).
   - **Solana `holder_count` is a string**, so the `typeof === "number"`
     check always failed. Solana also *does* return a `holders` list (top-10
     share is now computed) and has **no honeypot field** at all — it was
     reporting `is_honeypot: false` when GoPlus simply has no answer.
   - `ownership_renounced` now also requires `can_take_back_ownership` and
     `hidden_owner` to be off (EVM).
   - Every security field is now **tri-state** (true / false / null; null =
     unknown, never "safe"). `security_scan_available` is only true when a
     real verdict exists (EVM honeypot verdict, or Solana authority data).
2. **Fixed false-GREEN bugs in `scoring.js`** (reproduced old vs new):
   - ownership still held on a token older than 48h scored GREEN;
   - GREEN copy always claimed "Liquidity is locked", even when unknown;
   - `null < 48` (the session 04 bug pattern) still existed in the RED check.
   New behaviour: unlocked liquidity is RED only for tokens < 30 days old (or
   unknown age), YELLOW for older ones; unknown lock/ownership/mint status
   adds a YELLOW reason; GREEN copy lists only what was confirmed.
3. **Root cause of session 04's "search returns junk": the search parameter
   is `q`, not `keyword`.** `keyword=` returned an unrelated list (six
   "NULL" tokens for PEPE's address); `q=<address>` returns PEPE on
   Ethereum, PulseChain and Unichain. The informal AI Agent Hub docs say
   `keyword`; the official API reference says `q`. `ingestion.js` fixed.
4. **`/v1/dex/security/detail` works** — with the documented parameters
   `platformName` + `address` (HTTP 200 for PEPE: `securityLevel: safe`,
   buy/sell tax, `securityItems[]` with `riskCode`/`riskyLevel`/`isHit`,
   source "W3W"). Session 04's "broken endpoint" conclusion was a parameter
   naming error on our side, not a CMC bug — **the support report needs
   correcting.** `/v1/dex/holders/list` was not retested.
5. **Also probed `/v1/dex/token?platform=&address=`:** returns liquidity,
   market cap, owner and a CMC risk level (`rl`). Its holder count (`hld`)
   was 0 for PEPE, so GoPlus stays the holder source. Locked/burned pool
   rates (`lr`/`br`) were null for the pools we sampled — no lock signal.
6. **Chain-aware lookup.** The same address can exist on several networks.
   `ingestion.js` now matches the requested network (CMC `pltId`), or takes
   the deepest liquidity when none is given; Solana addresses match
   case-sensitively. `networkId` is now optional on `/check`, so the UI can
   auto-detect the chain. Verified the CMC→GoPlus map against CMC's platform
   list (1→1, 14→56, 16→Solana, 199→8453, 51→42161, 28→43114); the list's
   `chId` gives EVM chain IDs for ~150 chains, a possible replacement for
   the hard-coded map.
7. **Contract age now uses the earliest of `pt`/`fpt`/`fpct`.** For PEPE,
   `fpt` says Feb 2025 but the first pool (`fpct`) is April 2023. Timestamps
   confirmed to be epoch milliseconds.
8. **Established-token override** (decision made this session). When a
   liquidity lock is *unknown* because most liquidity sits in concentrated
   pools, a token that clears every bar below can be GREEN with a visible
   caveat: age >= 90 days, liquidity >= $250k, >= 10,000 holders, top-10
   <= 50%, >= 80% of liquidity in concentrated pools, mint/ownership clean.
   Strictly additive — a known-unlocked lock is never excused, and all other
   RED/YELLOW checks still apply. `goplus.js` computes the concentrated
   share (BONK 94.45%, PEPE 0.47%); `/check` returns it as
   `data.concentratedLiquidityPct` and the caveat in `caveats[]`.
9. **Backend hardening.** `/check` now returns a `data` object (raw numbers
   for the "see the data" panel), `caveats`, `networkName`,
   `alsoOnNetworks`, and always fills `degradedReason` on failure. Added
   CORS (`CORS_ORIGIN` env, default `*`), address-format validation, a `/`
   health route, a JSON 500 handler, request timeouts (CMC 15s, GoPlus 12s)
   and URL-encoding of addresses. `server.js` now fails loudly if the port is
   taken (Express 5 passes listen errors to the callback; the old code
   printed "running" and exited silently).
10. **Deploy blocker found and fixed:** the repo had **no `package.json`** —
    dependencies only resolved via `~/package.json` / `~/node_modules` in the
    home directory, which would have failed on Render. Added a repo-level
    `package.json` (express, dotenv, cors) with a `start` script.
11. **Live end-to-end result** (through `handleCheck`, real APIs):
    PEPE -> Ethereum **YELLOW** (liquidity unlocked, old token);
    BONK -> Solana **GREEN with one caveat**. Existing suites
    (`test_scoring`, `test_ingestion`, `test_routes`) pass, and a new
    `test_realdata.js` locks in today's fixes using captured real responses.
12. **Environment lessons:** Termux has no `/tmp` (use `$TMPDIR`); a stale
    `node server.js` on port 3000 answered earlier test requests; same-named
    downloads can be stale — copy the newest file (or use unique names).

## Open items carried into next session

- Confirm this session's commit + push landed (`git status`, `git log -1`).
- Not yet tested over HTTP since the fixes (`node server.js` + curl) — the
  live check went through `handleCheck` directly.
- Correct/withdraw the CMC support report about `security/detail`.
- Optional: wire CMC's `/v1/dex/security/detail` in as a second opinion next
  to GoPlus (stronger CMC-API story, and a fallback if GoPlus is down). Need
  to see the full `securityItems` code list and a risky token's response.
- Solana lock signal: GoPlus `dex[].burn_percent` (0–100) on Standard pools
  could verify locks for CPMM-heavy tokens — not implemented.
- EVM `liquidity_locked` reads only V2-style LP holders; a young V3-heavy
  token with a tiny unlocked V2 pool could read as "unlocked" — review.
- `price_change_24h_pct` (`pc24h`) unit unverified; not exposed in `data`.
- **Frontend (layer 5) not started.** Needs: one input, chain auto-detect
  (`networkName`), `alsoOnNetworks` note, caveat line, "see the data" panel
  from `data`, Watch button posting `/watch` with the detected `networkId`.
- Watchlist is in-memory (lost on Render restart) — matters for layer 6.
- Telegram alerting (layer 6), MCP layer (layer 7), README, demo video and
  DoraHacks submission — not started. Backend not yet deployed to Render.
