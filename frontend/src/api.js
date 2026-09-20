// The TokenLens backend. Override with VITE_API_URL (see .env.example).
export const API_URL = (
  import.meta.env?.VITE_API_URL || "https://tokenlens-sxdq.onrender.com"
).replace(/\/+$/, "");

// The free host sleeps when idle; a cold start can take close to a minute.
export const REQUEST_TIMEOUT_MS = 90000;

// Same shape the server accepts: EVM (0x + 40 hex) and Solana (base58) addresses.
const ADDRESS_RE = /^[A-Za-z0-9]{20,70}$/;

export class CheckError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = "CheckError";
    this.kind = kind; // "aborted" | "timeout" | "network" | "server"
  }
}

export function normalizeAddress(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "");
}

// Returns a plain-language problem, or null when the address looks fine.
export function validateAddress(address) {
  if (!ADDRESS_RE.test(address)) {
    return "That doesn't look like a token contract address. Paste the full address (on most networks it starts with 0x).";
  }
  return null;
}

function withTimeout(signal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return { controller, done: () => clearTimeout(timer) };
}

/**
 * Asks the backend for a verdict. Resolves to the /check response body, or
 * throws a CheckError whose message is safe to show to the user.
 */
export async function checkToken({
  address,
  networkId = "",
  signal,
  fetchImpl = fetch,
  baseUrl = API_URL,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  const query = networkId ? `?networkId=${encodeURIComponent(networkId)}` : "";
  const url = `${baseUrl}/check/${encodeURIComponent(address)}${query}`;
  const { controller, done } = withTimeout(signal, timeoutMs);

  let res;
  try {
    res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } catch {
    if (signal?.aborted) throw new CheckError("aborted", "Cancelled.");
    if (controller.signal.aborted) {
      throw new CheckError("timeout", "The server took too long to answer. Try again in a moment.");
    }
    throw new CheckError("network", "Couldn't reach the server. Check your connection and try again.");
  } finally {
    done();
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    // handled below
  }

  if (!res.ok) {
    throw new CheckError("server", (body && body.error) || "The server had a problem. Try again in a moment.");
  }
  if (!body || typeof body.verdict !== "string") {
    throw new CheckError("server", "The server sent an answer we couldn't read. Try again in a moment.");
  }
  return body;
}

/** Adds a token to the server-side watchlist (alerts are not built yet). */
export async function watchToken({
  address,
  networkId,
  symbol,
  fetchImpl = fetch,
  baseUrl = API_URL,
}) {
  let res;
  try {
    res = await fetchImpl(`${baseUrl}/watch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ tokenAddress: address, networkId, symbol }),
    });
  } catch {
    throw new CheckError("network", "Couldn't reach the server. Check your connection and try again.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new CheckError("server", (body && body.error) || "Couldn't add that token to your watchlist.");
  }
  return body;
}
