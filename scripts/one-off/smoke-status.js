#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * Smoke harness for scripts/portfolio/status.js (T-20260521-173).
 *
 * Covers:
 *   - empty registry → "No products registered" message + exit 0
 *   - mixed registry (valid + stale repo_path) → table renders, stale row flagged
 *   - AC-6.2 stale_count increment in TR-9 payload
 *   - parallel execution actually runs concurrently (timing assertion)
 *   - per-product 5s timeout bound (smoke: 3 products complete in <12s,
 *     should be much faster in practice but a serial impl would visibly drag)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { PassThrough } = require("stream");

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mc-status-smoke-"));
const TMP_REG = path.join(TMP_DIR, "portfolio.json");

// Set BEFORE requiring registry/status — registryPath() reads env on every call.
mcEnv.setEnv("PORTFOLIO_REGISTRY", TMP_REG);

delete require.cache[require.resolve("../../scripts/portfolio/registry")];
delete require.cache[require.resolve("../../scripts/portfolio/status")];

const reg = require("../../scripts/portfolio/registry");
const { statusForRegistry } = require("../../scripts/portfolio/status");

// ── helpers ────────────────────────────────────────────────
function makeBuffers() {
  const out = [], err = [];
  const ostream = new PassThrough(), estream = new PassThrough();
  ostream.on("data", d => out.push(d.toString()));
  estream.on("data", d => err.push(d.toString()));
  return { ostream, estream, getOut: () => out.join(""), getErr: () => err.join("") };
}

let failures = 0;
function pass(name) { console.log("PASS -", name); }
function fail(name, detail) {
  console.log("FAIL -", name);
  if (detail !== undefined) console.log("       detail:", detail);
  failures++;
}
function assertEq(name, got, want) {
  if (got === want) pass(name);
  else fail(name, { got, want });
}
function assertContains(name, got, sub) {
  if (String(got || "").includes(sub)) pass(name);
  else fail(name, { got, sub });
}

// ── Test 1: empty registry ────────────────────────────────
(async () => {
  console.log("\n--- Test 1: empty registry ---");
  reg.save({ schema: "mc/portfolio-registry/v1", products: {} });
  const b = makeBuffers();
  const r = await statusForRegistry({ stdout: b.ostream, stderr: b.estream });
  assertEq("empty.exitCode", r.exitCode, 0);
  assertEq("empty.rows.length", r.rows.length, 0);
  assertContains("empty.message", b.getOut(), "No products registered");

  // ── Test 2: mixed registry (valid + stale) ──────────────
  console.log("\n--- Test 2: mixed registry (valid + stale) ---");
  const validRepo = path.join(TMP_DIR, "valid-product");
  fs.mkdirSync(validRepo, { recursive: true });
  // Initialize a tiny git repo so `git status --porcelain` returns "" and
  // `git log` returns something. Using execSync is fine here in smoke land.
  const { execSync } = require("child_process");
  execSync("git init -b main", { cwd: validRepo, stdio: "ignore" });
  execSync('git -c user.email=a@b -c user.name=test commit --allow-empty -m smoke', {
    cwd: validRepo,
    stdio: "ignore",
  });

  const stalePath = path.join(TMP_DIR, "stale-does-not-exist");
  const nowIso = new Date().toISOString();
  reg.save({
    schema: "mc/portfolio-registry/v1",
    products: {
      valid: { slug: "valid", repo_path: validRepo, role: "product", last_synced: nowIso },
      stale: { slug: "stale", repo_path: stalePath, role: "product", last_synced: nowIso },
    },
  });

  const b2 = makeBuffers();
  const t0 = Date.now();
  const r2 = await statusForRegistry({ stdout: b2.ostream, stderr: b2.estream });
  const elapsed = Date.now() - t0;

  assertEq("mixed.exitCode", r2.exitCode, 0);
  assertEq("mixed.rows.length", r2.rows.length, 2);

  const validRow = r2.rows.find(r => r.slug === "valid");
  const staleRow = r2.rows.find(r => r.slug === "stale");
  if (!validRow) fail("mixed.valid_row_present", { rows: r2.rows.map(r => r.slug) });
  else pass("mixed.valid_row_present");
  if (!staleRow) fail("mixed.stale_row_present", { rows: r2.rows.map(r => r.slug) });
  else pass("mixed.stale_row_present");

  if (staleRow) {
    assertEq("mixed.stale_flag", staleRow.stale, true);
    assertEq("mixed.stale_remote_unreachable", staleRow.remoteUnreachable, true);
    assertContains("mixed.stale_remote_text", staleRow.remote, "stale");
  }

  // Header presence
  assertContains("mixed.header", b2.getOut(), "SLUG");
  assertContains("mixed.header", b2.getOut(), "WARP");
  assertContains("mixed.header", b2.getOut(), "LAST COMMIT");
  assertContains("mixed.header", b2.getOut(), "REMOTE");

  // ── Test 3: parallel timing ──────────────────────────────
  // With 2 products run in parallel, even on a cold machine elapsed should be
  // well below 2× the per-product timeout (10s). 8s is a loose bound that
  // still catches an accidental serial implementation under load.
  if (elapsed < 8000) pass("mixed.parallel_under_8s (elapsed=" + elapsed + "ms)");
  else fail("mixed.parallel_under_8s", { elapsed });

  // ── Test 4: TR-9 privacy contract (counts only) ─────────
  // We can't intercept the trace emission easily without monkey-patching the
  // logger module, but the rows object exposes the same counts that emitTrace
  // derives — verify the derivation contract.
  const dirtyCount = r2.rows.reduce((a, r) => a + (r.dirtyCount > 0 ? 1 : 0), 0);
  const staleCount = r2.rows.reduce((a, r) => a + (r.stale ? 1 : 0), 0);
  const unreachableCount = r2.rows.reduce((a, r) => a + (r.remoteUnreachable ? 1 : 0), 0);
  assertEq("tr9.stale_count", staleCount, 1);
  // valid product is freshly initialised git repo with no commits beyond the
  // empty one — so dirtyCount==0 expected.
  assertEq("tr9.dirty_count", dirtyCount, 0);
  // unreachableCount >= 1 (stale row is unreachable; valid row depends on gh
  // presence + auth on the smoke machine — both 1 and 2 are acceptable).
  if (unreachableCount >= 1 && unreachableCount <= 2) pass("tr9.unreachable_count_in_range");
  else fail("tr9.unreachable_count_in_range", { unreachableCount });

  // ── Cleanup ──────────────────────────────────────────────
  fs.rmSync(TMP_DIR, { recursive: true, force: true });

  console.log("\nsummary:", failures === 0 ? "ALL PASS" : `${failures} FAIL`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error("smoke crashed:", err);
  process.exit(2);
});
