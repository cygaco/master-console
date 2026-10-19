"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const HOOKS = __dirname;
const registryView = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude", "paths.json"), "utf8"));

function project(policyName, policyBody) {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), "policy-guard-"));
  fs.mkdirSync(path.join(t, ".claude"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, ".claude", "paths.json"), path.join(t, ".claude", "paths.json"));
  if (policyBody) {
    const dir = path.join(t, registryView.policy);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, policyName), JSON.stringify(policyBody, null, 2) + "\n");
  }
  return t;
}
const hook = (name, t, stdin) => spawnSync(process.execPath, [path.join(HOOKS, name)], { cwd: t, input: stdin, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: t } });
const shipped = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, registryView.policy, name), "utf8"));

test("ledger-presence-guard reads its shipped policy from paths.policy", () => {
  const event = JSON.stringify({ tool_name: "Bash", tool_input: { command: "node scripts/sprint/plan.js --sprint x" }, tool_response: { exit_code: 0 } });
  const withPolicy = project("ledger-presence.json", shipped("ledger-presence.json"));
  const without = project("ledger-presence.json", null);
  try {
    const a = hook("ledger-presence-guard.js", withPolicy, event);
    assert.strictEqual(a.status, 0, "warn mode never blocks");
    assert.match(a.stderr, /\[ledger-presence-guard\] (LOUD WARN|warn):/, `the shipped policy was not loaded: ${a.stderr}`);
    const b = hook("ledger-presence-guard.js", without, event);
    assert.strictEqual(b.status, 0);
    assert.strictEqual(b.stderr, "", "a deleted policy disables the guard");
  } finally {
    fs.rmSync(withPolicy, { recursive: true, force: true });
    fs.rmSync(without, { recursive: true, force: true });
  }
});

test("version-bump-guard reads its policy from paths.policy (a block policy turns fail-closed into a block)", () => {
  const block = project("version-bump-guard.json", { ...shipped("version-bump-guard.json"), enforcement: { mode: "block" } });
  const none = project("version-bump-guard.json", null);
  try {
    const a = hook("version-bump-guard.js", block, "not json");
    assert.strictEqual(a.status, 2, `policy mode block must block the fail-closed path: ${a.stderr}`);
    assert.match(a.stderr, /mode=block/);
    const b = hook("version-bump-guard.js", none, "not json");
    assert.strictEqual(b.status, 0, "no policy = warn mode");
    assert.match(b.stderr, /mode=warn/);
  } finally {
    fs.rmSync(block, { recursive: true, force: true });
    fs.rmSync(none, { recursive: true, force: true });
  }
});

test("the shipped policies sit at paths.policy", () => {
  for (const name of ["ledger-presence.json", "version-bump-guard.json"]) assert.ok(fs.existsSync(path.join(ROOT, registryView.policy, name)), name);
});
