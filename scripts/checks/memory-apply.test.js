#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// memory-apply.test.js — planted-case + live sealed-store test for the GATED
// memory mutation executor (scripts/checks/memory-apply.js).
//
// Two layers (modelled on doc-ref-integrity.test.js):
//   • PURE validatePlan() — the safety gate — proved on synthetic plans with NO
//     disk: contradicted+evidence delete is allowed; the load-bearing invariant
//     (an UNVERIFIABLE — or verified — delete/correct is ALWAYS rejected) holds;
//     missing newBody / empty evidence / unknown action|classification are rejected;
//     action:none is always allowed.
//   • LIVE in a sealed fs.mkdtempSync store: a valid contradicted-delete plan
//     DRY-RUN (default) mutates NOTHING + exits 0; --apply removes the file AND its
//     MEMORY.md index line and leaves the store structurally clean (exit 0). An
//     unverifiable-delete plan exits 2 with the file STILL PRESENT (nothing mutated).
// ─────────────────────────────────────────────────────────────────────────────
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const CHECK = path.join(__dirname, "memory-apply.js");
const mod = require("./memory-apply.js");

// The write primitive is NOT on the module's public surface (gauntlet r13 HIGH, surface reduction);
// it is reachable only through the explicitly test-only handle. Bound ONCE here so every fixture
// below — including the r12 FD spy, which is what keeps a regression to a write-by-path
// self-detecting — goes through the same door. A hard destructure (rather than an `||` fallback to
// mod.atomicWriteInStore) is deliberate: if the handle ever disappears this file fails loudly
// instead of silently re-binding to a re-promoted public export.
const writer = mod.__testonly__.atomicWriteInStore;

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

// ── PURE validatePlan(): the safety gate ─────────────────────────────────────

ok("PLANTED: delete on contradicted WITH evidence is ALLOWED", () => {
  const v = mod.validatePlan({
    store: "s",
    changes: [{ file: "a.md", classification: "contradicted", action: "delete", evidence: "grep shows the claim is false" }],
  });
  assert.strictEqual(v.ok, true, `expected ok, got ${JSON.stringify(v.violations)}`);
  assert.strictEqual(v.violations.length, 0);
  assert.deepStrictEqual(v.planned, [{ file: "a.md", action: "delete" }]);
});

ok("INVARIANT: delete on UNVERIFIABLE is ALWAYS rejected ('couldn't verify' is not 'delete')", () => {
  const v = mod.validatePlan({
    store: "s",
    changes: [{ file: "a.md", classification: "unverifiable", action: "delete", evidence: "could not find ground truth" }],
  });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.violations.length, 1);
  assert.strictEqual(v.violations[0].reason, "only a contradicted memory may be mutated");
});

ok("INVARIANT: delete on VERIFIED is rejected (a true memory is never deleted)", () => {
  const v = mod.validatePlan({
    store: "s",
    changes: [{ file: "a.md", classification: "verified", action: "delete", evidence: "confirmed true" }],
  });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.violations[0].reason, "only a contradicted memory may be mutated");
});

ok("PLANTED: correct with NO newBody is rejected", () => {
  const v = mod.validatePlan({
    store: "s",
    changes: [{ file: "a.md", classification: "contradicted", action: "correct", evidence: "the value drifted" }],
  });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.violations[0].reason, "correct requires newBody");
});

ok("PLANTED: correct on contradicted WITH evidence + newBody is ALLOWED", () => {
  const v = mod.validatePlan({
    store: "s",
    changes: [{ file: "a.md", classification: "contradicted", action: "correct", evidence: "drifted", newBody: "---\nname: a\n---\nfixed\n" }],
  });
  assert.strictEqual(v.ok, true, JSON.stringify(v.violations));
  // planned now carries the validated newBody so run() applies exactly what was gated
  // (no plan re-lookup / last-wins divergence).
  assert.deepStrictEqual(v.planned, [{ file: "a.md", action: "correct", newBody: "---\nname: a\n---\nfixed\n" }]);
});

ok("PLANTED: correct/delete with EMPTY (whitespace) evidence is rejected", () => {
  const del = mod.validatePlan({
    store: "s",
    changes: [{ file: "a.md", classification: "contradicted", action: "delete", evidence: "   " }],
  });
  assert.strictEqual(del.violations[0].reason, "mutation requires ground-truth evidence");
  const corr = mod.validatePlan({
    store: "s",
    changes: [{ file: "b.md", classification: "contradicted", action: "correct", evidence: "", newBody: "x" }],
  });
  assert.strictEqual(corr.violations[0].reason, "mutation requires ground-truth evidence");
});

ok("PLANTED: action 'none' is always allowed (even unverifiable, no evidence)", () => {
  const v = mod.validatePlan({
    store: "s",
    changes: [
      { file: "a.md", classification: "unverifiable", action: "none" },
      { file: "b.md", classification: "verified", action: "none" },
    ],
  });
  assert.strictEqual(v.ok, true, JSON.stringify(v.violations));
  assert.strictEqual(v.planned.length, 2);
});

ok("PLANTED: unknown action or classification is rejected", () => {
  const badAction = mod.validatePlan({ store: "s", changes: [{ file: "a.md", classification: "contradicted", action: "purge", evidence: "x" }] });
  assert.strictEqual(badAction.violations[0].reason, "invalid action/classification");
  const badClass = mod.validatePlan({ store: "s", changes: [{ file: "b.md", classification: "maybe", action: "delete", evidence: "x" }] });
  assert.strictEqual(badClass.violations[0].reason, "invalid action/classification");
});

ok("PLANTED: all-or-nothing — one bad change fails the whole plan", () => {
  const v = mod.validatePlan({
    store: "s",
    changes: [
      { file: "a.md", classification: "contradicted", action: "delete", evidence: "false" },
      { file: "b.md", classification: "unverifiable", action: "delete", evidence: "dunno" },
    ],
  });
  assert.strictEqual(v.ok, false, "a single unsafe change fails the plan");
  assert.strictEqual(v.violations.length, 1);
  assert.strictEqual(v.violations[0].file, "b.md");
});

// ── removeIndexLines: reuses the detector's parseIndex ────────────────────────
ok("removeIndexLines drops only the matching target line", () => {
  const index = "- [Alpha](a.md) — h\n- [Bravo](b.md) — h\n- [Gamma](c.md) — h\n";
  const next = mod.removeIndexLines(index, new Set(["b.md"]));
  assert.ok(/a\.md/.test(next) && /c\.md/.test(next), "kept the others");
  assert.ok(!/b\.md/.test(next), "dropped the deleted target's line");
});

// ── LIVE sealed store ─────────────────────────────────────────────────────────

function seedStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const mk = (slug) => `---\nname: ${slug}\ndescription: a memory\nmetadata:\n  type: feedback\n---\n\nBody.\n`;
  fs.writeFileSync(path.join(dir, "keep_one.md"), mk("keep-one"));
  fs.writeFileSync(path.join(dir, "drop_one.md"), mk("drop-one"));
  fs.writeFileSync(
    path.join(dir, "MEMORY.md"),
    "- [Keep One](keep_one.md) — a memory\n- [Drop One](drop_one.md) — a memory\n",
  );
}
function writePlan(dir, plan) {
  const p = path.join(dir, "plan.json");
  fs.writeFileSync(p, JSON.stringify(plan, null, 2));
  return p;
}

ok("LIVE: a valid contradicted-delete plan DRY-RUN (default) mutates NOTHING and exits 0", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const plan = writePlan(base, {
    store,
    changes: [{ file: "drop_one.md", classification: "contradicted", action: "delete", evidence: "TRACKER shows this fact was reversed" }],
  });
  const r = spawnSync("node", [CHECK, "--plan", plan, "--json"], { encoding: "utf8" });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(r.status, 0, "clean dry-run exits 0");
  assert.strictEqual(out.dryRun, true);
  assert.strictEqual(out.applied, false);
  assert.ok(fs.existsSync(path.join(store, "drop_one.md")), "dry-run did NOT delete the file");
  assert.ok(/drop_one\.md/.test(fs.readFileSync(path.join(store, "MEMORY.md"), "utf8")), "index untouched");
});

// ─────────────────────────────────────────────────────────────────────────────
// QUARANTINE — the --apply (mutation) executor is HELD (ADR-0039 §A2.1, ED-310).
//
// Every test below this banner used to exercise --apply ACTUALLY MUTATING — a
// clean apply, a rollback, the hardlink/EEXIST/close-failure protections AS
// OBSERVED THROUGH a real --apply run, the projected-store gate reached via
// --apply, etc. Since `run()`'s hold refuses --apply unconditionally, before the
// plan is even read (see "HOLD — CONTROL" in memory-apply.js), none of that code
// runs anymore under --apply, and these tests would either red (their original
// assertion no longer holds) or pass for the wrong reason (e.g. "the file still
// exists" being trivially true when nothing ever attempted to touch it).
//
// Per the r15 fix brief (C6), each is QUARANTINED rather than deleted or given a
// bypass flag: its body is rewritten to assert the ONE thing that is true of it
// today — that this exact --apply invocation refuses via the HOLD, citing
// ADR-0039 §A2.1, before any mutation — and a comment names what it used to prove.
// The underlying mechanisms (rollback verification, the hardlink/EEXIST/close
// defenses, the store projection) remain covered where they are exercised BELOW
// the control — directly against `writer` (`__testonly__.atomicWriteInStore`) or
// the pure `validatePlan`/`projectStoreState` functions — see the r11/r12/r13
// MECHANISM and CONTROL fixtures elsewhere in this file, none of which call
// `run()` and so are unaffected by the hold. Restore each quarantined body from
// git history when the hold is lifted (tracked as ED-310; underlying findings
// ED-306/307/308/309).
function assertHoldRefusal(result, { cli } = {}) {
  const problems = cli ? undefined : result.problems || [];
  if (cli) {
    assert.strictEqual(result.status, 2, "--apply refuses fail-closed (exit 2) while HELD");
    const out = JSON.parse(result.stdout);
    assert.strictEqual(out.fatal, true, "the CLI reports fatal while HELD");
    assert.strictEqual(out.applied, false, "nothing is applied while HELD");
    assert.ok(
      (out.problems || []).some((p) => /HELD/.test(p)),
      `the refusal names the HOLD: ${JSON.stringify(out.problems)}`,
    );
    assert.ok(
      (out.problems || []).some((p) => /A2\.1/.test(p)),
      `the refusal cites ADR-0039 §A2.1: ${JSON.stringify(out.problems)}`,
    );
    return out;
  }
  assert.strictEqual(result.fatal, true, "run() reports fatal while HELD");
  assert.strictEqual(result.applied, false, "nothing is applied while HELD");
  assert.ok(problems.some((p) => /HELD/.test(p)), `the refusal names the HOLD: ${JSON.stringify(problems)}`);
  assert.ok(problems.some((p) => /A2\.1/.test(p)), `the refusal cites ADR-0039 §A2.1: ${JSON.stringify(problems)}`);
  return result;
}

ok("QUARANTINED (was 'LIVE: --apply removes the file + its MEMORY.md index line and leaves the store clean (exit 0)'): --apply refuses via the HOLD instead — the file/index survive untouched", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const plan = writePlan(base, {
    store,
    changes: [{ file: "drop_one.md", classification: "contradicted", action: "delete", evidence: "TRACKER shows this fact was reversed" }],
  });
  const r = spawnSync("node", [CHECK, "--plan", plan, "--apply", "--json"], { encoding: "utf8" });
  assertHoldRefusal(r, { cli: true });
  assert.ok(fs.existsSync(path.join(store, "drop_one.md")), "the file was NOT deleted — the hold refused before any mutation");
  const idx = fs.readFileSync(path.join(store, "MEMORY.md"), "utf8");
  assert.ok(/drop_one\.md/.test(idx), "the index line was NOT removed");
  assert.ok(/keep_one\.md/.test(idx), "the surviving entry is intact");
});

