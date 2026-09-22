/**
 * The TokenLens Telegram bot: turns messages into checks, watches and alerts.
 * All I/O is injected (telegram client, watchlist store, the check function),
 * so it can be tested without Telegram.
 */

const { generateVerdictCopy } = require("./copyGenerator");
const { isChatGone } = require("./telegram");
const { SIM_ALIAS, SIM_ADDRESS } = require("./simulation");

// EVM (0x + 40 hex) and Solana (base58) addresses both fit this.
const ADDRESS_RE = /^[A-Za-z0-9]{20,70}$/;

// Names people type, mapped to CoinMarketCap network ids (the ones with a full security scan).
const NETWORKS = {
  ethereum: 1, eth: 1,
  bsc: 14, bnb: 14, binance: 14,
  base: 199,
  arbitrum: 51, arb: 51,
  avalanche: 28, avax: 28,
  solana: 16, sol: 16,
};

const EMOJI = { red: "🔴", yellow: "🟡", green: "🟢", unknown: "⚪" };
const NAME = { red: "Red", yellow: "Yellow", green: "Green", unknown: "Grey" };

const DISCLAIMER = "Automated check, not financial advice.";

const HELP = [
  "TokenLens checks a token before you buy it. Send me a token's contract address and I'll tell you, in plain words, whether it looks risky.",
  "",
  "/check <address> [network]  check a token",
  "/watch <address> [network]  alert me if its verdict changes",
  "/list  tokens I'm watching",
  "/unwatch <number>  stop watching one",
  "/demo  see what an alert looks like",
  "",
  "Networks: ethereum, bsc, base, arbitrum, avalanche, solana. Leave it out and I'll find the token myself.",
].join("\n");

