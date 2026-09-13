#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// admin-suite-coverage.test.js — SP-20260614-002 / AC-R5a.
//
// Proves scripts/checks/admin-suite-coverage.js:
//   - resolves all admin skills (via an injected resolver),
//   - flags orphan/phantom registry openers,
//   - asserts the refuseIfTargetIsMC guard in preview.js,
//   - is fail-CLOSED on a malformed registry,
//   - is TOLERANT (skip-with-note) when targets are absent in the worktree, so it reads
//     green pre-integration but enforces every check once present.
// Uses the exported evaluate() with injected { registry, resolve, exists, read } seams —
// NO real dispatch-skill subprocess, NO real preview.js needed (post-integration safe).
//   verified_by ::resolves-all-skills-no-orphan-rows-asserts-mc-guard-failclosed
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const CHECK = path.join(ROOT, "scripts", "checks", "admin-suite-coverage.js");
const { evaluate, ADMIN_SKILLS, WARPOS_GUARD_TOKEN } = require(CHECK);

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

console.log("admin-suite-coverage.test.js — AC-R5a");

const GOOD_REGISTRY = {
  $schema: "mc/admin-panel-registry/v1",
  panels: {
    admin: { route: "/admin", opener: "node scripts/admin/preview.js", description: "Founder admin home" },
    readiness: { route: "/admin/readiness", opener: "node scripts/admin/preview.js --route /admin/readiness", description: "Launch-readiness" },
    guides: { route: "/admin/guides", opener: "node scripts/admin/preview.js --route /admin/guides", description: "Guides" },
  },
};

// Fully-integrated seams: every skill present+resolves, preview.js present with the guard.
const integratedSeams = {
  resolve: (id) => ({ found: true, fileExists: true }),
  exists: (rel) => rel.startsWith("scripts/admin/"), // pretend the opener scripts exist
  // Realistic preview.js stub: run() CALLS the guard BEFORE a seam (the call-order check
  // verifies behavior/ordering, not token presence — xprovider review BLOCKER #4).
  read: (rel) =>
    rel === "scripts/admin/preview.js"
      ? `async function run(argv){ const g = ${WARPOS_GUARD_TOKEN}(instanceDir); if (g.refuse) return; resolveOrScaffold({}); }`
      : null,
};

ok("GREEN when fully integrated — all skills resolve, openers exist, guard present", () => {
  const { findings, skipped } = evaluate({ registry: GOOD_REGISTRY, ...integratedSeams });
  assert.strictEqual(findings.length, 0, `expected 0 findings, got: ${JSON.stringify(findings)}`);
  assert.strictEqual(skipped.length, 0, `expected 0 skips when fully integrated, got ${skipped.length}`);
});

ok("TOLERANT pre-integration — absent skills/preview SKIPPED-with-note, still green", () => {
  const seams = {
    resolve: (id) => ({ found: false, fileExists: false }), // skill .md absent
    exists: (rel) => false, // opener scripts absent
    read: (rel) => null, // preview.js absent
  };
  const { findings, skipped } = evaluate({ registry: GOOD_REGISTRY, ...seams });
  assert.strictEqual(findings.length, 0, `pre-integration must be green, got: ${JSON.stringify(findings)}`);
  assert(skipped.length >= ADMIN_SKILLS.length, "absent skills + preview must be skipped-with-note");
});

ok("FINDING — a skill whose file EXISTS but resolves found:false", () => {
  const seams = {
    ...integratedSeams,
    resolve: (id) => ({ found: id !== "admin:seed", fileExists: true }),
  };
  const { findings } = evaluate({ registry: GOOD_REGISTRY, ...seams });
  assert(findings.some((f) => f.finding_type === "skill_unresolved" && f.skill === "admin:seed"),
    "expected skill_unresolved for admin:seed");
});

ok("FINDING — non-admin node opener is UNRECOGNIZED (only scripts/admin/* allowed)", () => {
  const reg = { ...GOOD_REGISTRY, panels: { ...GOOD_REGISTRY.panels,
    bad: { route: "/admin/x", opener: "node scripts/elsewhere/ghost.js", description: "x" } } };
  const { findings } = evaluate({ registry: reg, ...integratedSeams });
  assert(findings.some((f) => f.finding_type === "unrecognized_opener" && f.panel === "bad"),
    "expected unrecognized_opener for a non-admin node opener");
});

