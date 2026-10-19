#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

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

test("registryPath() resolves to ~/.mc/portfolio.json (or an existing legacy registry, read-both)", () => {
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
    assert.ok(
      resolved.startsWith(os.homedir()),
      `Expected path to start with homedir ${os.homedir()}, got ${resolved}`,
    );
  } finally {
    if (saved !== undefined) mcEnv.setEnv("PORTFOLIO_REGISTRY", saved);
  }
});

test("paths.json does not contain portfolioRegistry (dead path removed from generated output)", () => {
  const pathsJson = require(path.join(ROOT, ".claude", "paths.json"));
  assert.strictEqual(
    pathsJson.portfolioRegistry,
    undefined,
    `Expected paths.portfolioRegistry to be undefined (removed), got ${pathsJson.portfolioRegistry}`,
  );
});

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
