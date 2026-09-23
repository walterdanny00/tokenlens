# TokenLens — DoraHacks submission kit

Everything to paste into the BUIDL form, the X post and the video, in one place.
Source of the rules: the official "Build with CMC: API Hackathon" page.

## Dates

| What | When |
|---|---|
| Submissions close | **Wed 30 Sep 2026, 23:59 UTC** |
| Judging | 1 to 16 Oct 2026 |
| Results | Mon 19 Oct 2026 |

Aim to submit by **Tue 29 Sep**, so a hiccup doesn't cost the entry.

## Required, and where we stand

- [ ] **Public repository.** The repo is private today. Check the API key was never
  committed, then make it public.
- [x] **Working demo or deployed link.** https://tokenlens-eight.vercel.app/
- [ ] **X post** linking the DoraHacks submission and the demo video, with
  **#BuildwithCMC** (draft below).
- [x] **CMC endpoints named explicitly** (below, and in the README).
- [ ] **Visible evidence of a real API call: code and response.** Commit the files
  in `docs/evidence/` (commands in the checklist below).
- [ ] **A short note on what the API made possible and where it got in the way**
  (draft below).
- [ ] **One track selected.** Recommended: **Markets and Trading Tools**
  (screeners, alert bots, scanners). TokenLens is a token scanner with an alert bot.
- [ ] **Registered on DoraHacks with the email on your CoinMarketCap account**, which
  is what upgrades your key to the free Startup tier during the event.
- [ ] Demo video recorded and uploaded.

Judging, out of 100: Does it work 30, Usefulness to a real person 25, Interesting
use of the API 20, Code quality and documentation 15, Presentation 10.

Do not commit the API key. The rules say it counts against code quality, and you'd
be asked to rotate it.

## Project name and tagline

**TokenLens**

Check a token before you buy it: a plain-language safety verdict, with Telegram
alerts.

## Links

- Web app: https://tokenlens-eight.vercel.app/
- API: https://tokenlens-sxdq.onrender.com (`/health`, `/check/:tokenAddress`)
- Telegram bot: https://t.me/tokenlens_bot
- Code: https://github.com/walterdanny00/tokenlens
- Demo video: _add the link once it is uploaded_

## Short description (about 150 words)

TokenLens turns a token's contract address into a plain-language safety verdict, for
people who can't read liquidity depth or holder concentration. Paste an address into
the web app or send it to the Telegram bot and get a red, yellow, green or grey answer
with the reasons: can you sell it, can more coins be created, who controls it, and can
the money behind it be pulled. CoinMarketCap's DEX API finds the token across networks
and supplies liquidity, market cap, volume and age. GoPlus supplies the security scan.
Unknown is never treated as safe, and a green that couldn't verify something says so in
a caveat. Watch a token on Telegram and the bot re-checks it every 30 minutes and
messages you only when its verdict changes. The web app, API and bot are live, and the
code is open.

## Full description

### The problem

New tokens appear all day, and the risks that lose people money are hard to see:
tokens you can buy but not sell (honeypots), coins the creators can still mint without
limit, and liquidity that can be pulled at any time. Block explorers and dashboards show
the raw numbers. A casual trader can't tell what they mean.

### What it does

- **A verdict in one glance.** Red, yellow, green or grey, with the reasons in plain
  sentences and an expandable "See the data" section for the numbers behind it.
- **Any network.** Paste an address without choosing a chain. TokenLens finds the token
  across networks and checks the one with the deepest liquidity, and tells you when the
  same address exists elsewhere.
- **A bot that watches for you.** On Telegram, send an address for a verdict, or tap
  Watch. Watched tokens are re-checked every 30 minutes, and the bot messages you only
  when a full check changes the verdict.

### How it uses CoinMarketCap's API

| Endpoint | What it does for TokenLens |
|---|---|
| `GET /v1/dex/search?q=<address>` (DEX API) | Finds the token by contract address on every network at once, and returns its network, liquidity, market cap, 24h volume, price and first-pool timestamps. Called for every check |
| `GET /v1/cryptocurrency/quotes/latest?symbol=` | A degraded fallback if the DEX search fails, so the API still answers (capped at yellow) |
| `GET /v1/dex/platform/list` | Maps CoinMarketCap's network IDs to real chain IDs, which is how a token's network is matched to the right security scan. Used to build and verify the mapping |

