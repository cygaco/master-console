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
 *   - PER-ENTRY EXPIRY (S-OS-06 r4 lane J4; β via α r-12 item 4): every deferred checkScripts member
 *     carries the tests/quarantine.json shape filedUnder / expiry / expiryVersion, and the suite FAILS
 *     when the tree version (package.json) >= its expiryVersion — the same clock and the same
 *     comparison as scripts/checks/run-tests.js "EXPIRED" (falsify-quarantine-runner.test.js case (h)).
 *     Its expiryVersion may not outlive the partition compat window that registers the member.
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

// ── per-entry expiry (lane J4): the tests/quarantine.json shape + the run-tests.js EXPIRED clock ──
const PER_ENTRY_EXPIRY_FIELDS = ["filedUnder", "expiry", "expiryVersion"];

/** Parse a semver "a.b.c" -> [a,b,c] or null (same grammar as scripts/checks/run-tests.js). */
function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
/** true iff version a >= b (both parsed semvers). */
function semverGte(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}
/** The tree's own version (package.json) — the clock the quarantine expiry is read against. null if unreadable. */
function treeVersion() {
  try {
    return parseSemver(JSON.parse(read("package.json").replace(/^﻿/, "")).version);
  } catch {
    return null;
  }
}

/**
 * Violations of the per-entry expiry contract for `entries` at tree version `tv` (parsed semver or null).
 * Fail-closed: a missing/blank field, an unparseable expiryVersion, or an unreadable tree version is a violation.
 */
function perEntryExpiryViolations(entries, tv) {
  const out = [];
  if (!tv) out.push("tree version (package.json#version) is unreadable or not a semver — every per-entry expiry reads EXPIRED (fail closed)");
  entries.forEach((e, i) => {
    const at = `checkScripts[${i}] (${(e && e.legacy) || "?"})`;
    for (const f of PER_ENTRY_EXPIRY_FIELDS) {
      if (!e || typeof e[f] !== "string" || e[f].trim() === "") out.push(`${at} is missing a non-empty "${f}"`);
    }
    if (!e || typeof e.expiryVersion !== "string") return;
    const ev = parseSemver(e.expiryVersion);
    if (!ev) return out.push(`${at} "expiryVersion" must be a semver a.b.c`);
    if (tv && semverGte(tv, ev)) {
      out.push(`EXPIRED: ${e.legacy} alias expired at ${e.expiryVersion} (tree ${tv.join(".")}) — remove the member or re-warrant [${e.filedUnder}, ${e.expiry}]`);
    }
  });
  return out;
}

test("alias map: every deferred check-script member carries filedUnder/expiry/expiryVersion and is NOT past its expiry", () => {
  const tv = treeVersion();
  assert.ok(map.checkScripts.length > 0, "the deferred member set is non-empty (an empty set would make this case vacuous)");
  const violations = perEntryExpiryViolations(map.checkScripts, tv);
  assert.deepStrictEqual(violations, [], `per-entry expiry violations:\n  - ${violations.join("\n  - ")}`);
});

test("alias map: a deferred member's expiryVersion does not outlive the partition compat window that registers it", () => {
  const partition = JSON.parse(read("scripts/open-source/rename-mc.denylist.json"));
  const windows = Array.isArray(partition.compatWindows) ? partition.compatWindows : [];
  for (const e of map.checkScripts) {
    const w = windows.find((x) => Array.isArray(x.members) && x.members.includes(e.legacy));
    assert.ok(w, `${e.legacy} is registered in a partition compatWindows surface`);
    const we = parseSemver(w.expires);
    const ev = parseSemver(e.expiryVersion);
    assert.ok(we && ev, `${e.legacy}: both the window expiry (${w.expires}) and the entry expiryVersion (${e.expiryVersion}) are semvers`);
    assert.ok(semverGte(we, ev), `${e.legacy}: expiryVersion ${e.expiryVersion} outlives its enforced compat window ${w.surface}@${w.expires}`);
  }
});

test("alias map: FALSIFIER — the per-entry expiry check fires on a planted past-expiry entry and on a missing field", () => {
  const tv = treeVersion();
  assert.ok(tv, "the tree version is readable");
  const real = map.checkScripts[0];
  // (h)-mirror: tree version == expiryVersion is EXPIRED (>=), exactly as run-tests.js reads it.
  const planted = { ...real, expiryVersion: tv.join(".") };
  const expired = perEntryExpiryViolations([planted], tv);
  assert.strictEqual(expired.length, 1, `a past-expiry entry produced ${expired.length} violation(s): ${expired.join(" | ")}`);
  assert.match(expired[0], new RegExp(`^EXPIRED: ${real.legacy.replace(/[.]/g, "\\.")} alias expired at ${tv.join("\\.")}`));
  const older = perEntryExpiryViolations([{ ...real, expiryVersion: "0.0.1" }], tv);
  assert.ok(older.some((v) => v.startsWith("EXPIRED:")), "an expiryVersion below the tree version is EXPIRED");
  for (const f of PER_ENTRY_EXPIRY_FIELDS) {
    const stripped = { ...real };
    delete stripped[f];
    assert.ok(perEntryExpiryViolations([stripped], tv).some((v) => v.includes(`missing a non-empty "${f}"`)), `a member without "${f}" is a violation`);
  }
  assert.ok(perEntryExpiryViolations([real], null).length > 0, "an unreadable tree version fails closed");
});
