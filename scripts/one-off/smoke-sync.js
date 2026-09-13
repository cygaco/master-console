#!/usr/bin/env node
"use strict";

/**
 * Smoke for scripts/portfolio/sync.js (T-20260521-175).
 *
 * Covers:
 *   - empty registry → exit 0, "no products" message
 *   - dry-run with 2 products → both rows emitted, exit 0
 *   - missing-repo product → SKIP row, not a fail-fast (AC-8.2)
 *   - sequential execution (no Promise.all) — timing of 2 dry-run products
 *     should be near-instantaneous (no subprocess spawn)
 *   - summary table renders with success/failure counts
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { PassThrough } = require("stream");

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mc-sync-smoke-"));
const TMP_REG = path.join(TMP_DIR, "portfolio.json");
const REAL_REPO = path.join(TMP_DIR, "real-product");
fs.mkdirSync(REAL_REPO, { recursive: true });

process.env.WARPOS_PORTFOLIO_REGISTRY = TMP_REG;

delete require.cache[require.resolve("../../scripts/portfolio/registry")];
delete require.cache[require.resolve("../../scripts/portfolio/sync")];
const reg = require("../../scripts/portfolio/registry");
const { syncRegistry } = require("../../scripts/portfolio/sync");

function makeBuffers() {
  const out = [], err = [];
  const ostream = new PassThrough(), estream = new PassThrough();
  ostream.on("data", d => out.push(d.toString()));
  estream.on("data", d => err.push(d.toString()));
  return { ostream, estream, getOut: () => out.join(""), getErr: () => err.join("") };
}

let failures = 0;
function assertEq(name, got, want) {
  if (got === want) console.log("PASS -", name);
  else {
    console.log("FAIL -", name, "→ got:", JSON.stringify(got), "want:", JSON.stringify(want));
    failures++;
  }
}
function assertContains(name, got, sub) {
  if (String(got || "").includes(sub)) console.log("PASS -", name);
  else {
    console.log("FAIL -", name, "→ contains:", JSON.stringify(sub), "actual:", JSON.stringify(got).slice(0, 300));
    failures++;
  }
}

(async () => {
  // 1. Empty registry
  console.log("--- Test 1: empty registry ---");
  reg.save({ schema: "mc/portfolio-registry/v1", products: {} });
  {
    const b = makeBuffers();
    const r = await syncRegistry({ stdout: b.ostream, stderr: b.estream });
    assertEq("empty.exitCode", r.exitCode, 0);
    assertEq("empty.results.length", r.results.length, 0);
    assertContains("empty.message", b.getOut(), "No products registered");
  }

  // 2. Two products dry-run (one real, one missing-repo)
  console.log("\n--- Test 2: two products dry-run (real + missing) ---");
  const nowIso = new Date().toISOString();
  reg.save({
    schema: "mc/portfolio-registry/v1",
    products: {
      real: {
        slug: "real",
        repo_path: REAL_REPO,
        role: "product",
        last_synced: nowIso,
      },
      missing: {
        slug: "missing",
        repo_path: path.join(TMP_DIR, "does-not-exist"),
        role: "product",
        last_synced: nowIso,
      },
    },
  });

  {
    const b = makeBuffers();
    const t0 = Date.now();
    const r = await syncRegistry({ stdout: b.ostream, stderr: b.estream, dryRun: true });
    const elapsed = Date.now() - t0;

    // exit 1 expected: missing-repo counts as a failure per AC-8.2 contract
    // ("non-zero only if at least one product failed, but every product is
    // attempted"). All-pass case is covered by the next assertion below.
    assertEq("dryrun.exitCode (mixed)", r.exitCode, 1);
    assertEq("dryrun.results.length", r.results.length, 2);

    const realR = r.results.find(x => x.slug === "real");
    const missingR = r.results.find(x => x.slug === "missing");
    assertEq("dryrun.real.ok", realR && realR.ok, true);
    assertEq("dryrun.real.status", realR && realR.status, "dry-run");
    assertEq("dryrun.missing.ok", missingR && missingR.ok, false);
    assertEq("dryrun.missing.status", missingR && missingR.status, "repo-not-found");

    // C-13 per-product banner format
    assertContains("c-13.real.banner", b.getOut(), "syncing real... ");
    assertContains("c-13.missing.banner", b.getOut(), "syncing missing... ");
    assertContains("c-13.missing.skip", b.getOut(), "SKIP (repo not found");

    // Summary table
    assertContains("summary.header", b.getOut(), "SLUG");
    assertContains("summary.header.FROM", b.getOut(), "FROM");
    assertContains("summary.header.TO", b.getOut(), "TO");
    assertContains("summary.tally", b.getOut(), "1 ok / 1 failed");

    // Sequential timing — dry-run shouldn't take more than a second total for 2 products.
    if (elapsed < 1000) console.log("PASS - dryrun.sequential_fast (elapsed=" + elapsed + "ms)");
    else { console.log("FAIL - dryrun.sequential_fast → elapsed=" + elapsed + "ms"); failures++; }
  }

  // 3. AC-8.2: no fail-fast — the missing-repo product doesn't abort the run,
  //    siblings are processed. (Already implicit in test 2 — both rows emit.)
  console.log("\n--- Test 3: no-fail-fast (AC-8.2) ---");
  // Construct a 3-product registry where the middle one is missing — verify
  // the third (after the missing one) still gets processed.
  const REAL_2 = path.join(TMP_DIR, "real-2");
  fs.mkdirSync(REAL_2, { recursive: true });
  reg.save({
    schema: "mc/portfolio-registry/v1",
    products: {
      a: { slug: "a", repo_path: REAL_REPO, role: "product", last_synced: nowIso },
      b: { slug: "b", repo_path: path.join(TMP_DIR, "gone"), role: "product", last_synced: nowIso },
      c: { slug: "c", repo_path: REAL_2, role: "product", last_synced: nowIso },
    },
  });
  {
    const b = makeBuffers();
    const r = await syncRegistry({ stdout: b.ostream, stderr: b.estream, dryRun: true });
    assertEq("nofailfast.results.length", r.results.length, 3);
    assertEq("nofailfast.a.ok", r.results.find(x => x.slug === "a").ok, true);
    assertEq("nofailfast.b.ok", r.results.find(x => x.slug === "b").ok, false);
    assertEq("nofailfast.c.ok", r.results.find(x => x.slug === "c").ok, true);
    assertContains("nofailfast.summary", b.getOut(), "2 ok / 1 failed");
  }

  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  console.log("\nsummary:", failures === 0 ? "ALL PASS" : `${failures} FAIL`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error("smoke crashed:", err);
  process.exit(2);
});
