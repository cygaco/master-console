#!/usr/bin/env node
"use strict";
/**
 * falsify-split-brain — S-OS-06 T2 (Product Lead compat risk), AC-3.2.
 *
 * The one-release compat window can leave BOTH the current and the legacy name set (env)
 * or present (directory). scripts/open-source/split-brain.js is the decision core: it must
 * resolve legacy-only / new-only / dual-identical deterministically, and must DIAGNOSE a
 * dual-conflicting state — non-zero exit plus an explicit divergence — never silently pick
 * one. Every diagnosis is a pure function of state (same state, same bytes out; directory
 * creation order does not matter).
 *
 *   node --test tests/regression/S-OS-06/falsify-split-brain.test.js
 */
const FALSIFIER_ID = "SPLIT-BRAIN";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const H = require("./falsifier-harness");

const SPLIT_BRAIN = path.join(H.REAL_ROOT, "scripts", "open-source", "split-brain.js");
const CURRENT = "MC_SOS06_FIXTURE_HOME";
const LEGACY = `${H.SLUG.toUpperCase()}_SOS06_FIXTURE_HOME`;
const CURRENT_DIR = ".mc";
const LEGACY_DIR = `.${H.SLUG}`;

function run(args, envOverrides) {
  const env = { ...process.env };
  delete env[CURRENT];
  delete env[LEGACY];
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, [SPLIT_BRAIN, ...args], { encoding: "utf8", env: { ...env, ...(envOverrides || {}) }, timeout: 60000 });
  if (r.error) throw new Error(`spawn split-brain failed: ${r.error.message}`);
  if (r.status === null) throw new Error(`split-brain killed by ${r.signal}`);
  return r;
}
const runEnv = (env, json = true) => run(["--env", CURRENT, LEGACY, ...(json ? ["--json"] : [])], env);

function withDirs(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sos06-split-brain-"));
  try {
    return fn(base, (dir, files) => {
      for (const [rel, content] of files) {
        const abs = path.join(base, dir, ...rel.split("/"));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, "utf8");
      }
    });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}
const runDir = (base, json = true) => run(["--dir", path.join(base, CURRENT_DIR), path.join(base, LEGACY_DIR), ...(json ? ["--json"] : [])]);

