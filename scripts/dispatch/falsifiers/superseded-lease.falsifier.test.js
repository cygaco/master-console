"use strict";
// FALSIFIER: AC-F5 superseded-lease — record-trust gate, surface conductor-lease-at-acquire.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const MOD = path.join(ROOT, "scripts", "dispatch", "conductor-lease.js");

test("AC-F5 superseded-lease write MUST-BLOCK (fencing token < current holder)", (t) => {
  const lease = require(MOD);
  const spId = "SP-FALSIFIER-F5";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lease-superseded-"));
  const opts = { root: dir };
  const a1 = lease.acquire(spId, { ...opts, sessionId: "sess-1" });
  lease.release(spId, { ...opts, token: a1.token });
  const a2 = lease.acquire(spId, { ...opts, sessionId: "sess-2" });
  assert.ok(a2.token > a1.token, "fencing token must be monotonic (a2 > a1)");
  const accepted = lease.verifyToken(spId, a1.token, opts);
  assert.strictEqual(
    accepted,
    false,
    "MUST-BLOCK: a write under the superseded (lower) fencing token must be refused",
  );
});
