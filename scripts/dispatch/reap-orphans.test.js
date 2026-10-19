#!/usr/bin/env node
"use strict";

const { harness } = require("../checks/lib/fixture-harness");
const { classify, isDispatchProc, terminate, ORPHAN_MIN_AGE_MS } = require("./reap-orphans");

const h = harness("reap-orphans");

const MIN = 20 * 60 * 1000;
const OLD = MIN + 60_000;
const YOUNG = 5_000;

const _path = require("path");
const _ROOT = process.env.CLAUDE_PROJECT_DIR || _path.resolve(__dirname, "..", "..");
const WRAP = _path.resolve(_ROOT, "scripts", "dispatch-agent.js");
const DCMD = "node " + WRAP + " reviewer p.txt";

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

h.test("a bare `node foo.js` is NOT a candidate (not even skipped)", () => {
  const res = run({ pid: 100, ppid: 1, ageMs: OLD, cmd: "node some/unrelated.js" });
  assert(!isOrphan(res, 100) && !isSkipped(res, 100), "non-dispatch proc must be ignored entirely");
});
h.test("a foreign `claude` (no telemetry marker) is NOT a candidate", () => {
  const res = run({ pid: 101, ppid: 1, ageMs: OLD, cmd: "claude -p --agent foo" });
  assert(!isOrphan(res, 101) && !isSkipped(res, 101), "a non-MC claude must not be touched");
});
h.test("isDispatchProc matches only `node <abs-canonical-wrapper>`", () => {
  const wrapC = _path.resolve(_ROOT, "scripts", "dispatch-claude.js");
  assert(isDispatchProc("node " + wrapC + " builder p.txt"), "node + abs dispatch-claude.js");
  assert(isDispatchProc("node " + WRAP + " reviewer p.txt"), "node + abs dispatch-agent.js");
  assert(!isDispatchProc("codex exec MC_RUN_ID=abc"), "marker branch removed — codex never matches on its own argv");
  assert(!isDispatchProc("node build.js"), "unrelated node");
  assert(!isDispatchProc("node scripts/dispatch-agent.js reviewer"), "a RELATIVE wrapper path never matches (abs required)");
  assert(!isDispatchProc(""), "empty cmd");
  assert(!isDispatchProc("node"), "node with no operand");
});

h.test("dispatch proc reparented to init (ppid=1), old, no lock => ORPHAN", () => {
  const res = run({ pid: 200, ppid: 1, ageMs: OLD, cmd: DCMD });
  assert(isOrphan(res, 200), "a reparented, old, unlocked dispatch subprocess is an orphan");
});
h.test("dispatch proc whose parent is ALIVE in the snapshot => SKIP (parent-alive)", () => {
  const res = run(
    { pid: 301, ppid: 300, ageMs: OLD, cmd: DCMD },
    { procs: [{ pid: 300, ppid: 10, ageMs: OLD, cmd: "node harness" }] },
  );
  assert(isSkipped(res, 301) && !isOrphan(res, 301), "a child of a live parent is NOT an orphan");
  const why = res.skipped.find((s) => s.pid === 301).reasons;
  assert(why.includes("parent-alive"), "skip reason must be parent-alive");
});

h.test("a YOUNG dispatch orphan => SKIP (too-young — may be live in-flight)", () => {
  const res = run({ pid: 400, ppid: 1, ageMs: YOUNG, cmd: DCMD });
  assert(isSkipped(res, 400) && !isOrphan(res, 400), "young process must be spared");
  assert(res.skipped.find((s) => s.pid === 400).reasons.some((r) => r.startsWith("too-young")), "reason too-young");
});

h.test("a dispatch orphan WITH a fresh live lock => SKIP (has-live-lock)", () => {
  const res = run(
    { pid: 500, ppid: 1, ageMs: OLD, cmd: DCMD },
    { livePids: new Set([500]) },
  );
  assert(isSkipped(res, 500) && !isOrphan(res, 500), "a live-locked dispatch is alive + tracked, never reaped");
  assert(res.skipped.find((s) => s.pid === 500).reasons.includes("has-live-lock"), "reason has-live-lock");
});

h.test("the reaper's own PID is never reaped (own-process-tree)", () => {
  const res = run(
    { pid: 600, ppid: 1, ageMs: OLD, cmd: DCMD },
    { selfTree: new Set([600]) },
  );
  assert(isSkipped(res, 600) && !isOrphan(res, 600), "own tree must be spared");
  assert(res.skipped.find((s) => s.pid === 600).reasons.includes("own-process-tree"), "reason own-process-tree");
});

