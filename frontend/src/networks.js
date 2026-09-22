// Networks the backend can run a full security scan on. `id` is CoinMarketCap's
// network id, which is what /check?networkId= expects. "" means auto-detect.
export const NETWORKS = [
  { id: "", label: "Auto-detect" },
  { id: "1", label: "Ethereum" },
  { id: "14", label: "BNB Chain" },
  { id: "199", label: "Base" },
  { id: "51", label: "Arbitrum" },
  { id: "28", label: "Avalanche" },
  { id: "16", label: "Solana" },
];

// Known-good tokens so a first-time visitor can see a result in one tap.
export const EXAMPLES = [
  {
    label: "PEPE on Ethereum",
    address: "0x6982508145454ce325ddbe47a25d4ec3d2311933",
    network: "1",
  },
  {
    label: "BONK on Solana",
    address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    network: "16",
  },
  // A clearly labelled fake token, used to demonstrate alerts. Not real data.
  {
    label: "Simulated demo token",
    address: "0x0d3a0d3a0d3a0d3a0d3a0d3a0d3a0d3a0d3a0d3a",
    network: "",
  },
];