ok("LIVE: an unverifiable-delete plan exits 2 with the file STILL PRESENT (nothing mutated)", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const plan = writePlan(base, {
    store,
    changes: [{ file: "drop_one.md", classification: "unverifiable", action: "delete", evidence: "could not confirm either way" }],
  });
  const r = spawnSync("node", [CHECK, "--plan", plan, "--apply", "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 2, "an unverifiable delete is fail-closed exit 2 even under --apply");
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.fatal, true);
  assert.ok(fs.existsSync(path.join(store, "drop_one.md")), "nothing mutated — the file is still present");
  assert.ok(/drop_one\.md/.test(fs.readFileSync(path.join(store, "MEMORY.md"), "utf8")), "index still present");
});

ok("LIVE: a bad store (no MEMORY.md) is fail-closed exit 2", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-"));
  const store = path.join(base, "notastore");
  fs.mkdirSync(store, { recursive: true });
  const plan = writePlan(base, { store, changes: [] });
  const r = spawnSync("node", [CHECK, "--plan", plan, "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 2, "a store without MEMORY.md is not a valid store");
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.fatal, true);
});

// ── PURE path-safety gate (security gauntlet r3) ─────────────────────────────

ok("PURE: isSafeStoreFilename accepts a plain *.md name, rejects traversal/absolute/separator/non-md", () => {
  assert.strictEqual(mod.isSafeStoreFilename("feedback_x.md"), true);
  assert.strictEqual(mod.isSafeStoreFilename("../SECRET.md"), false, "parent traversal");
  assert.strictEqual(mod.isSafeStoreFilename("a/b.md"), false, "separator");
  assert.strictEqual(mod.isSafeStoreFilename("a\\b.md"), false, "backslash");
  assert.strictEqual(mod.isSafeStoreFilename(path.resolve("/tmp/x.md")), false, "absolute");
  assert.strictEqual(mod.isSafeStoreFilename(".."), false);
  assert.strictEqual(mod.isSafeStoreFilename("notmd.txt"), false, "non-.md");
  assert.strictEqual(mod.isSafeStoreFilename(""), false);
});

ok("PLANTED: validatePlan REJECTS a delete whose file is a traversal path", () => {
  const v = mod.validatePlan({
    store: "s",
    changes: [{ file: "../../CLAUDE.md", classification: "contradicted", action: "delete", evidence: "x" }],
  });
  assert.strictEqual(v.ok, false);
  assert.ok(/unsafe file path/.test(v.violations[0].reason), v.violations[0] && v.violations[0].reason);
});

ok("PLANTED: validatePlan REJECTS duplicate file entries", () => {
  const v = mod.validatePlan({
    store: "s",
    changes: [
      { file: "a.md", classification: "verified", action: "none" },
      { file: "a.md", classification: "contradicted", action: "delete", evidence: "x" },
    ],
  });
  assert.strictEqual(v.ok, false);
  assert.ok(v.violations.some((x) => /duplicate file entry/.test(x.reason)));
});

// ── LIVE security: traversal + symlink cannot escape the store ────────────────

