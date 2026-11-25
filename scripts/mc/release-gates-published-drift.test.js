"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const CHECK = path.join("scripts", "checks", "emit-drift-vs-published.js");
let canned = null;
let seen = null;
const realSpawnSync = cp.spawnSync;
cp.spawnSync = function routed(cmd, args, opts) {
  if (canned && Array.isArray(args) && typeof args[0] === "string" && args[0].endsWith(CHECK)) {
    seen = args.slice(1);
    return canned;
  }
  return realSpawnSync.apply(this, arguments);
};
const { run } = require("./release-gates.js");
const GATE = "published_emit_drift";
const ALL_GATES = [...fs.readFileSync(path.join(__dirname, "release-gates.js"), "utf8").matchAll(/\bgate\("([a-z0-9_]+)"/g)].map((m) => m[1]);
const gateWith = (status, stdout, stderr) => {
  canned = { status, stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout), stderr: stderr || "" };
  try {
    return run({ skip: ALL_GATES.filter((g) => g !== GATE) }).results.find((r) => r.name === GATE);
  } finally {
    canned = null;
  }
};
const PC = "a".repeat(40);
const CANNOT = /COULD NOT RUN - not a pass/;

test("the gate exists and runs the enforcer in source mode with --json", () => {
  assert.ok(ALL_GATES.includes(GATE));
  gateWith(0, { ok: true, skipped: false, published_commit: PC, removals: [], changed: [] });
  assert.deepStrictEqual(seen, ["--source", ".", "--ref", "HEAD", "--json"]);
});

test("GREEN on exit 0 with ok:true", () => {
  const g = gateWith(0, { ok: true, skipped: false, published_commit: PC, removals: [], changed: [] });
  assert.strictEqual(g.severity, "green");
  assert.strictEqual(g.ok, true);
});

test("GREEN on exit 0 with skipped:true, saying publisher source only", () => {
  const g = gateWith(0, { ok: true, skipped: true, removals: [], changed: [] });
  assert.strictEqual(g.severity, "green");
  assert.match(g.message, /n\/a: publisher source only/);
});

test("RED on exit 1 with parsed removals, naming the dropped content", () => {
  const g = gateWith(1, { ok: false, skipped: false, published_commit: PC, removals: [{ path: "README.md", kind: "line", line: "line gone" }, { path: "docs/a/b.png", kind: "file", blob: "abc" }], changed: [] });
  assert.strictEqual(g.severity, "red");
  assert.match(g.message, /would drop published content/);
  assert.doesNotMatch(g.message, CANNOT);
  assert.ok(g.details.some((d) => d.includes("line gone")) && g.details.some((d) => d.includes("docs/a/b.png")), JSON.stringify(g.details));
});

test("RED on exit 1 with a changed docs file", () => {
  const g = gateWith(1, { ok: false, skipped: false, published_commit: PC, removals: [], changed: [{ path: "docs/p.png", kind: "file", published_blob: "a", emitted_blob: "b" }] });
  assert.strictEqual(g.severity, "red");
  assert.match(g.message, /would drop published content/);
});

test("RED could-not-run on exit 2, labelled distinctly from a finding", () => {
  const g = gateWith(2, { ok: false, skipped: false, removals: [], changed: [], error: "gh failed" });
  assert.strictEqual(g.severity, "red");
  assert.match(g.message, CANNOT);
  assert.doesNotMatch(g.message, /would drop published content/);
});

test("RED could-not-run on a null (signal) exit", () => {
  const g = gateWith(null, "");
  assert.strictEqual(g.severity, "red");
  assert.match(g.message, CANNOT);
});

test("RED could-not-run on a code outside 0/1/2", () => {
  for (const code of [3, 127, 255]) {
    const g = gateWith(code, { ok: true, skipped: false, published_commit: PC, removals: [], changed: [] });
    assert.strictEqual(g.severity, "red", `exit ${code}`);
    assert.match(g.message, CANNOT);
  }
});

test("RED could-not-run on unparseable JSON, even with exit 0 or 1", () => {
  for (const code of [0, 1]) {
    const g = gateWith(code, "SKIP: not json");
    assert.strictEqual(g.severity, "red", `exit ${code}`);
    assert.match(g.message, CANNOT);
  }
});

