#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// registry-shape.test.js — SP-20260614-002 / AC-R4b (registry shape + alias-beside).
//
// The admin-panel registry (framework/admin-panel-registry.json) must:
//   - carry the $schema "mc/admin-panel-registry/v1"
//   - have a generic `panels` map where every row is { route, opener, description }
//   - sit ALIAS-BESIDE the eventual item-23 /panel:* registry — additive, NOT a fork:
//     a forward-compatible /panel:admin forwarder could read THIS SAME file unchanged.
//     We prove forward-compat by asserting a panel keyed exactly "admin" exists with a
//     route of "/admin" (the synonym layer's anchor), and that the file does NOT itself
//     redefine/shadow a `/panel:*` skill surface (no top-level "panel"/"aliases" fork key).
//   verified_by ::rows-well-formed-and-alias-beside-not-forking-panel
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const REGISTRY = path.join(ROOT, "framework", "admin-panel-registry.json");

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

console.log("registry-shape.test.js — AC-R4b");

const reg = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));

ok("carries the versioned $schema", () => {
  assert.strictEqual(reg.$schema, "mc/admin-panel-registry/v1");
});

ok("has a generic `panels` map (object, non-empty)", () => {
  assert(reg.panels && typeof reg.panels === "object" && !Array.isArray(reg.panels),
    "`panels` must be an object map");
  assert(Object.keys(reg.panels).length >= 1, "`panels` must be non-empty");
});

ok("every row is { route, opener, description } (all strings)", () => {
  for (const [key, row] of Object.entries(reg.panels)) {
    assert(row && typeof row === "object", `panel '${key}' must be an object`);
    for (const field of ["route", "opener", "description"]) {
      assert.strictEqual(typeof row[field], "string", `panel '${key}'.${field} must be a string`);
      assert(row[field].length > 0, `panel '${key}'.${field} must be non-empty`);
    }
    assert(row.route.startsWith("/"), `panel '${key}'.route must start with '/'`);
  }
});

ok("alias-beside: keyed 'admin' panel anchors route '/admin' (panel synonym anchor)", () => {
  assert(reg.panels.admin, "expected a generic 'admin' panel for /panel:admin forward-compat");
  assert.strictEqual(reg.panels.admin.route, "/admin", "the 'admin' panel must anchor route /admin");
});

ok("does NOT fork/shadow the /panel:* synonym layer (no competing top-level fork key)", () => {
  // additive: the file holds only $schema + panels. A top-level "panel"/"aliases"/"synonyms"
  // key would shadow the eventual item-23 surface instead of being read BESIDE it.
  const topKeys = Object.keys(reg).filter((k) => k !== "$schema" && k !== "panels");
  assert.deepStrictEqual(topKeys, [],
    `unexpected top-level key(s) that would fork the /panel:* layer: ${topKeys.join(", ")}`);
});

ok("forward-compatible: a /panel:* forwarder could resolve every key->route from this file", () => {
  // Simulate the eventual forwarder: every panel id maps deterministically to its route+opener.
  for (const [id, row] of Object.entries(reg.panels)) {
    const resolved = { route: row.route, opener: row.opener };
    assert(resolved.route && resolved.opener, `/panel:${id} would fail to resolve route+opener`);
  }
});

console.log(`\nregistry-shape: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
