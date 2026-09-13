#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";
/**
 * scripts/checks/mc-install-baseline.ship-coverage.test.js
 *
 * Hermetic tests for the --ship-coverage mode added to mc-install-baseline.js
 * (S-LC-12 / T-296 class-closer).
 *
 * Drives the exported pure helpers { shippedPathSet, computeShipCoverage } with
 * in-memory manifest fixtures — no subprocess spawning, no live manifest dependency.
 *
 * Test cases:
 *   (A) GREEN  — all mandated paths present in shipped set
 *   (B) RED    — one mandated path absent from shipped set → reported in missing[]
 *   (C) FAIL-CLOSED (no assets) — manifest with no assets key → red
 *   (D) FAIL-CLOSED (null)      — null manifest → red
 *   (E) FAIL-CLOSED (empty assets) — manifest.assets === {} → red
 *   (F) src vs dest  — path present only as dest (not src) still matches
 *   (G) multi-kind  — paths spread across multiple asset kinds all found
 *
 * Exit: 0 iff all tests pass, 1 otherwise.
 */

const path = require("path");
const { shippedPathSet, computeShipCoverage } = require(
  path.join(__dirname, "mc-install-baseline.js"),
);

let passes = 0;
let failures = 0;

function ok(name, condition, detail) {
  if (condition) {
    passes++;
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    const suffix = detail != null ? ` — ${detail}` : "";
    console.log(`  FAIL ${name}${suffix}`);
  }
}

// ── Helper: build a minimal valid manifest with one or more asset kinds ──────
function makeManifest(assetsByKind) {
  return { assets: assetsByKind };
}

// ─────────────────────────────────────────────────────────────────────────────
// (A) GREEN — all mandated paths present in shipped set
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[A] GREEN — all mandated paths present in ship payload");
{
  const manifest = makeManifest({
    top_script: [
      { src: "scripts/dispatch-agent.js", dest: "scripts/dispatch-agent.js" },
      { src: "scripts/dispatch-claude.js", dest: "scripts/dispatch-claude.js" },
    ],
    hook: [
      { src: "scripts/hooks/build.js", dest: "scripts/hooks/build.js" },
    ],
  });
  const mandated = [
    "scripts/dispatch-agent.js",
    "scripts/dispatch-claude.js",
    "scripts/hooks/build.js",
  ];
  const result = computeShipCoverage(manifest, mandated);
  ok("(A) status === green", result.status === "green", `got ${result.status}`);
  ok("(A) missing[] is empty", result.missing.length === 0, `got ${JSON.stringify(result.missing)}`);
  ok("(A) checkedPaths === 3", result.checkedPaths === 3, `got ${result.checkedPaths}`);

  // Verify shippedPathSet directly
  const s = shippedPathSet(manifest);
  ok("(A) shippedPathSet has dispatch-agent.js", s.has("scripts/dispatch-agent.js"));
  ok("(A) shippedPathSet has dispatch-claude.js", s.has("scripts/dispatch-claude.js"));
  ok("(A) shippedPathSet has hooks/build.js", s.has("scripts/hooks/build.js"));
}

