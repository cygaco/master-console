#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * scripts/portfolio/registry-path.test.js
 *
 * Planted-violation test for T-20260611-309.
 *
 * Asserts:
 *  1. registry.js#registryPath() resolves to ~/.mc/portfolio.json
 *     (home-anchored, NOT project-local).
 *  2. The dead project-local registry.yaml (under the project portfolio dir) is
 *     NEVER what registryPath() returns. (Literal intentionally split here and
 *     in the test name — path-lint hard-bans the contiguous form.)
 *  3. paths.json (generated) does NOT contain a portfolioRegistry key
 *     (the key was removed via removedIn so nothing can resolve the dead path).
 *  4. MC_PORTFOLIO_REGISTRY env-var override is honoured by registryPath().
 *
 * Exit 0 = all assertions pass.
 * Exit 1 = at least one failure (failures printed to stderr).
 */

const path = require("path");
const os = require("os");
const assert = require("assert");

const ROOT = path.resolve(__dirname, "..", "..");
const { registryPath } = require("./registry");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}

// ── 1. Default resolution is HOME-anchored ────────────────────────────────
// S-OS-06 T3 part 5 read-both: ~/.mc/portfolio.json — unless ONLY the legacy registry exists on this machine, which
// is then used in place (never moved). The legacy dir name is derived from mc-env's prefix (no legacy literal here);
// the sandboxed fresh/legacy-only/dual cases live in tests/regression/S-OS-06/home-read-both.test.js.
test("registryPath() resolves to ~/.mc/portfolio.json (or an existing legacy registry, read-both)", () => {
  // Ensure no env override is active for this assertion
  const saved = mcEnv.readEnv("PORTFOLIO_REGISTRY");
  mcEnv.unsetEnv("PORTFOLIO_REGISTRY");
  try {
    const resolved = registryPath();
    const fs = require("fs");
    const current = path.join(os.homedir(), ".mc", "portfolio.json");
    const legacy = path.join(os.homedir(), `.${mcEnv.LEGACY_PREFIX.slice(0, -1).toLowerCase()}`, "portfolio.json");
    const expected = fs.existsSync(current) || !fs.existsSync(legacy) ? current : legacy;
    assert.strictEqual(
      resolved,
      expected,
      `Expected ${expected}, got ${resolved}`,
    );
  } finally {
    if (saved !== undefined) mcEnv.setEnv("PORTFOLIO_REGISTRY", saved);
  }
});

// ── 2. Dead project-local path is NEVER returned ──────────────────────────
test("registryPath() does NOT point at the dead project-local registry.yaml", () => {
  const saved = mcEnv.readEnv("PORTFOLIO_REGISTRY");
  mcEnv.unsetEnv("PORTFOLIO_REGISTRY");
  try {
    const resolved = registryPath();
    const deadPath = path.join(ROOT, ".claude", "portfolio", "registry.yaml");
    assert.notStrictEqual(
      resolved,
      deadPath,
      `registryPath() must not resolve to the dead project-local path ${deadPath}`,
    );
    // Also assert the resolved path contains the user's home dir
    assert.ok(
      resolved.startsWith(os.homedir()),
      `Expected path to start with homedir ${os.homedir()}, got ${resolved}`,
    );
  } finally {
    if (saved !== undefined) mcEnv.setEnv("PORTFOLIO_REGISTRY", saved);
  }
});

// ── 3. paths.json has no portfolioRegistry key (key removed via removedIn) ─
test("paths.json does not contain portfolioRegistry (dead path removed from generated output)", () => {
  const pathsJson = require(path.join(ROOT, ".claude", "paths.json"));
  assert.strictEqual(
    pathsJson.portfolioRegistry,
    undefined,
    `Expected paths.portfolioRegistry to be undefined (removed), got ${pathsJson.portfolioRegistry}`,
  );
});

// ── 4. MC_PORTFOLIO_REGISTRY env override is honoured ─────────────────
test("MC_PORTFOLIO_REGISTRY env-var override is honoured by registryPath()", () => {
  const override = path.join(os.tmpdir(), "test-portfolio.json");
  const saved = mcEnv.readEnv("PORTFOLIO_REGISTRY");
  mcEnv.setEnv("PORTFOLIO_REGISTRY", override);
  try {
    const resolved = registryPath();
    assert.strictEqual(
      resolved,
      path.resolve(override),
      `Expected env override ${path.resolve(override)}, got ${resolved}`,
    );
  } finally {
    if (saved !== undefined) {
      mcEnv.setEnv("PORTFOLIO_REGISTRY", saved);
    } else {
      mcEnv.unsetEnv("PORTFOLIO_REGISTRY");
    }
  }
});

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
