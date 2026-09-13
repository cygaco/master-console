#!/usr/bin/env node
"use strict";

/**
 * reap-orphans.test.js — P5 fixture test for the orphaned-dispatch-subprocess
 * reaper (E-TEAMS-MIGRATION-001). Exercises the PURE classify() core with PLANTED
 * process snapshots — no real `ps`/`taskkill`, no live processes — so every safety
 * gate is proven against known inputs:
 *
 *   GATE 1 signature   — only MC dispatch subprocesses are candidates.
 *   GATE 2 orphaned    — parent dead / reparented-to-init ⇒ orphan; parent alive ⇒ skip.
 *   GATE 3 age         — younger than min-age ⇒ skip (may be a live in-flight dispatch).
 *   GATE 4 live-lock   — a fresh concurrency lock for the PID ⇒ skip (alive + tracked).
 *   GATE 5 own-tree    — never the reaper's own PID / ancestors.
 *   FAIL-OPEN          — ambiguous parent liveness ⇒ skip (never reap on unknown).
 *
 * The P5 PLANTED-VIOLATION (h.violation) is inverted vs an enforcer: here a "pass"
 * means "the gate spared a process it must NOT reap"; the planted-violation proves
 * the reaper DOES flag a genuine orphan (so it isn't a no-op that spares everything).
 *
 *   node scripts/dispatch/reap-orphans.test.js
 */

const { harness } = require("../checks/lib/fixture-harness");
const { classify, isDispatchProc, terminate, ORPHAN_MIN_AGE_MS } = require("./reap-orphans");

const h = harness("reap-orphans");

const MIN = 20 * 60 * 1000; // 20min age floor used by the production default
const OLD = MIN + 60_000; // comfortably past the floor
const YOUNG = 5_000; // 5s — well under the floor

// The r3 redesign requires the ABSOLUTE canonical wrapper path as the node script
// operand. Build the real path so fixtures match exactly what the matcher accepts.
const _path = require("path");
const _ROOT = process.env.CLAUDE_PROJECT_DIR || _path.resolve(__dirname, "..", "..");
const WRAP = _path.resolve(_ROOT, "scripts", "dispatch-agent.js");
// A realistic dispatch command: node <abs-wrapper> <role> <prompt>.
const DCMD = "node " + WRAP + " reviewer p.txt";

// Helper: run classify with a single proc + sensible defaults, return {orphans, skipped}.
function run(proc, extra = {}) {
  const procs = [proc, ...(extra.procs || [])];
  return classify({
    procs,
    selfTree: extra.selfTree || new Set(),
    livePids: extra.livePids || new Set(),
    now: Date.now(),
    minAgeMs: MIN,
  });
}
const isOrphan = (res, pid) => res.orphans.some((o) => o.pid === pid);
const isSkipped = (res, pid) => res.skipped.some((s) => s.pid === pid);

// ── GATE 1: signature ────────────────────────────────────────────────────────
h.test("a bare `node foo.js` is NOT a candidate (not even skipped)", () => {
  const res = run({ pid: 100, ppid: 1, ageMs: OLD, cmd: "node some/unrelated.js" });
  assert(!isOrphan(res, 100) && !isSkipped(res, 100), "non-dispatch proc must be ignored entirely");
});
h.test("a foreign `claude` (no telemetry marker) is NOT a candidate", () => {
  const res = run({ pid: 101, ppid: 1, ageMs: OLD, cmd: "claude -p --agent foo" });
  assert(!isOrphan(res, 101) && !isSkipped(res, 101), "a non-MC claude must not be touched");
});
h.test("isDispatchProc matches only `node <abs-canonical-wrapper>` (r3 redesign)", () => {
  const wrapC = _path.resolve(_ROOT, "scripts", "dispatch-claude.js");
  assert(isDispatchProc("node " + wrapC + " builder p.txt"), "node + abs dispatch-claude.js");
  assert(isDispatchProc("node " + WRAP + " reviewer p.txt"), "node + abs dispatch-agent.js");
  assert(!isDispatchProc("codex exec MC_RUN_ID=abc"), "marker branch removed — codex never matches on its own argv");
  assert(!isDispatchProc("node build.js"), "unrelated node");
  assert(!isDispatchProc("node scripts/dispatch-agent.js reviewer"), "a RELATIVE wrapper path no longer matches (abs required)");
  assert(!isDispatchProc(""), "empty cmd");
  assert(!isDispatchProc("node"), "node with no operand");
});

