#!/usr/bin/env node
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(__dirname, "validate-autonomy-config.js");
const REAL_DEFAULT_CONFIG = path.join(
  REPO_ROOT,
  ".claude",
  "agents",
  "president",
  "_system",
  "policy",
  "sprint-full-autonomy.json",
);

function run(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 30000,
  });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

test("precondition: ajv is NOT resolvable in this repo", () => {
  let resolved = false;
  try {
    require.resolve("ajv");
    resolved = true;
  } catch {
    resolved = false;
  }
  assert.equal(
    resolved,
    false,
    "ajv became resolvable — this repo's schema half now actually runs; " +
      "the exit-3/skip path below is no longer exercised by default and " +
      "this suite needs a companion test for the schema-ran case.",
  );
});

test("valid config, ajv unavailable, NO --allow-schema-skip: exits 3, not 0", () => {
  const res = run(["--file", REAL_DEFAULT_CONFIG]);
  assert.equal(
    res.code,
    3,
    `expected exit 3 (contract-passed-but-schema-skipped); got ${res.code}. ` +
      `stdout=${res.stdout} stderr=${res.stderr}`,
  );
  assert.match(res.stderr, /SCHEMA VALIDATION WAS SKIPPED/);
  assert.match(res.stderr, /NOT the same as full validation/);
  assert.match(res.stderr, /Exiting 3/);
  assert.notEqual(res.code, 0);
});

test("valid config, ajv unavailable, WITH --allow-schema-skip: exits 0, message says why", () => {
  const res = run(["--file", REAL_DEFAULT_CONFIG, "--allow-schema-skip"]);
  assert.equal(res.code, 0, `stdout=${res.stdout} stderr=${res.stderr}`);
  assert.match(res.stdout, /SCHEMA VALIDATION WAS SKIPPED/);
  assert.match(res.stdout, /--allow-schema-skip was passed/);
});

test("no-op guard: --allow-schema-skip does NOT mask a genuine contract failure", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "autonomy-broken-"));
  try {
    const cfg = JSON.parse(fs.readFileSync(REAL_DEFAULT_CONFIG, "utf8"));
    cfg.hard_ceilings = cfg.hard_ceilings.slice(0, -1);
    const brokenPath = path.join(tmp, "broken-autonomy.json");
    fs.writeFileSync(brokenPath, JSON.stringify(cfg, null, 2));

    const withoutFlag = run(["--file", brokenPath]);
    assert.equal(withoutFlag.code, 1, "broken config must fail without the flag");
    assert.match(withoutFlag.stderr, /hard_ceilings\[\] mismatch/);

    const withFlag = run(["--file", brokenPath, "--allow-schema-skip"]);
    assert.equal(
      withFlag.code,
      1,
      "NO-OP GUARD FAILED: --allow-schema-skip must only affect the " +
        "schema-skip branch, never mask a real contract failure",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
