#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// epic-fold.test.js — S-LC-09. /epic:fold's backing logic (scripts/epic/fold.js)
// MUST: classify the incoming item (14-class taxonomy), append a PROVENANCE
// Change Log entry (date + source), be idempotent, and FLAG a conflict with a
// stable commitment WITHOUT silently overwriting Scope/Decisions.
//
// PLANTED VIOLATION (no false-green): a scope-reduction item that contradicts a
// stable commitment MUST be flagged (detectConflict reads NOT-ok), and the fold
// MUST NOT mutate the Scope frontmatter / Decisions section.
// ─────────────────────────────────────────────────────────────────────────────

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const { harness } = require(path.join(ROOT, "scripts", "checks", "lib", "fixture-harness"));
const plan = require(path.join(ROOT, "scripts", "epic", "plan.js"));
const fold = require(path.join(ROOT, "scripts", "epic", "fold.js"));

const h = harness("S-LC-09/epic-fold");

// A realistic fixture epic with a distinctive stable commitment ("funding probe")
// in both the frontmatter Scope and a ## Decisions entry.
function makeEpic() {
  return plan.buildEpic({
    epicId: "E-FOLD-001",
    slug: "fold-fixture",
    title: "Fold Fixture Epic",
    goal: "fixture for /epic:fold",
    background: "fixture",
    scope: "Build the provider-tier readiness engine and the funding probe.",
    outOfScope: "inferring funding from dispatch.",
    definitionOfDone: ["DoD — proven by X."],
    decisions: [{ date: "2026-06-08", text: "self-attestation default for funding detection" }],
    date: "2026-06-08",
    sessionId: "FIX",
    agent: "Alex",
  }).epic;
}

// ── classify covers the taxonomy + provenance is appended ─────────────────────
h.pass("classify: an explicit type wins; the heuristic is the fallback", () => {
  return (
    fold.classify({ text: "anything", type: "risk" }) === "risk" &&
    fold.classify({ text: "we must enforce this with a guard" }) === "enforcement-requirement"
  );
});

h.pass("clean scope-addition fold: provenance entry appended, no conflict", () => {
  const epic = makeEpic();
  const res = fold.foldIntoEpic(
    epic,
    { text: "add a CLI-latest-version readiness check", type: "scope-addition" },
    { source: "operator", date: "2026-06-09" },
  );
  return (
    res.ok === true &&
    res.conflict.conflict === false &&
    res.classification === "scope-addition" &&
    /## Change log[\s\S]*fold \(scope-addition\)/.test(res.updated) &&
    res.updated.includes("Provenance: 2026-06-09 · source: operator")
  );
});

// ── idempotency: folding the same item twice does not duplicate ───────────────
h.test("idempotent: re-folding the same item is a no-op (single marker)", () => {
  const epic = makeEpic();
  const item = { text: "add a CLI-latest-version readiness check", type: "scope-addition", source: "operator", date: "2026-06-09" };
  const r1 = fold.foldIntoEpic(epic, item);
  assert.ok(r1.ok && !r1.alreadyApplied, "first fold applies");
  const r2 = fold.foldIntoEpic(r1.updated, item);
  assert.ok(r2.ok && r2.alreadyApplied, "second fold is a no-op");
  const marker = r1.provenance.marker;
  assert.strictEqual(r1.updated.split(marker).length - 1, 1, "marker present exactly once");
  assert.strictEqual(r2.updated, r1.updated, "the no-op changes nothing");
});

// ── PLANTED VIOLATION: a conflicting scope-reduction MUST be flagged ──────────
h.violation("detectConflict: a scope-reduction contradicting a stable commitment is FLAGGED", () => {
  const epic = makeEpic();
  return fold.detectConflict(
    { text: "remove the funding probe entirely", type: "scope-reduction", conflictsWith: "funding probe" },
    epic,
  ); // { ok:false, conflict:true } → not-pass → caught
});

// ── conflict is flagged in the Change log but Scope/Decisions are untouched ────
h.test("conflict is FLAGGED in the Change log; Scope/Decisions are NOT silently overwritten", () => {
  const epic = makeEpic();
  const scopeLineBefore = epic.split(/\r?\n/).find((l) => /\*\*Scope:\*\*/.test(l));
  const res = fold.foldIntoEpic(
    epic,
    { text: "remove the funding probe entirely", type: "scope-reduction", conflictsWith: "funding probe" },
    { source: "operator", date: "2026-06-09" },
  );
  assert.ok(res.ok, "fold still records the item");
  assert.strictEqual(res.conflict.conflict, true, "conflict detected");
  assert.ok(/CONFLICT FLAGGED/.test(res.updated), "conflict is flagged in the Change log");
  assert.ok(res.requiresApproval, "conflicting/taste-heavy fold is flagged for approval");
  const scopeLineAfter = res.updated.split(/\r?\n/).find((l) => /\*\*Scope:\*\*/.test(l));
  assert.strictEqual(scopeLineAfter, scopeLineBefore, "Scope line unchanged (not silently overwritten)");
  assert.ok(res.updated.includes("self-attestation default for funding detection"), "the stable decision is preserved verbatim");
});

// ── END-TO-END CLI: append (exit 0) · conflict (exit 4) · missing epic (exit 3)
h.test("end-to-end CLI: fold appends provenance (0); conflict exits 4; missing epic exits 3", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-efold-"));
  try {
    const epicFile = path.join(tmp, "E-FOLD-001-fold-fixture.md");
    fs.writeFileSync(epicFile, makeEpic(), "utf8");
    const FOLD = path.join(ROOT, "scripts", "epic", "fold.js");

    // clean fold → exit 0, entry appended
    let r = spawnSync(
      process.execPath,
      [FOLD, "--epic", epicFile, "--text", "add a CLI-latest-version check", "--type", "scope-addition", "--source", "operator", "--date", "2026-06-09"],
      { encoding: "utf8" },
    );
    assert.strictEqual(r.status, 0, `clean fold should exit 0: ${r.stderr}`);
    let md = fs.readFileSync(epicFile, "utf8");
    assert.ok(/fold \(scope-addition\)/.test(md), "entry appended");
    assert.ok(md.includes("Provenance: 2026-06-09 · source: operator"), "provenance recorded");

    // conflicting fold → exit 4 (non-fatal signal)
    r = spawnSync(
      process.execPath,
      [FOLD, "--epic", epicFile, "--text", "remove the funding probe entirely", "--type", "scope-reduction", "--conflicts-with", "funding probe", "--source", "operator", "--date", "2026-06-09"],
      { encoding: "utf8" },
    );
    assert.strictEqual(r.status, 4, "a flagged conflict exits 4");

    // missing epic → exit 3 (read-before-write guard)
    r = spawnSync(process.execPath, [FOLD, "--epic", path.join(tmp, "nope.md"), "--text", "x"], { encoding: "utf8" });
    assert.strictEqual(r.status, 3, "missing epic exits 3");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

h.done();
