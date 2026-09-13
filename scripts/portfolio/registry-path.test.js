#!/usr/bin/env node
"use strict";

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
 *  4. WARPOS_PORTFOLIO_REGISTRY env-var override is honoured by registryPath().
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
test("registryPath() resolves to ~/.mc/portfolio.json", () => {
  // Ensure no env override is active for this assertion
  const saved = process.env.WARPOS_PORTFOLIO_REGISTRY;
  delete process.env.WARPOS_PORTFOLIO_REGISTRY;
  try {
    const resolved = registryPath();
    const expected = path.join(os.homedir(), ".mc", "portfolio.json");
    assert.strictEqual(
      resolved,
      expected,
      `Expected ${expected}, got ${resolved}`,
    );
  } finally {
    if (saved !== undefined) process.env.WARPOS_PORTFOLIO_REGISTRY = saved;
  }
});

// ── 2. Dead project-local path is NEVER returned ──────────────────────────
test("registryPath() does NOT point at the dead project-local registry.yaml", () => {
  const saved = process.env.WARPOS_PORTFOLIO_REGISTRY;
  delete process.env.WARPOS_PORTFOLIO_REGISTRY;
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
    if (saved !== undefined) process.env.WARPOS_PORTFOLIO_REGISTRY = saved;
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

// ── 4. WARPOS_PORTFOLIO_REGISTRY env override is honoured ─────────────────
test("WARPOS_PORTFOLIO_REGISTRY env-var override is honoured by registryPath()", () => {
  const override = path.join(os.tmpdir(), "test-portfolio.json");
  const saved = process.env.WARPOS_PORTFOLIO_REGISTRY;
  process.env.WARPOS_PORTFOLIO_REGISTRY = override;
  try {
    const resolved = registryPath();
    assert.strictEqual(
      resolved,
      path.resolve(override),
      `Expected env override ${path.resolve(override)}, got ${resolved}`,
    );
  } finally {
    if (saved !== undefined) {
      process.env.WARPOS_PORTFOLIO_REGISTRY = saved;
    } else {
      delete process.env.WARPOS_PORTFOLIO_REGISTRY;
    }
  }
});

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
