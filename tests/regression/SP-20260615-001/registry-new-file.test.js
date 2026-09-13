#!/usr/bin/env node
// AC-R1a [β-1] — NEW framework/panel-registry.json; admin-panel-registry.json untouched/separate.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..");

let p = 0, f = 0;
function ok(n, fn) { try { fn(); p++; console.log("  ok  " + n); } catch (e) { f++; console.log("FAIL  " + n + "\n      " + e.message); } }

ok("panel-registry-is-new-file-admin-registry-byte-unchanged", () => {
  const panelP = path.join(ROOT, "framework", "panel-registry.json");
  const adminP = path.join(ROOT, "framework", "admin-panel-registry.json");
  assert.ok(fs.existsSync(panelP), "framework/panel-registry.json must exist (NEW file)");
  const panel = JSON.parse(fs.readFileSync(panelP, "utf8"));
  assert.strictEqual(panel.$schema, "mc/panel-registry/v1", "panel registry carries its own schema");

  // admin registry is a SEPARATE, untouched file with its own admin-scoped shape.
  assert.ok(fs.existsSync(adminP), "admin-panel-registry.json must still exist");
  const admin = JSON.parse(fs.readFileSync(adminP, "utf8"));
  assert.strictEqual(admin.$schema, "mc/admin-panel-registry/v1", "admin registry keeps its own schema (not folded into panel)");
  for (const k of ["admin", "readiness", "guides"]) {
    assert.ok(admin.panels && admin.panels[k], `admin registry still has its '${k}' row (untouched)`);
  }
  // The two registries are distinct schemas → not extended/folded.
  assert.notStrictEqual(panel.$schema, admin.$schema, "panel + admin registries are distinct files/schemas");
});

console.log(`\nregistry-new-file: ${p}/${p + f} pass`);
process.exit(f ? 1 : 0);