ok("LIVE-SECURITY: a path-traversal delete is fail-closed and CANNOT delete a file OUTSIDE the store", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-trav-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const sentinel = path.join(base, "SECRET.md"); // lives OUTSIDE the store
  fs.writeFileSync(sentinel, "do not delete me\n");
  const plan = writePlan(base, {
    store,
    changes: [{ file: "../SECRET.md", classification: "contradicted", action: "delete", evidence: "attacker-supplied" }],
  });
  const r = spawnSync("node", [CHECK, "--plan", plan, "--apply", "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 2, "a traversal path is rejected fail-closed exit 2");
  assert.ok(fs.existsSync(sentinel), "the out-of-store file MUST survive (no traversal delete)");
  // an ABSOLUTE path is rejected too
  const plan2 = writePlan(base, {
    store,
    changes: [{ file: sentinel, classification: "contradicted", action: "delete", evidence: "x" }],
  });
  const r2 = spawnSync("node", [CHECK, "--plan", plan2, "--apply", "--json"], { encoding: "utf8" });
  assert.strictEqual(r2.status, 2, "an absolute path is rejected fail-closed exit 2");
  assert.ok(fs.existsSync(sentinel), "sentinel still present after the absolute-path attempt");
});

ok("LIVE-SECURITY: a symlinked memory file is rejected under --apply (no out-of-store write) [skips if symlink unsupported]", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-sym-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const outside = path.join(base, "OUTSIDE.md");
  fs.writeFileSync(outside, "original outside content\n");
  const linkPath = path.join(store, "drop_one.md");
  fs.unlinkSync(linkPath); // replace the real store file with a symlink to the outside file
  try {
    fs.symlinkSync(outside, linkPath, "file");
  } catch (e) {
    console.log("  (skip: symlink creation not permitted on this platform)");
    return;
  }
  const plan = writePlan(base, {
    store,
    changes: [{ file: "drop_one.md", classification: "contradicted", action: "correct", evidence: "x", newBody: "MALICIOUS\n" }],
  });
  const r = spawnSync("node", [CHECK, "--plan", plan, "--apply", "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 2, "a symlink target is rejected fail-closed exit 2");
  assert.strictEqual(fs.readFileSync(outside, "utf8"), "original outside content\n", "the symlink target was NOT overwritten");
});

// ── security gauntlet r5 (agy lane): the MEMORY.md index is never a mutation target ──
ok("PURE: isSafeStoreFilename REJECTS the index file MEMORY.md (case-insensitive)", () => {
  assert.strictEqual(mod.isSafeStoreFilename("MEMORY.md"), false);
  assert.strictEqual(mod.isSafeStoreFilename("memory.md"), false);
  assert.strictEqual(mod.isSafeStoreFilename("Memory.MD"), false);
  assert.strictEqual(mod.isSafeStoreFilename("a.md:MEMORY.md"), false, "NTFS alternate-data-stream name rejected");
  assert.strictEqual(mod.isSafeStoreFilename("x.md:stream"), false, "any ':' rejected (honest .md suffix)");
  assert.strictEqual(mod.isSafeStoreFilename("feedback_x.md"), true, "a real per-fact file still passes");
});

ok("PLANTED: validatePlan REJECTS a delete/correct targeting MEMORY.md", () => {
  const del = mod.validatePlan({
    store: "s",
    changes: [{ file: "MEMORY.md", classification: "contradicted", action: "delete", evidence: "x" }],
  });
  assert.strictEqual(del.ok, false);
  assert.ok(/unsafe file path/.test(del.violations[0].reason));
});

ok("LIVE-SECURITY: a plan targeting MEMORY.md for delete is fail-closed and does NOT corrupt the index", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-idx-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const plan = writePlan(base, {
    store,
    changes: [{ file: "MEMORY.md", classification: "contradicted", action: "delete", evidence: "attacker-supplied" }],
  });
  const r = spawnSync("node", [CHECK, "--plan", plan, "--apply", "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 2, "targeting the index is rejected fail-closed exit 2");
  assert.ok(fs.existsSync(path.join(store, "MEMORY.md")), "the index file MUST still exist (not deleted)");
  assert.ok(/keep_one\.md/.test(fs.readFileSync(path.join(store, "MEMORY.md"), "utf8")), "index content intact");
});

// ── security gauntlet r7 (agy lane): all-or-nothing hardening ─────────────────
ok("PLANTED: validatePlan REJECTS a CASE-ONLY-distinct duplicate (a.md + A.md)", () => {
  const v = mod.validatePlan({
    store: "s",
    changes: [
      { file: "a.md", classification: "contradicted", action: "delete", evidence: "x" },
      { file: "A.md", classification: "contradicted", action: "delete", evidence: "y" },
    ],
  });
  assert.strictEqual(v.ok, false, "a.md + A.md resolve to one file on a case-insensitive FS");
  assert.ok(v.violations.some((x) => /duplicate file entry/.test(x.reason)));
});

ok("LIVE-SECURITY: a DIRECTORY named foo.md is rejected in preflight (not unlinked mid-apply)", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-dir-"));
  const store = path.join(base, "agent");
  seedStore(store);
  fs.mkdirSync(path.join(store, "dir_as_file.md")); // a directory masquerading as a memory file
  const plan = writePlan(base, {
    store,
    changes: [{ file: "dir_as_file.md", classification: "contradicted", action: "delete", evidence: "x" }],
  });
  const r = spawnSync("node", [CHECK, "--plan", plan, "--apply", "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 2, "a non-regular target is rejected fail-closed exit 2");
  assert.ok(fs.existsSync(path.join(store, "dir_as_file.md")), "the directory is untouched");
  assert.ok(fs.existsSync(path.join(store, "keep_one.md")), "no partial mutation of siblings");
});

ok("LIVE-SECURITY: an unreadable index (MEMORY.md is a dir) fails BEFORE any delete (FIX-C)", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-idx2-"));
  const store = path.join(base, "agent");
  seedStore(store);
  fs.unlinkSync(path.join(store, "MEMORY.md")); // make the index unreadable-as-a-file
  fs.mkdirSync(path.join(store, "MEMORY.md")); // ...by replacing it with a directory
  const plan = writePlan(base, {
    store,
    changes: [{ file: "drop_one.md", classification: "contradicted", action: "delete", evidence: "x" }],
  });
  const r = spawnSync("node", [CHECK, "--plan", plan, "--apply", "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 2, "an unreadable index pre-read fails-closed exit 2");
  assert.ok(fs.existsSync(path.join(store, "drop_one.md")), "the file was NOT deleted (pre-read failed before the mutation loop)");
});

// ── security gauntlet r8 (agy+qa): the case-insensitivity class, one canonicalization ──
ok("PURE: canonicalStoreName resolves a case-variant plan name to the real on-disk entry", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-canon-"));
  const store = path.join(base, "agent");
  seedStore(store); // writes drop_one.md, keep_one.md, MEMORY.md
  assert.strictEqual(mod.canonicalStoreName(store, "DROP_ONE.md"), "drop_one.md", "case-variant resolves to disk name");
  assert.strictEqual(mod.canonicalStoreName(store, "drop_one.md"), "drop_one.md", "exact match");
  assert.strictEqual(mod.canonicalStoreName(store, "nope.md"), null, "no match → null");
});

// QUARANTINED (r15 fix brief C6): this used to prove an END-TO-END --apply actually deletes a
// case-variant name and re-syncs the index. Since run()'s HOLD refuses --apply unconditionally
// before the plan is even read, no case-insensitive delete can be observed through --apply today.
// The underlying mechanism (canonicalStoreName resolving a case-variant plan name to the real
// on-disk entry) remains covered BELOW the control by "PURE: canonicalStoreName resolves a
// case-variant plan name to the real on-disk entry" a few tests above, which calls
// mod.canonicalStoreName directly and is unaffected by the hold. Restore this body from git
// history when the hold is lifted (ED-310; underlying findings ED-306/307/308/309).
ok("QUARANTINED (was 'LIVE-SECURITY: deleting a CASE-VARIANT name (DROP_ONE.md) removes the file AND its index line (no broken pointer)'): --apply refuses via the HOLD instead — the case-variant file/index survive untouched", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-case-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const plan = writePlan(base, {
    store,
    changes: [{ file: "DROP_ONE.md", classification: "contradicted", action: "delete", evidence: "TRACKER reversed it" }],
  });
  const r = spawnSync("node", [CHECK, "--plan", plan, "--apply", "--json"], { encoding: "utf8" });
  assertHoldRefusal(r, { cli: true });
  assert.ok(fs.existsSync(path.join(store, "drop_one.md")), "the real (lowercase) file was NOT deleted — the hold refused before any mutation");
  const idx = fs.readFileSync(path.join(store, "MEMORY.md"), "utf8");
  assert.ok(/drop_one\.md/i.test(idx), "the index line was NOT removed");
});

ok("LIVE-SECURITY: a CORRECT-only apply with an unreadable index (MEMORY.md dir) fails BEFORE the correct (no partial)", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-corr-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const before = fs.readFileSync(path.join(store, "drop_one.md"), "utf8");
  fs.unlinkSync(path.join(store, "MEMORY.md"));
  fs.mkdirSync(path.join(store, "MEMORY.md")); // index is now a dir → not a readable regular file
  const plan = writePlan(base, {
    store,
    changes: [{ file: "drop_one.md", classification: "contradicted", action: "correct", evidence: "drifted", newBody: "---\nname: drop-one\ndescription: x\nmetadata:\n  type: feedback\n---\nCORRECTED\n" }],
  });
  const r = spawnSync("node", [CHECK, "--plan", plan, "--apply", "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 2, "index pre-check fails-closed BEFORE any correct (exit 2)");
  assert.strictEqual(fs.readFileSync(path.join(store, "drop_one.md"), "utf8"), before, "the fact file was NOT rewritten (no partial mutation)");
});

// ── security gauntlet r9 (backend): all-or-nothing rollback + malformed-plan ──────
ok("LIVE-SECURITY: a mid-sequence apply fault ROLLS BACK op1's delete — true all-or-nothing (:322)", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-rollback-"));
  const store = path.join(base, "agent");
  seedStore(store); // drop_one.md, keep_one.md, MEMORY.md
  // Make keep_one.md read-only so the correct (op2) THROWS after the delete (op1) commits.
  fs.chmodSync(path.join(store, "keep_one.md"), 0o444);
  const plan = writePlan(base, {
    store,
    changes: [
      { file: "drop_one.md", classification: "contradicted", action: "delete", evidence: "reversed" },
      { file: "keep_one.md", classification: "contradicted", action: "correct", evidence: "drifted", newBody: "---\nname: keep-one\ndescription: x\nmetadata:\n  type: feedback\n---\nNEW\n" },
    ],
  });
  const r = spawnSync("node", [CHECK, "--plan", plan, "--apply", "--json"], { encoding: "utf8" });
  try { fs.chmodSync(path.join(store, "keep_one.md"), 0o644); } catch {} // restore for cleanup
  assert.strictEqual(r.status, 2, "a mid-sequence fault fails-closed exit 2");
  assert.ok(fs.existsSync(path.join(store, "drop_one.md")), "op1's deleted file was RESTORED by rollback — all-or-nothing held");
});

ok("LIVE: a non-array plan.changes is a MALFORMED plan (exit 2), not a silent empty one (:101)", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-badplan-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const p = path.join(base, "plan.json");
  fs.writeFileSync(p, JSON.stringify({ store, changes: "not-an-array" }));
  const r = spawnSync("node", [CHECK, "--plan", p, "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 2, "non-array changes → fatal exit 2, not a silent exit 0");
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.fatal, true);
});

// ── gauntlet r10 (:417): --apply leaves the store CLEAN or BYTE-IDENTICAL, never corrupted ──
// Snapshot every file in a store so "byte-identical to pre-apply" is asserted, not assumed.
function snapshot(dir) {
  const snap = new Map();
  for (const name of fs.readdirSync(dir).sort()) {
    snap.set(name, fs.readFileSync(path.join(dir, name)).toString("base64"));
  }
  return snap;
}
function assertUnchanged(dir, before, why) {
  const after = snapshot(dir);
  assert.deepStrictEqual([...after.keys()], [...before.keys()], `${why}: the file SET changed`);
  for (const [name, bytes] of before) {
    assert.strictEqual(after.get(name), bytes, `${why}: '${name}' is not byte-identical to pre-apply`);
  }
}

// Run `body()` with the detector's post-check replaced by `fn`. The POST-CHECK is a real branch of
// run() — a post-check that errors or reports findings routes to the rollback — but since r12 the
// PROSPECTIVE pre-check refuses store-dirtying plans before they ever mutate, so a dirty store can
// no longer be used to reach the rollback. Substituting the post-check reaches the same branch
// deterministically and on every platform, and touches NOTHING in the production module: the
// projection calls mem.readStore/mem.evaluate, never mem.run.
function withPostCheck(fn, body) {
  const memmod = require("./memory-integrity.js");
  const orig = memmod.run;
  memmod.run = fn;
  try {
    return body();
  } finally {
    memmod.run = orig;
  }
}

ok("r10 PURE: validateNewBody accepts a valid memory file and names every structural defect", () => {
  assert.deepStrictEqual(
    mod.validateNewBody("---\nname: a-slug\ndescription: d\nmetadata:\n  type: feedback\n---\nbody\n"),
    [],
    "a canonical memory file is valid",
  );
  assert.ok(/no YAML frontmatter/.test(mod.validateNewBody("just prose, no block\n")[0]), "no block is caught");
  const partial = mod.validateNewBody("---\nname: a-slug\n---\nbody\n");
  assert.ok(partial.some((r) => /'description'/.test(r)), "missing description named");
  assert.ok(partial.some((r) => /metadata\.type/.test(r)), "missing metadata.type named");
  const badType = mod.validateNewBody("---\nname: a-slug\ndescription: d\nmetadata:\n  type: nonsense\n---\nb\n");
  assert.strictEqual(badType.length, 1);
  assert.ok(/metadata\.type/.test(badType[0]));
});

// PLANTED RED — proves HALF ONE (pre-validation). Before the fix, validatePlan only required a
// non-empty newBody STRING, so this body was written to disk successfully; nothing threw, so the
// catch-only rollback never fired and a corrupted memory file was left behind.
//
// REWIRED BELOW THE CONTROL (r15 fix brief C6): this used to invoke `--apply`; since run()'s HOLD
// refuses --apply unconditionally BEFORE the plan is even read, that would now only prove the HOLD
// fired, not that the body-level content gate refused the mutation. The content gate (validateNewBody
// via run()) is NOT gated by opts.apply — it runs identically under a plain (no --apply) invocation,
// which is the ONE part of "as --apply would refuse" that is still reachable — so this asserts the
// same violation through dry-run instead of through the held mutation path.
ok("r10 PLANTED (half a): a correct plan with a STRUCTURALLY INVALID newBody is refused BEFORE any mutation", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r10-prevalid-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const before = snapshot(store);
  const plan = writePlan(base, {
    store,
    changes: [{ file: "drop_one.md", classification: "contradicted", action: "correct", evidence: "TRACKER reversed it", newBody: "CORRUPTED — no frontmatter at all\n" }],
  });
  const r = spawnSync("node", [CHECK, "--plan", plan, "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 2, `a structurally invalid newBody is fail-closed exit 2, got ${r.status} :: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.fatal, true);
  assert.strictEqual(out.applied, false, "nothing was applied");
  assert.ok(
    (out.violations || []).some((x) => /newBody is not a valid memory file/.test(x.reason)),
    `the refusal names the body defect: ${JSON.stringify(out.violations)}`,
  );
  assertUnchanged(store, before, "invalid newBody refused pre-mutation");
});

ok("r10 PLANTED (half a): the SAME invalid newBody is refused in DRY-RUN too (no gate/apply divergence)", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r10-dry-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const before = snapshot(store);
  const plan = writePlan(base, {
    store,
    changes: [{ file: "drop_one.md", classification: "contradicted", action: "correct", evidence: "x", newBody: "---\nname: only-a-name\n---\nb\n" }],
  });
  const r = spawnSync("node", [CHECK, "--plan", plan, "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 2, "a dry-run must not promise a correct that --apply would refuse");
  assertUnchanged(store, before, "dry-run never mutates");
});

// PLANTED RED — the r12 MEDIUM fixture. This body PASSES per-file pre-validation (name +
// description + valid type), so validateNewBody cannot catch it; it is dirty only relative to the
// REST of the store — its name-slug collides with keep_one.md's. r10 caught it AFTER mutating and
// rolled back; r12 refuses it BEFORE mutating, because the pre-check now runs the detector over
// the store state the plan would produce instead of over the body alone.
//
// REWIRED BELOW THE CONTROL (r15 fix brief C6): invoked as a plain (no --apply) dry-run. The
// prospective store-state gate (projectStoreState + mem.evaluate) is NOT gated by opts.apply — it
// runs identically either way and is what this test proves, so dry-run reaches it unaffected by
// the HOLD, which only refuses the mutation ITSELF.
ok("r12 MEDIUM: a correct that passes per-file validation but DIRTIES the store (duplicate name-slug) is refused BEFORE any mutation", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r12-prospect-"));
  const store = path.join(base, "agent");
  seedStore(store); // keep_one.md → name: keep-one ; drop_one.md → name: drop-one
  const before = snapshot(store);
  const collide = "---\nname: keep-one\ndescription: a memory\nmetadata:\n  type: feedback\n---\n\nCOLLIDES WITH keep_one.md\n";
  const plan = writePlan(base, {
    store,
    changes: [{ file: "drop_one.md", classification: "contradicted", action: "correct", evidence: "TRACKER shows the slug was merged", newBody: collide }],
  });
  const r = spawnSync("node", [CHECK, "--plan", plan, "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 2, `a store-dirtying plan must fail closed (exit 2), got ${r.status} :: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.fatal, true);
  assert.strictEqual(out.applied, false, "nothing was applied");
  // THE claim: refused BEFORE the mutation, so there was no rollback to run at all.
  assert.strictEqual(out.rolledBack, undefined, "nothing was mutated, so no rollback should have been needed");
  assert.ok(
    (out.prospectiveFindings || []).some((f) => f.kind === "duplicate-name-slug"),
    `the store-wide finding is reported from the PROJECTED store: ${JSON.stringify(out.prospectiveFindings)}`,
  );
  assert.ok(
    (out.violations || []).some((x) => /duplicate-name-slug/.test(x.reason)),
    `the refusal names the collision: ${JSON.stringify(out.violations)}`,
  );
  assertUnchanged(store, before, "store-dirtying plan refused pre-mutation");
  // Asserted LAST, on purpose: the pre-mutation refusal above is what this test proves. This line
  // is the supporting claim — the body IS per-file valid, so the body-level gate cannot see it.
  assert.deepStrictEqual(mod.validateNewBody(collide), [], "the body is per-file VALID — the body-level gate cannot catch this");
});

// The post-check is now the BACKSTOP rather than the gate for this class, and it must still work:
// if anything the projection did not predict makes the store dirty, the mutations are rolled back.
//
// QUARANTINED (r15 fix brief C6): proving the BACKSTOP requires a real mutation to have landed on
// disk (so there is something for the post-check to observe and the rollback to undo). run()'s HOLD
// refuses --apply before the plan is even read — before backup/apply/rollback ever run — so there
// is no reachable path to exercise a real rollback today, in-process or via the CLI. There is no
// mechanism below the control to point this at: the rollback code (`undo`) only runs from inside
// run()'s apply branch. Restore this body from git history when the hold is lifted (ED-310;
// underlying findings ED-306/307/308/309).
ok("QUARANTINED (was 'r12 MEDIUM: the post-check backstop still rolls back a store the projection did not predict'): --apply refuses via the HOLD instead — no mutation, no rollback needed", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r12-backstop-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const before = snapshot(store);
  const plan = writePlan(base, {
    store,
    changes: [{ file: "drop_one.md", classification: "contradicted", action: "delete", evidence: "TRACKER reversed it" }],
  });
  const res = mod.run({ plan, apply: true });
  assertHoldRefusal(res);
  assertUnchanged(store, before, "the hold refused before any mutation — nothing to roll back");
});

// QUARANTINED (r15 fix brief C6): "applies cleanly" is, by definition, a real mutation landing
// (out.applied === true, the corrected body on disk). run()'s HOLD refuses --apply unconditionally,
// so a clean apply is not a reachable outcome today — there is no mechanism below the control that
// proves it. The gate this plan clears (validatePlan + validateNewBody + the prospective store
// check) remains covered by "r12 MEDIUM: the DRY-RUN clears the same gates as --apply" and the
// PLANTED/PURE fixtures above, all of which run this exact plan shape through dry-run. Restore this
// body from git history when the hold is lifted (ED-310; underlying findings ED-306/307/308/309).
ok("QUARANTINED (was 'r10 NO-REGRESSION: a correct with a VALID body still applies cleanly and leaves the store clean'): --apply refuses via the HOLD instead — the file survives untouched", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r10-good-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const before = fs.readFileSync(path.join(store, "drop_one.md"), "utf8");
  const newBody = "---\nname: drop-one\ndescription: a corrected memory\nmetadata:\n  type: project\n---\n\nCORRECTED BODY.\n";
  const plan = writePlan(base, {
    store,
    changes: [{ file: "drop_one.md", classification: "contradicted", action: "correct", evidence: "git log shows the value changed", newBody }],
  });
  const r = spawnSync("node", [CHECK, "--plan", plan, "--apply", "--json"], { encoding: "utf8" });
  assertHoldRefusal(r, { cli: true });
  assert.strictEqual(fs.readFileSync(path.join(store, "drop_one.md"), "utf8"), before, "the file was NOT corrected — the hold refused before any mutation");
});

// REWIRED BELOW THE CONTROL (r15 fix brief C6): invoked as a plain (no --apply) dry-run — the
// prospective store-state gate this test proves is not gated by opts.apply, so dry-run reaches the
// identical refusal untouched by the HOLD.
ok("r10/r12: a MIXED plan is all-or-nothing — one dirty-making correct blocks the sibling DELETE too", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r10-mixed-"));
  const store = path.join(base, "agent");
  seedStore(store);
  fs.writeFileSync(path.join(store, "third.md"), "---\nname: third-one\ndescription: a memory\nmetadata:\n  type: feedback\n---\n\nBody.\n");
  fs.appendFileSync(path.join(store, "MEMORY.md"), "- [Third](third.md) — a memory\n");
  const before = snapshot(store);
  const plan = writePlan(base, {
    store,
    changes: [
      { file: "third.md", classification: "contradicted", action: "delete", evidence: "reversed" },
      { file: "drop_one.md", classification: "contradicted", action: "correct", evidence: "merged", newBody: "---\nname: keep-one\ndescription: a memory\nmetadata:\n  type: feedback\n---\n\nCOLLIDES.\n" },
    ],
  });
  const r = spawnSync("node", [CHECK, "--plan", plan, "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 2, "the whole plan fails closed");
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.applied, false, "nothing net-applied");
  // r12: the collision is now seen in the PROJECTED store, so the whole plan — the sound delete
  // included — is refused before anything is written, rather than applied and then undone.
  assert.strictEqual(out.rolledBack, undefined, "refused pre-mutation, so no rollback was needed");
  assert.ok(
    (out.prospectiveFindings || []).some((f) => f.kind === "duplicate-name-slug"),
    `the projection names the collision: ${JSON.stringify(out.prospectiveFindings)}`,
  );
  assert.ok(fs.existsSync(path.join(store, "third.md")), "the sibling delete never happened");
  assertUnchanged(store, before, "mixed plan refused whole (index re-sync included)");
});

// ── gauntlet r11 HIGH-1: a hardlinked target cannot reach OUTSIDE the store ───
// A hardlink is a REGULAR file by every stat predicate, so lstat+isFile() cannot see one. Before
// r11, `correct` used fs.writeFileSync, which writes THROUGH the inode — the out-of-store twin was
// overwritten while the run reported ok:true with a clean post-check. Two fixtures, because there
// are two independent claims: the MECHANISM (rename never writes through an inode) and the
// END-TO-END refusal. Both are RED against 16bcf623.

ok("r11 HIGH-1 MECHANISM: atomicWriteInStore over a HARDLINKED target leaves the outside file BYTE-UNCHANGED", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-hl1-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const outside = path.join(base, "outside.md");
  const outsideBytes = Buffer.from("OUTSIDE SECRET — must never be rewritten\n", "utf8");
  fs.writeFileSync(outside, outsideBytes);
  const target = path.join(store, "drop_one.md");
  fs.unlinkSync(target);
  try {
    fs.linkSync(outside, target); // a REAL hardlink: store entry and outside file share one inode
  } catch (e) {
    console.log(`      (skipped: hardlinks unsupported here — ${e.code})`);
    return;
  }
  assert.ok(fs.lstatSync(target).nlink > 1, "precondition: the target really is hardlinked");

  writer(store, target, "REPLACEMENT BODY\n");

  assert.ok(
    fs.readFileSync(outside).equals(outsideBytes),
    "the OUT-OF-STORE file must be byte-unchanged (writeFileSync would have written through the inode)",
  );
  assert.strictEqual(fs.readFileSync(target, "utf8"), "REPLACEMENT BODY\n", "the in-store target got the new bytes");
  assert.strictEqual(fs.lstatSync(target).nlink, 1, "the target is no longer hardlinked — rename replaced the dir entry");
  assert.ok(
    !fs.readdirSync(store).some((n) => n.endsWith(".tmp")),
    "no temp file is left behind in the store",
  );
});

// REWIRED BELOW THE CONTROL (r15 fix brief C6): invoked as a plain (no --apply) dry-run — the fs
// preflight hardlink check this test proves is not gated by opts.apply, so dry-run reaches the
// identical refusal untouched by the HOLD, and the outside file is trivially byte-unchanged since
// dry-run never writes.
ok("r11 HIGH-1 END-TO-END: a valid `correct` plan on a HARDLINKED file is refused and the OUTSIDE file is BYTE-UNCHANGED", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-hl2-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const outside = path.join(base, "outside.md");
  const outsideBytes = Buffer.from("OUTSIDE SECRET — must never be rewritten\n", "utf8");
  fs.writeFileSync(outside, outsideBytes);
  const target = path.join(store, "drop_one.md");
  fs.unlinkSync(target);
  try {
    fs.linkSync(outside, target);
  } catch (e) {
    console.log(`      (skipped: hardlinks unsupported here — ${e.code})`);
    return;
  }
  // A fully VALID plan — contradicted, real evidence, structurally valid newBody. Nothing about
  // the PLAN is wrong; the danger is entirely in the target's extra directory entry.
  const plan = writePlan(base, {
    store,
    changes: [
      {
        file: "drop_one.md",
        classification: "contradicted",
        action: "correct",
        evidence: "grep shows the claim is false",
        newBody: "---\nname: drop-one\ndescription: corrected\nmetadata:\n  type: feedback\n---\n\nNew body.\n",
      },
    ],
  });
  const r = spawnSync(process.execPath, [CHECK, "--plan", plan, "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 2, "fail-closed on a hardlinked target");
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.applied, false, "nothing was applied");
  assert.ok(
    (out.violations || []).some((v) => /hard link/i.test(v.reason)),
    `preflight must name the hardlink, got ${JSON.stringify(out.violations)}`,
  );
  assert.ok(
    fs.readFileSync(outside).equals(outsideBytes),
    "the OUT-OF-STORE file must be byte-unchanged",
  );
});

// ── gauntlet r11 HIGH-3: rollback restores MEMORY.md BYTE-EXACTLY ─────────────
// The backup used to capture MEMORY.md as Buffer.from(preReadIndexText, "utf8") — the string that
// had already been DECODED at read time. A decode→re-encode round trip is not the identity on
// arbitrary bytes: invalid UTF-8 comes back as U+FFFD (EF BF BD). So `rolledBack: true` could be
// reported over a MEMORY.md whose bytes had changed. MEMORY.md is human-edited, so this is live.
// The assertion below is a BUFFER comparison on purpose — comparing strings would decode both
// sides and hide exactly the defect under test. RED against 16bcf623.
// r12 note on the TRIGGER (the claim is unchanged): these used to reach the rollback by seeding a
// structurally broken `bad.md` so the POST-check found the store dirty. Since r12 the PROSPECTIVE
// pre-check refuses that plan before it mutates, so the rollback is now reached the way it will be
// reached in the field — a post-check that could not certify the store — via withPostCheck.
// QUARANTINED (r15 fix brief C6): proving a BYTE-EXACT rollback requires a real mutation to have
// landed (so the backup/rollback transaction has something to restore). run()'s HOLD refuses
// --apply before the plan is even read — before the backup capture, the mutation loop, or `undo`
// ever run — so there is no reachable path to a rollback today. The backup/rollback code (`undo`)
// is internal to run()'s apply branch; there is no mechanism below the control to point this at.
// Restore this body from git history when the hold is lifted (ED-310; underlying findings
// ED-306/307/308/309).
ok("QUARANTINED (was 'r11 HIGH-3: a rollback restores MEMORY.md BYTE-IDENTICALLY even when it holds invalid UTF-8'): --apply refuses via the HOLD instead — the invalid-UTF-8 index survives untouched", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-utf8-"));
  const store = path.join(base, "agent");
  fs.mkdirSync(store, { recursive: true });
  const mk = (slug) => `---\nname: ${slug}\ndescription: a memory\nmetadata:\n  type: feedback\n---\n\nBody.\n`;
  fs.writeFileSync(path.join(store, "drop_one.md"), mk("drop-one"));
  fs.writeFileSync(path.join(store, "keep_one.md"), mk("keep-one"));
  // MEMORY.md carries a LONE 0xFF — a byte that is not valid UTF-8 and cannot survive a
  // decode→re-encode round trip. It sits in a hook, so the index still parses.
  const indexBytes = Buffer.concat([
    Buffer.from("- [Drop One](drop_one.md) — a memory\n- [Keep One](keep_one.md) — hook ", "utf8"),
    Buffer.from([0xff]),
    Buffer.from("\n", "utf8"),
  ]);
  fs.writeFileSync(path.join(store, "MEMORY.md"), indexBytes);

  const plan = writePlan(base, {
    store,
    changes: [
      {
        file: "drop_one.md",
        classification: "contradicted",
        action: "delete",
        evidence: "grep shows the claim is false",
      },
    ],
  });
  const res = mod.run({ plan, apply: true });
  assertHoldRefusal(res);
  assert.ok(fs.readFileSync(path.join(store, "MEMORY.md")).equals(indexBytes), "the index was NOT touched");
  assert.ok(fs.existsSync(path.join(store, "drop_one.md")), "the delete never happened");
});

// QUARANTINED (r15 fix brief C6): same reason as the fixture above — proving the backup is
// UNCONDITIONAL requires a real correct-only apply to reach the rollback, which the HOLD refuses
// before the plan is even read. Restore this body from git history when the hold is lifted
// (ED-310; underlying findings ED-306/307/308/309).
ok("QUARANTINED (was 'r11 HIGH-3: the MEMORY.md backup is UNCONDITIONAL — a correct-only rollback restores it byte-exactly too'): --apply refuses via the HOLD instead — the correct never happens", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-uncond-"));
  const store = path.join(base, "agent");
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(
    path.join(store, "drop_one.md"),
    "---\nname: drop-one\ndescription: a memory\nmetadata:\n  type: feedback\n---\n\nBody.\n",
  );
  const indexBytes = Buffer.concat([
    Buffer.from("- [Drop One](drop_one.md) — a memory hook ", "utf8"),
    Buffer.from([0xff]),
    Buffer.from("\n", "utf8"),
  ]);
  fs.writeFileSync(path.join(store, "MEMORY.md"), indexBytes);
  const plan = writePlan(base, {
    store,
    changes: [
      {
        file: "drop_one.md",
        classification: "contradicted",
        action: "correct",
        evidence: "grep shows the claim is false",
        newBody: "---\nname: drop-one\ndescription: corrected\nmetadata:\n  type: feedback\n---\n\nNew.\n",
      },
    ],
  });
  const res = mod.run({ plan, apply: true });
  assertHoldRefusal(res);
  assert.ok(fs.readFileSync(path.join(store, "MEMORY.md")).equals(indexBytes), "MEMORY.md is untouched");
  assert.ok(
    !fs.readdirSync(store).some((n) => n.endsWith(".tmp")),
    "no temp file is left behind — nothing was ever written",
  );
});

// ── gauntlet r11 MEDIUM: invisible-only evidence is not evidence ──────────────
ok("r11 MEDIUM: evidence made ONLY of invisible characters is REJECTED", () => {
  // U+200B/U+2060/U+180E/U+034F are format characters, NOT whitespace — JS trim() leaves them, so
  // each of these cleared the old `.trim()` gate and applied a delete with visually blank audit
  // evidence. RED against 16bcf623.
  const invisibleOnly = [
    "\u200B",
    "\u200B\u200B\u200B",
    "\u2060",
    "\u180E",
    "\u034F",
    "\uFEFF\u200B",
    "\u200B \t\n",
    "\u00A0\u200B ",
    "\u200E\u200F",
  ];
  for (const evidence of invisibleOnly) {
    const v = mod.validatePlan({
      store: "s",
      changes: [{ file: "a.md", classification: "contradicted", action: "delete", evidence }],
    });
    assert.strictEqual(v.ok, false, `invisible-only evidence ${JSON.stringify(evidence)} must be rejected`);
    assert.strictEqual(v.violations[0].reason, "mutation requires ground-truth evidence");
  }
});

ok("r11 MEDIUM: evidence with ONE visible character still passes (the gate is not over-tight)", () => {
  for (const evidence of ["x", "\u200Bgrep shows the claim is false\u200B", " \u00A0 g \u200B "]) {
    const v = mod.validatePlan({
      store: "s",
      changes: [{ file: "a.md", classification: "contradicted", action: "delete", evidence }],
    });
    assert.strictEqual(v.ok, true, `visible evidence ${JSON.stringify(evidence)} must be accepted`);
  }
});

ok("r11 MEDIUM: hasVisibleText routes through the module's ONE INVIS/SPACE_MAP enumeration", () => {
  assert.strictEqual(typeof mod.hasVisibleText, "function");
  assert.ok(mod.INVIS instanceof RegExp && mod.SPACE_MAP instanceof RegExp, "both classes are exported, not inlined twice");
  assert.strictEqual(mod.hasVisibleText("\u200B"), false);
  assert.strictEqual(mod.hasVisibleText(""), false);
  assert.strictEqual(mod.hasVisibleText(null), false);
  assert.strictEqual(mod.hasVisibleText("a"), true);
  // /g regexes carry lastIndex — prove repeated calls do not alternate.
  assert.strictEqual(mod.hasVisibleText("\u200B"), false, "a second call agrees with the first");
  assert.strictEqual(mod.hasVisibleText("ab"), true);
  assert.strictEqual(mod.hasVisibleText("ab"), true, "no lastIndex leakage between calls");
});

// ── gauntlet r11 HIGH-2: the newBody pre-check no longer MIRRORS the detector ──
ok("r11 HIGH-2: validateNewBody REJECTS the parser shapes that used to yield a trusted type", () => {
  const dupMetadata =
    "---\nname: a-slug\ndescription: d\nmetadata:\n  type: feedback\nmetadata:\n  type: feedback\n---\nbody\n";
  const nonScalarChild =
    "---\nname: a-slug\ndescription: d\nmetadata:\n  type: feedback\n  tags: []\n---\nbody\n";
  for (const [label, body] of [["duplicate top-level metadata:", dupMetadata], ["metadata.tags: []", nonScalarChild]]) {
    const reasons = mod.validateNewBody(body);
    assert.ok(reasons.length > 0, `${label} must produce reasons, got none`);
    assert.ok(
      reasons.some((rr) => /metadata\.type/.test(rr)),
      `${label}: expected a metadata.type reason, got ${JSON.stringify(reasons)}`,
    );
  }
});

ok("r11 HIGH-2: the pre-check and the post-check are the SAME function, not two copies", () => {
  const memmod = require("./memory-integrity.js");
  assert.strictEqual(typeof memmod.frontmatterProblems, "function", "the shared validator is exported");
  // Every body the pre-check accepts must also satisfy the detector's own rules, and vice versa.
  const bodies = [
    "---\nname: a-slug\ndescription: d\nmetadata:\n  type: feedback\n---\nbody\n",
    "---\nname: a-slug\ndescription: d\nmetadata:\n  type: feedback\n  tags: []\n---\nbody\n",
    "---\nname: a-slug\ndescription: d\nmetadata:\n  type: feedback\nmetadata:\n  type: user\n---\nbody\n",
    "---\nname: a-slug\ndescription: d\nmetadata:\n  type: nonsense\n---\nbody\n",
    "no frontmatter at all\n",
    "---\nname: a-slug\nmetadata:\n  type: feedback\n---\nbody\n",
  ];
  for (const body of bodies) {
    const pre = mod.validateNewBody(body);
    const post = memmod.frontmatterProblems(memmod.parseFrontmatter(body)).map((p) => p.message);
    assert.deepStrictEqual(pre, post, `pre-check and post-check disagree about ${JSON.stringify(body)}`);
  }
});

// REWIRED BELOW THE CONTROL (r15 fix brief C6): invoked as a plain (no --apply) dry-run — the
// content gate (validateNewBody, called from run() regardless of opts.apply) is what this test
// proves, so dry-run reaches the identical refusal untouched by the HOLD.
ok("r11 HIGH-2 LIVE: an --apply whose newBody carries a duplicated metadata block is fail-closed", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-dupmeta-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const before = snapshot(store);
  const plan = writePlan(base, {
    store,
    changes: [
      {
        file: "drop_one.md",
        classification: "contradicted",
        action: "correct",
        evidence: "grep shows the claim is false",
        newBody:
          "---\nname: drop-one\ndescription: d\nmetadata:\n  type: feedback\nmetadata:\n  type: feedback\n---\nbody\n",
      },
    ],
  });
  const r = spawnSync(process.execPath, [CHECK, "--plan", plan, "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 2, "a structurally invalid newBody must be refused BEFORE any write");
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.applied, false);
  assert.ok(
    (out.violations || []).some((v) => /newBody is not a valid memory file/.test(v.reason)),
    `expected a newBody violation, got ${JSON.stringify(out.violations)}`,
  );
  assertUnchanged(store, before, "a refused newBody leaves the store untouched");
});

// ─────────────────────────────────────────────────────────────────────────────
// gauntlet r12 CRITICAL — the temp-and-rename mechanism is no longer escapable
//
// r11 moved the write off the TARGET's inode (rename replaces a directory entry). It left the
// write's SOURCE unguarded: the temp was created by `fs.writeFileSync(tmpAbs, data)` — a write BY
// PATH — at `.memory-apply.<pid>.<counter>.tmp`, a name built from two ENUMERABLE values. A
// hardlink pre-created at that path was followed exactly the way the target's used to be, so an
// ordinary `correct` plan overwrote an out-of-store file and still reported {ok:true,
// applied:true} with a clean post-check.
//
// The layers are tested SEPARATELY on purpose, so a later reader can see which one is the control:
//   • CONTROL      — `wx` exclusive create + a write through the DESCRIPTOR (the two tests below);
//   • depth        — an unguessable temp name;
//   • belt+braces  — nlink === 1 on the fresh descriptor;
//   • hygiene ONLY — the stray-temp refusal. Tested LAST and labelled, because it is NOT what
//     makes the escape impossible; the mechanism tests above hold with no scan in sight.
// ─────────────────────────────────────────────────────────────────────────────

const VALID_BODY = "---\nname: drop-one\ndescription: corrected\nmetadata:\n  type: feedback\n---\n\nNew body.\n";

// Plant a hardlink to `outside` at EVERY temp name the pre-fix generator could pick in THIS
// process (pid is fixed; the counter is monotonic and shared across this file's earlier writes).
// Returns false if the platform has no hardlinks.
function plantEnumerableTempLinks(store, outside) {
  for (let i = 0; i < 64; i++) {
    const p = path.join(store, `.memory-apply.${process.pid}.${i}.tmp`);
    try {
      fs.linkSync(outside, p);
    } catch (e) {
      if (i === 0) {
        console.log(`      (skipped: hardlinks unsupported here — ${e.code})`);
        return false;
      }
    }
  }
  return true;
}

ok("r12 CRITICAL CONTROL: the temp is created O_EXCL ('wx') and written through the DESCRIPTOR, never by path", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r12-fd-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const target = path.join(store, "drop_one.md");

  const origOpen = fs.openSync;
  const origWrite = fs.writeFileSync;
  const origFstat = fs.fstatSync;
  const opens = [];
  const writeTargets = [];
  const fstatted = [];
  fs.openSync = (p, flags, mode) => {
    const fd = origOpen(p, flags, mode);
    opens.push({ p, flags, fd });
    return fd;
  };
  fs.writeFileSync = (dest, data, o) => {
    writeTargets.push(dest);
    return origWrite(dest, data, o);
  };
  fs.fstatSync = (fd, o) => {
    fstatted.push(fd);
    return origFstat(fd, o);
  };
  try {
    writer(store, target, "NEW BODY\n");
  } finally {
    fs.openSync = origOpen;
    fs.writeFileSync = origWrite;
    fs.fstatSync = origFstat;
  }

  assert.strictEqual(opens.length, 1, `exactly one temp open, got ${opens.length}`);
  assert.strictEqual(opens[0].flags, "wx", "the temp must be created O_CREAT|O_EXCL|O_WRONLY");
  assert.ok(writeTargets.length >= 1, "the data was written");
  for (const w of writeTargets) {
    assert.strictEqual(
      typeof w,
      "number",
      `the write must target a file DESCRIPTOR, got ${JSON.stringify(w)} — a write BY PATH after the exclusive open re-resolves the name and reopens the exact TOCTOU window the open closed`,
    );
  }
  assert.strictEqual(writeTargets[0], opens[0].fd, "the write goes to the descriptor the exclusive open returned");
  assert.ok(fstatted.includes(opens[0].fd), "nlink is checked on that same descriptor (belt-and-braces)");
  assert.strictEqual(fs.readFileSync(target, "utf8"), "NEW BODY\n", "the target still gets the new bytes");
});

