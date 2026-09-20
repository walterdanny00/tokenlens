import { test } from "node:test";
import assert from "node:assert/strict";
import { checkToken, normalizeAddress, validateAddress, watchToken, CheckError } from "./api.js";

const PEPE = "0x6982508145454ce325ddbe47a25d4ec3d2311933";
const okBody = { verdict: "yellow", reasons: ["x"], data: {} };
const respond = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("normalizeAddress trims whitespace and stray quotes", () => {
  assert.equal(normalizeAddress(`  "${PEPE}"\n`), PEPE);
  assert.equal(normalizeAddress(null), "");
});

test("validateAddress accepts EVM and Solana addresses and rejects junk", () => {
  assert.equal(validateAddress(PEPE), null);
  assert.equal(validateAddress("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"), null);
  assert.match(validateAddress("PEPE"), /doesn't look like/);
  assert.match(validateAddress(""), /doesn't look like/);
  assert.match(validateAddress("0x123 456"), /doesn't look like/);
});

test("checkToken builds the URL, with and without a network", async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => { seen.push([url, opts]); return respond(200, okBody)(); };
  await checkToken({ address: PEPE, fetchImpl, baseUrl: "https://api.test" });
  await checkToken({ address: PEPE, networkId: "1", fetchImpl, baseUrl: "https://api.test" });
  assert.equal(seen[0][0], `https://api.test/check/${PEPE}`);
  assert.equal(seen[1][0], `https://api.test/check/${PEPE}?networkId=1`);
  assert.ok(seen[0][1].signal);
});

test("checkToken returns the body on success", async () => {
  const body = await checkToken({ address: PEPE, fetchImpl: respond(200, okBody), baseUrl: "https://api.test" });
  assert.equal(body.verdict, "yellow");
});

test("server errors surface the server's own plain message", async () => {
  await assert.rejects(
    checkToken({ address: PEPE, fetchImpl: respond(400, { error: "networkId must be a number." }), baseUrl: "https://api.test" }),
    (e) => e instanceof CheckError && e.kind === "server" && e.message === "networkId must be a number."
  );
  await assert.rejects(
    checkToken({ address: PEPE, fetchImpl: respond(500, null), baseUrl: "https://api.test" }),
    (e) => e.kind === "server" && /had a problem/.test(e.message)
  );
});

test("an answer without a verdict is rejected", async () => {
  await assert.rejects(
    checkToken({ address: PEPE, fetchImpl: respond(200, { hello: 1 }), baseUrl: "https://api.test" }),
    (e) => e.kind === "server" && /couldn't read/.test(e.message)
  );
});

test("network failures become a friendly message", async () => {
  const fetchImpl = async () => { throw new TypeError("fetch failed"); };
  await assert.rejects(
    checkToken({ address: PEPE, fetchImpl, baseUrl: "https://api.test" }),
    (e) => e.kind === "network" && /Couldn't reach the server/.test(e.message)
  );
});

test("a slow server times out", async () => {
  const fetchImpl = (url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  await assert.rejects(
    checkToken({ address: PEPE, fetchImpl, baseUrl: "https://api.test", timeoutMs: 20 }),
    (e) => e.kind === "timeout"
  );
});

test("caller-initiated abort is reported as aborted, not as an error to show", async () => {
  const controller = new AbortController();
  const fetchImpl = (url, { signal }) =>
    new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const pending = checkToken({ address: PEPE, fetchImpl, baseUrl: "https://api.test", signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (e) => e.kind === "aborted");
});

test("watchToken posts the token and reports failures plainly", async () => {
  let sent;
  const ok = async (url, opts) => { sent = [url, JSON.parse(opts.body), opts.method]; return { ok: true, json: async () => ({ watching: true }) }; };
  assert.deepEqual(await watchToken({ address: PEPE, networkId: 1, symbol: "PEPE", fetchImpl: ok, baseUrl: "https://api.test" }), { watching: true });
  assert.deepEqual(sent, ["https://api.test/watch", { tokenAddress: PEPE, networkId: 1, symbol: "PEPE" }, "POST"]);
  await assert.rejects(
    watchToken({ address: PEPE, networkId: 1, fetchImpl: respond(400, { error: "nope" }), baseUrl: "https://api.test" }),
    (e) => e.message === "nope"
  );
});
