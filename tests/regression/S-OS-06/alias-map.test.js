#!/usr/bin/env node
"use strict";
/**
 * alias-map.test.js — S-OS-06 T3 parts 2 + 3: the enforcer for the committed alias MAP
 * (scripts/open-source/mc-alias-map.json) against the real tree. Read-only.
 *
 *   - every enumerated skill (rename-mc.js SKILL_NAMESPACE_SKILLS) has a map entry;
 *   - every map entry's canonical target exists, and its legacy alias exists and forwards to it
 *     (skills: `/<canonical> $ARGUMENTS` + the mc@2.1.0 removal; shims: require the canonical file);
 *   - no legacy alias exists on disk that the map does not list (a silent, unmapped alias is a
 *     compat surface nobody will remove at 2.1.0).
 *
 *   node --test tests/regression/S-OS-06/alias-map.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const RENAME_MC = require(path.join(ROOT, "scripts", "open-source", "rename-mc.js"));
const MAP_REL = "scripts/open-source/mc-alias-map.json";
const LEGACY = "warp" + "os";

const abs = (rel) => path.join(ROOT, ...rel.split("/"));
const read = (rel) => fs.readFileSync(abs(rel), "utf8");
const map = JSON.parse(read(MAP_REL));

function trackedFiles() {
  const r = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.strictEqual(r.status, 0, `git ls-files failed: ${r.stderr}`);
  return r.stdout.split(String.fromCharCode(0)).filter(Boolean);
}

test("alias map: header states its question and the 2.1.0 removal", () => {
  assert.ok(typeof map.$question === "string" && map.$question.trim(), "the map states its question");
  assert.strictEqual(map.removeIn, "2.1.0");
  assert.ok(Array.isArray(map.skills) && Array.isArray(map.checkScripts));
});

test("alias map: every enumerated skill is mapped warp:<skill> -> mc:<skill>", () => {
  const legacy = new Set(map.skills.map((e) => e.legacy));
  for (const s of RENAME_MC.SKILL_NAMESPACE_SKILLS) assert.ok(legacy.has(`warp:${s}`), `warp:${s} is mapped`);
});

test("alias map: every skill alias exists and forwards to an existing canonical skill", () => {
  for (const e of map.skills) {
    assert.ok(fs.existsSync(abs(e.canonicalPath)), `canonical ${e.canonicalPath} exists`);
    assert.ok(fs.existsSync(abs(e.legacyPath)), `alias ${e.legacyPath} exists`);
    const body = read(e.legacyPath);
    assert.ok(body.includes(`\n/${e.canonical} $ARGUMENTS\n`), `${e.legacyPath} dispatches /${e.canonical} $ARGUMENTS`);
    assert.ok(body.includes(`# /${e.legacy} — DEPRECATED, use /${e.canonical}`), `${e.legacyPath} names itself deprecated`);
    assert.ok(body.includes("mc@2.1.0"), `${e.legacyPath} states its removal release`);
  }
});

test("alias map: every check-script shim exists and requires its existing canonical script", () => {
  for (const e of map.checkScripts) {
    assert.ok(fs.existsSync(abs(e.canonical)), `canonical ${e.canonical} exists`);
    assert.ok(fs.existsSync(abs(e.legacy)), `shim ${e.legacy} exists`);
    assert.match(read(e.legacy), new RegExp(`require(\\.resolve)?\\("\\./${path.basename(e.canonical).replace(/[.]/g, "\\.")}"\\)`), `${e.legacy} requires ./${path.basename(e.canonical)}`);
  }
});

test("alias map: no unmapped legacy alias exists in the tracked tree", () => {
  const mapped = new Set([...map.skills.map((e) => e.legacyPath), ...map.checkScripts.map((e) => e.legacy)]);
  const legacyRe = new RegExp(`^(\\.claude/commands/warp/[^/]+\\.md|\\.claude/commands/scan/${LEGACY}-[^/]+\\.md|scripts/checks/${LEGACY}-[^/]+\\.js)$`);
  const unmapped = trackedFiles().filter((f) => legacyRe.test(f) && !mapped.has(f));
  assert.deepStrictEqual(unmapped, [], "every tracked legacy alias is listed in the map");
});
