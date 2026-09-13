#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// lifecycle-hooks-registry.test.js — S-LC-02 / WI-1. The VIRTUAL mode-lifecycle
// EVENT registry (.claude/agents/_org/mode-lifecycle-hooks.json) is well-formed:
//   - parses; sibling schema string mc/mode-lifecycle-hooks/v0.1
//   - every event row has event / when / mode / payload_fields
//   - mode ∈ {block, advisory}
//   - harness_fires is the literal false on EVERY row (virtual invariant, β refinement)
//   - no duplicate event ids
//   - ~23 events present (the §13 list)
//   - the modeLifecycleHooks paths key survived regen into .claude/paths.json
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const REGISTRY = path.join(ROOT, ".claude", "agents", "_org", "mode-lifecycle-hooks.json");
const PATHS_JSON = path.join(ROOT, ".claude", "paths.json");

const VALID_MODES = ["block", "advisory"];
// The §13 canonical event list (the spine S-LC-03/04 will wire emitters into).
const EXPECTED_EVENTS = [
  "mode:switch:requested", "mode:switch:preflight", "mode:teardown:before",
  "team:persistent:kill:before", "team:persistent:kill:after", "mode:state:clear:before",
  "mode:init:before", "mode:policy:load", "team:persistent:spawn:before",
  "team:persistent:spawn:after", "team:persistent:verify", "dispatch:matrix:load",
  "sprint:binding:verify", "epic:binding:verify", "tracker:binding:verify",
  "planning:artifact:verify", "provider:readiness:verify", "mode:init:after",
  "mode:switch:after", "session:end:before", "session:end:after",
  "session:resume:stale-team-detect", "session:resume:mode-state-reconcile",
];

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

const doc = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));

ok("registry-parses-with-sibling-schema", () => {
  assert.strictEqual(doc.$schema, "mc/mode-lifecycle-hooks/v0.1", "sibling schema string");
  assert.ok(Array.isArray(doc.events), "events is an array");
});

ok("every-event-has-required-fields", () => {
  for (const row of doc.events) {
    assert.ok(typeof row.event === "string" && row.event, `event present (${JSON.stringify(row)})`);
    assert.ok(typeof row.when === "string" && row.when, `${row.event}: when present`);
    assert.ok(VALID_MODES.includes(row.mode), `${row.event}: mode ∈ {block,advisory} (got ${row.mode})`);
    assert.ok(Array.isArray(row.payload_fields), `${row.event}: payload_fields is an array`);
  }
});

ok("harness_fires-is-literal-false-on-every-row", () => {
  for (const row of doc.events) {
    assert.strictEqual(row.harness_fires, false, `${row.event}: harness_fires must be the literal false (virtual)`);
  }
});

ok("no-duplicate-event-ids", () => {
  const seen = new Set();
  for (const row of doc.events) {
    assert.ok(!seen.has(row.event), `duplicate event id ${row.event}`);
    seen.add(row.event);
  }
});

ok("~23-events-present (the §13 list, exact)", () => {
  const ids = doc.events.map((r) => r.event);
  assert.strictEqual(ids.length, EXPECTED_EVENTS.length, `expected ${EXPECTED_EVENTS.length}, got ${ids.length}`);
  for (const ev of EXPECTED_EVENTS) {
    assert.ok(ids.includes(ev), `missing declared event ${ev}`);
  }
});

ok("payload-fields-are-status-label-names-only (no obvious secret field)", () => {
  const SECRET = /(secret|token|password|api[_-]?key|credential|bearer)/i;
  for (const row of doc.events) {
    for (const f of row.payload_fields) {
      assert.ok(!SECRET.test(f), `${row.event}: payload field "${f}" looks like a secret carrier`);
    }
  }
});

ok("paths-key-survived-regen (modeLifecycleHooks)", () => {
  const p = JSON.parse(fs.readFileSync(PATHS_JSON, "utf8"));
  assert.strictEqual(
    p.modeLifecycleHooks,
    ".claude/agents/_org/mode-lifecycle-hooks.json",
    "modeLifecycleHooks must resolve in .claude/paths.json after build.js",
  );
});

console.log(`\nlifecycle-hooks-registry: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
