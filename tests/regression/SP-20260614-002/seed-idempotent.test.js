#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// seed-idempotent.test.js — SP-20260614-002 R-3 (AC-R3b).
//   - running /admin:seed twice is idempotent: no duplicate checklist block, no
//     duplicate founder session, no duplicate sample-events file (content stable,
//     second run reports "unchanged")
//   - writes are confined to the throwaway instance dir
//   - the refuseIfTargetIsMC guard applies to the seed target: a pointer that
//     resolves to the MC canonical root is refused (non-zero), no writes
// Temp instance + injected --pointer; no real npm run dev.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const seedMod = require(path.join(ROOT, "scripts", "admin", "seed.js"));

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

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function setup() {
  const base = mkTmp("admin-seed-idem-");
  const instanceDir = path.join(base, "instance");
  fs.mkdirSync(instanceDir, { recursive: true });
  fs.writeFileSync(path.join(instanceDir, "package.json"), JSON.stringify({ name: "admin-preview-instance" }), "utf8");
  const pointer = path.join(base, "admin-preview.json");
  fs.writeFileSync(pointer, JSON.stringify({ $schema: "mc/admin-preview/v1", instanceDir }), "utf8");
  return { base, instanceDir, pointer };
}

function snapshot(instanceDir) {
  return {
    session: fs.readFileSync(path.join(instanceDir, seedMod.SESSION_FILE), "utf8"),
    events: fs.readFileSync(path.join(instanceDir, seedMod.EVENTS_FILE), "utf8"),
    checklist: fs.readFileSync(path.join(instanceDir, seedMod.CHECKLIST_FILE), "utf8"),
  };
}

ok("seed-twice-idempotent-confined-to-instance", () => {
  const { instanceDir, pointer } = setup();
  const r1 = seedMod.seed({ pointer });
  assert.ok(r1.ok, `first seed should succeed: ${r1.error || ""}`);
  const after1 = snapshot(instanceDir);

  const r2 = seedMod.seed({ pointer });
  assert.ok(r2.ok, `second seed should succeed: ${r2.error || ""}`);
  const after2 = snapshot(instanceDir);

  // Byte-identical after the second run — no duplication.
  assert.strictEqual(after2.session, after1.session, "founder session must not duplicate/change on re-run");
  assert.strictEqual(after2.events, after1.events, "sample events must not duplicate/change on re-run");
  assert.strictEqual(after2.checklist, after1.checklist, "checklist must not duplicate/change on re-run");

  // Second run reports every artifact as already-present (unchanged).
  assert.strictEqual(r2.actions.session, "unchanged", "second seed: session unchanged");
  assert.strictEqual(r2.actions.events, "unchanged", "second seed: events unchanged");
  assert.strictEqual(r2.actions.checklist, "unchanged", "second seed: checklist unchanged");

  // Exactly ONE checklist marker block (no duplicate FOUNDERS_CHECKLIST content).
  const markerCount = (after2.checklist.match(/mc:founders-checklist v1/g) || []).length;
  assert.strictEqual(markerCount, 1, "exactly one founders-checklist block after two runs");
});

ok("seed-target-mc-root-refused", () => {
  // Pointer that resolves instanceDir to the MC canonical root → refuse.
  const base = mkTmp("admin-seed-mc-");
  const pointer = path.join(base, "admin-preview.json");
  fs.writeFileSync(pointer, JSON.stringify({ $schema: "mc/admin-preview/v1", instanceDir: ROOT }), "utf8");
  const r = seedMod.seed({ pointer });
  assert.strictEqual(r.ok, false, "seed must refuse the MC canonical root as target");
  assert.ok(/mc/i.test(r.error), `refusal must name MC: ${r.error}`);
});

console.log(`\nseed-idempotent: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