h.test("ambiguous parent (ppid present, NOT in snapshot, unprovable) => SKIP", () => {
  const res = run({ pid: 700, ppid: NaN, ageMs: OLD, cmd: DCMD });
  assert(isSkipped(res, 700) && !isOrphan(res, 700), "unknown parent ⇒ ambiguous ⇒ skip (fail-open)");
  assert(res.skipped.find((s) => s.pid === 700).reasons.includes("parent-liveness-unknown"), "reason parent-liveness-unknown");
});

h.test("mixed batch: only the genuine orphan is flagged; live/young/foreign spared", () => {
  const res = classify({
    procs: [
      { pid: 800, ppid: 1, ageMs: OLD, cmd: DCMD },
      { pid: 801, ppid: 1, ageMs: YOUNG, cmd: DCMD },
      { pid: 802, ppid: 1, ageMs: OLD, cmd: "node unrelated.js" },
      { pid: 803, ppid: 50, ageMs: OLD, cmd: DCMD },
      { pid: 50, ppid: 1, ageMs: OLD, cmd: "node harness" },
    ],
    selfTree: new Set(),
    livePids: new Set(),
    now: Date.now(),
    minAgeMs: MIN,
  });
  assert(res.orphans.length === 1 && res.orphans[0].pid === 800, "exactly one orphan (pid 800)");
  assert(!isOrphan(res, 801) && !isOrphan(res, 802) && !isOrphan(res, 803), "others spared");
});

