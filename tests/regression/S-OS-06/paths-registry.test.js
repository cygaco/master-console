#!/usr/bin/env node
"use strict";
/**
 * paths-registry — S-OS-06 T4 stage A (T-20260913-363): the paths registry SOURCE survives into its GENERATED views.
 *
 * framework/paths.registry.json is the single source of truth; scripts/paths/build.js regenerates .claude/paths.json and
 * scripts/hooks/lib/paths.generated.js (plus the lint rules, schema and PATH_KEYS doc) from it. The views are
 * deny-listed from the codemod (never hand-edited), so after the mc rename they must be REGENERATED, and this file
 * proves the regen happened and stays honest:
 *   (1) every live SOURCE key resolves, with the same path, in BOTH views — and neither view carries a key the SOURCE
 *       does not (a generated-only orphan is exactly the hand-edit class CLAUDE.md "source vs generated" forbids);
 *   (2) a fresh build.js run from the SOURCE (in a temp copy, never the real tree) reproduces the COMMITTED views and
 *       the working-tree views byte-for-byte, and --check on the real tree is green; a planted hand-edit makes --check
 *       exit 1 (the check bites);
 *   (3) zero legacy-slug occurrences in the SOURCE and every build output (no Class-3 pin exists for these files).
 *
 *   node --test tests/regression/S-OS-06/paths-registry.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const H = require("./falsifier-harness");

const ROOT = H.REAL_ROOT;
const BUILD_REL = "scripts/paths/build.js";
const REGISTRY_REL = "framework/paths.registry.json";
const PATHS_JSON_REL = ".claude/paths.json";
const GENERATED_JS_REL = "scripts/hooks/lib/paths.generated.js";
const VIEW_RELS = [PATHS_JSON_REL, GENERATED_JS_REL];
const OUTPUT_RELS = [...VIEW_RELS, "scripts/path-lint.rules.generated.json", "schemas/paths.schema.json", "_requirements/03-architecture/PATH_KEYS.md"];

const abs = (root, rel) => path.join(root, ...rel.split("/"));
const read = (root, rel) => fs.readFileSync(abs(root, rel), "utf8");

function childEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function registry() {
  return JSON.parse(read(ROOT, REGISTRY_REL));
}

function liveEntries(reg) {
  return Object.entries(reg.paths).filter(([, e]) => !e.removedIn);
}

/** A registry path the way path.join + path.relative round-trips it (no trailing slash, "." -> ""). */
function norm(p) {
  const n = path.posix.normalize(String(p)).replace(/\/+$/, "");
  return n === "." ? "" : n;
}

function runBuild(root, args = []) {
  const r = spawnSync(process.execPath, [abs(root, BUILD_REL), ...args], { cwd: root, env: childEnv(), encoding: "utf8", timeout: 60 * 1000 });
  if (r.error) throw new Error(`build.js spawn failed: ${r.error.message}`);
  if (r.status === null) throw new Error(`build.js was killed by ${r.signal} — not an observed exit code`);
  return r;
}

function headBlob(rel) {
  const r = spawnSync("git", ["show", `HEAD:${rel}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git show HEAD:${rel} failed: ${String(r.stderr || "")}`);
  return r.stdout;
}

function withBuildCopy(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sos06-paths-"));
  try {
    for (const rel of [BUILD_REL, REGISTRY_REL]) {
      fs.mkdirSync(path.dirname(abs(dir, rel)), { recursive: true });
      fs.copyFileSync(abs(ROOT, rel), abs(dir, rel));
    }
    return fn(dir);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* temp dir; best effort on Windows file locks */
    }
  }
}

test("paths-registry (1): every live SOURCE key resolves, same path, in BOTH generated views — no orphan either way", () => {
  const reg = registry();
  const live = liveEntries(reg);
  const liveKeys = live.map(([k]) => k).sort();
  assert.ok(live.length >= 100, `non-vacuous: expected the full registry, got ${live.length} live keys`);

  const json = JSON.parse(read(ROOT, PATHS_JSON_REL));
  assert.strictEqual(json.$schema, `mc/paths/v${reg.version}`, "paths.json $schema derives from the mc SOURCE registry version");
  assert.strictEqual(json.version, reg.version);
  const jsonKeys = Object.keys(json).filter((k) => k !== "$schema" && k !== "version").sort();
  assert.deepStrictEqual(jsonKeys, liveKeys, "paths.json keys == the SOURCE's live keys (no dropped key, no generated-only orphan)");
  for (const [k, e] of live) assert.strictEqual(json[k], e.path, `paths.json[${k}] == SOURCE path`);

  const genFile = abs(ROOT, GENERATED_JS_REL);
  delete require.cache[genFile];
  const { PROJECT, PATHS } = require(genFile);
  assert.deepStrictEqual(Object.keys(PATHS).sort(), liveKeys, "paths.generated.js PATHS keys == the SOURCE's live keys");
  for (const [k, e] of live) {
    assert.strictEqual(H.toPosix(path.relative(PROJECT, PATHS[k])), norm(e.path), `paths.generated.js PATHS.${k} resolves to the SOURCE path`);
  }

  for (const [k, e] of Object.entries(reg.paths).filter(([, x]) => x.removedIn)) {
    assert.ok(!(k in json) && !(k in PATHS), `removed key ${k} (removedIn ${e.removedIn}) is absent from both views`);
  }
});

test("paths-registry (2): a fresh build.js run from the SOURCE reproduces the committed + working-tree views byte-for-byte", () => {
  const check = runBuild(ROOT, ["--check"]);
  assert.strictEqual(check.status, 0, `build.js --check on the real tree must be green:\n${check.stdout}\n${check.stderr}`);

  withBuildCopy((dir) => {
    const r = runBuild(dir);
    assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
    for (const rel of OUTPUT_RELS) {
      const fresh = fs.readFileSync(abs(dir, rel));
      assert.ok(fresh.equals(fs.readFileSync(abs(ROOT, rel))), `${rel}: working tree differs from a fresh SOURCE build (hand-edit or stale regen)`);
      assert.ok(fresh.equals(headBlob(rel)), `${rel}: COMMITTED blob differs from a fresh SOURCE build (the regen was not committed)`);
    }

    // The check bites: a hand-edit to a generated view (in the copy) is STALE, exit 1.
    const planted = abs(dir, PATHS_JSON_REL);
    const doc = JSON.parse(fs.readFileSync(planted, "utf8"));
    doc.sprintTemplates = `_${H.SLUG}/templates/sprint`;
    fs.writeFileSync(planted, JSON.stringify(doc, null, 2) + "\n");
    const stale = runBuild(dir, ["--check"]);
    assert.strictEqual(stale.status, 1, `a hand-edited view must fail --check:\n${stale.stdout}\n${stale.stderr}`);
    assert.match(stale.stdout, /STALE\s+\.claude\/paths\.json/);
  });
});

test("paths-registry (3): zero legacy-slug occurrences in the SOURCE and every generated output", () => {
  const re = new RegExp(H.SLUG, "gi");
  const counts = Object.fromEntries([REGISTRY_REL, ...OUTPUT_RELS].map((rel) => [rel, (read(ROOT, rel).match(re) || []).length]));
  assert.deepStrictEqual(
    Object.entries(counts).filter(([, n]) => n !== 0),
    [],
    `legacy slug survives in a paths artifact (no Class-3 pin covers these files): ${JSON.stringify(counts)}`
  );
});
