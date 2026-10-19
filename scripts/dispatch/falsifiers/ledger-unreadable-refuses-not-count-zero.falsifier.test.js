"use strict";
/**
 * FALSIFIER: ledger-unreadable-refuses-not-count-zero
 *
 * THE ATTACK: the fallback COUNT is the number the Seam-E arm decision rests on (the bar for arming the fence:
 * zero fallbacks, or every one explained from the ledger). If a read failure on the ledger collapsed to an EMPTY ledger (count 0), then:
 *   (a) a fallback against an unreadable-but-appendable ledger would proceed with a fabricated count of 0,
 *       and `report` would certify a clean "ZERO fallbacks" over a ledger it could not even read — the
 *       exact false-green the flip-trigger's honesty rests on; and
 *   (b) an unreadable ledger read on the SUCCESS
 *       path would THROW after the ref already moved, turning a landed write into a false failure.
 *
 * MUST HOLD: ENOENT (never written) is the ONLY "empty". A present-but-unreadable ledger (a) REFUSES the
 * fallback (fallback-unrecordable, security) and `report` surfaces UNREADABLE — never ZERO; and (b) the
 * informational success-path count read is SAFE — {count:null, unreadable:true}, never a throw, never a
 * fabricated 0.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dog = require("../broker-dogfood");

function unreadableLedger(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ledger-unreadable-${tag}-`));
  const logPath = path.join(dir, "dogfood-fallbacks.jsonl");
  fs.mkdirSync(logPath, { recursive: true });
  return { dir, logPath };
}

test("FALSIFIER MUST-BLOCK — an unreadable-but-present ledger REFUSES the fallback (never a count-0 bypass)", () => {
  const L = unreadableLedger("refuse");
  try {
    const rec = dog.recordFallback({ transport: "branch-merge", target_ref: "refs/heads/main", reason: "no-pinned-bundle-configured" }, { logPath: L.logPath });
    assert.strictEqual(rec.ok, false, "MUST-BLOCK: an unreadable ledger cannot be counted — recordFallback must fail");
    assert.match(String(rec.error), /ledger-unreadable/);
    const res = dog.attemptFallback({ reason: "no-pinned-bundle-configured", transport: "branch-merge", targetRef: "refs/heads/main", gitRoot: L.dir, logPath: L.logPath, emit: false });
    assert.strictEqual(res.ok, false, "MUST-BLOCK: the fallback must be refused, not performed with count 0");
    assert.strictEqual(res.reason, "fallback-unrecordable");
    assert.strictEqual(res.classification, "security");
  } finally {
    fs.rmSync(L.dir, { recursive: true, force: true });
  }
});

test("FALSIFIER MUST-BLOCK — report() surfaces UNREADABLE and NEVER certifies a clean ZERO", () => {
  const L = unreadableLedger("report");
  try {
    const rep = dog.report(L.logPath);
    assert.strictEqual(rep.unreadable, true, "MUST-BLOCK: an unreadable ledger must be flagged unreadable");
    assert.match(rep.text, /UNREADABLE/);
    assert.strictEqual(/ZERO fallbacks/.test(rep.text), false, "MUST-BLOCK: an unreadable ledger must NEVER read as a clean ZERO");
  } finally {
    fs.rmSync(L.dir, { recursive: true, force: true });
  }
});

test("FALSIFIER MUST-BLOCK — the informational success-path count read is SAFE (never throws, never a false zero)", () => {
  const L = unreadableLedger("safe");
  try {
    const safe = dog.fallbackCountSafe(L.logPath);
    assert.strictEqual(safe.count, null, "MUST-BLOCK: an unreadable ledger must NOT report a fabricated count of 0");
    assert.strictEqual(safe.unreadable, true);
    assert.throws(() => dog.fallbackCount(L.logPath), "the security-path count read must still throw on unreadable");
  } finally {
    fs.rmSync(L.dir, { recursive: true, force: true });
  }
});