ok("r12 CRITICAL MECHANISM: a hardlink planted at every ENUMERABLE temp name cannot capture the write", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r12-hltmp-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const outside = path.join(base, "outside.md");
  const outsideBytes = Buffer.from("OUTSIDE SECRET — must never be rewritten\n", "utf8");
  fs.writeFileSync(outside, outsideBytes);
  if (!plantEnumerableTempLinks(store, outside)) return;

  const target = path.join(store, "drop_one.md");
  writer(store, target, "REPLACEMENT BODY\n");

  assert.ok(
    fs.readFileSync(outside).equals(outsideBytes),
    "the OUT-OF-STORE file must be byte-unchanged — a write BY PATH to a pre-created temp follows the planted hardlink",
  );
  assert.strictEqual(fs.readFileSync(target, "utf8"), "REPLACEMENT BODY\n", "the in-store target got the new bytes");
});

ok("r12 CRITICAL END-TO-END (correct): a planted temp hardlink cannot reach an out-of-store file", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r12-e2e-corr-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const outside = path.join(base, "outside.md");
  const outsideBytes = Buffer.from("OUTSIDE SECRET — must never be rewritten\n", "utf8");
  fs.writeFileSync(outside, outsideBytes);
  if (!plantEnumerableTempLinks(store, outside)) return;

  // A fully ORDINARY plan: contradicted, real evidence, structurally valid body, a target with one
  // directory entry. Nothing about the plan or the target is suspicious.
  const plan = writePlan(base, {
    store,
    changes: [{ file: "drop_one.md", classification: "contradicted", action: "correct", evidence: "grep shows the claim is false", newBody: VALID_BODY }],
  });
  const res = mod.run({ plan, apply: true }); // IN-PROCESS so process.pid matches the planted names

  // Asserted FIRST: the escape itself. Pre-fix this run returned {ok:true, applied:true} with a
  // clean post-check while the out-of-store file had been overwritten.
  assert.ok(
    fs.readFileSync(outside).equals(outsideBytes),
    "the OUT-OF-STORE file must be BYTE-UNCHANGED",
  );
  assert.strictEqual(res.fatal, true, "the apply must fail closed");
  assert.strictEqual(res.applied, false, "nothing was applied");
});