// ─────────────────────────────────────────────────────────────────────────────
// (B) RED — one mandated path absent from shipped set → reported in missing[]
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[B] RED — one mandated path absent from ship payload");
{
  const manifest = makeManifest({
    top_script: [
      { src: "scripts/dispatch-agent.js", dest: "scripts/dispatch-agent.js" },
    ],
  });
  const mandated = [
    "scripts/dispatch-agent.js",
    "scripts/generate-steps-maps.js",  // NOT in manifest
  ];
  const result = computeShipCoverage(manifest, mandated);
  ok("(B) status === red", result.status === "red", `got ${result.status}`);
  ok(
    "(B) missing[] contains the absent path",
    result.missing.length === 1 && result.missing[0] === "scripts/generate-steps-maps.js",
    `got ${JSON.stringify(result.missing)}`,
  );
  ok("(B) checkedPaths === 2", result.checkedPaths === 2, `got ${result.checkedPaths}`);
  ok(
    "(B) reason mentions count",
    typeof result.reason === "string" && result.reason.includes("1 of 2"),
    `got reason: ${result.reason}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// (C) FAIL-CLOSED — manifest with no assets key → red
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[C] FAIL-CLOSED — manifest missing assets key → red");
{
  const manifest = { version: "0.15.4", generated_by: "test" };  // no assets
  const result = computeShipCoverage(manifest, ["scripts/foo.js"]);
  ok("(C) status === red", result.status === "red", `got ${result.status}`);
  ok(
    "(C) reason mentions fail-closed",
    typeof result.reason === "string" && result.reason.toLowerCase().includes("fail-closed"),
    `got reason: ${result.reason}`,
  );
  ok("(C) checkedPaths === 0", result.checkedPaths === 0, `got ${result.checkedPaths}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// (D) FAIL-CLOSED — null manifest → red
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[D] FAIL-CLOSED — null manifest → red");
{
  const result = computeShipCoverage(null, ["scripts/foo.js"]);
  ok("(D) status === red", result.status === "red", `got ${result.status}`);
  ok(
    "(D) reason mentions fail-closed",
    typeof result.reason === "string" && result.reason.toLowerCase().includes("fail-closed"),
    `got reason: ${result.reason}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// (E) FAIL-CLOSED — empty assets object → red
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[E] FAIL-CLOSED — empty assets {} → red");
{
  const manifest = { assets: {} };  // assets present but empty
  const result = computeShipCoverage(manifest, ["scripts/foo.js"]);
  ok("(E) status === red", result.status === "red", `got ${result.status}`);
  ok(
    "(E) reason mentions fail-closed",
    typeof result.reason === "string" && result.reason.toLowerCase().includes("fail-closed"),
    `got reason: ${result.reason}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// (F) src vs dest — path present only as dest (not src) still matches
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[F] src vs dest — path under dest matches even if different from src");
{
  const manifest = makeManifest({
    some_kind: [
      // dest differs from src — the mandated path matches dest
      { src: "scripts/internal/foo-source.js", dest: "scripts/foo.js" },
    ],
  });
  const mandated = ["scripts/foo.js"];
  const result = computeShipCoverage(manifest, mandated);
  ok("(F) status === green (dest match)", result.status === "green", `got ${result.status}`);

  // Also verify src is in the set too
  const s = shippedPathSet(manifest);
  ok("(F) shippedPathSet has dest path", s.has("scripts/foo.js"));
  ok("(F) shippedPathSet has src path too", s.has("scripts/internal/foo-source.js"));
}

// ─────────────────────────────────────────────────────────────────────────────
// (G) multi-kind — paths spread across multiple asset kinds all found
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[G] multi-kind — mandated paths across different asset kinds");
{
  const manifest = makeManifest({
    top_script: [
      { src: "scripts/dispatch-claude.js", dest: "scripts/dispatch-claude.js" },
    ],
    hook: [
      { src: "scripts/hooks/build.js", dest: "scripts/hooks/build.js" },
    ],
    check_tool: [
      { src: "scripts/checks/doc-ref-integrity.js", dest: "scripts/checks/doc-ref-integrity.js" },
    ],
    paths_engine: [
      { src: "scripts/paths/build.js", dest: "scripts/paths/build.js" },
    ],
  });
  const mandated = [
    "scripts/dispatch-claude.js",
    "scripts/hooks/build.js",
    "scripts/checks/doc-ref-integrity.js",
    "scripts/paths/build.js",
  ];
  const result = computeShipCoverage(manifest, mandated);
  ok("(G) status === green", result.status === "green", `got ${result.status}`);
  ok("(G) missing[] empty", result.missing.length === 0, `got ${JSON.stringify(result.missing)}`);
  ok("(G) checkedPaths === 4", result.checkedPaths === 4, `got ${result.checkedPaths}`);

  const s = shippedPathSet(manifest);
  ok("(G) shippedPathSet.size === 4", s.size === 4, `got ${s.size}`);
}

// ── (H) CLI smoke test — the --ship-coverage MODE actually runs end-to-end ──────
// The hermetic cases above drive the pure helpers only. A gauntlet reviewer (S-LC-12)
// reading the diff in isolation hallucinated that runShipCoverageCheck() references an
// undeclared REPO_ROOT and crashes on invocation — a FALSE POSITIVE (REPO_ROOT is
// declared at module top-level and the live mode runs green). This case spawns the
// real CLI so the glue is exercised: the process must exit cleanly (0 green or 1 red),
// must NOT throw a ReferenceError / crash with a non-{0,1} code, and must emit the
// mode's own result line — proving the CLI dispatch + variable scope are sound.
{
  const { spawnSync } = require("child_process");
  const script = path.join(__dirname, "mc-install-baseline.js");
  const r = spawnSync(process.execPath, [script, "--ship-coverage", "--json"], {
    encoding: "utf8",
    cwd: path.resolve(__dirname, "..", ".."),
    timeout: 30000,
  });
  const noCrash = !r.error && (r.status === 0 || r.status === 1);
  const noRefError = !/ReferenceError/.test((r.stderr || "") + (r.stdout || ""));
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* non-JSON = a crash, caught by noCrash */ }
  const emittedResult = parsed && parsed.name === "mc-install-baseline:ship-coverage";
  ok("(H) --ship-coverage CLI runs without crash (exit 0|1, no spawn error)", noCrash, `status=${r.status} err=${r.error && r.error.message}`);
  ok("(H) --ship-coverage CLI does not throw ReferenceError", noRefError, (r.stderr || "").slice(0, 200));
  ok("(H) --ship-coverage CLI emits its result envelope", Boolean(emittedResult), `stdout=${(r.stdout || "").slice(0, 200)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n# ${passes + failures} tests: ${passes} passed, ${failures} failed`);
if (failures > 0) {
  console.error(`FAIL mc-install-baseline.ship-coverage.test: ${failures} test(s) failed`);
  process.exit(1);
} else {
  console.log("OK   mc-install-baseline.ship-coverage.test: all tests passed");
  process.exit(0);
}
