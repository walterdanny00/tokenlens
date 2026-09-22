/**
 * A clearly labelled SIMULATED token, for demos.
 *
 * Real tokens don't change verdict on cue, so this stand-in lets the owner show a
 * live alert honestly. It never touches CoinMarketCap or GoPlus: it produces a
 * made-up token record, and the REAL scoring, copy and alert code turns that
 * into a verdict, so a flip travels the same path a real change would.
 *
 * It is marked "simulated" everywhere it appears (network "Simulated", a caveat,
 * a 🧪 line on alerts) and only the owner can change its state.
 */

const SIM_ADDRESS = "0x0d3a0d3a0d3a0d3a0d3a0d3a0d3a0d3a0d3a0d3a";
const SIM_NETWORK_ID = 9999;
const SIM_ALIAS = "demo"; // "/watch demo" is shorthand for the address
const STATES = ["green", "yellow", "red", "unknown"];

const NOTE =
  "This is a simulated demo token, used to show how alerts work. It is not a real token and none of this is real data.";

const BASE = {
  source: "simulation",
  security_source: "simulation",
  simulated: true,
  address: SIM_ADDRESS,
  symbol: "DEMO",
  name: "Simulated demo token",
  network_id: SIM_NETWORK_ID,
  network_name: "Simulated",
  also_on_networks: [],
};

// A healthy token: every check answered and clean.
const HEALTHY = {
  ...BASE,
  security_scan_available: true,
  holder_data_available: true,
  is_honeypot: false,
  mint_function_active: false,
  ownership_renounced: true,
  liquidity_locked: true,
  liquidity_locked_pct: 100,
  liquidity_lock_days: null,
  concentrated_liquidity_pct: 0,
  top10_holder_pct: 18,
  holder_count: 42000,
  liquidity_usd: 1500000,
  market_cap: 20000000,
  volume_24h: 300000,
  price_usd: 0.0123,
  contract_age_hours: 24 * 400,
};

const RECORDS = {
  green: HEALTHY,
  yellow: { ...HEALTHY, liquidity_locked: false, liquidity_locked_pct: 0 },
  red: { ...HEALTHY, is_honeypot: true },
  unknown: {
    ...BASE,
    security_scan_available: false,
    holder_data_available: false,
    is_honeypot: null,
    mint_function_active: null,
    ownership_renounced: null,
    liquidity_locked: null,
    liquidity_usd: null,
    market_cap: null,
    volume_24h: null,
    price_usd: null,
    contract_age_hours: null,
    holder_count: null,
    top10_holder_pct: null,
  },
};

function createSimulator(initial = "green") {
  let state = STATES.includes(initial) ? initial : "green";
  return {
    address: SIM_ADDRESS,
    networkId: SIM_NETWORK_ID,
    note: NOTE,
    states: STATES,
    get state() {
      return state;
    },
    set(next) {
      if (!STATES.includes(next)) return false;
      state = next;
      return true;
    },
    isSimulated(address) {
      return String(address || "").toLowerCase() === SIM_ADDRESS;
    },
    record() {
      return { ...RECORDS[state] };
    },
  };
}

module.exports = { createSimulator, SIM_ADDRESS, SIM_NETWORK_ID, SIM_ALIAS, STATES, NOTE };
