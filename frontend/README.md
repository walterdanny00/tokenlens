# TokenLens frontend

One input, one verdict. Paste a token's contract address and get a
plain-language check: can you sell it, can more coins be created, who controls
it, and can the money behind it be pulled. Built with React and Vite.

It talks to the TokenLens backend (`/check/:tokenAddress`), which combines
CoinMarketCap DEX data with GoPlus security data.

## Run it

```
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests for the formatting and API client
npm run build    # production build in dist/
```

## Configuration

`VITE_API_URL` sets the backend URL (see `.env.example`). If unset it uses the
Render deployment.

## How it is put together

| File | Job |
|---|---|
| `src/App.jsx` | The page: form, loading, error and result states |
| `src/components/VerdictBand.jsx` | The verdict: a full-width color band with the reasons and any caveat |
| `src/components/DataPanel.jsx` | "See the data": the numbers behind the verdict |
| `src/api.js` | Calls the backend with a timeout and turns failures into plain messages |
| `src/format.js` | Turns the backend's `data` into readable rows. Unknown is always shown as unknown |
| `src/url.js` | Shareable links (`?token=...&network=...`) |

Notes:

- The verdict never relies on color alone: each state has its own shape and words.
- The free backend sleeps when idle; the page tells the visitor when the first
  check is waking it up.
- `watchToken` in `src/api.js` is ready for the alerts feature. There is no
  Watch button yet because alerts are not built.

## Deploy (Vercel)

Import the repository, set **Root Directory** to `frontend`, and keep the
detected Vite settings. `VITE_API_URL` is optional.
