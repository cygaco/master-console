"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const CHECK_REL = path.join("scripts", "checks", "mode-lifecycle-hooks-coverage.js");
const ALLOW_REL = path.join("scripts", "checks", "mode-lifecycle-hooks-coverage.allowlist.json");

function scratchTree(version, allowlistEdit, extraFiles = {}) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), "mlc-release-"));
  const copy = (rel) => { fs.mkdirSync(path.dirname(path.join(t, rel)), { recursive: true }); fs.cpSync(path.join(ROOT, rel), path.join(t, rel), { recursive: true }); };
  copy(CHECK_REL);
  copy(ALLOW_REL);
  copy(path.join("scripts", "hooks", "lib"));
  copy(path.join(".claude", "paths.json"));
  const registryRel = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude", "paths.json"), "utf8")).modeLifecycleHooks;
  copy(registryRel);
  const vj = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8"));
  fs.writeFileSync(path.join(t, "version.json"), JSON.stringify({ ...vj, version }, null, 2) + "\n");
  if (allowlistEdit) {
    const al = JSON.parse(fs.readFileSync(path.join(t, ALLOW_REL), "utf8"));
    allowlistEdit(al);
    fs.writeFileSync(path.join(t, ALLOW_REL), JSON.stringify(al, null, 2) + "\n");
  }
  for (const [rel, body] of Object.entries(extraFiles)) {
    fs.mkdirSync(path.dirname(path.join(t, rel)), { recursive: true });
    fs.writeFileSync(path.join(t, rel), body);
  }
  return t;
}

let target = null;
const realSpawnSync = cp.spawnSync;
cp.spawnSync = function routed(cmd, args, opts) {
  if (target && Array.isArray(args) && typeof args[0] === "string" && args[0].endsWith(CHECK_REL)) {
    return realSpawnSync(cmd, [path.join(target, CHECK_REL), ...args.slice(1)], { ...opts, cwd: target, env: { ...process.env, CLAUDE_PROJECT_DIR: target } });
  }
  return realSpawnSync.apply(this, arguments);
};
const { run } = require("./release-gates.js");
const GATE = "mode_lifecycle_allowlist_review";
const ALL_GATES = [...fs.readFileSync(path.join(__dirname, "release-gates.js"), "utf8").matchAll(/\bgate\("([a-z0-9_]+)"/g)].map((m) => m[1]);
const releaseAt = (version, allowlistEdit, extraFiles) => {
  target = scratchTree(version, allowlistEdit, extraFiles);
  try {
    const summary = run({ skip: ALL_GATES.filter((g) => g !== GATE) });
    return { summary, gate: summary.results.find((r) => r.name === GATE) };
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
    target = null;
  }
};

test("the gate is wired into release-gates.js", () => {
  assert.ok(ALL_GATES.includes(GATE), `gates: ${ALL_GATES.join(", ")}`);
});

test("a release below every entry's review version passes the gate", () => {
  const { gate, summary } = releaseAt("2.1.0");
  assert.strictEqual(gate.severity, "green", gate.message);
  assert.strictEqual(summary.red, 0);
});

test("a 2.2.0 release with unreviewed entries is REFUSED", () => {
  const { gate, summary } = releaseAt("2.2.0");
  assert.strictEqual(gate.severity, "red", gate.message);
  assert.ok(summary.red >= 1 && summary.ok === false, "a red gate blocks the release (release-gates exits 2)");
  assert.ok((gate.details || []).some((d) => /REVIEW DUE at framework version 2\.2\.0/.test(d)), JSON.stringify(gate.details));
});

test("a due entry whose event is already emitted still refuses the release (the check alone exits 0)", () => {
  const EV = "mode:switch:requested";
  const { gate } = releaseAt(
    "2.2.0",
    (al) => { for (const [k, e] of Object.entries(al.wiring_pending)) e.review_by_version = k === EV ? "2.2.0" : "2.3.0"; },
    { "scripts/hooks/emits-requested.js": `require("./lib/lifecycle-events");\nemit("${EV}", {});\n` },
  );
  assert.strictEqual(gate.severity, "red", gate.message);
  assert.ok(/check --enforce exit 0/.test(gate.message), `the check itself passed: ${gate.message}`);
  assert.ok((gate.details || []).some((d) => d.startsWith(`${EV}: REVIEW DUE`)), JSON.stringify(gate.details));
});

test("reviewing the entries (a later review version) clears the 2.2.0 release", () => {
  const { gate } = releaseAt("2.2.0", (al) => { for (const e of Object.values(al.wiring_pending)) e.review_by_version = "2.3.0"; });
  assert.strictEqual(gate.severity, "green", gate.message);
});
