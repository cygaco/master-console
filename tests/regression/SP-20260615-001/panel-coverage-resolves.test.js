#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// panel-coverage-resolves.test.js — SP-20260615-001 / AC-R5a.
//
// Proves scripts/checks/panel-registry-coverage.js asserts every registry row's opener
// resolves to a REAL backing target, and that an orphan / unsafe opener is a hard finding
// (exit 1):
//   - against the REAL framework/panel-registry.json → exit 0 (all 4 seed rows resolve:
//     /cockpit:readiness, /models:router, node scripts/admin/preview.js, node scripts/panel/roadmap.js),
//   - against a temp fixture with an ORPHAN opener (node scripts/nonexistent.js) → exit 1,
//   - against a temp fixture with an UNSAFE opener (node x.js && calc) → exit 1.
// The fixture path is fed via the --registry seam so the real file is never touched.
//   verified_by ::every-row-opener-resolves-orphan-or-unsafe-is-finding
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const CHECK = path.join(ROOT, "scripts", "checks", "panel-registry-coverage.js");
const REAL_REGISTRY = path.join(ROOT, "framework", "panel-registry.json");
// evaluate() is the INJECTABLE pure core — used for the B2/B3 cases so the review sandbox
// (which has spawnSync EPERM) can verify the fixes without a nested node spawn.
const { evaluate } = require(CHECK);

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

console.log("panel-coverage-resolves.test.js — AC-R5a");

// Run the CLI; return { status, out } where out is the parsed --json envelope.
function runCheck(registryPath) {
  const args = [CHECK, "--json"];
  if (registryPath) args.push("--registry", registryPath);
  const res = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
  let out = null;
  try {
    out = JSON.parse(String(res.stdout).trim());
  } catch {
    /* leave null — a corrupt-input run still prints JSON; a crash would not */
  }
  return { status: res.status, out, stderr: res.stderr };
}

// A scratch dir for fixture registries (cleaned at the end).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "panel-cov-resolves-"));
function writeFixture(name, obj) {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
  return p;
}

ok("REAL registry — all 4 seed rows resolve → exit 0", () => {
  // Sanity: the real registry exists and carries the four known panels.
  const real = JSON.parse(fs.readFileSync(REAL_REGISTRY, "utf8"));
  assert.strictEqual(real.$schema, "mc/panel-registry/v1", "real registry $schema");
  for (const p of ["readiness", "models", "admin", "roadmap"]) {
    assert(real.panels[p], `real registry missing the '${p}' seed row`);
  }
  const { status, out } = runCheck(); // no --registry → the real file
  assert.strictEqual(status, 0, `expected exit 0 on the real registry, got ${status}`);
  assert(out && out.ok === true, `expected ok:true, got ${JSON.stringify(out)}`);
  assert.strictEqual(out.violationCount, 0, `expected 0 findings, got ${JSON.stringify(out.violations)}`);
});

ok("ORPHAN opener (node scripts/nonexistent.js) → finding, exit 1", () => {
  const fixture = writeFixture("orphan.json", {
    $schema: "mc/panel-registry/v1",
    panels: {
      ghost: { name: "ghost", opener: "node scripts/nonexistent.js", description: "phantom target", run_context: "cli" },
    },
  });
  const { status, out } = runCheck(fixture);
  assert.strictEqual(status, 1, `expected exit 1 on an orphan opener, got ${status}`);
  assert(out && out.ok === false, "expected ok:false");
  assert(
    out.violations.some((v) => v.finding_type === "orphan_opener" && v.panel === "ghost"),
    `expected orphan_opener for 'ghost', got ${JSON.stringify(out.violations)}`,
  );
});

ok("UNSAFE opener (node x.js && calc) → finding, exit 1", () => {
  const fixture = writeFixture("unsafe.json", {
    $schema: "mc/panel-registry/v1",
    panels: {
      evil: { name: "evil", opener: "node x.js && calc", description: "injection attempt", run_context: "cli" },
    },
  });
  const { status, out } = runCheck(fixture);
  assert.strictEqual(status, 1, `expected exit 1 on an unsafe opener, got ${status}`);
  assert(out && out.ok === false, "expected ok:false");
  assert(
    out.violations.some((v) => v.finding_type === "unsafe_opener" && v.panel === "evil"),
    `expected unsafe_opener for 'evil' (the && metacharacter), got ${JSON.stringify(out.violations)}`,
  );
});

// ── B2 (review BLOCKER): an orphan script INSIDE an EXISTING lane dir is a FINDING, not a
// skip. The prefix-only skip would permanently mask a real orphan in the integrated tree.
// Verified via the INJECTABLE evaluate() (no spawn — sandbox-safe).
ok("B2 — orphan script inside an EXISTING lane dir → orphan_opener finding (NOT skipped)", () => {
  const { findings, skipped } = evaluate({
    registry: {
      $schema: "mc/panel-registry/v1",
      panels: { roadmap: { name: "roadmap", opener: "node scripts/panel/ghost.js", description: "d", run_context: "cli" } },
    },
    resolve: () => ({ found: true }),
    exists: () => false, // the script file is absent
    laneDirExists: () => true, // but the lane dir scripts/panel/ EXISTS (integrated tree)
  });
  assert(
    findings.some((f) => f.finding_type === "orphan_opener" && f.panel === "roadmap"),
    `expected orphan_opener when the lane dir exists, got ${JSON.stringify(findings)}`,
  );
  assert.strictEqual(skipped.length, 0, "must NOT skip an absent script when its lane dir exists");
});

ok("B2 — absent script AND absent lane dir → SKIP (genuine pre-integration case stays tolerant)", () => {
  const { findings, skipped } = evaluate({
    registry: {
      $schema: "mc/panel-registry/v1",
      panels: { roadmap: { name: "roadmap", opener: "node scripts/panel/ghost.js", description: "d", run_context: "cli" } },
    },
    resolve: () => ({ found: true }),
    exists: () => false,
    laneDirExists: () => false, // lane dir absent → genuine mid-worktree, skip-with-note
  });
  assert.strictEqual(findings.length, 0, "an absent lane dir must remain tolerant (no finding)");
  assert.strictEqual(skipped.length, 1, "expected exactly one skip-with-note");
});

// ── B3 (review BLOCKER): the row shape is EXACT — an extra `route` key is a FINDING.
ok("B3 — a row with an extra `route` key → extra_row_keys finding (exact shape)", () => {
  const { findings } = evaluate({
    registry: {
      $schema: "mc/panel-registry/v1",
      panels: { admin: { name: "admin", opener: "/cockpit:readiness", description: "d", run_context: "cli", route: "/admin" } },
    },
    resolve: () => ({ found: true }),
    exists: () => true,
    laneDirExists: () => true,
  });
  assert(
    findings.some((f) => f.finding_type === "extra_row_keys" && f.panel === "admin"),
    `expected extra_row_keys for the admin-style 'route' key, got ${JSON.stringify(findings)}`,
  );
});

// Cleanup.
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {
  /* best effort */
}

console.log(`\npanel-coverage-resolves: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
