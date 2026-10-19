"use strict";
// FALSIFIER: AC-F7 simultaneous-lease-race — record-trust gate, surface conductor-lease-at-acquire.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const MOD = path.join(ROOT, "scripts", "dispatch", "conductor-lease.js");

test("AC-F7 simultaneous acquire of the same SP-id yields exactly ONE holder (second MUST-BLOCK)", (t) => {
  const lease = require(MOD);
  const spId = "SP-FALSIFIER-F7";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lease-race-"));
  const opts = { root: dir };
  const a = lease.acquire(spId, { ...opts, sessionId: "sess-A" });
  const b = lease.acquire(spId, { ...opts, sessionId: "sess-B" });
  const winners = [a, b].filter((r) => r && r.ok === true);
  assert.strictEqual(
    winners.length,
    1,
    "MUST-BLOCK: exactly one session may hold the SP-id lease; the second acquire must cleanly fail (no double-hold)",
  );
});