// ── env ──────────────────────────────────────────────────────────────────────
test(`${FALSIFIER_ID} GREEN (env absent): neither name set -> exit 0, resolved null`, () => {
  const r = runEnv({});
  assert.strictEqual(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.strictEqual(d.state, "absent");
  assert.strictEqual(d.resolved, null);
});

test(`${FALSIFIER_ID} GREEN (env legacy-only): falls back to the legacy value with ONE deprecation warning`, () => {
  const r = runEnv({ [LEGACY]: "/legacy/home" });
  assert.strictEqual(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.deepStrictEqual([d.state, d.ok, d.resolved, d.source, d.deprecated], ["legacy-only", true, "/legacy/home", "legacy", true]);
  assert.strictEqual((r.stderr.match(/DEPRECATION/g) || []).length, 1);
});

test(`${FALSIFIER_ID} GREEN (env new-only): uses the current value, no deprecation warning`, () => {
  const r = runEnv({ [CURRENT]: "/new/home" });
  assert.strictEqual(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.deepStrictEqual([d.state, d.resolved, d.source, d.deprecated], ["new-only", "/new/home", "current", false]);
  assert.doesNotMatch(r.stderr, /DEPRECATION/);
});

test(`${FALSIFIER_ID} GREEN (env dual-identical): both set and equal -> the current name, deprecated`, () => {
  const r = runEnv({ [CURRENT]: "/same", [LEGACY]: "/same" });
  assert.strictEqual(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.deepStrictEqual([d.state, d.ok, d.resolved, d.source, d.deprecated], ["dual-identical", true, "/same", "current", true]);
});

test(`${FALSIFIER_ID} RED (env dual-conflicting): both set and DIFFERENT -> exit 1 with an explicit divergence, never silently resolved`, () => {
  const env = { [CURRENT]: "/new/home", [LEGACY]: "/legacy/home" };
  const r = runEnv(env);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  const d = JSON.parse(r.stdout);
  assert.strictEqual(d.state, "dual-conflicting");
  assert.strictEqual(d.ok, false);
  assert.strictEqual(d.source, "current", "canonical precedence is NAMED even while the state is diagnosed");
  assert.deepStrictEqual(d.divergence.current, { name: CURRENT, value: "/new/home" });
  assert.deepStrictEqual(d.divergence.legacy, { name: LEGACY, value: "/legacy/home" });
  const human = runEnv(env, false);
  assert.strictEqual(human.status, 1);
  assert.match(human.stdout, /DIVERGENCE/);
});

test(`${FALSIFIER_ID} RED (env determinism): the same dual-conflicting state yields byte-identical diagnoses`, () => {
  const env = { [CURRENT]: "a", [LEGACY]: "b" };
  const outs = [runEnv(env), runEnv(env), runEnv(env)];
  for (const o of outs) assert.strictEqual(o.status, 1);
  assert.strictEqual(new Set(outs.map((o) => o.stdout)).size, 1);
});

// ── directories ──────────────────────────────────────────────────────────────
test(`${FALSIFIER_ID} GREEN (dir legacy-only): falls back to the legacy directory, deprecated`, () => {
  withDirs((base, make) => {
    make(LEGACY_DIR, [["portfolio.json", "{}\n"]]);
    const r = runDir(base);
    assert.strictEqual(r.status, 0, r.stderr);
    const d = JSON.parse(r.stdout);
    assert.deepStrictEqual([d.state, d.source, d.deprecated], ["legacy-only", "legacy", true]);
  });
});

test(`${FALSIFIER_ID} GREEN (dir new-only): uses the current directory`, () => {
  withDirs((base, make) => {
    make(CURRENT_DIR, [["portfolio.json", "{}\n"]]);
    const r = runDir(base);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(JSON.parse(r.stdout).state, "new-only");
  });
});

test(`${FALSIFIER_ID} GREEN (dir dual-identical): same content created in a different order -> dual-identical`, () => {
  withDirs((base, make) => {
    make(CURRENT_DIR, [["a.json", "1\n"], ["sub/b.json", "2\n"]]);
    make(LEGACY_DIR, [["sub/b.json", "2\n"], ["a.json", "1\n"]]);
    const r = runDir(base);
    assert.strictEqual(r.status, 0, r.stderr);
    const d = JSON.parse(r.stdout);
    assert.deepStrictEqual([d.state, d.source, d.deprecated], ["dual-identical", "current", true]);
  });
});

test(`${FALSIFIER_ID} RED (dir dual-conflicting): differing content + a legacy-only file -> exit 1 with counted divergence, deterministic`, () => {
  withDirs((base, make) => {
    make(CURRENT_DIR, [["a.json", "new\n"], ["same.json", "x\n"]]);
    make(LEGACY_DIR, [["a.json", "old\n"], ["same.json", "x\n"], ["extra.json", "legacy only\n"]]);
    const first = runDir(base);
    assert.strictEqual(first.status, 1, first.stdout + first.stderr);
    const d = JSON.parse(first.stdout);
    assert.strictEqual(d.state, "dual-conflicting");
    assert.strictEqual(d.ok, false);
    assert.deepStrictEqual(d.divergence.counts, { onlyInCurrent: 0, onlyInLegacy: 1, differing: 1 });
    assert.deepStrictEqual(d.divergence.onlyInLegacy, ["extra.json"]);
    assert.deepStrictEqual(d.divergence.differing, ["a.json"]);
    const second = runDir(base);
    assert.strictEqual(second.status, 1);
    assert.strictEqual(second.stdout, first.stdout, "the same directory state must yield a byte-identical diagnosis");
  });
});

test(`${FALSIFIER_ID} RED (usage): a malformed invocation exits 2, never a silent 0`, () => {
  const r = run(["--env", CURRENT]);
  assert.strictEqual(r.status, 2);
});