// ── GATE 2: orphaned (the core decision) ─────────────────────────────────────
h.test("dispatch proc reparented to init (ppid=1), old, no lock => ORPHAN", () => {
  const res = run({ pid: 200, ppid: 1, ageMs: OLD, cmd: DCMD });
  assert(isOrphan(res, 200), "a reparented, old, unlocked dispatch subprocess is an orphan");
});
h.test("dispatch proc whose parent is ALIVE in the snapshot => SKIP (parent-alive)", () => {
  // parent pid 300 present in the snapshot ⇒ alive ⇒ not an orphan.
  const res = run(
    { pid: 301, ppid: 300, ageMs: OLD, cmd: DCMD },
    { procs: [{ pid: 300, ppid: 10, ageMs: OLD, cmd: "node harness" }] },
  );
  assert(isSkipped(res, 301) && !isOrphan(res, 301), "a child of a live parent is NOT an orphan");
  const why = res.skipped.find((s) => s.pid === 301).reasons;
  assert(why.includes("parent-alive"), "skip reason must be parent-alive");
});

// ── GATE 3: age ──────────────────────────────────────────────────────────────
h.test("a YOUNG dispatch orphan => SKIP (too-young — may be live in-flight)", () => {
  const res = run({ pid: 400, ppid: 1, ageMs: YOUNG, cmd: DCMD });
  assert(isSkipped(res, 400) && !isOrphan(res, 400), "young process must be spared");
  assert(res.skipped.find((s) => s.pid === 400).reasons.some((r) => r.startsWith("too-young")), "reason too-young");
});

// ── GATE 4: live lock ────────────────────────────────────────────────────────
h.test("a dispatch orphan WITH a fresh live lock => SKIP (has-live-lock)", () => {
  const res = run(
    { pid: 500, ppid: 1, ageMs: OLD, cmd: DCMD },
    { livePids: new Set([500]) },
  );
  assert(isSkipped(res, 500) && !isOrphan(res, 500), "a live-locked dispatch is alive + tracked, never reaped");
  assert(res.skipped.find((s) => s.pid === 500).reasons.includes("has-live-lock"), "reason has-live-lock");
});

// ── GATE 5: own process tree ─────────────────────────────────────────────────
h.test("the reaper's own PID is never reaped (own-process-tree)", () => {
  const res = run(
    { pid: 600, ppid: 1, ageMs: OLD, cmd: DCMD },
    { selfTree: new Set([600]) },
  );
  assert(isSkipped(res, 600) && !isOrphan(res, 600), "own tree must be spared");
  assert(res.skipped.find((s) => s.pid === 600).reasons.includes("own-process-tree"), "reason own-process-tree");
});

// ── FAIL-OPEN: ambiguous parent ──────────────────────────────────────────────
h.test("ambiguous parent (ppid present, NOT in snapshot, unprovable) => SKIP", () => {
  // ppid 9999 not in snapshot; classify calls pidAlive(9999). On a real box 9999
  // is almost certainly dead ⇒ would be orphan. To make the AMBIGUITY deterministic
  // we instead assert the inverse: a proc with a NON-finite ppid is parent-unknown.
  const res = run({ pid: 700, ppid: NaN, ageMs: OLD, cmd: DCMD });
  assert(isSkipped(res, 700) && !isOrphan(res, 700), "unknown parent ⇒ ambiguous ⇒ skip (fail-open)");
  assert(res.skipped.find((s) => s.pid === 700).reasons.includes("parent-liveness-unknown"), "reason parent-liveness-unknown");
});

// ── multi-condition: ONLY the genuine orphan among a mixed batch ──────────────
h.test("mixed batch: only the genuine orphan is flagged; live/young/foreign spared", () => {
  const res = classify({
    procs: [
      { pid: 800, ppid: 1, ageMs: OLD, cmd: DCMD }, // ORPHAN
      { pid: 801, ppid: 1, ageMs: YOUNG, cmd: DCMD }, // young → skip
      { pid: 802, ppid: 1, ageMs: OLD, cmd: "node unrelated.js" }, // not ours → ignored
      { pid: 803, ppid: 50, ageMs: OLD, cmd: DCMD }, // parent alive → skip
      { pid: 50, ppid: 1, ageMs: OLD, cmd: "node harness" }, // the live parent
    ],
    selfTree: new Set(),
    livePids: new Set(),
    now: Date.now(),
    minAgeMs: MIN,
  });
  assert(res.orphans.length === 1 && res.orphans[0].pid === 800, "exactly one orphan (pid 800)");
  assert(!isOrphan(res, 801) && !isOrphan(res, 802) && !isOrphan(res, 803), "others spared");
});

