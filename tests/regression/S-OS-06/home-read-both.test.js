#!/usr/bin/env node
"use strict";
/**
 * home-read-both — S-OS-06 T3 part 5 (HOME-anchored state, read-both, NEVER auto-move).
 *
 *   ~/.mc/portfolio.json   first, else an EXISTING legacy ~/.<legacy>/portfolio.json read AND written in place
 *   ~/.codex-mc            first, else an EXISTING legacy ~/.codex-<legacy> codex home used in place
 *
 * Each case runs the REAL module in a child process with HOME/USERPROFILE pointed at a sandbox (os.homedir()), and
 * every MC_/legacy-prefixed env var stripped so no ambient override masks the HOME resolution. The legacy names are
 * derived from the harness slug — this file adds no legacy literal. The two pinned machine literals (registry.js,
 * safe-spawn.js) are test-pinned below: exactly one occurrence each, so the compat read cannot silently vanish.
 *
 *   node --test tests/regression/S-OS-06/home-read-both.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const H = require("./falsifier-harness");

const LEG = H.SLUG;
const PREFIX_RE = new RegExp(`^(?:MC|${LEG.toUpperCase()})_`);
const REGISTRY = path.join(H.REAL_ROOT, "scripts", "portfolio", "registry.js");
const SAFE_SPAWN = path.join(H.REAL_ROOT, "scripts", "dispatch", "safe-spawn.js");

function sandboxHome(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sos06-home-${tag}-`));
}

function runChild(home, code) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const k of Object.keys(env)) if (PREFIX_RE.test(k)) delete env[k];
  delete env.CODEX_HOME;
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ["-e", code], { encoding: "utf8", env, timeout: 60000 });
  if (r.error) throw new Error(`spawn failed: ${r.error.message}`);
  assert.strictEqual(r.status, 0, r.stderr);
  return { out: JSON.parse(r.stdout), deprecations: (r.stderr.match(/DEPRECATION/g) || []).length, stderr: r.stderr };
}

const registryProbe = `const r = require(${JSON.stringify(REGISTRY)}); const p = r.registryPath(); r.registryPath(); process.stdout.write(JSON.stringify({ p }));`;

test("home-read-both (portfolio): fresh HOME -> ~/.mc/portfolio.json, silent, nothing created", () => {
  const home = sandboxHome("reg-fresh");
  const r = runChild(home, registryProbe);
  assert.strictEqual(r.out.p, path.join(home, ".mc", "portfolio.json"));
  assert.strictEqual(r.deprecations, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(home, ".mc")), "resolving the registry path never creates ~/.mc");
});

test("home-read-both (portfolio): legacy-only registry is used IN PLACE — one deprecation line, never moved", () => {
  const home = sandboxHome("reg-legacy");
  const leg = path.join(home, `.${LEG}`, "portfolio.json");
  fs.mkdirSync(path.dirname(leg), { recursive: true });
  fs.writeFileSync(leg, '{"products":{}}');
  const r = runChild(home, registryProbe);
  assert.strictEqual(r.out.p, leg);
  assert.strictEqual(r.deprecations, 1, r.stderr);
  assert.ok(!fs.existsSync(path.join(home, ".mc")), "HOME state is never auto-moved to ~/.mc");
  assert.strictEqual(fs.readFileSync(leg, "utf8"), '{"products":{}}', "legacy registry untouched by resolution");
});

test("home-read-both (portfolio): both present -> ~/.mc wins, legacy ignored, silent", () => {
  const home = sandboxHome("reg-both");
  for (const top of [".mc", `.${LEG}`]) {
    fs.mkdirSync(path.join(home, top), { recursive: true });
    fs.writeFileSync(path.join(home, top, "portfolio.json"), '{"products":{}}');
  }
  const r = runChild(home, registryProbe);
  assert.strictEqual(r.out.p, path.join(home, ".mc", "portfolio.json"));
  assert.strictEqual(r.deprecations, 0, r.stderr);
});

const codexProbe =
  `const s = require(${JSON.stringify(SAFE_SPAWN)}); const atLoad = s.DEFAULT_CODEX_HOME;` +
  `const a = s.withCodexHome("codex", {}).CODEX_HOME; const b = s.withCodexHome("codex", {}).CODEX_HOME;` +
  `process.stdout.write(JSON.stringify({ atLoad, a, b }));`;

test("home-read-both (codex home): fresh -> ~/.codex-mc", () => {
  const home = sandboxHome("codex-fresh");
  const r = runChild(home, codexProbe);
  assert.deepStrictEqual(r.out, { atLoad: path.join(home, ".codex-mc"), a: path.join(home, ".codex-mc"), b: path.join(home, ".codex-mc") });
  assert.strictEqual(r.deprecations, 0, r.stderr);
});

test("home-read-both (codex home): legacy-only authenticated home used IN PLACE — deprecation deferred to a codex spawn, once; never moved", () => {
  const home = sandboxHome("codex-legacy");
  const leg = path.join(home, `.codex-${LEG}`);
  fs.mkdirSync(leg, { recursive: true });
  fs.writeFileSync(path.join(leg, "auth.json"), "{}");
  const r = runChild(home, codexProbe);
  assert.deepStrictEqual(r.out, { atLoad: leg, a: leg, b: leg });
  assert.strictEqual(r.deprecations, 1, r.stderr);
  assert.ok(!fs.existsSync(path.join(home, ".codex-mc")), "the legacy codex home is never moved/copied to ~/.codex-mc");
  assert.strictEqual(fs.readFileSync(path.join(leg, "auth.json"), "utf8"), "{}", "authenticated state untouched");
});

test("home-read-both (codex home): both present -> ~/.codex-mc", () => {
  const home = sandboxHome("codex-both");
  fs.mkdirSync(path.join(home, ".codex-mc"), { recursive: true });
  fs.mkdirSync(path.join(home, `.codex-${LEG}`), { recursive: true });
  const r = runChild(home, codexProbe);
  assert.strictEqual(r.out.atLoad, path.join(home, ".codex-mc"));
  assert.strictEqual(r.deprecations, 0, r.stderr);
});

test("home-read-both (test-pin): each HOME compat read keeps exactly one pinned legacy literal", () => {
  const count = (file, needle) => fs.readFileSync(file, "utf8").split(needle).length - 1;
  assert.strictEqual(count(SAFE_SPAWN, `".codex-${LEG}"`), 1, "safe-spawn.js: the codex-home machine pin");
  assert.strictEqual(count(REGISTRY, `".${LEG}"`), 1, "registry.js: the portfolio-registry legacy segment pin");
});