function shortAddress(address) {
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function parseNetwork(word) {
  if (word === undefined) return { networkId: undefined };
  const w = word.toLowerCase();
  if (/^\d{1,4}$/.test(w)) return { networkId: Number(w) };
  if (NETWORKS[w]) return { networkId: NETWORKS[w] };
  return { error: `I don't know the network "${word}". Try ethereum, bsc, base, arbitrum, avalanche or solana.` };
}

// "/check 0xabc solana" -> { address, networkId }, or { error }
function parseTokenArgs(args) {
  const [typed, network] = args;
  // "/watch demo" is shorthand for the simulated demo token.
  const address = typed && typed.toLowerCase() === SIM_ALIAS ? SIM_ADDRESS : typed;
  if (!address || !ADDRESS_RE.test(address)) {
    return { error: "Send me a token's full contract address, like /check 0x6982508145454ce325ddbe47a25d4ec3d2311933" };
  }
  const parsed = parseNetwork(network);
  if (parsed.error) return { error: parsed.error };
  return { address, networkId: parsed.networkId };
}

function createBot({
  telegram,
  store,
  check, // ({ tokenAddress, networkId }) -> { status, body }
  webAppUrl,
  limiter, // optional per-chat rate limiter
  intervalMinutes = 30,
  simulator, // optional: the simulated demo token
  ownerChatId, // the only chat allowed to change the simulated token
  runSimulationCycle, // () => re-checks only the simulated token's watchers
  logger = console,
}) {
  const seenUpdates = [];

  const webLink = (address, networkId) =>
    `${webAppUrl.replace(/\/+$/, "")}/?token=${encodeURIComponent(address)}${networkId ? `&network=${networkId}` : ""}`;

  const openButton = (address, networkId) => ({ text: "Open the full check", url: webLink(address, networkId) });

  const send = (chatId, text, opts) => telegram.sendMessage(chatId, text, opts);

  const isComplete = (body) => (body.dataSource === "dex" || body.dataSource === "simulation") && !body.degradedReason;

  const titleOf = (body, address) =>
    `${(body.data && body.data.symbol) || "Token"} on ${body.networkName || "an unknown network"} (${shortAddress(address)})`;

  async function runCheck(address, networkId) {
    const res = await check({ tokenAddress: address, networkId });
    if (res.status !== 200) return { error: (res.body && res.body.error) || "I couldn't check that right now. Please try again." };
    return { body: res.body };
  }

  async function doCheck(chatId, address, networkId) {
    const { body, error } = await runCheck(address, networkId);
    if (error) return send(chatId, error);
    const buttons = [[openButton(address, body.networkId)]];
    if (body.networkId) buttons.unshift([{ text: "Watch this token", callback_data: `w:${body.networkId}:${address}` }]);
    return send(chatId, `${titleOf(body, address)}\n\n${body.message}`, { buttons });
  }

  async function doWatch(chatId, address, networkId) {
    const { body, error } = await runCheck(address, networkId);
    if (error) return send(chatId, error);
    if (!body.networkId) {
      return send(chatId, "I couldn't find that token on any network I know. Please check the address and try again.");
    }

    const complete = isComplete(body);
    const outcome = store.add({
      chatId,
      networkId: body.networkId,
      address,
      symbol: (body.data && body.data.symbol) || null,
      networkName: body.networkName,
      verdict: complete ? body.verdict : null,
    });

    switch (outcome.result) {
      case "exists":
        return send(chatId, `You're already watching ${titleOf(body, address)}.`);
      case "user_limit":
        return send(chatId, `You're already watching ${store.maxPerUser} tokens, which is the most I can do per person. Stop one with /unwatch <number> (see /list).`);
      case "token_limit":
      case "total_limit":
        return send(chatId, "I'm watching as many different tokens as I can right now. Please try again later.");
      default: {
        const now = complete
          ? `Right now it's ${EMOJI[body.verdict]} ${NAME[body.verdict]}.`
          : "I couldn't complete every check just now, so I'll start alerting after the first full check.";
        const persistence = store.persistent ? "" : "\n\n(Heads-up: my watchlist isn't saved between restarts yet.)";
        return send(
          chatId,
          `Watching ${titleOf(body, address)}. ${now}\n\nI check every ${intervalMinutes} minutes and message you if the verdict changes.${persistence}`,
          { buttons: [[openButton(address, body.networkId)]] }
        );
      }
    }
  }

  function doList(chatId) {
    const mine = store.list(chatId);
    if (!mine.length) return send(chatId, "You're not watching anything yet. Send me a token address, then tap \"Watch this token\".");
    const lines = mine.map(
      (w, i) => `${i + 1}. ${EMOJI[w.lastVerdict] || "⏳"} ${w.symbol || "Token"} on ${w.networkName || `network ${w.networkId}`} (${shortAddress(w.address)})`
    );
    return send(chatId, `Tokens you're watching:\n\n${lines.join("\n")}\n\nStop one with /unwatch <number>.`);
  }

  function doUnwatch(chatId, args) {
    const ref = args[0];
    if (!ref) return send(chatId, "Tell me which one: /unwatch <number> (see /list).");
    const removed = store.remove(chatId, ref);
    if (!removed) return send(chatId, "I couldn't find that one. Check the number with /list.");
    return send(chatId, `Stopped watching ${removed.symbol || "that token"} on ${removed.networkName || `network ${removed.networkId}`}.`);
  }

  // Owner only: set the simulated token's state, then run the REAL re-check loop
  // for its watchers straight away, so the alert arrives through the normal path.
  async function doSimulate(chatId, args) {
    const wanted = (args[0] || "").toLowerCase();
    if (!wanted) {
      return send(chatId, `The simulated token is ${EMOJI[simulator.state]} ${NAME[simulator.state]} right now. Use /simulate green, yellow, red or unknown.`);
    }
    if (!simulator.set(wanted)) return send(chatId, "Use /simulate green, yellow, red or unknown.");
    await send(chatId, `Simulated token set to ${EMOJI[wanted]} ${NAME[wanted]}. Re-checking whoever watches it…`);
    const stats = await runSimulationCycle();
    if (stats && stats.skipped) {
      return send(chatId, "I was in the middle of a re-check. Send that again in a few seconds.");
    }
    return send(
      chatId,
      stats && stats.alerts
        ? `Done: ${stats.alerts} alert${stats.alerts === 1 ? "" : "s"} sent.`
        : "Done, but nobody's verdict changed, so there was no alert. (Watch it first with /watch demo.)"
    );
  }

  function doDemo(chatId) {
    const text = [
      "🧪 Sample alert. This is not a real token.",
      "",
      alertText({ symbol: "SAMPLE", networkName: "Ethereum" }, "green", {
        verdict: "red",
        reasons: ["This token can be bought but not sold — a honeypot."],
        caveats: [],
      }),
      "",
      "This is what you'll get when a token you watch changes.",
    ].join("\n");
    return send(chatId, text);
  }

  async function handleMessage(message) {
    if (!message.text || !message.chat || message.chat.type !== "private") return;
    const chatId = message.chat.id;

    if (limiter) {
      const hit = limiter.hit(String(chatId));
      if (!hit.allowed) return send(chatId, `You're going a bit fast. Please wait ${hit.retryAfterSec} seconds and try again.`);
    }

    const parts = message.text.trim().split(/\s+/);
    const isCommand = parts[0].startsWith("/");
    const command = isCommand ? parts[0].toLowerCase().replace(/@.*$/, "") : null;
    const args = isCommand ? parts.slice(1) : parts;

    // A bare address means "check this".
    if (!isCommand) {
      if (parts.length === 1 && ADDRESS_RE.test(parts[0])) return doCheck(chatId, parts[0], undefined);
      return send(chatId, "Send me a token's contract address and I'll check it, or /help to see what I can do.");
    }

    switch (command) {
      case "/start": {
        // Deep link from the web app: /start w_<networkId>_<address>
        const m = /^w_(\d{1,4})_([A-Za-z0-9]{20,70})$/.exec(args[0] || "");
        if (m) return doWatch(chatId, m[2], Number(m[1]));
        return send(chatId, HELP);
      }
      case "/help":
        return send(chatId, HELP);
      case "/check":
      case "/watch": {
        const parsed = parseTokenArgs(args);
        if (parsed.error) return send(chatId, parsed.error);
        return command === "/check" ? doCheck(chatId, parsed.address, parsed.networkId) : doWatch(chatId, parsed.address, parsed.networkId);
      }
      case "/list":
        return doList(chatId);
      case "/unwatch":
        return doUnwatch(chatId, args);
      case "/demo":
        return doDemo(chatId);
      case "/myid":
        return send(
          chatId,
          `Your chat ID is ${chatId}.` +
            (ownerChatId === undefined ? " To use the owner-only /simulate command, set TELEGRAM_OWNER_CHAT_ID to this number." : "")
        );
      case "/simulate":
        // To everyone else this command doesn't exist.
        if (simulator && runSimulationCycle && ownerChatId !== undefined && chatId === ownerChatId) return doSimulate(chatId, args);
        return send(chatId, "I don't know that command. Try /help.");
      default:
        return send(chatId, "I don't know that command. Try /help.");
    }
  }

  async function handleCallback(query) {
    const chatId = query.message && query.message.chat && query.message.chat.id;
    const m = /^w:(\d{1,4}):([A-Za-z0-9]{20,70})$/.exec(query.data || "");
    if (!chatId || !m) return telegram.answerCallbackQuery(query.id).catch(() => {});
    await telegram.answerCallbackQuery(query.id, "Adding to your watchlist…").catch(() => {});
    if (limiter && !limiter.hit(String(chatId)).allowed) return;
    return doWatch(chatId, m[2], Number(m[1]));
  }

  async function handleUpdate(update) {
    if (!update || typeof update.update_id !== "number") return;
    if (seenUpdates.includes(update.update_id)) return; // Telegram can re-deliver
    seenUpdates.push(update.update_id);
    if (seenUpdates.length > 200) seenUpdates.shift();

    try {
      if (update.message) await handleMessage(update.message);
      else if (update.callback_query) await handleCallback(update.callback_query);
    } catch (err) {
      logger.error(`bot: could not handle an update (${err.message})`);
      const chatId =
        (update.message && update.message.chat && update.message.chat.id) ||
        (update.callback_query && update.callback_query.message && update.callback_query.message.chat.id);
      if (chatId && !isChatGone(err)) await send(chatId, "Something went wrong on my side. Please try again in a moment.").catch(() => {});
    }
  }

  return { handleUpdate };
}

// "PEPE on Ethereum changed from Yellow to Red." plus the new verdict's full explanation.
function alertText(watch, oldVerdict, body) {
  const name = `${watch.symbol || "A token you watch"} on ${watch.networkName || "its network"}`;
  const copy = body.message || generateVerdictCopy({ verdict: body.verdict, reasons: body.reasons || [], caveats: body.caveats || [] });
  const simulated = body.simulated ? "🧪 Simulated demo token. Not real data.\n\n" : "";
  return `${simulated}🔔 ${name} changed from ${NAME[oldVerdict] || "Grey"} to ${NAME[body.verdict] || "Grey"}.\n\n${copy}`;
}

module.exports = { createBot, alertText, parseTokenArgs, parseNetwork, ADDRESS_RE, EMOJI, NAME, shortAddress };