test("RED when the payload contradicts the exit code (exit 0 not ok/skipped; exit 1 with nothing removed)", () => {
  const a = gateWith(0, { ok: false, skipped: false, published_commit: PC, removals: [{ path: "README.md", kind: "line", line: "x" }], changed: [] });
  assert.strictEqual(a.severity, "red");
  assert.match(a.message, CANNOT);
  const b = gateWith(1, { ok: false, skipped: false, published_commit: PC, removals: [], changed: [] });
  assert.strictEqual(b.severity, "red");
  assert.match(b.message, CANNOT);
});

test("RED when the enforcer script is missing (runScript reports exit 2)", () => {
  const g = gateWith(2, "", "Script missing: scripts/checks/emit-drift-vs-published.js");
  assert.strictEqual(g.severity, "red");
  assert.match(g.message, CANNOT);
});

test("the gate command passes --ref HEAD explicitly", () => {
  gateWith(0, { ok: true, skipped: false, published_commit: PC, removals: [], changed: [] });
  assert.ok(seen.includes("--ref") && seen[seen.indexOf("--ref") + 1] === "HEAD");
});

test("GREEN message names the published commit and the stale-exception count", () => {
  const g = gateWith(0, { ok: true, skipped: false, published_commit: PC, removals: [], changed: [], stale_exceptions: [{ path: "README.md", reason: "excuses nothing" }, { path: "a", reason: "r" }] });
  assert.strictEqual(g.severity, "green");
  assert.ok(g.message.includes(PC), g.message);
  assert.match(g.message, /2 stale exception[(]s[)]/);
});

test("RED drift message names the published commit and the stale-exception count", () => {
  const g = gateWith(1, { ok: false, skipped: false, published_commit: PC, removals: [{ path: "README.md", kind: "line", line: "x" }], changed: [], stale_exceptions: [] });
  assert.strictEqual(g.severity, "red");
  assert.ok(g.message.includes(PC), g.message);
  assert.match(g.message, /0 stale exception[(]s[)]/);
});

test("exit 0 ok:true without a 40-hex published_commit is could-not-run (interpretResult contract)", () => {
  const g = gateWith(0, { ok: true, skipped: false, removals: [], changed: [] });
  assert.strictEqual(g.severity, "red");
  assert.match(g.message, CANNOT);
});

test("neither the gate nor release-evidence reads the enforcer result ok flag itself", () => {
  const gateSrc = fs.readFileSync(path.join(__dirname, "release-gates.js"), "utf8");
  const start = gateSrc.indexOf('gate("published_emit_drift"');
  const block = gateSrc.slice(start, gateSrc.indexOf("\n];", start));
  assert.ok(start > 0 && block.length > 100);
  assert.doesNotMatch(block, /payload\.ok\b/);
  const re = fs.readFileSync(path.join(__dirname, "..", "public-repo", "release-evidence.js"), "utf8");
  assert.doesNotMatch(re, /\bj\.ok\b/);
});

test("F41 published_emit_drift is non-skippable: --skip runs it anyway and a stubbed drift still reds", () => {
  canned = { status: 1, stdout: JSON.stringify({ ok: false, skipped: false, published_commit: PC, removals: [{ path: "README.md", kind: "line", line: "x" }], changed: [], stale_exceptions: [] }), stderr: "" };
  let summary;
  try {
    summary = run({ skip: ALL_GATES });
  } finally {
    canned = null;
  }
  const g = summary.results.find((r) => r.name === GATE);
  assert.ok(g, "the non-skippable gate must still appear in results, not be dropped");
  assert.doesNotMatch(g.message, /Skipped via --skip flag/);
  assert.match(g.message, /REFUSED to skip non-skippable gate/);
  assert.strictEqual(g.severity, "red", g && g.message);
  assert.match(g.message, /would drop published content/);
  assert.ok(summary.results.filter((r) => r.severity === "red").length >= 1, "a --skip cannot green a drift on the non-skippable gate");
});
