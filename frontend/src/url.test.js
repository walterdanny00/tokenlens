import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInitial, buildShareUrl } from "./url.js";

test("parseInitial reads a shared link", () => {
  assert.deepEqual(parseInitial("?token=0xabc&network=1"), { token: "0xabc", network: "1" });
  assert.deepEqual(parseInitial(""), { token: "", network: "" });
  assert.deepEqual(parseInitial(undefined), { token: "", network: "" });
});

test("buildShareUrl replaces any old query and only adds network when known", () => {
  assert.equal(buildShareUrl("https://x.app/?old=1#h", "0xabc", "1"), "https://x.app/?token=0xabc&network=1");
  assert.equal(buildShareUrl("https://x.app/", "0xabc", ""), "https://x.app/?token=0xabc");
});
