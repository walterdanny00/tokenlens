/**
 * The re-check loop: every few minutes, look at each watched token once and
 * message the people watching it when its verdict changes.
 *
 * Only complete checks count. If a data source hiccups, the answer is partial
 * (and usually a worse-looking YELLOW), so we skip that token this round rather
 * than raise a false alarm and another one when it recovers.
 */

const { alertText } = require("./bot");
const { isChatGone } = require("./telegram");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createWatcher({
  store,
  check, // ({ tokenAddress, networkId }) -> { status, body }
  telegram,
  webAppUrl,
  intervalMs = 30 * 60 * 1000,
  spacingMs = 1500, // pause between tokens, to stay gentle with CoinMarketCap's rate limit
  sleepImpl = sleep,
  logger = console,
}) {
  let running = false;
  let timer = null;

  const link = (address, networkId) =>
    `${webAppUrl.replace(/\/+$/, "")}/?token=${encodeURIComponent(address)}&network=${networkId}`;

  async function notify(watch, oldVerdict, body) {
    try {
      await telegram.sendMessage(watch.chatId, alertText(watch, oldVerdict, body), {
        buttons: [[{ text: "Open the full check", url: link(watch.address, watch.networkId) }]],
      });
      return true;
    } catch (err) {
      if (isChatGone(err)) {
        store.removeChat(watch.chatId); // they blocked the bot: stop trying
        logger.log(`watcher: removed the watches of a chat that can't be reached`);
      } else {
        logger.error(`watcher: could not send an alert (${err.message})`);
      }
      return false;
    }
  }

  /**
   * One pass over every watched token (or only those `only(token)` accepts).
   * Returns counts, mainly for tests.
   */
  async function runCycle({ only } = {}) {
    if (running) return { skipped: true };
    running = true;
    const stats = { checked: 0, skipped: 0, alerts: 0 };
    try {
      const tokens = store.tokens().filter((t) => (only ? only(t) : true));
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (i > 0) await sleepImpl(spacingMs);
        let res;
        try {
          res = await check({ tokenAddress: token.address, networkId: token.networkId });
        } catch (err) {
          logger.error(`watcher: check failed (${err.message})`);
          stats.skipped++;
          continue;
        }
        const body = res && res.body;
        const complete = body && (body.dataSource === "dex" || body.dataSource === "simulation");
        if (!res || res.status !== 200 || !body || body.degradedReason || !complete) {
          stats.skipped++; // partial or failed: don't compare
          continue;
        }
        stats.checked++;

        for (const watch of store.watchersOf(token.networkId, token.address)) {
          const old = watch.lastVerdict;
          if (old === body.verdict) continue; // nothing changed: nothing to save either
          store.setVerdict(watch, body.verdict);
          if (old) {
            // A new verdict: tell them. (No old verdict means this was the first full check.)
            if (await notify(watch, old, body)) stats.alerts++;
          }
        }
      }
      await store.persistIfNeeded();
    } catch (err) {
      logger.error(`watcher: cycle failed (${err.message})`);
    } finally {
      running = false;
    }
    return stats;
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => runCycle().catch((e) => logger.error(`watcher: ${e.message}`)), intervalMs);
    if (timer.unref) timer.unref(); // don't keep the process alive just for this
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { runCycle, start, stop };
}

module.exports = { createWatcher };
