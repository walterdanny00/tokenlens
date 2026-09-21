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

13. **Backend deployed to Render** (free instance): `https://tokenlens-sxdq.onrender.com`.
    Settings: build `npm install`, start `npm start`, `NODE_VERSION=22`,
    `CMC_API_KEY` set in Render's Environment (never in the repo);
    `CORS_ORIGIN` left unset (open). Auto-deploys on every push to `main`.
    `/` and `/health` return `{"ok":true,"service":"tokenlens"}`. First
    deploy looped because the Start Command had been set to `npm install`
    (it exits immediately) — fixed to `npm start`. Verified live from Render:
    PEPE -> Ethereum YELLOW, BONK -> Solana GREEN with one caveat.
14. **Keep-alive:** free Render instances sleep after 15 minutes idle; an
    external cron-job service now pings `/` every few minutes (working).
    Free instances get 750 hours/month, enough for one always-on service.
    Optional: point the cron at `/health` instead.
15. **Frontend built and deployed** — `frontend/` (React 19 + Vite 5), live at
    `https://tokenlens-eight.vercel.app/` (Vercel, Root Directory `frontend`,
    no env vars needed; `VITE_API_URL` defaults to the Render URL).
    Design: the verdict is a full-width color band that opens like an
    aperture; each state has its own shape and words (never color alone);
    fonts Bricolage Grotesque + Public Sans. Features: one input with paste
    button, network picker with auto-detect, PEPE/BONK example chips, reasons
    and caveat, "also on other networks" note, expandable "See the data"
    (unknown always shown as unknown), shareable links
    (`?token=...&network=...` that auto-run), friendly errors, and a "server is
    waking up" notice that only appears if a check takes over 5 seconds (a
    safety net for redeploys or a missed ping; the keep-alive cron means
    visitors normally never see it). No Watch button yet — alerts are not
    built, so it would promise something the product can't do (`watchToken`
    is ready in `src/api.js`). "Token age" was relabelled **"Trading for"**:
    the number is when CMC first saw a pool, not the token's real age.
16. **Frontend verification:** 21 unit tests (`npm test` in `frontend/`), plus
    a browser run of the real bundle against a mocked API through 12 flows
    (examples, panel, invalid input, server/network errors, slow server, share
    link, unlisted network, unknown verdict) with no console errors — the
    browser harness is not in the repo. Checked on a real phone: PEPE yellow,
    BONK green with caveat, invalid input error, shared link auto-runs.
17. **More lessons:** a phone browser's text-scaling setting can make the UI
    look unevenly sized (the same page looked right in a second browser);
    the Vercel build prints the same harmless esbuild `allow-scripts` warning
    as local installs.

18. **Protecting the public API** (before making the repo public). Every
    uncached `/check` spends CoinMarketCap credits (1 per search), so the API
    now has: an in-memory answer cache (`cache.js`; 60s for a good answer, 10s
    for a partial one, single-flight for simultaneous identical requests,
    `X-Cache` HIT/MISS header); a per-visitor rate limit (`rateLimit.js`; 30 per
    minute per IP, HTTP 429 with a plain message and `Retry-After`); a shared
    lookup budget (100 uncached lookups per 10 minutes for everyone, HTTP 503
    "very busy" — cached answers still served); a 500-entry cap on the
    watchlist; and `/`, `/health` exempt from limits so the cron ping is free.
    All tunable by env (`RATE_LIMIT_PER_MIN`, `MAX_LOOKUPS_PER_10_MIN`,
    `CACHE_TTL_SECONDS`, `TRUST_PROXY`). `handleCheck`/`handleWatch` take an
    optional `protection` argument, so behaviour is unchanged without it.
    `GET /ip` was added to confirm `TRUST_PROXY`. Testing on the live site
    showed `TRUST_PROXY=1` saw an internal `10.x` address and `2` saw a
    Cloudflare edge address that changes per request, so nothing was limited.
    Requests arrive through Cloudflare and Render's proxy
    (`X-Forwarded-For` = client, Cloudflare edge, Render internal) and Render
    does not strip values a client sends, so the default is now **3** hops
    (trusting "all" would let a visitor spoof their IP). To confirm on the live
    site: `/ip` shows your real address, also with a fake `X-Forwarded-For`. New `test_protection.js` (16 tests); the
    server wiring was also exercised through an offline Express stand-in.

