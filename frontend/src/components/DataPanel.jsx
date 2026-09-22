import { useState } from "react";
import { buildRows } from "../format.js";

const MARKS = { good: "✓", bad: "✕", unknown: "?" };
const MARK_WORDS = { good: "Good:", bad: "Problem:", unknown: "Unknown:" };

function Rows({ rows }) {
  return (
    <dl className="rows">
      {rows.map((r) => (
        <div className="row" key={r.key}>
          <dt>{r.label}</dt>
          <dd className={`row__value row__value--${r.tone}`}>
            {MARKS[r.tone] && (
              <span className={`mark mark--${r.tone}`} aria-hidden="true">
                {MARKS[r.tone]}
              </span>
            )}
            <span className="row__text">
              {MARK_WORDS[r.tone] && <span className="sr">{MARK_WORDS[r.tone]} </span>}
              {r.value}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function DataPanel({ data, degradedReason, simulated }) {
  const [open, setOpen] = useState(false);
  const { market, safety } = buildRows(data || {});

  return (
    <section className="data column">
      <button
        type="button"
        className="disclose"
        aria-expanded={open}
        aria-controls="data-panel"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{open ? "Hide the data" : "See the data"}</span>
        <svg className="disclose__chev" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="M4 7.5l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div className="panel" id="data-panel" data-open={open}>
        <div className="panel__body">
          {simulated && <p className="panel__note">Simulated data. None of these numbers are real.</p>}
          <h3 className="group__title">Safety checks</h3>
          <Rows rows={safety} />
          <h3 className="group__title">The market</h3>
          <Rows rows={market} />
          {degradedReason && (
            <p className="panel__note">Some data couldn't be fetched: {degradedReason}</p>
          )}
        </div>
      </div>
    </section>
  );
}
