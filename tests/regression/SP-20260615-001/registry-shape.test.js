#!/usr/bin/env node
// AC-R1b [β-1] — row shape {name,opener,description,run_context}; run_context enum; no mandatory route.
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..");

let p = 0, f = 0;
function ok(n, fn) { try { fn(); p++; console.log("  ok  " + n); } catch (e) { f++; console.log("FAIL  " + n + "\n      " + e.message); } }

ok("rows-are-name-opener-description-run_context-no-mandatory-route", () => {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, "framework", "panel-registry.json"), "utf8"));
  assert.strictEqual(reg.$schema, "mc/panel-registry/v1");
  const RC = new Set(["in_app", "cli"]);
  const rows = Object.entries(reg.panels || {});
  assert.ok(rows.length >= 4, "at least the 4 seed panels");
  for (const [k, v] of rows) {
    for (const key of ["name", "opener", "description", "run_context"]) {
      assert.ok(typeof v[key] === "string" && v[key].length > 0, `${k}.${key} non-empty string`);
    }
    assert.ok(RC.has(v.run_context), `${k}.run_context in {in_app,cli} (got ${v.run_context})`);
    assert.ok(!("route" in v), `${k} has NO mandatory route key (run_context carries in-app-vs-cli)`);
  }
});

console.log(`\nregistry-shape: ${p}/${p + f} pass`);
process.exit(f ? 1 : 0);