h.test("age-unknown (ageMs=Infinity) => SKIP, never reaped", () => {
  const res = run({ pid: 1000, ppid: 1, ageMs: Infinity, startMs: NaN, cmd: DCMD });
  assert(isSkipped(res, 1000) && !isOrphan(res, 1000), "unknown age must be spared");
  assert(res.skipped.find((s) => s.pid === 1000).reasons.includes("age-unknown"), "reason age-unknown");
});
h.test("minAgeMs=NaN does not disable the age gate", () => {
  const res = classify({
    procs: [{ pid: 1001, ppid: 1, ageMs: 5000, startMs: Date.now() - 5000, cmd: DCMD }],
    selfTree: new Set(), livePids: new Set(), now: Date.now(), minAgeMs: NaN,
  });
  assert(!isOrphan(res, 1001), "a 5s proc must NOT be reaped even with minAgeMs=NaN (floor applies)");
});
h.test("minAgeMs=0 does not disable the age gate", () => {
  const res = classify({
    procs: [{ pid: 1002, ppid: 1, ageMs: 5000, startMs: Date.now() - 5000, cmd: DCMD }],
    selfTree: new Set(), livePids: new Set(), now: Date.now(), minAgeMs: 0,
  });
  assert(!isOrphan(res, 1002), "minAgeMs=0 must clamp to the floor, not reap a 5s proc");
});
h.test("locksOk=false (lock enum failed) => every candidate spared", () => {
  const res = classify({
    procs: [{ pid: 1003, ppid: 1, ageMs: OLD, startMs: Date.now() - OLD, cmd: DCMD }],
    selfTree: new Set(), livePids: new Set(), locksOk: false, now: Date.now(), minAgeMs: MIN,
  });
  assert(!isOrphan(res, 1003), "cannot read locks => cannot reap");
  assert(res.skipped.find((s) => s.pid === 1003).reasons.includes("lock-state-unknown"), "reason lock-state-unknown");
});
h.test("SIGNATURE: only `node <abs-operand-wrapper>` matches; every spoof is rejected", () => {
  const path = require("path");
  const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
  const realClaude = path.resolve(ROOT, "scripts", "dispatch-claude.js");
  const realAgent = path.resolve(ROOT, "scripts", "dispatch-agent.js");
  assert(isDispatchProc("node " + realClaude + " builder p.txt"), "node + abs dispatch-claude.js (the script operand)");
  assert(isDispatchProc(["node", realAgent, "reviewer"]), "argv-array form with the abs wrapper operand");
  assert(!isDispatchProc("grep dispatch-agent.js somefile.txt"), "argv[0]=grep — not node");
  assert(!isDispatchProc("python worker.py --file " + realAgent), "argv[0]=python — not node");
  assert(!isDispatchProc("node /tmp/evil/dispatch-claude.js"), "a dispatch-claude.js NOT our canonical path");
  assert(!isDispatchProc("node scripts/dispatch-agent.js reviewer"), "RELATIVE operand (foreign-cwd forgery) — abs required");
  assert(!isDispatchProc("node -e \"require('x')\" " + realAgent), "the wrapper after `-e <code>` is NOT the operand");
  assert(!isDispatchProc(["node", "-e", "console.log(1)", realAgent]), "argv form: -e consumes code; trailing wrapper is not the operand");
  assert(!isDispatchProc(["claude", "--prompt", "remember " + realAgent + " is the path"]), "claude (not node) with the path inside a --prompt value");
  assert(!isDispatchProc(["node", "--prompt", "MC_RUN_ID=demo"]), "a marker as a --prompt value is NOT identity");
  assert(!isDispatchProc(["node", "evil arg " + realAgent]), "a single argv value containing the path is ONE token, not the operand");
  assert(!isDispatchProc(["node", "--import", realAgent, "x"]), "--import <wrapper> — wrapper is the flag value, not the operand");
  assert(!isDispatchProc(["node", "--loader", realAgent]), "--loader <wrapper> — flag value, not operand");
  assert(!isDispatchProc(["node", "--env-file", realAgent, "x"]), "--env-file <wrapper> — flag value, not operand");
  assert(!isDispatchProc("node --eval=\"setInterval(()=>{},1e6)\" " + realAgent), "--eval=<code> <wrapper> — inline eval, wrapper is not the operand");
  assert(!isDispatchProc(["node", "--unknown-future-flag", realAgent]), "any flag before the wrapper => not our shape => no match (conservative)");
  assert(!isDispatchProc(["node", "--max-old-space-size=4096", realAgent, "x"]), "--flag=value before the wrapper => no match (argv[1] must be the wrapper)");
  assert(!isDispatchProc("node --test=abc " + realAgent), "--test=<x> (entry-mode switch) before the wrapper => no match");
  assert(!isDispatchProc("node --run=foo " + realAgent), "--run=<x> (entry-mode switch) before the wrapper => no match");
  const wrapDotted = realAgent.replace(/dispatch-agent\.js$/, "x/../dispatch-agent.js");
  assert(isDispatchProc(["node", wrapDotted]), "a real wrapper path with a .. segment resolves + matches");
});
h.test("a candidate with pid<=1 is never classified as an orphan", () => {
  const res = classify({
    procs: [{ pid: 1, ppid: 0, ageMs: OLD, startMs: 1, cmd: DCMD }],
    selfTree: new Set(), livePids: new Set(), now: Date.now(), minAgeMs: MIN,
  });
  assert(!isOrphan(res, 1) && !isSkipped(res, 1), "pid<=1 must be dropped entirely");
});
h.test("terminate() refuses pid<=1, pid 0, and our own pid", () => {
  assert(terminate(0).signalled === false, "pid 0 refused");
  assert(terminate(1).signalled === false, "pid 1 refused");
  assert(terminate(-5).signalled === false, "negative pid refused");
  assert(terminate(process.pid).signalled === false, "own pid refused");
});
h.test("a descendant of the reaper's tree is spared (own-process-tree)", () => {
  const procs = [
    { pid: 1100, ppid: 1101, ageMs: OLD, startMs: Date.now() - OLD, cmd: DCMD },
    { pid: 1101, ppid: process.pid, ageMs: OLD, startMs: Date.now() - OLD, cmd: "node middle" },
  ];
  const { selfTree } = require("./reap-orphans");
  const res = classify({ procs, selfTree: selfTree(procs), livePids: new Set(), now: Date.now(), minAgeMs: MIN });
  assert(!isOrphan(res, 1100), "a descendant of our tree must be spared");
  assert(res.skipped.find((s) => s.pid === 1100).reasons.includes("own-process-tree"), "reason own-process-tree");
});

h.violation("a genuine orphan is NOT spared (reaper is not a no-op)", () => {
  const res = run({ pid: 900, ppid: 1, ageMs: OLD, cmd: DCMD });
  return { ok: res.orphans.length === 0 };
});

h.failClosed("classify(null) does not green-light a reap", () => {
  const res = classify(null);
  if (res && Array.isArray(res.orphans) && res.orphans.length === 0) {
    throw new Error("ok: no orphans from null input (fail-safe)");
  }
  return { ok: false };
});

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

h.done();