ok("r12 CRITICAL END-TO-END (delete/index): the index re-sync cannot reach an out-of-store file either", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r12-e2e-del-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const outside = path.join(base, "outside.md");
  const outsideBytes = Buffer.from("OUTSIDE SECRET — must never be rewritten\n", "utf8");
  fs.writeFileSync(outside, outsideBytes);
  if (!plantEnumerableTempLinks(store, outside)) return;

  // The delete path writes MEMORY.md through the SAME writer, so it reproduces independently.
  const plan = writePlan(base, {
    store,
    changes: [{ file: "drop_one.md", classification: "contradicted", action: "delete", evidence: "TRACKER shows this fact was reversed" }],
  });
  const res = mod.run({ plan, apply: true });

  // Asserted FIRST: the escape itself (pre-fix the outside file came back truncated/rewritten).
  assert.ok(
    fs.readFileSync(outside).equals(outsideBytes),
    "the OUT-OF-STORE file must be BYTE-UNCHANGED (the index re-sync used to write through it)",
  );
  assert.strictEqual(res.fatal, true, "the apply must fail closed");
  assert.strictEqual(res.applied, false, "nothing was applied");
  assert.ok(fs.existsSync(path.join(store, "drop_one.md")), "the delete did not happen");
});

ok("r12 CRITICAL: EEXIST ABORTS the write fail-closed — it is NEVER retried under a fresh name", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r12-eexist-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const target = path.join(store, "drop_one.md");
  const before = fs.readFileSync(target);

  const origOpen = fs.openSync;
  let tempOpens = 0;
  fs.openSync = (p, flags, mode) => {
    if (typeof p === "string" && path.basename(p).startsWith(mod.TMP_PREFIX)) {
      tempOpens++;
      throw Object.assign(new Error("EEXIST: file already exists, open"), { code: "EEXIST" });
    }
    return origOpen(p, flags, mode);
  };
  let threw = null;
  try {
    writer(store, target, "SHOULD NEVER LAND\n");
  } catch (e) {
    threw = e;
  } finally {
    fs.openSync = origOpen;
  }

  assert.ok(threw, "the write must abort, not swallow the collision");
  assert.strictEqual(threw.code, "EEXIST", `the abort keeps the code: ${threw && threw.message}`);
  assert.strictEqual(
    tempOpens,
    1,
    `exactly ONE open attempt — a retry under a fresh name would mask an attack in progress (got ${tempOpens})`,
  );
  assert.ok(fs.readFileSync(target).equals(before), "the target is untouched");
  assert.ok(
    !fs.readdirSync(store).some((n) => n.startsWith(mod.TMP_PREFIX)),
    "no temp is left behind by the aborted write",
  );
});

