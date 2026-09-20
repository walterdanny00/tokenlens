// Headlines mirror the backend's copyGenerator.js so the page and the API
// agree. `kind` picks the glyph, which never relies on color alone.
const VERDICTS = {
  red: { headline: "Be careful with this one.", kind: "red" },
  yellow: { headline: "Proceed with caution.", kind: "yellow" },
  green: { headline: "No major red flags found.", kind: "green" },
  unknown: { headline: "Not enough data yet.", kind: "unknown" },
};

export function verdictInfo(verdict) {
  return VERDICTS[verdict] || VERDICTS.unknown;
}
