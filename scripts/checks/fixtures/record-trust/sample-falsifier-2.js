"use strict";

const test = require("node:test");
const assert = require("node:assert");

test("MUST-BLOCK: the sample guard refuses a cross-session HMAC trust anchor", () => {
  const guardBlocks = (scope, anchor) => scope === "cross-session" && /hmac/i.test(anchor);
  assert.strictEqual(guardBlocks("cross-session", "per-session HMAC"), true, "a cross-session HMAC anchor MUST be blocked");
  assert.strictEqual(guardBlocks("same-session", "per-session HMAC"), false, "same-session HMAC is allowed");
});