ok("r12 CRITICAL depth: temp names are unguessable (crypto-random) and never repeat", () => {
  assert.strictEqual(typeof mod.tempFileName, "function", "the temp name has ONE generator");
  const names = new Set();
  for (let i = 0; i < 500; i++) {
    const n = mod.tempFileName();
    assert.ok(/^\.memory-apply\.[0-9a-f]{32}\.tmp$/.test(n), `unexpected temp-name shape: ${n}`);
    assert.ok(!n.includes(`.${process.pid}.`), "the pid must not appear in the name — it is enumerable");
    names.add(n);
  }
  assert.strictEqual(names.size, 500, "no repeats");
});

// REWIRED BELOW THE CONTROL (r15 fix brief C6): invoked as a plain (no --apply) dry-run — the
// stray-temp scan this test proves runs whenever `mutations.length` is nonzero, regardless of
// opts.apply, so dry-run reaches the identical refusal untouched by the HOLD.
ok("r12 HYGIENE (explicitly NOT the control): a stray apply temp in the store refuses the plan", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r12-stray-"));
  const store = path.join(base, "agent");
  seedStore(store);
  fs.writeFileSync(path.join(store, ".memory-apply.leftover-from-a-crash.tmp"), "junk\n");
  const before = snapshot(store);
  const plan = writePlan(base, {
    store,
    changes: [{ file: "drop_one.md", classification: "contradicted", action: "correct", evidence: "e", newBody: VALID_BODY }],
  });
  const r = spawnSync(process.execPath, [CHECK, "--plan", plan, "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 2, "a store in an unexplained state is not written into");
  const out = JSON.parse(r.stdout);
  assert.ok(
    (out.violations || []).some((v) => /stray apply temp/.test(v.reason)),
    `the refusal names the stray temp: ${JSON.stringify(out.violations)}`,
  );
  assertUnchanged(store, before, "stray temp refused");
});

// ─────────────────────────────────────────────────────────────────────────────
// gauntlet r12 HIGH — `rolledBack` is an OBSERVATION of the store, not a report
// from the code that was supposed to restore it.
// ─────────────────────────────────────────────────────────────────────────────

// QUARANTINED (r15 fix brief C6): proving rollback VERIFICATION (rolledBack:false + ROLLBACK
// INCOMPLETE on a restore that silently fails) requires a real forward mutation to sabotage
// mid-flight. run()'s HOLD refuses --apply before the plan is even read — before the mutation loop
// or `undo` ever run — so there is no reachable path to this today, and the verification logic is
// internal to run()'s `undo`, with no mechanism below the control to point this at. Restore this
// body from git history when the hold is lifted (ED-310; underlying findings ED-306/307/308/309).
ok("QUARANTINED (was 'r12 HIGH: a rollback whose restore SILENTLY leaves wrong bytes reports rolledBack:false + ROLLBACK INCOMPLETE'): --apply refuses via the HOLD instead — nothing mutated, nothing to roll back", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r12-rbverify-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const before = snapshot(store);
  const newDrop = "---\nname: drop-one\ndescription: corrected\nmetadata:\n  type: feedback\n---\n\nNEW DROP.\n";
  const newKeep = "---\nname: keep-one\ndescription: corrected\nmetadata:\n  type: feedback\n---\n\nNEW KEEP.\n";
  const plan = writePlan(base, {
    store,
    changes: [
      { file: "drop_one.md", classification: "contradicted", action: "correct", evidence: "e1", newBody: newDrop },
      { file: "keep_one.md", classification: "contradicted", action: "correct", evidence: "e2", newBody: newKeep },
    ],
  });
  const res = mod.run({ plan, apply: true });
  assertHoldRefusal(res);
  assertUnchanged(store, before, "the hold refused before any mutation — nothing to roll back or verify");
});

// QUARANTINED (r15 fix brief C6): same reason — proving a GENUINE rollback re-reads every captured
// path requires a real forward mutation to have landed, which the HOLD refuses before the plan is
// even read. Restore this body from git history when the hold is lifted (ED-310; underlying
// findings ED-306/307/308/309).
ok("QUARANTINED (was 'r12 HIGH: a genuine rollback still reports rolledBack:true — after RE-READING every captured path'): --apply refuses via the HOLD instead — nothing mutated, nothing to roll back", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r12-rbok-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const before = snapshot(store);
  const plan = writePlan(base, {
    store,
    changes: [
      { file: "drop_one.md", classification: "contradicted", action: "delete", evidence: "reversed" },
      { file: "keep_one.md", classification: "contradicted", action: "correct", evidence: "drifted", newBody: "---\nname: keep-one\ndescription: corrected\nmetadata:\n  type: feedback\n---\n\nNEW.\n" },
    ],
  });
  const res = mod.run({ plan, apply: true });
  assertHoldRefusal(res);
  assertUnchanged(store, before, "the hold refused before any mutation — nothing to roll back or verify");
});

// ─────────────────────────────────────────────────────────────────────────────
// gauntlet r12 MEDIUM — the pre-check and the post-check are ONE computation
// ─────────────────────────────────────────────────────────────────────────────

// REWIRED BELOW THE CONTROL (r15 hold, brief §1 option (a)): this used to reach the post-mutation
// state by running a real `--apply`, which the hold now refuses. The property under test is
// projectStoreState-vs-disk, and it is preserved intact: the post-mutation state is now produced by
// REPLAYING the same ops through the very primitives run()'s apply loop uses, in the same order —
// fs.unlinkSync for a delete, the write primitive for a correct, and removeIndexLines() through the
// write primitive for the delete's index re-sync (memory-apply.js, the BACKUP → APPLY block). No
// second implementation of the projection or of the write is introduced. What is NOT covered while
// the hold stands is run()'s own SEQUENCING of those primitives.
ok("r12 MEDIUM: the PROJECTED store is exactly what the detector reads after the mutations land", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r12-proj-"));
  const store = path.join(base, "agent");
  seedStore(store);
  fs.writeFileSync(path.join(store, "third.md"), "---\nname: third-one\ndescription: a memory\nmetadata:\n  type: feedback\n---\n\nBody.\n");
  fs.appendFileSync(path.join(store, "MEMORY.md"), "- [Third](third.md) — a memory\n");
  const indexText = fs.readFileSync(path.join(store, "MEMORY.md"), "utf8");

  const newBody = "---\nname: drop-one\ndescription: corrected\nmetadata:\n  type: project\n---\n\nCORRECTED [[keep-one]].\n";
  const mutations = [
    { file: "third.md", canonicalFile: "third.md", action: "delete" },
    { file: "drop_one.md", canonicalFile: "drop_one.md", action: "correct", newBody },
  ];
  const projected = mod.projectStoreState(store, mutations, indexText);

  // The plan still goes through the real gate, so the ops proved below are ops the gate ACCEPTS —
  // a projection that only matches disk for plans nothing would ever apply proves nothing.
  const v = mod.validatePlan({
    store,
    changes: [
      { file: "third.md", classification: "contradicted", action: "delete", evidence: "reversed" },
      { file: "drop_one.md", classification: "contradicted", action: "correct", evidence: "drifted", newBody },
    ],
  });
  assert.strictEqual(v.ok, true, `the gate accepts this plan: ${JSON.stringify(v.violations)}`);

  // Replay the accepted ops through the SAME primitives, in the SAME order as the apply loop.
  const deletedFiles = new Set();
  for (const p of mutations) {
    const fileAbs = path.resolve(store, p.canonicalFile);
    if (p.action === "delete") {
      fs.unlinkSync(fileAbs);
      deletedFiles.add(p.canonicalFile);
    } else {
      writer(store, fileAbs, p.newBody);
    }
  }
  writer(store, path.join(store, "MEMORY.md"), mod.removeIndexLines(indexText, deletedFiles));

  const memmod = require("./memory-integrity.js");
  const actual = memmod.readStore(store, projected.dir, memmod.DEFAULT_MAX_INDEX_LINES);
  assert.deepStrictEqual(projected, actual, "the projection is the post-mutation store record, not an approximation of it");
  assert.deepStrictEqual(
    memmod.evaluate({ stores: [projected] }),
    memmod.evaluate({ stores: [actual] }),
    "so the pre-check and the post-check are the SAME computation over the SAME state",
  );
});

