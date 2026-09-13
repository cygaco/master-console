#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// seed-reads-pointer.test.js — SP-20260614-002 R-3 (AC-R3a).
// scripts/admin/seed.js READS the single instance pointer and seeds ONLY into
// the pointed instance:
//   - founder-allowlist session marker + sample events + FOUNDERS_CHECKLIST.md
//     all land INSIDE the pointed instanceDir
//   - with NO live pointer it fails CLEAR ("run /admin:preview first"), non-zero,
//     and scaffolds NOTHING
//   - it NEVER writes its own pointer (the pointer file is untouched after a seed)
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

// Build a throwaway "instance" dir + a pointer file referencing it.
function setup() {
  const base = mkTmp("admin-seed-");
  const instanceDir = path.join(base, "instance");
  fs.mkdirSync(instanceDir, { recursive: true });
  // Make it look like a Next app so the MC guard never fires.
  fs.writeFileSync(path.join(instanceDir, "package.json"), JSON.stringify({ name: "admin-preview-instance" }), "utf8");
  const pointer = path.join(base, "admin-preview.json");
  fs.writeFileSync(
    pointer,
    JSON.stringify({
      $schema: "mc/admin-preview/v1",
      instanceDir,
      slug: "admin-preview-instance",
      route: "/admin",
      startedBy: "admin:preview",
    }),
    "utf8"
  );
  return { base, instanceDir, pointer };
}

ok("seed-reads-pointer-writes-only-into-pointed-instance", () => {
  const { instanceDir, pointer } = setup();
  const r = seedMod.seed({ pointer });
  assert.ok(r.ok, `seed should succeed: ${r.error || ""}`);
  assert.strictEqual(path.resolve(r.instanceDir), path.resolve(instanceDir));
  // All three artifacts landed INSIDE the pointed instance.
  assert.ok(fs.existsSync(path.join(instanceDir, seedMod.SESSION_FILE)), "founder session seeded into instance");
  assert.ok(fs.existsSync(path.join(instanceDir, seedMod.EVENTS_FILE)), "sample events seeded into instance");
  assert.ok(fs.existsSync(path.join(instanceDir, seedMod.CHECKLIST_FILE)), "FOUNDERS_CHECKLIST.md seeded into instance");
  // Session carries the founder allowlist (warm-start authenticated).
  const sess = JSON.parse(fs.readFileSync(path.join(instanceDir, seedMod.SESSION_FILE), "utf8"));
  assert.ok(Array.isArray(sess.allowlist) && sess.allowlist.length >= 1, "session has a founder allowlist");
});

ok("no-live-pointer-fails-clear-nonzero-no-scaffold", () => {
  const base = mkTmp("admin-seed-nopointer-");
  const pointer = path.join(base, "missing-admin-preview.json"); // does not exist
  const r = seedMod.seed({ pointer });
  assert.strictEqual(r.ok, false, "seed must fail with no live pointer");
  assert.ok(/admin:preview first/i.test(r.error), `error must name the remediation: ${r.error}`);
  // Nothing scaffolded: the base dir has no new instance.
  const entries = fs.readdirSync(base);
  assert.deepStrictEqual(entries, [], "seed must NOT scaffold a second instance on a missing pointer");
});

ok("seed-never-writes-its-own-pointer", () => {
  const { pointer } = setup();
  const before = fs.readFileSync(pointer, "utf8");
  const beforeMtime = fs.statSync(pointer).mtimeMs;
  const r = seedMod.seed({ pointer });
  assert.ok(r.ok, `seed should succeed: ${r.error || ""}`);
  const after = fs.readFileSync(pointer, "utf8");
  assert.strictEqual(after, before, "seed must NOT modify the pointer content");
  assert.strictEqual(fs.statSync(pointer).mtimeMs, beforeMtime, "seed must NOT rewrite the pointer file");
});

console.log(`\nseed-reads-pointer: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