We also tried `/v1/dex/token` and `/v1/dex/security/detail`; both respond correctly
with the documented parameters, and a CMC security second opinion is the next step.
Worth noting: CMC's own security endpoint doesn't close the Solana honeypot gap either
— its `solanaDisplay.rugPullStatus`/`fakeTokenStatus` came back "Unknown" even for
BONK, a large, multi-year-established token. Neither provider runs an actual trade
simulation on Solana; both only report authority flags and static tax rates.

### Design choices that matter

- **Unknown is never safe.** Every security field is true, false or unknown. If a scan is
  unavailable the verdict is capped at yellow. Two different kinds of unknown are treated
  differently: a specific token's check that was attempted but came back empty is always
  a yellow reason, never excused; a check the data source doesn't run on that chain AT ALL
  (e.g. no honeypot simulator on Solana) can be disclosed as a caveat instead — but only
  once the token clears a strict bar of other evidence.
- **A green never hides its limits.** Tokens with most liquidity in concentrated pools
  can't have a classic liquidity lock verified, and Solana tokens can't have sellability
  verified at all (no honeypot data exists there from any provider we found). An old,
  liquid, widely held token with clean mint and ownership can still be green, with each
  gap disclosed as its own caveat — a token can carry more than one. A known-bad result
  is never excused this way, for either gap.
- **No false alarms.** If a data source hiccups, the answer is partial. The alert loop
  skips it rather than raising an alarm, and another when it recovers.
- **Built to stay open.** Answer cache, per-visitor rate limit and a lookup budget protect
  the CoinMarketCap credits behind a public API.

### Evidence of real API calls

The exact code is in `ingestion.js` (`fetchDexRecord`), and real responses are committed
in `docs/evidence/`:

```js
const res = await fetchImpl(
  `${BASE_URL}/v1/dex/search?q=${encodeURIComponent(searchTerm)}`,
  { headers: authHeaders(apiKey), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
);
```

- `docs/evidence/cmc-dex-search-pepe.json` is the CoinMarketCap search response for
  PEPE's address, trimmed to the matching tokens (the API key is a header and never
  appears in it).
- `docs/evidence/tokenlens-check-pepe.json` is what TokenLens's own API returned for the
  same token.

Excerpt of a real result, showing the same address on several networks:

```json
{ "s": "PEPE", "plt": "Ethereum",   "addr": "0x6982508145454ce325ddbe47a25d4ec3d2311933", "liq": 32567734.37 }
{ "s": "PEPE", "plt": "PulseChain", "addr": "0x6982508145454ce325ddbe47a25d4ec3d2311933", "liq": 5321.61 }
```

### What the API made possible, and where it got in the way

**Made possible.** A single search by contract address returns the token on every
network with liquidity, market cap, volume, price and first-pool times. That is what
lets TokenLens take just an address, with no chain picker and no per-chain
integration. Each call reports its credit cost (`credit_count`, 1 per search), which made
it easy to budget a public service.

**In the way.**

- **The search parameter.** CoinMarketCap's own reference documents it as `q`, but the
  informal agent-facing docs say `keyword`. `keyword` is silently ignored and returns an
  unrelated default list with no error, so address lookups looked "successful" while
  finding nothing. It cost us most of a working session.
- **Generic 400s.** `/v1/dex/security/detail` and `/v1/dex/holders/list` answered with a
  plain `BAD_REQUEST` for the parameter names we guessed, with no hint of which
  parameter was wrong. The documented `platformName` and `address` worked for
  `security/detail`; we did not get `holders/list` working.
- **Data gaps for security decisions.** In the token detail we sampled, the holder count
  was 0 for PEPE and the pool locked and burned rates were empty, so we needed a second
  source (GoPlus) for holders and liquidity locks.
- **"Age".** `fpt` (first price time) said February 2025 for PEPE, while its first pool
  (`fpct`) dates from April 2023. We use the earliest timestamp available.
- **Budgeting shared credits.** Our key is on the free Basic plan (15,000 credits a
  month, about 480/day). A public site with no login could burn through that from
  traffic alone, so we added a daily cap well under the average, leaving headroom for
  both visitor checks and the alert bot's re-checks.

### Try it in 60 seconds

