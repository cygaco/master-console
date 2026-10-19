#!/usr/bin/env node
"use strict";

const assert = require("assert");
const SHP = require("./skill-hook-points");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}
const clone = (o) => JSON.parse(JSON.stringify(o));

const ROLE_IDS = ["director-of-product", "product-lead", "director-of-growth", "copy-lead", "conversion-lead", "marketing-lead"];
const coherent = {
  skills: {
    "roadmap:next": {
      domain: "product",
      hooks: [
        { hook_point: "pick", role: "product-lead", condition: "single-product" },
        { hook_point: "pick", role: "director-of-product", condition: "strategic", default: true },
      ],
    },
    "growth:message-brief": {
      domain: "growth",
      hooks: [
        { hook_point: "distill-message", role: "director-of-growth" },
        { hook_point: "shape-copy", role: "copy-lead" },
      ],
    },
  },
};

test("coherent registry → 0 errors", () => {
  const r = SHP.validate(clone(coherent), ROLE_IDS);
  assert.ok(r.ok, `expected clean, got: ${r.errors.join("; ")}`);
});

test("stale/renamed role not in registry → rejected", () => {
  const reg = clone(coherent);
  reg.skills["growth:message-brief"].hooks[0].role = "director-of-marketing";
  const r = SHP.validate(reg, ROLE_IDS);
  assert.ok(!r.ok && r.errors.some((e) => /director-of-marketing.*not in role-registry/.test(e)),
    `expected stale-role error, got: ${r.errors.join("; ")}`);
});

test("conditional hook with 0 defaults → rejected", () => {
  const reg = clone(coherent);
  reg.skills["roadmap:next"].hooks[1].default = false;
  const r = SHP.validate(reg, ROLE_IDS);
  assert.ok(!r.ok && r.errors.some((e) => /hook_point 'pick'.*0 default/.test(e)),
    `expected no-default error, got: ${r.errors.join("; ")}`);
});

test("conditional hook with 2 defaults → rejected", () => {
  const reg = clone(coherent);
  reg.skills["roadmap:next"].hooks[0].default = true;
  const r = SHP.validate(reg, ROLE_IDS);
  assert.ok(!r.ok && r.errors.some((e) => /2 default/.test(e)),
    `expected 2-default error, got: ${r.errors.join("; ")}`);
});

test("skill with empty hooks → rejected", () => {
  const reg = clone(coherent);
  reg.skills["roadmap:next"].hooks = [];
  const r = SHP.validate(reg, ROLE_IDS);
  assert.ok(!r.ok && r.errors.some((e) => /hooks missing or empty/.test(e)),
    `expected empty-hooks error, got: ${r.errors.join("; ")}`);
});

test("resolveAgent filters by skill + hook_point", () => {
  const rows = SHP.resolveAgent("growth:message-brief", "shape-copy", clone(coherent));
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].role, "copy-lead");
});

test("defaultRoleFor: conditional → default row; single → sole role", () => {
  assert.strictEqual(SHP.defaultRoleFor("roadmap:next", "pick", clone(coherent)), "director-of-product");
  assert.strictEqual(SHP.defaultRoleFor("growth:message-brief", "distill-message", clone(coherent)), "director-of-growth");
});

test("real skill-hook-points.json validates vs real role-registry", () => {
  const reg = SHP.load();
  const ids = SHP.loadRoleIds();
  const r = SHP.validate(reg, ids);
  assert.ok(r.ok, `real registry has errors: ${r.errors.join("; ")}`);
});

if (failures.length) {
  process.stderr.write(`skill-hook-points bite-test: ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}
process.stdout.write(`skill-hook-points bite-test: ${passed}/${passed} passed (positive + 4 bite + 3 resolver/integration)\n`);
process.exit(0);
