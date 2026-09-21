# TokenLens — Roadmap

## What this is

TokenLens is a risk-monitoring tool for DEX token listings, built for the
"Build with CMC: API Hackathon" (DoraHacks, Sept 9–30 2026, $10K prize pool).
It turns raw market and security data into a plain-language verdict
(🔴/🟡/🟢/⚪) that a non-technical crypto user can act on in one glance,
instead of a dashboard of numbers they'd need expertise to interpret.

## Live

- Web app: https://tokenlens-eight.vercel.app/ (Vercel)
- API: https://tokenlens-sxdq.onrender.com (Render; `/health`, `/check/:tokenAddress`)
- Code: https://github.com/walterdanny00/tokenlens

## Why this idea (pivot history)

Two earlier directions were considered and dropped before landing here:

1. **AI research chat on token data.** Dropped because CMC's own live "CMC AI"
   feature already does price-explanation, token comparison, portfolio
   analysis, and multi-turn chat on their own site.
2. **Plain risk-score scanner** (a single numeric/label score per token).
   Dropped because that category is already saturated — RugCheck,
   TokenSniffer, Solsniffer, GoPlus, De.Fi, Webacy all do this.

TokenLens's actual angle: a **plain-language verdict + reasons**, aimed at a
**specific real person** — a casual trader who acts on tips from Telegram/X,
has a wallet, but can't read liquidity depth or holder concentration.

**Competitive check (session 4):** reviewed 5 of the 23 other hackathon
submissions. Argus, Bedrock, and OverWatch are general dashboards. PerpsIA
(perpetual futures signal scoring) is the closest competitor but targets
already-sophisticated traders — a different audience. TokenLens's
non-technical angle appears to still be differentiated, though not all 23
entries were reviewed.

## Judging criteria (how the design maps to scoring)

| Criterion | Weight | How TokenLens addresses it |
|---|---|---|
| Does it work | 30% | Scoring logic works correctly even with partial data (capped verdicts, unknown is never treated as safe); verified against real CMC and GoPlus responses; ingestion never crashes, always degrades gracefully |
| Usefulness to a real person | 25% | Plain-language traffic-light verdict is the primary UX; explicit non-technical target persona |
| Interesting use of the API | 20% | Combines CMC market/DEX-search data with GoPlus security data — a genuine multi-source design, not a single wrapped endpoint. CMC's own `/v1/dex/security/detail` (works with `platformName` + `address`) is a planned second opinion |
| Code quality & documentation | 15% | Scoring/copy/ingestion logic are pure, testable functions, decoupled from API/UI |
| Presentation | remainder | Demo should show a live alert firing, not just a static screenshot |

## Locked architecture