// REWIRED BELOW THE CONTROL (r15 hold, brief §1 option (a)): the mechanism is the PROSPECTIVE
// store-state gate — the projection sees a finding that exists in the store already, and the gate
// refuses on ANY finding rather than only plan-attributable ones. Both halves are still exercised:
// the projection directly (pure projectStoreState + the detector's evaluate), and the gate that
// consumes it through the DRY-RUN, which run() returns from AFTER every gate --apply must clear
// ("DRY-RUN (default) ... returns HERE, after every gate --apply must clear" — memory-apply.js).
// What is NOT covered while the hold stands: that the refusal specifically beats the --apply
// mutation loop to the disk. The ordering is still asserted structurally by the hold's own ORDERING
// PROOF and by "the DRY-RUN clears the same gates as --apply" below.
ok("r12 MEDIUM: an ALREADY-dirty store is refused AT THE GATE, not applied and rolled back", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r12-dirty-"));
  const store = path.join(base, "agent");
  seedStore(store);
  // An orphan: present on disk, referenced by no index line. The plan's own ops are sound.
  fs.writeFileSync(path.join(store, "orphan.md"), "---\nname: orphan-one\ndescription: a memory\nmetadata:\n  type: feedback\n---\n\nBody.\n");
  const before = snapshot(store);
  const indexText = fs.readFileSync(path.join(store, "MEMORY.md"), "utf8");

  // (1) the projection names the PRE-EXISTING finding, even though the plan's own op is sound.
  const memmod = require("./memory-integrity.js");
  const mutations = [{ file: "drop_one.md", canonicalFile: "drop_one.md", action: "delete" }];
  const projected = mod.projectStoreState(store, mutations, indexText);
  const projectedFindings = memmod.evaluate({ stores: [projected] }).findings || [];
  assert.ok(
    projectedFindings.some((f) => f.kind === "orphan-memory-file"),
    `the projection names the pre-existing finding: ${JSON.stringify(projectedFindings)}`,
  );

  // (2) the gate that consumes it refuses the plan on that finding, having mutated nothing.
  const plan = writePlan(base, {
    store,
    changes: [{ file: "drop_one.md", classification: "contradicted", action: "delete", evidence: "TRACKER reversed it" }],
  });
  const r = spawnSync(process.execPath, [CHECK, "--plan", plan, "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 2, "the plan must leave the store fully clean — fail-closed otherwise");
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.applied, false);
  assert.strictEqual(out.rolledBack, undefined, "refused at the gate — nothing to roll back");
  assert.ok(
    (out.prospectiveFindings || []).some((f) => f.kind === "orphan-memory-file"),
    `the gate refuses on the pre-existing finding: ${JSON.stringify(out.prospectiveFindings)}`,
  );
  assertUnchanged(store, before, "already-dirty store refused at the gate");
});

ok("r12 MEDIUM: the DRY-RUN clears the same gates as --apply (no gate/apply divergence)", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r12-dry-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const before = snapshot(store);
  const collide = "---\nname: keep-one\ndescription: a memory\nmetadata:\n  type: feedback\n---\n\nCOLLIDES.\n";
  const plan = writePlan(base, {
    store,
    changes: [{ file: "drop_one.md", classification: "contradicted", action: "correct", evidence: "merged", newBody: collide }],
  });
  const r = spawnSync(process.execPath, [CHECK, "--plan", plan, "--json"], { encoding: "utf8" });
  assert.strictEqual(r.status, 2, "a dry-run must not promise a correct that --apply would refuse");
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.dryRun, true, "it is still reported as a dry-run");
  assert.ok(
    (out.prospectiveFindings || []).some((f) => f.kind === "duplicate-name-slug"),
    `the dry-run sees the store-wide consequence too: ${JSON.stringify(out.prospectiveFindings)}`,
  );
  assertUnchanged(store, before, "dry-run never mutates");
});

// ─────────────────────────────────────────────────────────────────────────────
// gauntlet r13 HIGH — the write primitive asserts CONFINEMENT itself, and is no
// longer advertised on the public surface.
//
// r12 hardened the write's destination and its source but left the primitive
// willing to rename its temp over ANY path a caller named. No plan reached it —
// every internal call site passes an isSafeStoreFilename-validated name resolved
// against storeAbs — so this is a hardening gap, not an escape. It is real all the
// same: the guarantee lived in an agreement among three callers instead of in the
// function that does the writing. Both fixtures below are RED against c004c3d3.
// ─────────────────────────────────────────────────────────────────────────────

ok("r13 HIGH: the write primitive REFUSES an out-of-store target and leaves it BYTE-UNCHANGED", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r13-conf-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const outside = path.join(base, "outside.md");
  const outsideBytes = Buffer.from("OUTSIDE SECRET — must never be rewritten\n", "utf8");
  fs.writeFileSync(outside, outsideBytes);

  let threw = null;
  try {
    writer(store, outside, Buffer.from("NEW\n"));
  } catch (e) {
    threw = e;
  }

  // Asserted FIRST: the damage. Pre-fix this call renamed the temp straight over the outside file.
  assert.ok(
    fs.readFileSync(outside).equals(outsideBytes),
    "the OUT-OF-STORE file must be BYTE-UNCHANGED — the primitive renamed its temp over any path it was handed",
  );
  assert.ok(threw, "the write must be refused, not silently skipped");
  assert.strictEqual(threw.code, "EOUTOFSTORE", `the refusal is fail-closed and typed: ${threw && threw.message}`);
  assert.ok(
    !fs.readdirSync(store).some((n) => n.startsWith(mod.TMP_PREFIX)),
    "the refusal happens BEFORE any temp is created — nothing to clean up",
  );
});

ok("r13 HIGH companion: a LEGITIMATE in-store target still succeeds (the assertion is not 'refuse everything')", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r13-legit-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const target = path.join(store, "drop_one.md");

  writer(store, target, "LEGIT BODY\n");
  assert.strictEqual(fs.readFileSync(target, "utf8"), "LEGIT BODY\n", "an in-store write still lands");

  // The same call spelled with a non-normalized store + target must also pass: the assertion
  // resolves BOTH sides, so it judges the paths rather than their spelling.
  const oddStore = path.join(store, "sub", "..");
  const oddTarget = path.join(store, ".", "keep_one.md");
  writer(oddStore, oddTarget, "LEGIT TOO\n");
  assert.strictEqual(
    fs.readFileSync(path.join(store, "keep_one.md"), "utf8"),
    "LEGIT TOO\n",
    "'.' and '..' spellings that RESOLVE into the store are accepted — the check normalizes, it does not string-match",
  );
});

ok("r13 HIGH (surface): the public export no longer advertises the writer; only the test-only handle reaches it", () => {
  assert.strictEqual(
    mod.atomicWriteInStore,
    undefined,
    "the module must not advertise a write primitive on its public surface",
  );
  assert.strictEqual(
    typeof mod.__testonly__.atomicWriteInStore,
    "function",
    "the test-only handle still reaches it — the FD spy fixture depends on it",
  );
  // The inert exports are deliberately NOT swept up in this: they touch no disk.
  for (const inert of ["tempFileName", "strayTempNames", "isSafeStoreFilename", "validatePlan", "run"]) {
    assert.strictEqual(typeof mod[inert], "function", `${inert} stays exported — it performs no writes`);
  }
  assert.strictEqual(typeof mod.TMP_PREFIX, "string", "TMP_PREFIX stays exported — inert");
});

// ─────────────────────────────────────────────────────────────────────────────
// gauntlet r13 — a failed close() is FATAL, because it is frequently the DEFERRED
// REPORT OF A WRITE FAILURE.
//
// Labelled MEDIUM by the reviewer as FD-lifecycle hygiene; it is worse than that.
// Buffered write errors (ENOSPC, EIO, quota) commonly surface at close rather than
// at the write. Swallowing close and renaming anyway can therefore rename a
// TRUNCATED temp over a perfectly good memory file and return {ok:true,
// applied:true} while doing it — data destruction with a success report. The
// last assertion is the one that encodes that: the good data must survive.
// ─────────────────────────────────────────────────────────────────────────────

// REWIRED BELOW THE CONTROL (r15 hold, brief §1 option (a)): the injection used to be driven by a
// real `--apply`, so under the hold no temp FD was ever opened and the fixture's own precondition
// (`injected === 1`) failed — it was proving nothing. It now targets the temp FD opened by the write
// primitive itself (`__testonly__.atomicWriteInStore`), which is where the close-is-fatal behaviour
// lives and which the hold deliberately does NOT gate. Every assertion about the write survives:
// good bytes intact, no rename of the failed temp, temp unlinked, no stray temp. What is NOT covered
// while the hold stands is the run()-level consequence — that a failed close aborts the surrounding
// transaction and surfaces as {applied:false, fatal:true}.
ok("r13: a failed close() on the temp FD is FATAL — no rename, temp cleaned up, the GOOD TARGET BYTES SURVIVE", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r13-close-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const target = path.join(store, "drop_one.md");
  const before = fs.readFileSync(target); // the perfectly good memory file

  const origOpen = fs.openSync;
  const origClose = fs.closeSync;
  const origRename = fs.renameSync;
  const tempPathByFd = new Map();
  const renameSources = [];
  let failedTmpPath = null;
  let injected = 0;

  fs.openSync = (p, flags, mode) => {
    const fd = origOpen(p, flags, mode);
    if (typeof p === "string" && path.basename(p).startsWith(mod.TMP_PREFIX)) tempPathByFd.set(fd, p);
    return fd;
  };
  // Fail the FIRST temp close only — a realistic transient (ENOSPC surfacing at close), and it
  // leaves the rollback path able to do its job, so the assertions below stay about the forward write.
  fs.closeSync = (fd) => {
    if (tempPathByFd.has(fd) && injected === 0) {
      injected++;
      failedTmpPath = tempPathByFd.get(fd);
      origClose(fd); // really release it — the fixture must not leak the descriptor it is testing
      throw Object.assign(new Error("ENOSPC: no space left on device, close"), { code: "ENOSPC" });
    }
    return origClose(fd);
  };
  fs.renameSync = (a, b) => {
    renameSources.push(a);
    return origRename(a, b);
  };

  let threw = null;
  try {
    writer(store, target, VALID_BODY);
  } catch (e) {
    threw = e;
  } finally {
    fs.openSync = origOpen;
    fs.closeSync = origClose;
    fs.renameSync = origRename;
  }

  assert.strictEqual(injected, 1, "precondition: the close failure was actually injected on a temp FD");

  // THE assertion — β's rationale. Pre-fix the truncated temp was renamed over this file.
  assert.ok(
    fs.readFileSync(target).equals(before),
    "the pre-existing target must be BYTE-UNCHANGED — a swallowed close renames a possibly-truncated temp over good data",
  );
  assert.ok(threw, "a write whose close failed fails CLOSED — the failure is not swallowed as 'the bytes are already written'");
  assert.strictEqual(threw.code, "ENOSPC", `the underlying code survives for the caller: ${threw && threw.message}`);
  assert.ok(
    !renameSources.includes(failedTmpPath),
    `the temp whose close failed must NEVER be renamed (rename sources: ${JSON.stringify(renameSources.map((s) => path.basename(s)))})`,
  );
  assert.ok(failedTmpPath && !fs.existsSync(failedTmpPath), "that temp is unlinked, not left behind");
  assert.ok(
    !fs.readdirSync(store).some((n) => n.startsWith(mod.TMP_PREFIX)),
    "no stray temp survives the aborted write",
  );
});

