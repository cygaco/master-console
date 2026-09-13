#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// panel-coverage-failclosed.test.js — SP-20260615-001 / AC-R5b  [β-3].
//
// Proves the β-3 binding asymmetry: the ENFORCER fails CLOSED on its OWN corrupt input
// (exit ≥2), DISTINCT from both a clean all-resolve pass (exit 0) and an orphan-row finding
// (exit 1). The three exit codes must be distinct, and the corrupt one must be ≥2.
//
// Feeds panel-registry-coverage.js (via the --registry seam) THREE inputs:
//   - CLEAN     (all rows resolve)        → exit 0
//   - ORPHAN    (a dead opener)           → exit 1
//   - CORRUPT   (non-JSON / wrong $schema / unreadable) → exit ≥2
// and asserts {0, 1, ≥2} are distinct with the corrupt-input code ≥2.
//
// A coverage check that reads green on its own malformed input FAILS this test — that is the
// BC-16 / enforcer-honesty bug this AC exists to prevent. (Opposite of the R-4 roadmap
// GENERATOR, which fails SOFT on its human-authored inputs — the two behaviors are tested
// as opposites on purpose; neither may leak into the other.)
//   verified_by ::corrupt-registry-exits-ge-2-distinct-from-clean-pass-and-from-finding
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const CHECK = path.join(ROOT, "scripts", "checks", "panel-registry-coverage.js");
// loadRegistry() is the INJECTABLE fail-closed loader — used for the B1 array-panels case so
// the review sandbox (spawnSync EPERM) can verify the fix without a nested node spawn.
const { loadRegistry } = require(CHECK);

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

console.log("panel-coverage-failclosed.test.js — AC-R5b [β-3]");

// Exit code of the CLI for a given registry path (raw status — the contract under test).
function exitFor(registryPath) {
  const res = spawnSync(process.execPath, [CHECK, "--registry", registryPath, "--json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return res.status;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "panel-cov-failclosed-"));
function writeRaw(name, raw) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, raw, "utf8");
  return p;
}
function writeJson(name, obj) {
  return writeRaw(name, JSON.stringify(obj, null, 2));
}

// ── The three canonical inputs ────────────────────────────────────────────────

// CLEAN — one row whose skill opener resolves (cockpit:readiness exists in this tree).
const cleanPath = writeJson("clean.json", {
  $schema: "mc/panel-registry/v1",
  panels: {
    readiness: {
      name: "readiness",
      opener: "/cockpit:readiness",
      description: "clean resolvable row",
      run_context: "cli",
    },
  },
});

// ORPHAN — a node opener pointing at a non-existent (non-parallel-lane) script.
const orphanPath = writeJson("orphan.json", {
  $schema: "mc/panel-registry/v1",
  panels: {
    ghost: { name: "ghost", opener: "node scripts/nonexistent.js", description: "dead opener", run_context: "cli" },
  },
});

ok("CLEAN registry → exit 0", () => {
  assert.strictEqual(exitFor(cleanPath), 0, "a clean all-resolve registry must exit 0");
});

ok("ORPHAN-row registry → exit 1", () => {
  assert.strictEqual(exitFor(orphanPath), 1, "an orphan-opener finding must exit 1");
});

// CORRUPT — three flavors, EACH must be ≥2 (fail-closed). The variety guards against a
// check that only handles one corruption shape.
const corruptCases = {
  "non-JSON content": writeRaw("notjson.json", "this is { not ] valid JSON"),
  "wrong $schema": writeJson("badschema.json", { $schema: "mc/WRONG/v9", panels: {} }),
  "missing panels": writeJson("nopanels.json", { $schema: "mc/panel-registry/v1" }),
  // B1 (review BLOCKER): an ARRAY `panels` is CORRUPT SHAPE (typeof [] === "object" used to
  // false-green it → exit 0). Must fail CLOSED (≥2), distinct from clean 0 / finding 1.
  "panels is an ARRAY": writeJson("arraypanels.json", { $schema: "mc/panel-registry/v1", panels: [] }),
  "unreadable (nonexistent path)": path.join(tmpDir, "DOES_NOT_EXIST.json"),
};

for (const [label, p] of Object.entries(corruptCases)) {
  ok(`CORRUPT (${label}) → exit ≥2 (fail-CLOSED)`, () => {
    const code = exitFor(p);
    assert(code >= 2, `corrupt input '${label}' must exit ≥2 (fail-closed), got ${code}`);
  });
}

ok("the THREE exit codes are DISTINCT and corrupt ≥2 (the β-3 asymmetry)", () => {
  const clean = exitFor(cleanPath);
  const finding = exitFor(orphanPath);
  const corrupt = exitFor(corruptCases["wrong $schema"]);
  assert.strictEqual(clean, 0, `clean expected 0, got ${clean}`);
  assert.strictEqual(finding, 1, `finding expected 1, got ${finding}`);
  assert(corrupt >= 2, `corrupt expected ≥2, got ${corrupt}`);
  const distinct = new Set([clean, finding, corrupt]);
  assert.strictEqual(distinct.size, 3, `expected 3 distinct exit codes, got ${JSON.stringify([clean, finding, corrupt])}`);
  // And the strict ordering clean < finding < corrupt holds (could-not-run is the loudest).
  assert(clean < finding && finding < corrupt, `expected 0 < 1 < ≥2 ordering, got ${clean}/${finding}/${corrupt}`);
});

// ── INJECTABLE fail-closed proof (no spawn — sandbox-safe). loadRegistry() is what maps to
// exit ≥2; assert ok:false directly on each corrupt shape, and ok:true on a clean one. This
// verifies the B1 fix (array panels) in a review sandbox where spawnSync is EPERM.
ok("B1 (injectable) — loadRegistry rejects an ARRAY `panels` (fail-closed precursor)", () => {
  const r = loadRegistry(writeJson("arr-inj.json", { $schema: "mc/panel-registry/v1", panels: [] }));
  assert.strictEqual(r.ok, false, "array panels must be ok:false (→ exit ≥2)");
  assert(/array/i.test(r.reason), `reason should name the array shape, got '${r.reason}'`);
});

ok("loadRegistry (injectable) — ok:false on every corrupt shape, ok:true on a clean one", () => {
  // clean → ok:true
  const clean = loadRegistry(writeJson("clean-inj.json", {
    $schema: "mc/panel-registry/v1",
    panels: { readiness: { name: "readiness", opener: "/cockpit:readiness", description: "d", run_context: "cli" } },
  }));
  assert.strictEqual(clean.ok, true, "a clean registry must load ok:true");
  // each corrupt → ok:false
  for (const [label, raw] of [
    ["non-JSON", writeRaw("nj-inj.json", "{ not ] json")],
    ["wrong $schema", writeJson("ws-inj.json", { $schema: "nope", panels: {} })],
    ["missing panels", writeJson("mp-inj.json", { $schema: "mc/panel-registry/v1" })],
    ["array panels", writeJson("ap-inj.json", { $schema: "mc/panel-registry/v1", panels: [] })],
    ["scalar root", writeRaw("sc-inj.json", "42")],
    ["unreadable", path.join(tmpDir, "NOPE-inj.json")],
  ]) {
    const r = loadRegistry(raw);
    assert.strictEqual(r.ok, false, `corrupt shape '${label}' must be ok:false`);
  }
});

// Cleanup.
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {
  /* best effort */
}

console.log(`\npanel-coverage-failclosed: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
