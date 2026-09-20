// The lens: a ring with the verdict's mark inside. Marks differ by shape
// (check, exclamation, cross, question) so meaning never depends on color.
export default function Lens({ kind = "mark", size = 64 }) {
  return (
    <svg
      className={`lens lens--${kind}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="lens__ring" cx="32" cy="32" r="29" fill="none" stroke="currentColor" strokeWidth="3" />
      {kind === "loading" && (
        <circle
          className="lens__spin"
          cx="32"
          cy="32"
          r="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="22 104"
        />
      )}
      {kind !== "loading" && <circle cx="32" cy="32" r="22" fill="currentColor" opacity="0.14" />}
      <g fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round">
        {kind === "green" && <path d="M21 33.5l8 8 15-17" />}
        {kind === "yellow" && <path d="M32 19v16" />}
        {kind === "red" && <path d="M23 23l18 18M41 23L23 41" />}
        {kind === "unknown" && <path d="M25.5 26c0-3.8 2.8-6.5 6.5-6.5s6.5 2.7 6.5 6.2c0 5.2-6.5 5.2-6.5 11" />}
        {kind === "mark" && <circle cx="32" cy="32" r="9" strokeWidth="4" />}
      </g>
      {(kind === "yellow" || kind === "unknown") && <circle cx="32" cy="44.5" r="2.8" fill="currentColor" />}
    </svg>
  );
}
