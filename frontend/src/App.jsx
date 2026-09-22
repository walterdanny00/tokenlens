import { useEffect, useRef, useState } from "react";
import { checkToken, normalizeAddress, validateAddress, CheckError } from "./api.js";
import { NETWORKS, EXAMPLES } from "./networks.js";
import { parseInitial, buildShareUrl } from "./url.js";
import { shortAddress } from "./format.js";
import { verdictInfo } from "./verdict.js";
import Lens from "./components/Lens.jsx";
import VerdictBand from "./components/VerdictBand.jsx";
import DataPanel from "./components/DataPanel.jsx";

// After this long we tell the visitor the free server is waking up.
const SLOW_AFTER_MS = 5000;

const pageUrl = () => window.location.origin + window.location.pathname;

export default function App() {
  const [initial] = useState(() =>
    parseInitial(typeof window === "undefined" ? "" : window.location.search)
  );
  const [address, setAddress] = useState(initial.token);
  const [network, setNetwork] = useState(initial.network);
  const [phase, setPhase] = useState("idle"); // idle | loading | done | error
  const [slow, setSlow] = useState(false);
  const [result, setResult] = useState(null);
  const [queried, setQueried] = useState(null);
  const [checks, setChecks] = useState(0);
  const [error, setError] = useState("");
  const [shareNote, setShareNote] = useState("");
  const abortRef = useRef(null);
  const headingRef = useRef(null);

  async function run(rawAddress, net) {
    const addr = normalizeAddress(rawAddress);
    const problem = validateAddress(addr);
    if (problem) {
      abortRef.current?.abort();
      setResult(null);
      setError(problem);
      setPhase("error");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("loading");
    setSlow(false);
    setError("");
    setShareNote("");
    const slowTimer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);

    try {
      const body = await checkToken({ address: addr, networkId: net, signal: controller.signal });
      if (controller.signal.aborted) return;
      setResult(body);
      setQueried({ address: addr, network: net });
      setChecks((n) => n + 1);
      setPhase("done");
      window.history.replaceState(
        null,
        "",
        buildShareUrl(pageUrl(), addr, String(body.networkId ?? net ?? ""))
      );
    } catch (err) {
      if (err instanceof CheckError && err.kind === "aborted") return;
      setResult(null);
      setError(err.message || "Something went wrong. Try again in a moment.");
      setPhase("error");
    } finally {
      clearTimeout(slowTimer);
    }
  }

  // A shared link (?token=...&network=...) runs its check on arrival.
  useEffect(() => {
    if (initial.token) run(initial.token, initial.network);
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move focus to the verdict so screen readers announce it and the page scrolls to it.
  useEffect(() => {
    if (phase === "done") headingRef.current?.focus();
  }, [phase, checks]);

  // Typing or pasting a new address invalidates whatever network was picked for
  // the last one (it's easy to leave a stale network selected, and a mismatch
  // silently reports "not found" instead of checking the right chain).
  function changeAddress(value) {
    setAddress(value);
    setNetwork("");
  }

  async function paste() {
    try {
      changeAddress(normalizeAddress(await navigator.clipboard.readText()));
    } catch {
      // Clipboard access was blocked; the visitor can still paste by hand.
    }
  }

  async function share() {
    if (!result || !queried) return;
    const url = buildShareUrl(pageUrl(), queried.address, String(result.networkId ?? queried.network ?? ""));
    const text = `${verdictInfo(result.verdict).headline} ${result.data?.symbol || ""} on ${result.networkName || "its network"}.`.replace(/\s+/g, " ");
    try {
      if (navigator.share) {
        await navigator.share({ title: "TokenLens check", text, url });
        setShareNote("Shared");
      } else {
        await navigator.clipboard.writeText(url);
        setShareNote("Link copied");
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
      setShareNote("Couldn't share. Copy the link from your address bar instead.");
    }
  }

  const canPaste = typeof navigator !== "undefined" && !!navigator.clipboard?.readText;
  const selectValue = NETWORKS.some((n) => n.id === network) ? network : "";
  const loading = phase === "loading";

  return (
    <>
      <header className="top column">
        <span className="brand">
          <Lens kind="mark" size={28} />
          TokenLens
        </span>
      </header>

      <main>
        <section className="finder column">
          <h1>Check a token before you buy it.</h1>
          <p className="finder__lede">
            Paste a token's contract address. We check whether you can sell it, whether more coins
            can be created, who controls it, and whether the money behind it can be pulled.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(address, network);
            }}
          >
            <label htmlFor="address">Token contract address</label>
            <div className="field">
              <input
                id="address"
                name="address"
                value={address}
                onChange={(e) => changeAddress(e.target.value)}
                placeholder="0x… or a Solana address"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              {canPaste && (
                <button type="button" className="field__paste" onClick={paste}>
                  Paste
                </button>
              )}
            </div>

            <div className="finder__row">
              <div className="select">
                <label htmlFor="network">Network</label>
                <select id="network" value={selectValue} onChange={(e) => setNetwork(e.target.value)}>
                  {NETWORKS.map((n) => (
                    <option key={n.id || "auto"} value={n.id}>
                      {n.label}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="go" disabled={loading}>
                {loading ? "Checking…" : "Check token"}
              </button>
            </div>
          </form>

          <div className="examples">
            <span>Not sure? Try</span>
            {EXAMPLES.map((ex) => (
              <button
                type="button"
                key={ex.address}
                disabled={loading}
                onClick={() => {
                  setAddress(ex.address);
                  setNetwork(ex.network);
                  run(ex.address, ex.network);
                }}
              >
                {ex.label}
              </button>
            ))}
          </div>
        </section>

        <div aria-live="polite">
          {loading && (
            <section className="band band--loading" role="status">
              <div className="band__inner">
                <Lens kind="loading" size={72} />
                <p className="band__headline">Checking {shortAddress(normalizeAddress(address))}…</p>
                {slow && (
                  <p className="band__note">
                    The server is waking up. It sleeps when nobody has used it for a while, so the
                    first check can take up to a minute.
                  </p>
                )}
              </div>
            </section>
          )}

          {phase === "error" && (
            <section className="column">
              <div className="notice" role="alert">
                <p className="notice__title">That check didn't work.</p>
                <p>{error}</p>
              </div>
            </section>
          )}

          {phase === "done" && result && (
            <VerdictBand
              key={checks}
              result={result}
              autoDetected={!queried?.network}
              headingRef={headingRef}
              onShare={share}
              shareNote={shareNote}
            />
          )}
        </div>

        {phase === "done" && result && (
          <DataPanel data={result.data} degradedReason={result.degradedReason} simulated={result.simulated === true} />
        )}
      </main>

      <footer className="foot column">
        <p>Market data from CoinMarketCap. Security data from GoPlus.</p>
        <p>TokenLens explains risks in plain words. It can't promise a token is safe.</p>
      </footer>
    </>
  );
}