1. **Data ingestion layer** (`ingestion.js` + `goplus.js`) — liquidity,
   market cap and contract age come from CMC's `/v1/dex/search` (query
   parameter is `q`, not `keyword`); honeypot/mint/ownership/holder and
   liquidity-pool data comes from GoPlus's free Token Security API, verified
   against real EVM and Solana responses (session 5). The lookup is
   chain-aware: a given `networkId` matches only that network, otherwise the
   deepest liquidity wins, and other networks holding the same address are
   reported. Maps CMC network IDs to GoPlus chain IDs (verified against
   CMC's platform list); Solana uses a separate GoPlus endpoint. All
   security fields are tri-state (true / false / null = unknown).
   CMC's `/v1/dex/security/detail` works with `platformName` + `address`
   (session 4's "broken endpoint" was a parameter-name error on our side) and
   is not wired in yet. Degrades gracefully at every failure point — never
   crashes, never guesses; requests have timeouts.
2. **Risk scoring engine** (`scoring.js`) — pure function, token record in,
   `{verdict, reasons, caveats?}` out. Works correctly with partial data:
   - **Full security-scan path** (when GoPlus data is available): RED for
     honeypot, active mint function, unlocked liquidity on a token younger
     than 30 days (or of unknown age), or (unrenounced ownership + contract
     age < 48h). YELLOW for: unlocked liquidity on an older token, ownership
     still held, unknown lock/ownership/mint status, high holder
     concentration (top-10 > 50%), short lock duration, thin liquidity
     (<$10K), or contract age < 7 days. GREEN if none of the above, with copy
     that lists only what was actually confirmed.
   - **Established-token override:** when the liquidity lock is *unknown*
     (not known-unlocked) because most liquidity sits in concentrated pools,
     a token that clears every bar — age >= 90 days, liquidity >= $250k,
     >= 10,000 holders, top-10 <= 50%, >= 80% of liquidity in concentrated
     pools, mint and ownership clean — can be GREEN with a visible caveat.
     Strictly additive; every other flag applies at full strength.
   - **No security scan available**: capped at YELLOW at most — never GREEN
     without a verified security scan.
   - **UNKNOWN**: neither security scan nor liquidity/age data available.
   - v1 deliberately has no severity weighting — noted as a v2 upgrade.
3. **Verdict copy generator** (`copyGenerator.js`) — templated plain-language
   paragraph per verdict, built from the reasons array plus any caveats.
   Always includes a "not financial advice" disclaimer.
4. **Backend API** (`routes.js` + `server.js`) — `GET /check/:tokenAddress`
   (`networkId` optional — the chain is auto-detected), `POST /watch`,
   `GET /watchlist`. `/check` returns the verdict, reasons, caveats,
   `networkName`, `alsoOnNetworks`, `degradedReason` and a `data` object of
   raw numbers for the UI. CORS (`CORS_ORIGIN`), address validation, health
   route and JSON error handling in place. Built and tested. `/watch` stores
   an initial verdict but does not yet re-check on a schedule (see layer 6);
   the watchlist is in-memory.
5. **Frontend** (`frontend/`, React + Vite) — one input box → full-width
   traffic-light verdict band with plain-language reasons and any caveat;
   network auto-detect; example tokens; expandable "See the data" section;
   shareable links; friendly error messages and a slow-server notice. Built, tested (21 unit
   tests + a browser run against a mocked API) and **deployed on Vercel**.
   The "watch this token" button is deliberately absent until alerts exist.
6. **Alerting layer** (`bot.js`, `telegram.js`, `store.js`, `watcher.js`) —
   Telegram bot over a webhook (checked with a secret): a bare address gets a
   verdict, `/watch` adds a watch, and a loop re-checks each watched token once
   per interval and messages only when a *complete* check changes the verdict.
   The watchlist is saved in Upstash Redis when configured, otherwise it is
   memory-only. Built, tested and **live** as `@tokenlens_bot`; the web app's
   "Watch on Telegram" button opens it. The old public `/watch` and `/watchlist` routes were
   removed (they would have exposed chat IDs).
7. **MCP/agent layer** — stretch goal, built last, cut first if time is
   short. **Not started.**
8. **Stack/infra** — Node/Express backend + React frontend. Backend on
   Render (free instance, Node 22, auto-deploy from `main`, `CMC_API_KEY` in
   Render's environment); frontend on Vercel (Root Directory `frontend`);
   repo `walterdanny00/tokenlens`. An external cron job pings the backend so
   the free instance doesn't sleep. `dotenv` for local key loading;
   `.gitignore` + `.env.example` in place; repo-level `package.json`
   (express, dotenv, cors) with a `start` script.

## Current status (living — update each session)

- DEX API access is live. The earlier "broken" security endpoints were
  parameter-naming errors on our side: search takes `q`; `security/detail`
  takes `platformName` + `address` (works); `/v1/dex/token` takes
  `platform` + `address` (works). `holders/list` not retested. The CMC
  support report should be corrected.
- Layers 1–5 and 8 are built, tested and **live end to end** (session 5):
  PEPE -> Ethereum YELLOW; BONK -> Solana GREEN with a caveat, from the
  deployed site through the deployed API.
- Known gaps: no Solana lock signal yet (GoPlus `dex[].burn_percent` is a
  candidate); EVM lock status reads V2-style LP holders only; alerts are built
  but not yet switched on in production.
- Bug patterns to keep watching: `null < N` evaluating true in JS (found
  again in session 5), and treating "unknown" as "safe".
- Key-safety setup complete: `.gitignore`, `.env.example`, `dotenv`; the key
  lives only in `.env` locally and in Render's environment.
- Public-API safeguards in place (session 5): answer cache, per-visitor rate
  limit, shared lookup budget, watchlist cap — see `docs/session-05.md`.
- Full details of what changed and why: `docs/session-05.md`.

## Next steps (in order)

1. Look into the occasional missing GoPlus data (seen once, see the session
   brief), then confirm the Upstash watchlist survives a redeploy.
2. Demo video (about 2 minutes): paste an address, show the verdict and the
   caveat, open the data, share the link, then the bot: Watch on Telegram,
   `/list` and `/demo`.
3. DoraHacks BUIDL submission before the Oct 1 deadline: description, live
   links, repo (public), video. Check the live links open without any login.
4. Optional, strengthens the API-use story: add CMC's `security/detail` as a
   second opinion next to GoPlus; correct the CMC support report.
5. MCP layer (layer 7) — only if time allows.