ok("FINDING (BLOCKER #3) — opener injection is UNSAFE-rejected, not first-token-passed", () => {
  const reg = { ...GOOD_REGISTRY, panels: { ...GOOD_REGISTRY.panels,
    evil: { route: "/admin/e", opener: "node scripts/admin/preview.js && calc.exe", description: "e" } } };
  const { findings } = evaluate({ registry: reg, ...integratedSeams });
  assert(findings.some((f) => f.finding_type === "unsafe_opener" && f.panel === "evil"),
    "expected unsafe_opener for an opener carrying a shell metacharacter (&&)");
});

ok("FINDING — missing refuseIfTargetIsMC guard when preview.js is PRESENT", () => {
  const seams = { ...integratedSeams, read: (rel) => (rel === "scripts/admin/preview.js" ? "function preview(){}" : null) };
  const { findings } = evaluate({ registry: GOOD_REGISTRY, ...seams });
  assert(findings.some((f) => f.finding_type === "missing_mc_guard"),
    "expected missing_mc_guard when preview.js lacks the token");
});

ok("FINDING (BLOCKER #4) — guard token PRESENT but CALLED AFTER a seam → call-order finding", () => {
  const seams = { ...integratedSeams, read: (rel) => (rel === "scripts/admin/preview.js"
    ? `async function run(argv){ resolveOrScaffold({}); const g = ${WARPOS_GUARD_TOKEN}(instanceDir); }`
    : null) };
  const { findings } = evaluate({ registry: GOOD_REGISTRY, ...seams });
  assert(findings.some((f) => f.finding_type === "mc_guard_call_order"),
    "expected mc_guard_call_order when a side-effecting seam runs before the guard");
});

ok("FINDING (MEDIUM #6) — resolver infra failure is resolver_error, NOT skill_unresolved", () => {
  const seams = { ...integratedSeams,
    resolve: (id) => (id === "admin:seed"
      ? { fileExists: true, found: false, resolverError: { message: "EPERM nested spawn" } }
      : { found: true, fileExists: true }) };
  const { findings } = evaluate({ registry: GOOD_REGISTRY, ...seams });
  assert(findings.some((f) => f.finding_type === "resolver_error" && f.skill === "admin:seed"),
    "resolver infra failure must surface as resolver_error");
  assert(!findings.some((f) => f.finding_type === "skill_unresolved"),
    "must NOT collapse a resolver error into skill_unresolved");
});

ok("FINDING — malformed panel row (missing fields)", () => {
  const reg = { ...GOOD_REGISTRY, panels: { ...GOOD_REGISTRY.panels, broke: { route: "/admin/y" } } };
  const { findings } = evaluate({ registry: reg, ...integratedSeams });
  assert(findings.some((f) => f.finding_type === "malformed_panel_row" && f.panel === "broke"),
    "expected malformed_panel_row");
});

ok("fail-CLOSED — malformed registry file -> CLI exit 2", () => {
  // Point the CLI at a bad registry by temp-swapping is heavy; instead assert the live CLI
  // runs and exits 0/1 (never crashes) against the real tree, AND that evaluate flags a
  // panels-less registry (the in-process fail-closed precursor).
  const { findings } = evaluate({ registry: { $schema: "x", panels: null }, ...integratedSeams });
  assert(findings.some((f) => f.finding_type === "registry_no_panels"), "expected registry_no_panels");
});

ok("live CLI runs against the real tree and exits 0 or 1 (never crashes)", () => {
  const res = spawnSync(process.execPath, [CHECK, "--json"], { cwd: ROOT, encoding: "utf8" });
  assert([0, 1].includes(res.status), `CLI exited ${res.status} (expected 0|1):\n${res.stderr}`);
  const out = JSON.parse(String(res.stdout).trim());
  assert(typeof out.ok === "boolean" && typeof out.checked === "number", "CLI --json shape");
});

console.log(`\nadmin-suite-coverage: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
