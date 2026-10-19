"use strict";
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { test } = require("node:test");
const assert = require("node:assert");

const dnr = require("./do-not-reopen");

function tmpRoot(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dnr-${tag}-`));
}

test("an unsettled decision reads as NOT settled", () => {
  const root = tmpRoot("unsettled");
  assert.strictEqual(dnr.isSettled("SP-A", "decision-1", { root }), false);
  assert.strictEqual(dnr.getDisposition("SP-A", "decision-1", { root }), null);
});

test("settle() records a disposition that reads as settled on a later (resumed) read", () => {
  const root = tmpRoot("settle");
  const r = dnr.settle("SP-B", "decision-1", { reason: "β ruled it out" }, { root });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(dnr.isSettled("SP-B", "decision-1", { root }), true);
  const disp = dnr.getDisposition("SP-B", "decision-1", { root });
  assert.strictEqual(disp.type, "settle");
  assert.strictEqual(disp.reason, "β ruled it out");
});

test("tryReopen WITHOUT supersede is REFUSED (advisory-only reversal is not enough, AC-F8)", () => {
  const root = tmpRoot("advisory");
  dnr.settle("SP-C", "decision-1", { reason: "locked" }, { root });
  const r1 = dnr.tryReopen("SP-C", "decision-1", { supersede: false }, { root });
  assert.strictEqual(r1.ok, false);
  assert.strictEqual(r1.reason, "supersession-required");
  const r2 = dnr.tryReopen("SP-C", "decision-1", {}, { root });
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(dnr.isSettled("SP-C", "decision-1", { root }), true);
  assert.strictEqual(dnr.history("SP-C", "decision-1", { root }).length, 1);
});

test("tryReopen WITH supersede:true appends an explicit supersession entry and succeeds", () => {
  const root = tmpRoot("supersede-via-tryreopen");
  dnr.settle("SP-D", "decision-1", { reason: "v1" }, { root });
  const r = dnr.tryReopen("SP-D", "decision-1", { supersede: true, newEntry: { reason: "v2 — explicitly revised" } }, { root });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.entry.type, "supersede");
  const hist = dnr.history("SP-D", "decision-1", { root });
  assert.strictEqual(hist.length, 2);
  assert.strictEqual(hist[0].type, "settle");
  assert.strictEqual(hist[1].type, "supersede");
  assert.strictEqual(hist[1].reason, "v2 — explicitly revised");
  assert.strictEqual(dnr.isSettled("SP-D", "decision-1", { root }), true);
});

test("supersede() is the explicit primitive callable directly (not only via tryReopen)", () => {
  const root = tmpRoot("direct-supersede");
  dnr.settle("SP-E", "decision-1", { reason: "v1" }, { root });
  const r = dnr.supersede("SP-E", "decision-1", { reason: "v2 direct" }, { root });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(dnr.getDisposition("SP-E", "decision-1", { root }).reason, "v2 direct");
});

test("reopening a decision that was never settled is a no-op success (nothing to protect)", () => {
  const root = tmpRoot("never-settled");
  const r = dnr.tryReopen("SP-F", "decision-never", { supersede: false }, { root });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, "not-previously-settled");
});

test("ledger is per-decisionId — settling one decision does not settle a sibling", () => {
  const root = tmpRoot("sibling");
  dnr.settle("SP-G", "decision-1", { reason: "x" }, { root });
  assert.strictEqual(dnr.isSettled("SP-G", "decision-2", { root }), false);
});

test("ledger is per-SP-id — same decisionId under a different spId is independent", () => {
  const root = tmpRoot("per-sp");
  dnr.settle("SP-H1", "decision-shared", { reason: "x" }, { root });
  assert.strictEqual(dnr.isSettled("SP-H2", "decision-shared", { root }), false);
});

test("ledger persists to a real jsonl file under root/do-not-reopen/<spId>.jsonl", () => {
  const root = tmpRoot("persist");
  dnr.settle("SP-I", "decision-1", { reason: "x" }, { root });
  const file = path.join(root, "do-not-reopen", "SP-I.jsonl");
  assert.ok(fs.existsSync(file));
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  assert.strictEqual(lines.length, 1);
  const parsed = JSON.parse(lines[0]);
  assert.strictEqual(parsed.type, "settle");
  assert.strictEqual(parsed.decisionId, "decision-1");
});
