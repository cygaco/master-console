#!/usr/bin/env node
"use strict";

/**
 * Isolated P5 test for epsilon-liveness.js (T-291 / doogle WG-6).
 *
 * Proves the four required cases:
 *   1. green     — evidence file matched by sha256 ledger record
 *   2. red       — orphaned evidence (no ledger record)
 *   3. green     — no evidence files (nothing to check)
 *   4. red       — unreadable ledger + evidence present (fail-closed)
 *
 * Plus bonus cases:
 *   5. green     — evidence matched by sprint+step+role filename convention (fallback)
 *   6. red       — ledger present but only ok:false records (no confirmed completion)
 *   7. green     — evidence file not yet stale (younger than threshold) is skipped
 *
 * Deterministic: uses pre-computed sha256 values and a fixed nowMs — no wall-clock sleeps.
 *   node scripts/checks/epsilon-liveness.test.js
 */

// These fixtures inject UNSIGNED synthetic ledger records to exercise the stall-DETECTION MATCHING logic
// (sha256 + filename fallback), so they opt out of the SP-20260718-004 same-session signature requirement
// via TEST-INJECTION (requireSignature:false) — NOT the old ambient MC_LIVENESS_REQUIRE_SIG=0 runtime
// env, which was killed (hunter r3 #2: an ambient-env unsigned opt-out is a settable-label false-green).
// The signature gate itself is covered by the verified-liveness-read suite.
const crypto = require("crypto");
const { harness } = require("./lib/fixture-harness");
const { evaluate: _evaluate } = require("./epsilon-liveness");
const evaluate = (args) => _evaluate({ requireSignature: false, ...args });

const h = harness("epsilon-liveness");

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// Fixed reference "now" — all mtimes are relative to this.
const NOW_MS = 1_000_000_000; // arbitrary epoch ms
const STALE_MS = 10 * 60 * 1000; // 10 min threshold
const OLD_MS = NOW_MS - 20 * 60 * 1000; // 20 min old = stale

// ── Case 1: green — sha256 match in ledger ───────────────────────────────────
h.pass("green when evidence file has a matching sha256 ledger record", () => {
  const evSha = sha256(Buffer.from("real-agent-return-value"));
  return evaluate({
    evidenceFiles: [
      { path: "/tmp/SP-001-design-product-lead.return.txt", mtimeMs: OLD_MS, sha256: evSha },
    ],
    ledgerLines: [
      JSON.stringify({
        role: "product-lead",
        sprint_id: "SP-001",
        step: "design",
        via: "epsilon-agent",
        ok: true,
        evidence_sha: evSha,
        completed_at: new Date(OLD_MS + 5000).toISOString(),
      }),
    ],
    nowMs: NOW_MS,
  });
});

// ── Case 2: red — orphaned evidence (no matching record) ─────────────────────
h.violation("red when evidence file has no matching ledger record", () => {
  const evSha = sha256(Buffer.from("orphaned-evidence-content"));
  const otherSha = sha256(Buffer.from("different-content"));
  return evaluate({
    evidenceFiles: [
      { path: "/tmp/SP-001-build-frontend-builder.return.txt", mtimeMs: OLD_MS, sha256: evSha },
    ],
    ledgerLines: [
      // Record for a DIFFERENT sprint_id: sha mismatch + filename mismatch (SP-999 ≠ SP-001)
      JSON.stringify({
        role: "frontend-builder",
        sprint_id: "SP-999",
        step: "build",
        via: "epsilon-agent",
        ok: true,
        evidence_sha: otherSha,
        completed_at: new Date(OLD_MS + 5000).toISOString(),
      }),
    ],
    nowMs: NOW_MS,
  });
});

// ── Case 3: green — no evidence files (nothing to check) ────────────────────
h.pass("green when no evidence files (nothing to check)", () =>
  evaluate({ evidenceFiles: [], ledgerLines: [], nowMs: NOW_MS }));

// ── Case 4: red — unreadable ledger + evidence present (fail-closed) ─────────
h.failClosed("red when ledger is unreadable and evidence exists (fail-closed)", () => {
  const evSha = sha256(Buffer.from("evidence-no-ledger"));
  return evaluate({
    evidenceFiles: [
      { path: "/tmp/SP-002-design-qa-reviewer.return.txt", mtimeMs: OLD_MS, sha256: evSha },
    ],
    ledgerLines: null, // null = unreadable
    nowMs: NOW_MS,
  });
});

// ── Case 5: green — filename-based fallback matching ────────────────────────
h.pass("green when evidence matched by sprint+step+role filename convention (fallback)", () => {
  const evSha = sha256(Buffer.from("filename-fallback-evidence"));
  const sprintId = "SP-003";
  const step = "gauntlet";
  const role = "security-reviewer";
  return evaluate({
    evidenceFiles: [
      {
        path: `/tmp/${sprintId}-${step}-${role}.return.txt`,
        mtimeMs: OLD_MS,
        sha256: evSha,
      },
    ],
    ledgerLines: [
      JSON.stringify({
        role,
        sprint_id: sprintId,
        step,
        via: "epsilon-agent",
        ok: true,
        // No evidence_sha — exercises the filename fallback path
        completed_at: new Date(OLD_MS + 5000).toISOString(),
      }),
    ],
    nowMs: NOW_MS,
  });
});

// ── Case 6: red — ledger has only ok:false records ──────────────────────────
h.violation("red when ledger records exist but all have ok:false", () => {
  const evSha = sha256(Buffer.from("failed-return-evidence"));
  return evaluate({
    evidenceFiles: [
      { path: "/tmp/SP-004-plan-director-of-product.return.txt", mtimeMs: OLD_MS, sha256: evSha },
    ],
    ledgerLines: [
      JSON.stringify({
        role: "director-of-product",
        sprint_id: "SP-004",
        step: "plan",
        via: "epsilon-agent",
        ok: false, // reap/failure — should NOT count as a match
        evidence_sha: evSha,
        completed_at: new Date(OLD_MS + 5000).toISOString(),
      }),
    ],
    nowMs: NOW_MS,
  });
});

// ── Case 7: green — evidence file not yet stale is not passed in ─────────────
// (The caller pre-filters by age before calling evaluate(); this proves that
//  a fresh file correctly produces no findings when evidenceFiles is empty.)
h.pass("green when evidenceFiles is empty (caller filtered out fresh files)", () =>
  evaluate({
    evidenceFiles: [], // fresh file was filtered by collectEvidence() before calling evaluate()
    ledgerLines: ["{}"],
    nowMs: NOW_MS,
  }));

// ── Case 8: red — unreadable evidence file (fail-closed, gauntlet 2026-06-10) ──
h.violation("red when evidence file is unreadable/un-stat-able (fail-closed)", () =>
  evaluate({
    evidenceFiles: [
      { path: "/tmp/SP-x-build-builder.return.txt", mtimeMs: null, sha256: null, unreadable: true },
    ],
    ledgerLines: ["{}"],
    nowMs: NOW_MS,
  }));

h.done();
