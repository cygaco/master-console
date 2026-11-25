"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const gd = require("./gauntlet-decision");
const gauntletPackage = require("./gauntlet-package");
const hookPoints = require("./hook-points");

const GOOD = "fix: x\n\nChange: bugfix\nBlast: minor\nRisks: none\n";
const BAD = "fix: x\n\nChange: not-a-real-value\nBlast: minor\nRisks: none\n";
const TICKET = { unit_types: ["backend"], max_risk: "low", domains: [], change: "bugfix", blast: "minor", risks: ["none"] };
const REG_EMPTY = "schema: mc/sprint/active-sprints/v1\nsprints: []\n";
const REG_ACTIVE = ["schema: mc/sprint/active-sprints/v1", "primary: SP-T", "sprints:", "  - id: SP-T", "    title: live", "    status: executing", "    layout: per_sprint_subdir"].join("\n") + "\n";

const tmps = [];
test.after(() => { for (const t of tmps) { try { fs.rmSync(t, { recursive: true, force: true }); } catch { } } });

function git(root, c) { return execSync(c, { cwd: root, windowsHide: true, stdio: "ignore" }); }
function commit(root, msg) {
  const f = path.join(root, ".msg-tmp");
  fs.writeFileSync(f, msg);
  git(root, `git -c user.email=t@t -c user.name=t commit --allow-empty -q -F ".msg-tmp"`);
  fs.rmSync(f, { force: true });
}
function mkRepo({ registry = null, headMsg = GOOD, onMain = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gd-"));
  tmps.push(root);
  git(root, "git init -q -b main");
  if (registry !== null) {
    fs.mkdirSync(path.join(root, ".claude", "project", "sprint"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "project", "sprint", "active-sprints.yaml"), registry);
    git(root, "git add -A");
  }
  commit(root, "base");
  if (!onMain) {
    git(root, "git checkout -q -b feature");
    commit(root, headMsg);
  }
  return root;
}
function patch(obj, key, fn) {
  const orig = obj[key];
  obj[key] = fn;
  return () => { obj[key] = orig; };
}
function expectHalt(res, reason) {
  assert.strictEqual(res.decision, null, JSON.stringify(res));
  assert.strictEqual(res.halt_reason, reason, JSON.stringify(res));
  assert.ok(gd.HALT_REASONS.includes(res.halt_reason));
  assert.strictEqual(typeof res.error, "string");
}

test("HALT_REASONS is frozen and closed", () => {
  assert.ok(Object.isFrozen(gd.HALT_REASONS));
  assert.strictEqual(gd.HALT_REASONS.length, 10);
  assert.strictEqual(gd.DEFAULTS.leanAuto, true);
  assert.ok(Object.isFrozen(gd.DEFAULTS));
});

test("change_trailer_missing: ticket path, trailer-less HEAD under an active sprint", () => {
  const root = mkRepo({ registry: REG_ACTIVE, headMsg: "plain commit" });
  expectHalt(gd.resolveGauntletDecision("SP-T", TICKET, { root }), "change_trailer_missing");
});

test("change_trailer_missing: no-ticket path, trailer-less HEAD", () => {
  const root = mkRepo({ registry: REG_EMPTY, headMsg: "plain commit" });
  const res = gd.resolveGauntletDecision("SP-T", { unit_types: [], max_risk: "", domains: [] }, { root });
  expectHalt(res, "change_trailer_missing");
  assert.match(res.error, /no ticket classification and HEAD trailer invalid/);
});

test("change_trailer_invalid: ticket path, malformed HEAD trailer", () => {
  const root = mkRepo({ headMsg: BAD });
  expectHalt(gd.resolveGauntletDecision("SP-T", TICKET, { root }), "change_trailer_invalid");
});

test("change_trailer_invalid: no-ticket path, malformed HEAD trailer", () => {
  const root = mkRepo({ headMsg: BAD });
  expectHalt(gd.resolveGauntletDecision("SP-T", { unit_types: [], max_risk: "", domains: [] }, { root }), "change_trailer_invalid");
});

test("change_trailer_downgraded: ticket higher than the HEAD trailer", () => {
  const root = mkRepo({});
  const res = gd.resolveGauntletDecision("SP-T", { ...TICKET, change: "release", blast: "major" }, { root });
  expectHalt(res, "change_trailer_downgraded");
  assert.match(res.error, /downgrade blocked/);
});

test("sprint_registry_unreadable: trailer-less HEAD and no registry at the base", () => {
  const root = mkRepo({ headMsg: "plain commit" });
  const res = gd.resolveGauntletDecision("SP-T", TICKET, { root });
  expectHalt(res, "sprint_registry_unreadable");
  assert.match(res.error, /^sprint_registry_unreadable:/);
});

test("head_unreadable: git seam fails on `git log`", () => {
  const res = gd.resolveGauntletDecision("SP-T", TICKET, { root: os.tmpdir(), git: () => { throw new Error("boom"); } });
  expectHalt(res, "head_unreadable");
});

test("head_unreadable: git seam fails on `rev-parse HEAD` after a good log", () => {
  const git2 = (args) => {
    if (args[0] === "log") return GOOD;
    throw new Error("rev-parse boom");
  };
  expectHalt(gd.resolveGauntletDecision("SP-T", TICKET, { root: os.tmpdir(), git: git2 }), "head_unreadable");
});

test("no_base: unresolvable default branch", () => {
  const root = mkRepo({});
  const res = gd.resolveGauntletDecision("SP-T", TICKET, { root, defaultBranch: "no-such-branch" });
  expectHalt(res, "no_base");
  assert.match(res.error, /^no_base:/);
});

test("base_is_head: nothing to diff", () => {
  const root = mkRepo({ onMain: true });
  const res = gd.resolveGauntletDecision("SP-T", { unit_types: [], max_risk: "", domains: [] }, { root });
  assert.ok(res.decision === null);
  const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gd-"));
  tmps.push(root2);
  git(root2, "git init -q -b main");
  commit(root2, GOOD);
  expectHalt(gd.resolveGauntletDecision("SP-T", TICKET, { root: root2 }), "base_is_head");
});

test("selector_refused: selectPackage returns a halt_reason", () => {
  const root = mkRepo({});
  const restore = patch(gauntletPackage, "selectPackage", () => ({ halt_reason: "change_trailer_missing", error: "planted refusal" }));
  try {
    const res = gd.resolveGauntletDecision("SP-T", TICKET, { root });
    expectHalt(res, "selector_refused");
    assert.strictEqual(res.detail, "planted refusal");
  } finally { restore(); }
});

test("decision_invalid: empty stage-4 roster", () => {
  const root = mkRepo({});
  const vacuous = {
    schema: gauntletPackage.SCHEMA, sprint: "SP-T", run_id: "r", base: "b", head: "h",
    trailer: { change: "bugfix", blast: "minor", risks: ["none"] }, package: "combined-focused",
    stages: [{ stage: 4, name: "review", kind: "agents", roster: [] }], budget: { wall_ms: 1, dispatches: 1 },
    reasons: ["x"], selector_version: gauntletPackage.SELECTOR_VERSION,
  };
  const restore = patch(gauntletPackage, "selectPackage", () => vacuous);
  try { expectHalt(gd.resolveGauntletDecision("SP-T", TICKET, { root }), "decision_invalid"); } finally { restore(); }
});

test("selection_threw: assembleInput throws", () => {
  const root = mkRepo({});
  const restore = patch(gauntletPackage, "assembleInput", () => { throw new Error("planted selector failure"); });
  try {
    const res = gd.resolveGauntletDecision("SP-T", TICKET, { root });
    expectHalt(res, "selection_threw");
    assert.match(res.error, /resolveGauntletDecision failed: planted selector failure/);
  } finally { restore(); }
});

test("property: never throws, every null decision names a HALT_REASONS member", () => {
  const roots = [os.tmpdir(), path.join(os.tmpdir(), "mc-gd-does-not-exist"), mkRepo({}), mkRepo({ headMsg: BAD })];
  const comps = [undefined, null, {}, TICKET, { change: "release", blast: "major" }];
  for (const root of roots) for (const c of comps) for (const mode of ["auto", "full"]) {
    let res;
    assert.doesNotThrow(() => { res = gd.resolveGauntletDecision("SP-T", c, { root, packageMode: mode }); });
    if (res.decision === null) assert.ok(gd.HALT_REASONS.includes(res.halt_reason), JSON.stringify(res));
    else assert.strictEqual(res.halt_reason, null);
  }
});

function maximalRoles() {
  const maximal = { ...TICKET, change: "release", blast: "major", surfaces: ["security"] };
  return hookPoints.agentsForStep("gauntlet", maximal).map((a) => a.role).sort();
}
function rosterRoles(decision) {
  const s = new Set();
  for (const st of decision.stages) for (const r of st.roster || []) s.add(r.role);
  return [...s].sort();
}

test("packageMode:'full' -> package full; roster roles == maximal registry match", () => {
  const root = mkRepo({});
  const res = gd.resolveGauntletDecision("SP-T", TICKET, { root, packageMode: "full", leanAuto: true });
  assert.ok(res.decision, JSON.stringify(res));
  assert.strictEqual(res.decision.package, "full");
  assert.deepStrictEqual(rosterRoles(res.decision).filter(Boolean), [...new Set(maximalRoles())].sort());
});

test("leanAuto:false + minor bugfix -> full (the default is the constant)", () => {
  const root = mkRepo({});
  const off = gd.resolveGauntletDecision("SP-T", TICKET, { root, leanAuto: false });
  assert.strictEqual(off.decision && off.decision.package, "full");
  const dflt = gd.resolveGauntletDecision("SP-T", TICKET, { root });
  assert.strictEqual(dflt.decision && dflt.decision.package, "full");
});

test("decideFromInput: forceFullTrailer convention; lean leaves a minor bugfix un-forced", () => {
  assert.deepStrictEqual(gd.forceFullTrailer({ change: "bugfix", blast: "minor", risks: ["none"] }), { change: "release", blast: "major", risks: ["none"] });
  let seen = null;
  const restore = patch(gauntletPackage, "selectPackage", (inp) => { seen = inp.trailer; return { halt_reason: "x", error: "stop" }; });
  try {
    const input = { trailer: { change: "bugfix", blast: "minor", risks: ["none"] } };
    gd.decideFromInput(input, { leanAuto: true });
    assert.strictEqual(seen.change, "bugfix");
    gd.decideFromInput(input, { leanAuto: false });
    assert.strictEqual(seen.change, "release");
    gd.decideFromInput(input, { leanAuto: true, packageMode: "full" });
    assert.strictEqual(seen.blast, "major");
  } finally { restore(); }
});
