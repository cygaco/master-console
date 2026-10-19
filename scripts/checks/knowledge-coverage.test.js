#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
const { execFileSync } = require("child_process");
const { evaluate } = require("./knowledge-coverage");

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}
const has = (problems, frag) => problems.some((p) => p.includes(frag));

const SPECS = {
  "design-lead": ".claude/agents/product/design-lead.md",
  "visual-review": ".claude/agents/product/quality/visual-review.md",
  "research-lead": ".claude/agents/growth/research-lead.md",
};
const roleSpecs = new Map(Object.entries(SPECS));

const libDomain = {
  domain: "design",
  kind: "library",
  producer: "design-lead",
  consumers: ["design-lead", "visual-review"],
};
const storeDomain = {
  domain: "audience",
  kind: "store",
  producer: "research-lead",
  consumers: ["copy-lead"],
};

const marker = (domain, role) => ({ domain, role, file: SPECS[role] });
const record = (domain, role) => ({ domain, role });

const coherent = () => ({
  domains: [libDomain],
  active: [record("design", "design-lead"), record("design", "visual-review")],
  markers: [marker("design", "design-lead"), marker("design", "visual-review")],
  roleSpecs,
});

test("coherent library → 0 problems", () => {
  const problems = evaluate(coherent());
  assert.deepStrictEqual(problems, [], `expected clean, got: ${problems.join(" | ")}`);
});

test("consumer with no active record → INV-3 (no record)", () => {
  const s = coherent();
  s.active = s.active.filter((r) => r.role !== "design-lead");
  const problems = evaluate(s);
  assert.ok(
    has(problems, "INV-3") && has(problems, "design-lead") && has(problems, "no active integration record"),
    `expected INV-3 no-record for design-lead, got: ${problems.join(" | ")}`
  );
});

test("consumer marker in wrong spec → INV-3 (no live marker)", () => {
  const s = coherent();
  s.markers = [record("design", "design-lead") && { domain: "design", role: "design-lead", file: ".claude/agents/WRONG.md" }, marker("design", "visual-review")];
  const problems = evaluate(s);
  assert.ok(
    has(problems, "INV-3") && has(problems, "no live") && has(problems, "design-lead"),
    `expected INV-3 no-marker for design-lead, got: ${problems.join(" | ")}`
  );
});

test("active record with no marker → INV-6 (phantom record)", () => {
  const s = coherent();
  s.markers = [marker("design", "visual-review")];
  const problems = evaluate(s);
  assert.ok(
    has(problems, "INV-6") && has(problems, "phantom"),
    `expected INV-6 phantom for design-lead, got: ${problems.join(" | ")}`
  );
});

test("record for a non-consumer role → INV-7 (orphan record)", () => {
  const s = coherent();
  s.active = [...s.active, record("design", "copy-lead")];
  const problems = evaluate(s);
  assert.ok(
    has(problems, "INV-7") && has(problems, "copy-lead") && has(problems, "orphan record"),
    `expected INV-7 orphan record for copy-lead, got: ${problems.join(" | ")}`
  );
});

test("marker with no record → INV-8 (orphan marker)", () => {
  const s = coherent();
  s.markers = [...s.markers, { domain: "design", role: "design-quality", file: SPECS["design-lead"] }];
  const problems = evaluate(s);
  assert.ok(
    has(problems, "INV-8") && has(problems, "design-quality") && has(problems, "orphan marker"),
    `expected INV-8 orphan marker for design-quality, got: ${problems.join(" | ")}`
  );
});

test("store producer record → tolerated, 0 problems from evaluate", () => {
  const problems = evaluate({
    domains: [storeDomain],
    active: [record("audience", "research-lead")],
    markers: [],
    roleSpecs,
  });
  assert.deepStrictEqual(problems, [], `store producer record must be tolerated, got: ${problems.join(" | ")}`);
});

test("store record for an unrelated role → INV-7 (orphan record)", () => {
  const problems = evaluate({
    domains: [storeDomain],
    active: [record("audience", "marketing-lead")],
    markers: [],
    roleSpecs,
  });
  assert.ok(has(problems, "INV-7") && has(problems, "marketing-lead"), `expected INV-7, got: ${problems.join(" | ")}`);
});

test("integration: real enforcer runs and emits a verdict on the live tree", () => {
  let out = "";
  let status = 0;
  try {
    out = execFileSync(process.execPath, [path.join(__dirname, "knowledge-coverage.js")], {
      encoding: "utf8",
      cwd: path.resolve(__dirname, "..", ".."),
    });
  } catch (e) {
    status = e.status;
    out = `${e.stdout || ""}${e.stderr || ""}`;
  }
  assert.ok(status === 0 || status === 1, `enforcer must exit 0 or 1, got ${status}: ${out}`);
  assert.ok(/\[knowledge-coverage\]/.test(out), `expected a knowledge-coverage status line, got: ${out}`);
});

if (failures.length) {
  process.stderr.write(`knowledge-coverage bite-test: ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}
process.stdout.write(
  `knowledge-coverage bite-test: ${passed}/${passed} passed (positive + INV-3a/3b/6/7/8 + store-tolerance + integration)\n`
);
process.exit(0);
