#!/usr/bin/env node
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const APPLY = path.join(__dirname, "apply.js");
const apply = require("./apply");
const trust = require("../operator/trust-my-repos");
const ACCT = "github.com/example-owner";

function fixture({ origin = `https://${ACCT}/repo.git`, trusted = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "turbo-apply-"));
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  fs.mkdirSync(path.join(project, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(project, ".claude", "settings.json"), "{}\n");
  spawnSync("git", ["init", "-q"], { cwd: project });
  if (origin) spawnSync("git", ["remote", "add", "origin", origin], { cwd: project });
  const user = trusted ? trust.applyTrust({}, ACCT).settings : {};
  fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify(user));
  const run = (...args) =>
    spawnSync(process.execPath, [APPLY, ...args], {
      cwd: project,
      env: { ...process.env, CLAUDE_PROJECT_DIR: project, HOME: home, USERPROFILE: home },
      encoding: "utf8",
      windowsHide: true,
    });
  return { root, project, home, run, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("no push scope exists: push-to-main is unknown and not part of --scope all", () => {
  assert.ok(!apply.KNOWN_SCOPES.has("push-to-main"));
  assert.ok(!("push-to-main" in apply.SCOPE_PERMISSIONS));
  for (const patterns of Object.values(apply.SCOPE_PERMISSIONS)) {
    for (const p of patterns) assert.ok(!/git push/.test(p), p);
  }
  assert.ok(!apply.normalizeScopes("all").includes("push-to-main"));
});

test("trustStatus reports missing, then present, from the user settings file", () => {
  const f = fixture();
  try {
    const settingsPath = path.join(f.home, ".claude", "settings.json");
    const missing = apply.trustStatus({ settingsPath, repoDir: f.project });
    assert.strictEqual(missing.present, false);
    assert.strictEqual(missing.account, ACCT);
    assert.strictEqual(missing.command, apply.TRUST_COMMAND);
    fs.writeFileSync(settingsPath, JSON.stringify(trust.applyTrust({}, ACCT).settings));
    assert.strictEqual(apply.trustStatus({ settingsPath, repoDir: f.project }).present, true);
  } finally {
    f.cleanup();
  }
});

test("trustStatus counts a block for this repository alone, but not one for another repository", () => {
  const f = fixture();
  try {
    const settingsPath = path.join(f.home, ".claude", "settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify(trust.applyTrust({}, `${ACCT}/repo`).settings));
    assert.strictEqual(apply.trustStatus({ settingsPath, repoDir: f.project }).present, true);
    fs.writeFileSync(settingsPath, JSON.stringify(trust.applyTrust({}, `${ACCT}/other`).settings));
    assert.strictEqual(apply.trustStatus({ settingsPath, repoDir: f.project }).present, false);
  } finally {
    f.cleanup();
  }
});

test("trustStatus without an origin asks for --repo", () => {
  const f = fixture({ origin: null });
  try {
    const t = apply.trustStatus({ settingsPath: path.join(f.home, ".claude", "settings.json"), repoDir: f.project });
    assert.strictEqual(t.present, false);
    assert.match(t.command, /--repo/);
  } finally {
    f.cleanup();
  }
});

test("--status prints the trust command when the block is missing, and never writes user settings", () => {
  const f = fixture();
  try {
    const userFile = path.join(f.home, ".claude", "settings.json");
    const before = fs.readFileSync(userFile, "utf8");
    const r = f.run("--status");
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /push trust:\s+MISSING/);
    assert.ok(r.stdout.includes("node scripts/operator/trust-my-repos.js"), r.stdout);
    assert.strictEqual(fs.readFileSync(userFile, "utf8"), before);
  } finally {
    f.cleanup();
  }
});

test("apply switches on the speed cadence and reports trust; --off clears it", () => {
  const f = fixture({ trusted: true });
  try {
    const userFile = path.join(f.home, ".claude", "settings.json");
    const before = fs.readFileSync(userFile, "utf8");
    const r = f.run("--scope", "manifest-edit", "--ttl", "5m");
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /Speed cadence ON/);
    assert.match(r.stdout, /push trust:\s+present/);
    const authPath = path.join(f.project, ".claude", "runtime", "authorization.json");
    assert.strictEqual(JSON.parse(fs.readFileSync(authPath, "utf8")).cadence, "speed");
    assert.match(f.run("--status").stdout, /cadence:\s+speed/);
    assert.strictEqual(fs.readFileSync(userFile, "utf8"), before, "user settings untouched");
    assert.strictEqual(f.run("--off").status, 0);
    assert.ok(!fs.existsSync(authPath));
  } finally {
    f.cleanup();
  }
});

test("--scope push-to-main is refused as an unknown scope", () => {
  const f = fixture();
  try {
    const r = f.run("--scope", "push-to-main");
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /unknown scope "push-to-main"/);
  } finally {
    f.cleanup();
  }
});
