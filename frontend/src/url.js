// Shareable links look like  https://site/?token=<address>&network=<id>

export function parseInitial(search) {
  const params = new URLSearchParams(search || "");
  return {
    token: (params.get("token") || "").trim(),
    network: (params.get("network") || "").trim(),
  };
}

export function buildShareUrl(pageUrl, address, network) {
  const url = new URL(pageUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set("token", address);
  if (network) url.searchParams.set("network", String(network));
  return url.toString();
}
