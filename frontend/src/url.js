// Shareable links look like  https://site/?token=<address>&network=<id>

export function parseInitial(search) {
  const params = new URLSearchParams(search || "");
  return {
    token: (params.get("token") || "").trim(),
    network: (params.get("network") || "").trim(),
  };
}

// Telegram allows up to 64 characters (letters, digits, _ and -) in a start link.
const START_PAYLOAD_MAX = 64;

/**
 * A link that opens the TokenLens bot and starts watching this token:
 * https://t.me/<bot>?start=w_<networkId>_<address>
 * Returns null when there's no network yet or the payload wouldn't be valid.
 */
export function telegramWatchUrl(bot, networkId, address) {
  const name = String(bot || "").replace(/^@/, "");
  if (!name || !/^\d{1,4}$/.test(String(networkId ?? ""))) return null;
  if (!/^[A-Za-z0-9]{20,70}$/.test(String(address || ""))) return null;
  const payload = `w_${networkId}_${address}`;
  if (payload.length > START_PAYLOAD_MAX) return null;
  return `https://t.me/${name}?start=${payload}`;
}

export function buildShareUrl(pageUrl, address, network) {
  const url = new URL(pageUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set("token", address);
  if (network) url.searchParams.set("network", String(network));
  return url.toString();
}
