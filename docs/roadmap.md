# TokenLens — Roadmap

## What this is

TokenLens is a risk-monitoring tool for DEX token listings, built for the
"Build with CMC: API Hackathon" (DoraHacks, Sept 9–30 2026, $10K prize pool).
It turns raw market and security data into a plain-language verdict
(🔴/🟡/🟢/⚪) that a non-technical crypto user can act on in one glance,
instead of a dashboard of numbers they'd need expertise to interpret.

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
| Does it work | 30% | Scoring logic works correctly even with partial data (capped verdicts, never a false Green); ingestion never crashes, always degrades gracefully |
| Usefulness to a real person | 25% | Plain-language traffic-light verdict is the primary UX; explicit non-technical target persona |
| Interesting use of the API | 20% | Combines CMC market/DEX-search data with GoPlus security data — a genuine multi-source design, not a single wrapped endpoint |
| Code quality & documentation | 15% | Scoring/copy/ingestion logic are pure, testable functions, decoupled from API/UI |
| Presentation | remainder | Demo should show a live alert firing, not just a static screenshot |

## Locked architecture

1. **Data ingestion layer** (`ingestion.js` + `goplus.js`) — liquidity and
   market cap come from CMC's `/v1/dex/search` (confirmed working);
   honeypot/mint/ownership/holder-concentration data comes from GoPlus's
   free Token Security API, since CMC's own `/v1/dex/security/detail` and
   `/v1/dex/holders/list` have not returned usable responses during the
   hackathon window (reported to CMC support as a specific bug — see
   docs/session-04.md). Maps CMC's network IDs to GoPlus's EVM chain IDs;
   Solana handled via a separate GoPlus endpoint. Degrades gracefully at
   every failure point — never crashes, never guesses.
2. **Risk scoring engine** (`scoring.js`) — pure function, token record in,
   `{verdict, reasons}` out. Works correctly with partial data:
   - **Full security-scan path** (when GoPlus data is available): RED for
     honeypot, active mint function, unlocked liquidity, or (unrenounced
     ownership + contract age < 48h). YELLOW for high holder concentration,
     short lock duration, thin liquidity (<$10K), or contract age < 7 days.
     GREEN if none of the above.
   - **No security scan available**: capped at YELLOW at most — liquidity/
     age signals still evaluated and reported, but never GREEN without a
     verified security scan.
   - **UNKNOWN**: neither security scan nor liquidity/age data available.
   - v1 deliberately has no severity weighting — noted as a v2 upgrade.
3. **Verdict copy generator** (`copyGenerator.js`) — templated plain-language
   paragraph per verdict, built from the reasons array. Always includes a
   "not financial advice" disclaimer.
4. **Backend API** (`routes.js` + `server.js`) — `GET /check/:tokenAddress`,
   `POST /watch`, `GET /watchlist`. Built and tested. `/watch` stores an
   initial verdict but does not yet re-check on a schedule (see layer 6).
5. **Frontend** — one input box → traffic-light verdict + paragraph;
   expandable "see the data" section for power users; "watch this token"
   button. Deploy on Vercel. **Not started — next build step.**
6. **Alerting layer** — Telegram bot; re-checks watched tokens on a
   schedule and messages only when the verdict changes. Backend plumbing
   (`/watch`, `/watchlist`) exists; the re-check loop and the bot itself
   are **not started**.
7. **MCP/agent layer** — stretch goal, built last, cut first if time is
   short. **Not started.**
8. **Stack/infra** — Node/Express backend + React frontend, Render
   (backend) + Vercel (frontend), repo `walterdanny00/tokenlens`. `dotenv`
   for key loading; `.gitignore` + `.env.example` in place.

## Current status (living — update each session)

- DEX API access is confirmed live (real credit consumption on calls), but
  `/v1/dex/security/detail` and `/v1/dex/holders/list` remain broken for
  every parameter combination tried — reported to CMC support as a
  specific bug (session 4). Not blocking further work: GoPlus now covers
  security data instead.
- Layers 1–4 (ingestion incl. GoPlus, scoring, copy generation, backend
  API) are built and tested against mocked data. `goplus.js`'s field
  mapping is built from scraped docs, not yet verified live.
- A real bug (`null < 30` evaluating true in JS) was found and fixed during
  testing — worth remembering as a pattern to watch for elsewhere in the
  scoring logic.
- Key-safety setup complete: `.gitignore`, `.env.example`, `dotenv`
  installed and confirmed working.

## Next steps (in order)

1. Push this session's files (`goplus.js`, updated `ingestion.js`,
   `scoring.js`, `test_ingestion.js`) and verify `goplus.js` against a real
   live GoPlus response.
2. Build the frontend (layer 5).
3. Build the Telegram alerting layer (layer 6) — scheduled re-check loop +
   bot messaging on verdict change.
4. MCP layer (layer 7) — only if time allows.
5. Add a README to the repo (code quality/documentation judging criterion).
6. Demo video + DoraHacks BUIDL submission before the Oct 1 deadline.
