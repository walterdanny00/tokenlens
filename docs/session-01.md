# Session 01 — 2026-09-18

## What happened this session

1. **Explored the hackathon prompt** and evaluated a "risk-score scanner"
   direction — found the category already saturated (RugCheck, TokenSniffer,
   Solsniffer, GoPlus, De.Fi, Webacy).
2. **Explored an "AI research chat" direction** — found CMC's own live
   CMC AI feature already covers this (price explanation, comparisons,
   portfolio analysis, multi-turn chat). Dropped.
3. **Landed on the real direction:** a plain-language risk verdict aimed at
   a specific non-technical persona (casual trader acting on tips), layered
   with detection → alerting → optional MCP exposure, built in that order
   rather than in parallel.
4. **Mapped the design to the published judging criteria** (Does it work 30%,
   Usefulness to a real person 25%, Interesting API use 20%, Code quality
   15%, Presentation — remainder) to make sure design choices are actually
   scoring-relevant, not just technically interesting.
5. **Set up accounts:** CMC API account (Basic tier), DoraHacks hacker
   profile (GitHub connected/verified), registered for the hackathon.
6. **Tested CMC DEX endpoints via Termux** — hit error 1006
   ("plan doesn't support this endpoint") on `/v1/dex/new/list` and
   `/v1/dex/tokens/trending/list`. Confirmed via Plan & Billing that the
   account still shows Basic/Active — the free hackathon Startup-tier
   upgrade hasn't applied yet. Sent a support message via the DoraHacks
   project page. Also found other hackathon entrants hitting the same 1006
   issue, including on endpoints that should be covered post-upgrade — so
   this may not fully resolve even once "upgraded."
7. **Designed and locked the risk-scoring thresholds** (see roadmap.md for
   the full breakdown) — deliberately simple, no severity weighting, to
   prioritize reliability and explainability for the hackathon window.
8. **Built and tested `scoring.js` and `copyGenerator.js`** against 6 mock
   token records (honeypot, unlocked liquidity, concentrated+thin liquidity,
   clean token, too-new-to-assess, no-security-scan). All verdicts and
   generated copy were correct on first real test run (one small copy bug —
   duplicated "no red flags" phrasing on the Green case — fixed same
   session).

## Open items carried into next session

- CMC Startup-tier access still unresolved — waiting on support reply.
- `walterdanny00/tokenlens` repo not yet created — `scoring.js` and
  `copyGenerator.js` exist only as chat-delivered files, not yet
  version-controlled.
- Data ingestion layer (layer 1) not started — blocked on confirming which
  endpoints are actually usable.
- DoraHacks BUIDL submission page created but only has a draft
  pitch/description — no repo link, no working demo yet.
