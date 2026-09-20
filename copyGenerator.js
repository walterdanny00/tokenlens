/**
 * TokenLens verdict copy generator.
 * Takes { verdict, reasons, caveats? } from scoring.js and builds the
 * plain-language paragraph a real, non-technical user sees. Templated, not
 * free-generated, so the tone and structure are always consistent and testable.
 */

const HEADERS = {
  red: "\uD83D\uDD34 Be careful with this one.",
  yellow: "\uD83D\uDFE1 Proceed with caution.",
  green: "\uD83D\uDFE2 No major red flags found.",
  unknown: "\u26AA Not enough data yet.",
};

const DISCLAIMER = "This is an automated check, not financial advice.";

function generateVerdictCopy({ verdict, reasons, caveats = [] }) {
  const header = HEADERS[verdict] || HEADERS.unknown;
  const body = reasons.join(" ");
  const notes = caveats.join(" ");
  return [header, body, notes, DISCLAIMER].filter(Boolean).join(" ").trim();
}

module.exports = { generateVerdictCopy };
