import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInitial, buildShareUrl, telegramWatchUrl } from "./url.js";

test("parseInitial reads a shared link", () => {
  assert.deepEqual(parseInitial("?token=0xabc&network=1"), { token: "0xabc", network: "1" });
  assert.deepEqual(parseInitial(""), { token: "", network: "" });
  assert.deepEqual(parseInitial(undefined), { token: "", network: "" });
});

test("buildShareUrl replaces any old query and only adds network when known", () => {
  assert.equal(buildShareUrl("https://x.app/?old=1#h", "0xabc", "1"), "https://x.app/?token=0xabc&network=1");
  assert.equal(buildShareUrl("https://x.app/", "0xabc", ""), "https://x.app/?token=0xabc");
});

const PEPE = "0x6982508145454ce325ddbe47a25d4ec3d2311933";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

test("telegramWatchUrl builds a start link the bot understands", () => {
  assert.equal(telegramWatchUrl("tokenlens_bot", 1, PEPE), `https://t.me/tokenlens_bot?start=w_1_${PEPE}`);
  assert.equal(telegramWatchUrl("@tokenlens_bot", "16", BONK), `https://t.me/tokenlens_bot?start=w_16_${BONK}`);
});

test("telegramWatchUrl stays under Telegram's 64 character limit for real addresses", () => {
  for (const [net, addr] of [[1, PEPE], [199, PEPE], [16, BONK], [8453, BONK]]) {
    const url = telegramWatchUrl("tokenlens_bot", net, addr);
    assert.ok(url, `${net}`);
    assert.ok(url.split("start=")[1].length <= 64);
  }
});

test("telegramWatchUrl works for the simulated demo token's network", () => {
  const SIM = "0x0d3a0d3a0d3a0d3a0d3a0d3a0d3a0d3a0d3a0d3a";
  assert.equal(telegramWatchUrl("tokenlens_bot", 9999, SIM), `https://t.me/tokenlens_bot?start=w_9999_${SIM}`);
});

test("telegramWatchUrl gives nothing when the link couldn't work", () => {
  assert.equal(telegramWatchUrl("tokenlens_bot", null, PEPE), null);
  assert.equal(telegramWatchUrl("tokenlens_bot", undefined, PEPE), null);
  assert.equal(telegramWatchUrl("tokenlens_bot", "abc", PEPE), null);
  assert.equal(telegramWatchUrl("tokenlens_bot", 1, "not an address"), null);
  assert.equal(telegramWatchUrl("tokenlens_bot", 1, "x".repeat(70)), null); // payload too long
  assert.equal(telegramWatchUrl("", 1, PEPE), null);
});
