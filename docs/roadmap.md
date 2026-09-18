# TokenLens — Roadmap

## What this is

TokenLens is a risk-monitoring tool for DEX token listings, built for the
"Build with CMC: API Hackathon" (DoraHacks, Sept 9–30 2026, $10K prize pool).
It turns raw CoinMarketCap DEX/security data into a plain-language verdict
(🔴/🟡/🟢/⚪) that a non-technical crypto user can act on in one glance,
instead of a dashboard of numbers they'd need expertise to interpret.

## Why this idea (pivot history)

Two earlier directions were considered and dropped before landing here:

1. **AI research chat on token data.** Dropped because CMC's own live "CMC AI"
   feature already does price-explanation, token comparison, portfolio
   analysis, and multi-turn chat on their own site — building the same thing
   with their API wouldn't read as differentiated to judges.
2. **Plain risk-score scanner** (a single numeric/label score per token).
   Dropped because that category is already saturated — RugCheck,
   TokenSniffer, Solsniffer, GoPlus, De.Fi, Webacy all do this, several with
   free public APIs already.

TokenLens's actual angle: a **plain-language verdict + reasons**, aimed at a
**specific real person** — a casual trader who acts on tips from Telegram/X,
has a wallet, but can't read liquidity depth or holder concentration. Existing
tools assume the user already understands the underlying metrics; TokenLens
assumes they don't.

## Judging criteria (how the design maps to scoring)

| Criterion | Weight | How TokenLens addresses it |
|---|---|---|
| Does it work | 30% | Core scoring logic kept deliberately simple (no severity weighting) to maximize reliability over nuance; ingestion layer never crashes and never silently guesses when data is missing |
| Usefulness to a real person | 25% | Plain-language traffic-light verdict is the primary UX, not a secondary feature; explicit non-technical target persona |
| Interesting use of the API | 20% | Layers DEX security/liquidity/holder data + polling + alerting, not just a single wrapped endpoint |
| Code quality & documentation | 15% | Scoring/copy/ingestion logic are pure, testable functions, decoupled from API/UI |
| Presentation | remainder | Demo should show a live alert firing, not just a static screenshot |

## Locked architecture

1. **Data ingestion layer** — poll CMC DEX endpoints per watched network
   (Ethereum, BSC, Solana, Base to start); normalize into token records
   (address, network, liquidity depth, holder concentration %, LP lock
   status, security-scan flags, contract age, volume); poll every ~15–30 min;
   on endpoint failure (e.g. error 1006), degrade gracefully and flag the
   record as partial data rather than guessing. **Built and tested
   (`ingestion.js`)** — DEX-first, falls back to Basic-tier cryptocurrency
   endpoints, never crashes.
2. **Risk scoring engine** — pure function, token record in,
   `{verdict, reasons}` out. Red-dominates logic: any hard flag returns Red
   immediately, never averaged away. Thresholds:
   - **RED** (any one): honeypot detected, OR mint function still active, OR
     liquidity not locked, OR (ownership not renounced AND contract age < 48h)
   - **YELLOW** (any one, all collected): top10 holders > 50% of supply, OR
     liquidity lock < 30 days, OR liquidity < $10K, OR contract age < 7 days
   - **GREEN**: none of the above
   - **UNKNOWN** (checked first, never falls through to Green): security-scan
     data unavailable, or contract too new for holder data to exist
   - v1 deliberately has no severity weighting — noted as a v2 upgrade, not
     in scope for the hackathon. **Built and tested (`scoring.js`).**
3. **Verdict copy generator** — templated (not free-generated) plain-language
   paragraph per verdict, built from the reasons array. Always includes a
   "not financial advice" disclaimer. Unknown is a first-class state.
   **Built and tested (`copyGenerator.js`).**
4. **Backend API** — Node/Express: `GET /check/:tokenAddress`,
   `POST /watch`, `GET /watchlist`. Wraps layers 1–3 so the frontend/MCP
   layer never touches CMC directly. **Not started — next build step.**
5. **Frontend** — one input box (paste address/link) → loading state →
   traffic-light verdict + paragraph. Secondary expandable "see the data"
   section for power users. "Watch this token" button feeds the alert layer.
   Deploy on Vercel. **Not started.**
6. **Alerting layer** — Telegram bot. User pastes a token to watch; bot
   re-checks on schedule and DMs only when the verdict changes. **Not
   started.**
7. **MCP/agent layer** — stretch goal, built last. Thin wrapper exposing
   `check_token()`, `watch_token()`, `get_watchlist()` as MCP tools, reusing
   layers 1–4 with no new logic. First thing cut if time runs short. **Not
   started.**
8. **Stack/infra** — Node/Express backend + React frontend, Render (backend)
   + Vercel (frontend), repo `walterdanny00/tokenlens`. `dotenv` installed
   for safe key loading; `.gitignore` + `.env.example` in place.

## Current status (living — update each session)

- CMC API account created (Basic tier); DoraHacks hacker profile set up
  (GitHub verified); registered for the hackathon.
- **Still blocked:** DEX endpoints return error 1006 — free Startup-tier
  hackathon upgrade hasn't applied to the CMC account yet. Support message
  sent via DoraHacks project page in session 01; no reply as of session 02.
  Not blocking further work — building against the fallback path.
- Layers 1–3 (ingestion, scoring, copy generation) are built, tested, and
  pushed to `main` (commit `d1b31d8`). This is the full core logic of the
  project, verified working end-to-end via mocked data, independent of the
  live CMC access issue.
- Key-safety setup complete: `.gitignore`, `.env.example`, `dotenv`
  installed, confirmed `.env` never gets staged in git.

## Next steps (in order)

1. Build the backend API (layer 4) wrapping layers 1–3 in Express.
2. Once CMC DEX access clears (or a decision is made to proceed on fallback
   only), verify `fetchDexRecord()`'s field names against a real response
   from `/v1/dex/security/detail` — currently based on docs, not live-tested.
3. Build the frontend (layer 5).
4. Build the Telegram alerting layer (layer 6).
5. MCP layer (layer 7) — only if time allows.
6. Add a README to the repo (code quality/documentation judging criterion).
7. Demo video + DoraHacks BUIDL submission before the Oct 1 deadline.