ok("r13: the close failure is REPORTED, not swallowed — the problem names the failure and its code survives", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-r13-closerep-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const target = path.join(store, "drop_one.md");

  const origOpen = fs.openSync;
  const origClose = fs.closeSync;
  const tempFds = new Set();
  fs.openSync = (p, flags, mode) => {
    const fd = origOpen(p, flags, mode);
    if (typeof p === "string" && path.basename(p).startsWith(mod.TMP_PREFIX)) tempFds.add(fd);
    return fd;
  };
  fs.closeSync = (fd) => {
    if (tempFds.has(fd)) {
      origClose(fd);
      throw Object.assign(new Error("EIO: i/o error, close"), { code: "EIO" });
    }
    return origClose(fd);
  };

  let threw = null;
  try {
    writer(store, target, "SHOULD NEVER LAND\n");
  } catch (e) {
    threw = e;
  } finally {
    fs.openSync = origOpen;
    fs.closeSync = origClose;
  }

  assert.ok(threw, "the close failure must propagate, not be swallowed as 'the bytes are already written'");
  assert.strictEqual(threw.code, "EIO", `the underlying code survives for the caller: ${threw && threw.message}`);
  assert.ok(/close/i.test(threw.message), `the message names the close failure: ${threw.message}`);
  assert.notStrictEqual(
    fs.readFileSync(target, "utf8"),
    "SHOULD NEVER LAND\n",
    "the bytes from the failed-close write never reached the target",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// THE HOLD ITSELF (r15 fix brief §2 / β condition C6). The fixtures above prove the
// mechanisms the hold makes unreachable; these five prove the HOLD, which is now the
// only reachable outcome of --apply. They are the tests that must go RED if the
// CONTROL in run() is ever removed — see the MUTANT PROOF in the brief (§4).
//
// Note WHY the in-process fixtures are load-bearing and the CLI ones are not: main()
// carries its own DEFENSE-IN-DEPTH refusal that fires before run() is even called, so
// a CLI-only assertion would stay green with run()'s CONTROL deleted. Anything that
// claims to prove the CONTROL must call run() directly.
// ─────────────────────────────────────────────────────────────────────────────

ok("HOLD: the refusal cites the SKILL DOC first, then ADR-0039 §A2.1 WITH the parenthetical, and no ED id", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-hold-cite-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const plan = writePlan(base, {
    store,
    changes: [{ file: "drop_one.md", classification: "contradicted", action: "delete", evidence: "TRACKER reversed it" }],
  });

  const res = assertHoldRefusal(mod.run({ plan, apply: true }));
  const msg = res.problems.find((p) => /HELD/.test(p));

  const docAt = msg.indexOf(".claude/commands/memory/verify.md");
  const adrAt = msg.indexOf("ADR-0039 §A2.1");
  assert.ok(docAt >= 0, `the refusal points at the shipped skill doc: ${msg}`);
  assert.ok(adrAt >= 0, `the refusal cites the ADR section: ${msg}`);
  assert.ok(docAt < adrAt, `the SKILL DOC comes FIRST — the reader needs what/why/when before provenance: ${msg}`);
  // REQUIRED, not decoration: ADR-0039 is titled 'agy-barred-as-security-scope-of-record', so a
  // bare section reference strands the reader in an apparently-wrong document.
  assert.ok(
    /ADR-0039 §A2\.1 \(the disclosed-residual rule for security-lane HIGHs\)/.test(msg),
    `the citation says what §A2.1 IS: ${msg}`,
  );
  assert.ok(/not a bug/i.test(msg), `it says the hold is deliberate, not a bug: ${msg}`);
  assert.ok(/memory-integrity\.js/.test(msg), `it says the read-only detector still works: ${msg}`);
  assert.ok(/[Dd]ry-run/.test(msg), `it says dry-run is still available: ${msg}`);
  assert.ok(/no override/i.test(msg), `it says there is no override: ${msg}`);
  // The enforcement-debt register is gitignored: an ED id in USER-FACING text would not survive a
  // fresh clone. Internal code comments may cross-reference it; this string may not.
  assert.ok(!/\bED-\d+\b/.test(msg), `no ED id in the user-facing refusal: ${msg}`);

  // The CLI's defense-in-depth copy must be the SAME string — two copies that drift are two
  // different answers to the same question.
  const cli = spawnSync(process.execPath, [CHECK, "--plan", plan, "--apply", "--json"], { encoding: "utf8" });
  const out = assertHoldRefusal(cli, { cli: true });
  assert.strictEqual(out.problems[0], msg, "the CONTROL and DEFENSE-IN-DEPTH refusals are one string, not two");
});

ok("HOLD ORDERING PROOF: --apply on a plan whose STORE DOES NOT EXIST fails with the HOLD, not the store error", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-hold-order-"));
  const missingStore = path.join(base, "no-such-store");
  assert.ok(!fs.existsSync(missingStore), "precondition: the store really is absent");
  const plan = writePlan(base, {
    store: missingStore,
    changes: [{ file: "drop_one.md", classification: "contradicted", action: "delete", evidence: "TRACKER reversed it" }],
  });

  // THE load-bearing assertion. Without it the CONTROL could sit anywhere after the store check and
  // every other hold test would still pass. run() reaches the store check at "has no MEMORY.md";
  // seeing the HOLD instead proves the refusal precedes that filesystem work.
  const res = assertHoldRefusal(mod.run({ plan, apply: true }));
  const problems = res.problems.join(" | ");
  assert.ok(!/no MEMORY\.md/.test(problems), `the store error was NOT reached — the hold came first: ${problems}`);

  // Deeper still: a plan file that cannot even be READ also yields the HOLD, so the CONTROL
  // precedes the plan read too (memory-apply.js: "plan file unreadable").
  const absentPlan = path.join(base, "not-written.json");
  const res2 = assertHoldRefusal(mod.run({ plan: absentPlan, apply: true }));
  assert.ok(
    !/unreadable/.test(res2.problems.join(" | ")),
    `the plan read was NOT reached either: ${res2.problems.join(" | ")}`,
  );

  // And the CLI agrees (this half proves main()'s defense-in-depth, not the CONTROL).
  const cli = spawnSync(process.execPath, [CHECK, "--plan", plan, "--apply", "--json"], { encoding: "utf8" });
  assertHoldRefusal(cli, { cli: true });
});

ok("HOLD IN-PROCESS PROOF: require(...).run({plan, apply:true}) refuses — the CONTROL, not the CLI layer", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-hold-inproc-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const before = snapshot(store);
  // A plan that clears every gate: pre-hold this was the CLEAN APPLY case (exit 0, file removed).
  const plan = writePlan(base, {
    store,
    changes: [{ file: "drop_one.md", classification: "contradicted", action: "delete", evidence: "TRACKER shows this fact was reversed" }],
  });

  // No spawn: main()'s defense-in-depth cannot participate. This is the CONTROL or nothing.
  const res = assertHoldRefusal(require("./memory-apply.js").run({ plan, apply: true }));
  assert.strictEqual(res.dryRun, false, "a refused --apply is not reported as a dry-run");
  assertUnchanged(store, before, "the in-process caller mutated NOTHING");
});

ok("HOLD NO-OVERRIDE: no env var and no flag re-enables --apply", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-hold-noovr-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const before = snapshot(store);
  const plan = writePlan(base, {
    store,
    changes: [{ file: "drop_one.md", classification: "contradicted", action: "delete", evidence: "TRACKER shows this fact was reversed" }],
  });

  // Every plausible spelling an operator (or a future maintainer) might reach for.
  const env = {
    ...process.env,
    ...mcEnv.envPair("MEMORY_APPLY_FORCE", "1"),
    ...mcEnv.envPair("MEMORY_APPLY_UNHOLD", "1"),
    MEMORY_APPLY_FORCE: "1",
    MEMORY_APPLY_UNHOLD: "1",
    ...mcEnv.envPair("APPLY_FORCE", "1"),
    ...mcEnv.envPair("UNHOLD", "1"),
    ...mcEnv.envPair("HOLD", "0"),
    FORCE: "1",
    UNHOLD: "1",
  };
  const withEnv = spawnSync(process.execPath, [CHECK, "--plan", plan, "--apply", "--json"], { encoding: "utf8", env });
  assertHoldRefusal(withEnv, { cli: true });

  for (const flag of ["--force", "--unhold", "--no-hold", "--override"]) {
    const r = spawnSync(process.execPath, [CHECK, "--plan", plan, "--apply", flag, "--json"], { encoding: "utf8" });
    assertHoldRefusal(r, { cli: true });
  }
  assertUnchanged(store, before, "no env var and no flag let a mutation through");

  // STRUCTURAL, and the reason this test stays honest as the module changes: the module reads
  // exactly ONE environment variable, and it is the project-root resolver — there is no env-gated
  // branch for a bypass to hide in. Adding one reds this assertion.
  const src = fs.readFileSync(CHECK, "utf8");
  const envNames = [...new Set([...src.matchAll(/process\.env\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))].sort();
  assert.deepStrictEqual(envNames, ["CLAUDE_PROJECT_DIR"], `the module's only env read is the project root: ${envNames}`);
  assert.ok(!/process\.env\s*\[/.test(src), "no dynamic env lookup either — a computed key is a bypass too");
});

ok("HOLD DRY-RUN REGRESSION: a clean dry-run still exits 0 and still prints its planned ops", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "memapply-hold-dry-"));
  const store = path.join(base, "agent");
  seedStore(store);
  const before = snapshot(store);
  const plan = writePlan(base, {
    store,
    changes: [
      { file: "drop_one.md", classification: "contradicted", action: "delete", evidence: "TRACKER shows this fact was reversed" },
      { file: "keep_one.md", classification: "verified", action: "none", evidence: "still true" },
    ],
  });

  const r = spawnSync(process.execPath, [CHECK, "--plan", plan], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, `the hold must not have collaterally broken the report-only path: ${r.stdout}${r.stderr}`);
  assert.ok(/^DRY-RUN /m.test(r.stdout), `it still reports as a dry-run: ${r.stdout}`);
  assert.ok(/would delete drop_one\.md/.test(r.stdout), `it still prints the planned ops: ${r.stdout}`);
  assert.ok(/no-op keep_one\.md/.test(r.stdout), `including the no-ops: ${r.stdout}`);
  assertUnchanged(store, before, "the dry-run mutates nothing");
});

console.log(`\nmemory-apply: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
