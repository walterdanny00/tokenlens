# Session 04 — 2026-09-19

## What happened this session

1. **Confirmed real DEX API access is live.** Search and pair-quotes calls
   consumed real credit_count and returned actual data — the Startup-tier
   access issue from sessions 1–3 appears resolved for at least some
   endpoints.
2. **`/v1/dex/security/detail` and `/v1/dex/holders/list` remain broken**
   for us specifically — every parameter combination tried (network_slug/
   network_id, contract_address/tokenAddress, with/without tag, both
   authenticated and via the keyless `/public-api/` prefix) returned a bare
   400 "Parameter error" or "BAD_REQUEST" with no further detail. Cross-
   checked against CMC's actual structured API Reference (not just the
   informal AI Agent Hub docs) to rule out wrong endpoint paths — the paths
   are correct; something about the request format or the endpoint itself
   is not working as documented.
3. **Escalated this as a specific, reproducible bug report** (not a vague
   access question) via the same DoraHacks support channel used in
   session 1.
4. **Found that `/v1/dex/search` works reliably** and returns real
   liquidity (`liq`) and market cap (`mc`) directly in its results —
   became the new primary data source for those two fields.
5. **Reviewed 5 of the 23 other hackathon submissions** (Argus, Bedrock,
   OverWatch, PerpsIA, plus attempted others blocked by robots.txt).
   Argus/Bedrock/OverWatch are general dashboards; none target a
   non-technical user the way TokenLens does. **PerpsIA** is the closest
   competitor (perpetual futures signal scoring) but is built for already-
   sophisticated traders (funding rates, open interest, leverage sizing) —
   a different audience than TokenLens's "explain it in plain English"
   angle. TokenLens's differentiation held up under this check, though not
   all 23 submissions were reviewed.
6. **Key tactical finding from PerpsIA:** they source security/honeypot
   data from **GoPlus** and **Honeypot.is**, not from CMC's own DEX security
   endpoints — CMC is used only for market data. Adopted the same pattern.
7. **Reworked `scoring.js`** to work correctly with partial data: full
   RED-check logic when a security scan is available; capped at YELLOW
   (never GREEN) when security data is missing but liquidity/age data is
   present, since safety can't be confirmed without it; UNKNOWN only when
   neither is available.
8. **Rewrote `ingestion.js`** to combine CMC's `/v1/dex/search` (liquidity,
   market cap — confirmed working) with a new **`goplus.js`** module
   (GoPlus's free, keyless Token Security API) for honeypot/mint/ownership/
   holder-concentration data. Includes a CMC-network-ID → GoPlus-EVM-chain-
   ID mapping (they use different ID schemes) and a separate path for
   Solana (not EVM).
9. **Found and fixed a real bug** during mock testing: `null < 30`
   evaluates to `true` in JavaScript (numeric coercion), which was causing
   a false "liquidity locked but only briefly" flag on tokens where lock
   duration is genuinely unknown. Fixed with explicit `typeof === "number"`
   guards.
10. All changes tested against mocked fetch responses (3 ingestion
    scenarios, 7 scoring scenarios) — all passing. `goplus.js`'s field
    mapping is built from scraped documentation and GitHub SDK source, not
    a live test call yet — still needs verification against a real GoPlus
    response.

## Open items carried into next session

- Files from this session (`goplus.js`, updated `ingestion.js`, updated
  `scoring.js`, updated `test_ingestion.js`) written but not yet pushed —
  in progress as of end of session.
- `goplus.js`'s exact field mapping unverified against a real live
  response — needs a real `curl`/server test once pushed.
- CMC support hasn't responded to either the session-1 tier report or the
  session-4 specific endpoint bug report.
- Frontend (layer 5) is next in roadmap order — not started.
- Telegram alerting layer (layer 6) not started; backend's `/watch`
  endpoint already stores an initial verdict but nothing re-checks it on a
  schedule or sends a message on change yet.
- MCP layer (layer 7) — stretch goal, not started.