19. **Telegram alerts built** (layer 6). Bot over a webhook that only accepts
    requests carrying `TELEGRAM_WEBHOOK_SECRET`; commands `/check`, `/watch`,
    `/list`, `/unwatch`, `/demo` (a clearly labelled sample alert), a bare
    address, a Watch button, and a `/start w_<networkId>_<address>` deep link
    the web app can use later. A re-check loop (default every 30 minutes, one
    lookup per distinct token, spaced out) alerts on verdict changes only, and
    only from *complete* checks — a partial answer (a data source hiccup)
    would look worse than reality, so it is skipped, avoiding a false alarm and
    a second one on recovery. The first full check just sets a baseline. A
    chat that blocks the bot is dropped. Limits: 5 watches per person, 20
    distinct tokens. The watchlist is one JSON value in Upstash Redis (its REST
    API, POST with a JSON command array) when `UPSTASH_REDIS_REST_URL` and
    `_TOKEN` are set, else memory-only; a failed load never lets a later save
    overwrite saved state. The public `POST /watch` and `GET /watchlist` were
    removed. New `test_alerts.js` (31 tests); the webhook wiring was exercised
    through the offline Express stand-in (secrets never appear in logs).
    Credit maths: each re-check ~1 CMC credit, so up to 960 a day at the
    defaults — lower `MAX_WATCHED_TOKENS` if the plan is small.

20. **Bot live and tested on a phone** (`@tokenlens_bot`, Upstash watchlist
    active in the logs; BotFather menu, description and picture set): `/start`,
    `/demo`, a bare address, the Watch button, `/list` and `/unwatch` all
    worked. One check at 2:31 PM came back *partial* ("contract security
    couldn't be verified"): the bot handled it correctly (yellow, watch added
    without a baseline, `/list` shows an hourglass), but it means GoPlus data
    can be missing at times — see open items.
21. **"Watch on Telegram" button added to the web app** — links to
    `https://t.me/tokenlens_bot?start=w_<networkId>_<address>` (shown once the
    network is known; payload checked against Telegram's 64-character limit).
    Removed the unused `watchToken` client function since `/watch` no longer
    exists. Frontend now has 23 unit tests; the browser run covers the link.

## Open items carried into next session

- **Re-confirm the safeguards on Render after the `TRUST_PROXY=3` change:**
  `/ip` should return your real IP (also when a fake `X-Forwarded-For` is sent),
  a repeat check should show `X-Cache: HIT` (confirmed), and a burst should
  start returning 429 (it did not with the old default). Lower `MAX_LOOKUPS_PER_10_MIN` if the
  CMC plan has few credits (default allows up to about 14,400 lookups a day).
- **`GET /watchlist` is public.** Fine today, but when Telegram alerts are added
  it must never expose chat IDs — store those privately.
- **Turn the bot on in Render** (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
  `PUBLIC_URL`; optionally the two Upstash variables) and test it live:
  `/demo`, a bare address, `/watch`, `/list`.
- **Investigate the missing security data** seen once at 2:31 PM (PEPE came back
  without GoPlus data): check `degradedReason` from the API and GoPlus directly;
  possible causes are a brief GoPlus outage or GoPlus rate-limiting Render's
  shared outbound IP. If it recurs: retry once on failure, and/or use a free
  GoPlus API key for higher limits.
- Tidy-up: `routes.js` still holds the old in-memory `handleWatch` /
  `handleWatchlist` helpers, now unused; remove them together with their tests
  in `test_routes.js` and `test_protection.js`.
- **Demo video and DoraHacks submission** before the Oct 1 deadline — make
  sure the GitHub repo is public (or judges can access it) and the live links
  work without any login (check the Vercel URL in a private tab).
- Correct/withdraw the CMC support report about `security/detail`.
- Optional: wire CMC's `/v1/dex/security/detail` in as a second opinion next
  to GoPlus (need the full `securityItems` code list and a risky token).
- Solana lock signal: GoPlus `dex[].burn_percent` (0–100) on Standard pools
  could verify locks for CPMM-heavy tokens — not implemented.
- EVM `liquidity_locked` reads only V2-style LP holders; a young V3-heavy
  token with a tiny unlocked V2 pool could read as "unlocked" — review.
- `price_change_24h_pct` (`pc24h`) unit unverified; not exposed in `data`.
- MCP layer (layer 7) — stretch, only if time allows.
- Housekeeping: switch the cron ping to `/health` (optional); `CORS_ORIGIN`
  is open on purpose so any judge-facing URL works.