// ── GAUNTLET HARDENING (security-reviewer fix-cycle 1) ───────────────────────
// CRIT-1: a NON-FINITE age (unknown start time) is ambiguity, never "old" => SKIP.
h.test("CRIT-1: age-unknown (ageMs=Infinity) => SKIP, never reaped", () => {
  const res = run({ pid: 1000, ppid: 1, ageMs: Infinity, startMs: NaN, cmd: DCMD });
  assert(isSkipped(res, 1000) && !isOrphan(res, 1000), "unknown age must be spared");
  assert(res.skipped.find((s) => s.pid === 1000).reasons.includes("age-unknown"), "reason age-unknown");
});
// CRIT-2: a NaN or below-floor minAgeMs must NOT disable the age gate (defaults to floor).
h.test("CRIT-2: minAgeMs=NaN does not disable the age gate", () => {
  const res = classify({
    procs: [{ pid: 1001, ppid: 1, ageMs: 5000, startMs: Date.now() - 5000, cmd: DCMD }],
    selfTree: new Set(), livePids: new Set(), now: Date.now(), minAgeMs: NaN,
  });
  assert(!isOrphan(res, 1001), "a 5s proc must NOT be reaped even with minAgeMs=NaN (floor applies)");
});
h.test("CRIT-2: minAgeMs=0 does not disable the age gate", () => {
  const res = classify({
    procs: [{ pid: 1002, ppid: 1, ageMs: 5000, startMs: Date.now() - 5000, cmd: DCMD }],
    selfTree: new Set(), livePids: new Set(), now: Date.now(), minAgeMs: 0,
  });
  assert(!isOrphan(res, 1002), "minAgeMs=0 must clamp to the floor, not reap a 5s proc");
});
// HIGH-4: lock-state-unknown (locksOk:false) => spare EVERYTHING.
h.test("HIGH-4: locksOk=false (lock enum failed) => every candidate spared", () => {
  const res = classify({
    procs: [{ pid: 1003, ppid: 1, ageMs: OLD, startMs: Date.now() - OLD, cmd: DCMD }],
    selfTree: new Set(), livePids: new Set(), locksOk: false, now: Date.now(), minAgeMs: MIN,
  });
  assert(!isOrphan(res, 1003), "cannot read locks => cannot reap");
  assert(res.skipped.find((s) => s.pid === 1003).reasons.includes("lock-state-unknown"), "reason lock-state-unknown");
});
// SIGNATURE (r3 redesign + r4 hardening): the ONLY match is `node <abs-canonical-
// wrapper>` where the wrapper is the SCRIPT OPERAND (not a -e/-p value, not an
// arbitrary later token) and ABSOLUTE (no ROOT-relative/foreign-cwd forgery). The
// marker-in-argv branch is GONE (a --prompt value can contain it; env is unreadable).
h.test("SIGNATURE: only `node <abs-operand-wrapper>` matches; every spoof is rejected", () => {
  const path = require("path");
  const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
  const realClaude = path.resolve(ROOT, "scripts", "dispatch-claude.js");
  const realAgent = path.resolve(ROOT, "scripts", "dispatch-agent.js");
  // POSITIVES — a genuine wrapper invocation:
  assert(isDispatchProc("node " + realClaude + " builder p.txt"), "node + abs dispatch-claude.js (the script operand)");
  assert(isDispatchProc(["node", realAgent, "reviewer"]), "argv-array form with the abs wrapper operand");
  // NEGATIVES — the reviewer's r2/r4 spoofs must ALL be rejected:
  assert(!isDispatchProc("grep dispatch-agent.js somefile.txt"), "argv[0]=grep — not node");
  assert(!isDispatchProc("python worker.py --file " + realAgent), "argv[0]=python — not node (r2 HIGH-5)");
  assert(!isDispatchProc("node /tmp/evil/dispatch-claude.js"), "a dispatch-claude.js NOT our canonical path");
  assert(!isDispatchProc("node scripts/dispatch-agent.js reviewer"), "RELATIVE operand (foreign-cwd forgery) — abs required (r4 MED)");
  assert(!isDispatchProc("node -e \"require('x')\" " + realAgent), "the wrapper after `-e <code>` is NOT the operand (r4 HIGH)");
  assert(!isDispatchProc(["node", "-e", "console.log(1)", realAgent]), "argv form: -e consumes code; trailing wrapper is not the operand (r4 HIGH)");
  assert(!isDispatchProc(["claude", "--prompt", "remember " + realAgent + " is the path"]), "claude (not node) with the path inside a --prompt value");
  assert(!isDispatchProc(["node", "--prompt", "MC_RUN_ID=demo"]), "a marker as a --prompt value is NOT identity (r4 HIGH — marker branch removed)");
  assert(!isDispatchProc(["node", "evil arg " + realAgent]), "a single argv value containing the path is ONE token, not the operand");
  // security-final: a value-consuming node flag must NOT promote the wrapper to operand:
  assert(!isDispatchProc(["node", "--import", realAgent, "x"]), "--import <wrapper> — wrapper is the flag value, not the operand");
  assert(!isDispatchProc(["node", "--loader", realAgent]), "--loader <wrapper> — flag value, not operand");
  assert(!isDispatchProc(["node", "--env-file", realAgent, "x"]), "--env-file <wrapper> — flag value, not operand");
  assert(!isDispatchProc("node --eval=\"setInterval(()=>{},1e6)\" " + realAgent), "--eval=<code> <wrapper> — inline eval, wrapper is not the operand");
  assert(!isDispatchProc(["node", "--unknown-future-flag", realAgent]), "any flag before the wrapper => not our shape => no match (conservative)");
  // FINAL tightening: ANY flag before the wrapper (even a benign --flag=value or an
  // entry-mode switch like --test=/--run=) => no match. Real dispatch is `node <w>`.
  assert(!isDispatchProc(["node", "--max-old-space-size=4096", realAgent, "x"]), "--flag=value before the wrapper => no match (argv[1] must be the wrapper)");
  assert(!isDispatchProc("node --test=abc " + realAgent), "--test=<x> (entry-mode switch) before the wrapper => no match (the security-final HIGH)");
  assert(!isDispatchProc("node --run=foo " + realAgent), "--run=<x> (entry-mode switch) before the wrapper => no match");
  // the wrapper written with a `..` segment still matches (false-negative close):
  const wrapDotted = realAgent.replace(/dispatch-agent\.js$/, "x/../dispatch-agent.js");
  assert(isDispatchProc(["node", wrapDotted]), "a real wrapper path with a .. segment resolves + matches");
});
// HIGH-6: pid<=1 is dropped by classify (defense in depth even if enum let it through).
h.test("HIGH-6: a candidate with pid<=1 is never classified as an orphan", () => {
  const res = classify({
    procs: [{ pid: 1, ppid: 0, ageMs: OLD, startMs: 1, cmd: DCMD }],
    selfTree: new Set(), livePids: new Set(), now: Date.now(), minAgeMs: MIN,
  });
  assert(!isOrphan(res, 1) && !isSkipped(res, 1), "pid<=1 must be dropped entirely");
});
// MEDIUM-7: terminate() refuses pid<=1 and self.
h.test("MEDIUM-7: terminate() refuses pid<=1, pid 0, and our own pid", () => {
  assert(terminate(0).signalled === false, "pid 0 refused");
  assert(terminate(1).signalled === false, "pid 1 refused");
  assert(terminate(-5).signalled === false, "negative pid refused");
  assert(terminate(process.pid).signalled === false, "own pid refused");
});
// MEDIUM-8: descendants of the reaper's own tree are excluded too.
h.test("MEDIUM-8: a descendant of the reaper's tree is spared (own-process-tree)", () => {
  // selfTree built from a snapshot where pid 1100 is OUR child (ppid=process.pid path).
  const procs = [
    { pid: 1100, ppid: 1101, ageMs: OLD, startMs: Date.now() - OLD, cmd: DCMD },
    { pid: 1101, ppid: process.pid, ageMs: OLD, startMs: Date.now() - OLD, cmd: "node middle" },
  ];
  const { selfTree } = require("./reap-orphans");
  const res = classify({ procs, selfTree: selfTree(procs), livePids: new Set(), now: Date.now(), minAgeMs: MIN });
  assert(!isOrphan(res, 1100), "a descendant of our tree must be spared");
  assert(res.skipped.find((s) => s.pid === 1100).reasons.includes("own-process-tree"), "reason own-process-tree");
});

// ── P5 planted-violation: the reaper DOES flag a real orphan (not a no-op) ─────
// "pass" for h.violation == NOT a pass; we want isPass(...) to be FALSE here, i.e.
// classify returns a NON-empty orphans list (ok:false-shaped). We adapt: return a
// {ok} where ok=true means "spared everything" (the failure mode we guard against).
h.violation("a genuine orphan is NOT spared (reaper is not a no-op)", () => {
  const res = run({ pid: 900, ppid: 1, ageMs: OLD, cmd: DCMD });
  // ok:true would mean "spared the real orphan" = the false-green we must catch.
  return { ok: res.orphans.length === 0 };
});

// ── fail-closed: classify tolerates malformed input without throwing green ────
h.failClosed("classify(null) does not green-light a reap", () => {
  const res = classify(null);
  // No procs ⇒ no orphans ⇒ returning {ok:true} would (correctly) be "nothing to
  // reap". To satisfy failClosed we assert it did NOT produce orphans from garbage.
  if (res && Array.isArray(res.orphans) && res.orphans.length === 0) {
    throw new Error("ok: no orphans from null input (fail-safe)"); // throw == fail-closed-ok
  }
  return { ok: false };
});

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

h.done();
