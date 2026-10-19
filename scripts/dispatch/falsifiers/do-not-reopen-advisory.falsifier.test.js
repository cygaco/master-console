"use strict";
// FALSIFIER: AC-F8 do-not-reopen-advisory-only — record-trust gate, surface do-not-reopen-at-resume.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const MOD = path.join(ROOT, "scripts", "dispatch", "do-not-reopen.js");

test("AC-F8 reversing a settled disposition without supersession MUST-BLOCK", (t) => {
  const dnr = require(MOD);
  const spId = "SP-FALSIFIER-F8";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dnr-settled-"));
  const opts = { root: dir };
  const decisionId = "falsifier-settled-decision";
  dnr.settle(spId, decisionId, { reason: "settled by the falsifier fixture" }, opts);
  assert.strictEqual(
    dnr.isSettled(spId, decisionId, opts),
    true,
    "the disposition must read as SETTLED on resume (surfaced, not silently reopenable)",
  );
  assert.strictEqual(typeof dnr.tryReopen, "function", "MUST-BLOCK: do-not-reopen must expose tryReopen() — an absent reopen API is a fail-open");
  const reversed = dnr.tryReopen(spId, decisionId, { supersede: false }, opts);
  assert.strictEqual(
    reversed.ok,
    false,
    "MUST-BLOCK: a settled disposition cannot be reopened without an explicit supersession entry (advisory-only is refused)",
  );
});