1. Open https://tokenlens-eight.vercel.app/ and tap **PEPE on Ethereum**: yellow, with the
   reason (liquidity isn't locked).
2. Tap **BONK on Solana**: green, with two caveats about what couldn't be verified —
   liquidity lock and sellability, disclosed independently.
3. Tap **Watch on Telegram**, press Start, and the bot begins watching.
4. In the bot, send `/watch demo` then (owner only) `/simulate red` to see a real
   alert fire through the real code, using a clearly labelled simulated token.
   `/demo` sends a text-only sample without watching anything.

### Honest limits

Automated checks can't promise a token is safe, and TokenLens says so on every result.
No honeypot/sellability data exists for Solana from GoPlus or CMC, so that line reads
"Not checked" there for every Solana token, and a green result discloses it as its own
caveat rather than implying it was confirmed. Alerts run every 30 minutes, not instantly,
and only for verdict changes.

### What's next

CoinMarketCap's own security endpoint as a second opinion next to GoPlus, a lock signal
for Solana pools, and an MCP tool so an AI agent can ask for a verdict.

## X post (draft)

> Built TokenLens for #BuildwithCMC: paste a token's contract address, get a
> plain-language safety verdict. Can you sell it? Can more coins be created? Can the
> liquidity be pulled? Powered by @CoinMarketCap's DEX API, with Telegram alerts.
>
> Try it: https://tokenlens-eight.vercel.app
> Submission: <DoraHacks link>

Attach the demo video to the post itself. The rules want the post to link your
DoraHacks submission and the video.

## Demo video script (about 2 minutes 30)

Record the phone screen for the web app and Telegram, and a terminal for the API call.
Keep the API key and the bot token off screen.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Web app home | "Every day people buy tokens they can't judge: ones you can't sell, ones that can be minted without limit, ones whose liquidity can vanish. TokenLens tells you in plain words." |
| 0:12 | Tap PEPE on Ethereum, yellow band | "Paste an address, no chain to pick. PEPE comes back yellow, and it says why: the liquidity isn't locked." |
| 0:30 | Open "See the data" | "Behind the verdict, every number, and anything unknown is shown as unknown, never as safe." |
| 0:45 | Tap BONK on Solana, green with two caveats | "BONK is green, but look at these two notes: its liquidity lock can't be verified, and neither can whether it's sellable at all — no honeypot data exists for Solana anywhere. Green never hides what it couldn't check, and it can carry more than one gap." |
| 1:10 | Terminal: the real CoinMarketCap search call and response | "Underneath is CoinMarketCap's DEX API: one search by address finds the token on every network, with liquidity, market cap, volume and age." |
| 1:30 | Web app: tap Watch on Telegram, then Start in the bot | "Tap Watch and the Telegram bot starts watching this token." |
| 1:45 | In the bot: `/watch demo`, then `/simulate red` | "Real tokens don't flip on cue for a demo, so here's a clearly labelled simulated token — same scoring rules, same alert code, just made-up data. Watch it, flip it, and..." |
| 1:55 | The alert arrives, marked 🧪 Simulated | "...there's the real alert, through the real alert loop." |
| 2:05 | Architecture (README diagram) or the repo | "CoinMarketCap for the market data, GoPlus for the security scan, and safeguards so a public API doesn't burn credits." |
| 2:20 | Web app home again | "TokenLens. Check a token before you buy it. Live now, and open source." |

## Credit budget

Checked via `GET /v1/key/info` (costs no credits): our key is the free **Basic** plan,
15,000 credits/month, resetting on the 1st. No Startup-tier upgrade was ever applied, so
there's no "after the event" cliff to plan around — these are just the standing limits,
set in Render's Environment:

| Variable | Value | Why |
|---|---|---|
| `MAX_LOOKUPS_PER_DAY` | `400` | Under the ~480/day average the monthly allowance implies, so a traffic burst can't exhaust it before judging ends |
| `MAX_WATCHED_TOKENS` | `5` | Caps the alert bot's recurring re-check cost — 5 tokens every 30 min ≈ 240 credits/day, leaving ≈160/day for visitor checks |
| `WATCH_INTERVAL_MINUTES` | left at the default (30) | The daily cap already protects the budget, so alerts can stay fast without a separate slowdown |

The simulated demo token (`/watch demo`, `/simulate`) never touches CoinMarketCap or
GoPlus, so rehearsing or recording the alert flow costs nothing against this budget.
