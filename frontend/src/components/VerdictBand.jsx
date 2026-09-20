import Lens from "./Lens.jsx";
import { joinList, shortAddress } from "../format.js";
import { verdictInfo } from "../verdict.js";

export default function VerdictBand({
  result,
  autoDetected,
  headingRef,
  onShare,
  shareNote,
}) {
  const info = verdictInfo(result.verdict);
  const data = result.data || {};
  const caveats = result.caveats || [];
  const others = result.alsoOnNetworks || [];

  return (
    <section className={`band band--${info.kind}`} aria-labelledby="verdict-title">
      <div className="band__inner">
        <Lens kind={info.kind} size={72} />
        <h2 id="verdict-title" className="band__headline" tabIndex={-1} ref={headingRef}>
          {info.headline}
        </h2>

        <p className="band__who">
          {data.symbol && <span className="band__symbol">{data.symbol}</span>}
          {data.name && data.name !== data.symbol && <span className="band__name">{data.name}</span>}
          {result.networkName && <span className="chip">{result.networkName}</span>}
          <span className="band__addr" title={result.tokenAddress}>
            {shortAddress(result.tokenAddress)}
          </span>
        </p>

        <ul className="band__reasons">
          {result.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>

        {caveats.map((caveat) => (
          <p className="band__caveat" key={caveat}>
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M10 9v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="10" cy="6.2" r="1.2" fill="currentColor" />
            </svg>
            <span>{caveat}</span>
          </p>
        ))}

        {autoDetected && others.length > 0 && (
          <p className="band__note">
            This address also exists on {joinList(others)}. We checked {result.networkName}, the
            network with the most liquidity. Pick a network above to check another.
          </p>
        )}

        <div className="band__actions">
          <button type="button" className="band__share" onClick={onShare}>
            Share this check
          </button>
          <span className="band__shared" role="status">
            {shareNote}
          </span>
        </div>

        <p className="band__legal">This is an automated check, not financial advice.</p>
      </div>
    </section>
  );
}
