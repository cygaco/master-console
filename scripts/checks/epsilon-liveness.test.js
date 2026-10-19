#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const { harness } = require("./lib/fixture-harness");
const { evaluate: _evaluate } = require("./epsilon-liveness");
const evaluate = (args) => _evaluate({ requireSignature: false, ...args });

const h = harness("epsilon-liveness");

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

const NOW_MS = 1_000_000_000;
const STALE_MS = 10 * 60 * 1000;
const OLD_MS = NOW_MS - 20 * 60 * 1000;

h.pass("green when evidence file has a matching sha256 ledger record", () => {
  const evSha = sha256(Buffer.from("real-agent-return-value"));
  return evaluate({
    evidenceFiles: [
      { path: "/tmp/SP-999001-design-product-lead.return.txt", mtimeMs: OLD_MS, sha256: evSha },
    ],
    ledgerLines: [
      JSON.stringify({
        role: "product-lead",
        sprint_id: "SP-999001",
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

h.violation("red when evidence file has no matching ledger record", () => {
  const evSha = sha256(Buffer.from("orphaned-evidence-content"));
  const otherSha = sha256(Buffer.from("different-content"));
  return evaluate({
    evidenceFiles: [
      { path: "/tmp/SP-999001-build-frontend-builder.return.txt", mtimeMs: OLD_MS, sha256: evSha },
    ],
    ledgerLines: [
      JSON.stringify({
        role: "frontend-builder",
        sprint_id: "SP-999999",
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

h.pass("green when no evidence files (nothing to check)", () =>
  evaluate({ evidenceFiles: [], ledgerLines: [], nowMs: NOW_MS }));

h.failClosed("red when ledger is unreadable and evidence exists (fail-closed)", () => {
  const evSha = sha256(Buffer.from("evidence-no-ledger"));
  return evaluate({
    evidenceFiles: [
      { path: "/tmp/SP-999002-design-qa-reviewer.return.txt", mtimeMs: OLD_MS, sha256: evSha },
    ],
    ledgerLines: null,
    nowMs: NOW_MS,
  });
});

h.pass("green when evidence matched by sprint+step+role filename convention (fallback)", () => {
  const evSha = sha256(Buffer.from("filename-fallback-evidence"));
  const sprintId = "SP-999003";
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
        completed_at: new Date(OLD_MS + 5000).toISOString(),
      }),
    ],
    nowMs: NOW_MS,
  });
});

h.violation("red when ledger records exist but all have ok:false", () => {
  const evSha = sha256(Buffer.from("failed-return-evidence"));
  return evaluate({
    evidenceFiles: [
      { path: "/tmp/SP-999004-plan-director-of-product.return.txt", mtimeMs: OLD_MS, sha256: evSha },
    ],
    ledgerLines: [
      JSON.stringify({
        role: "director-of-product",
        sprint_id: "SP-999004",
        step: "plan",
        via: "epsilon-agent",
        ok: false,
        evidence_sha: evSha,
        completed_at: new Date(OLD_MS + 5000).toISOString(),
      }),
    ],
    nowMs: NOW_MS,
  });
});

h.pass("green when evidenceFiles is empty (caller filtered out fresh files)", () =>
  evaluate({
    evidenceFiles: [],
    ledgerLines: ["{}"],
    nowMs: NOW_MS,
  }));

h.violation("red when evidence file is unreadable/un-stat-able (fail-closed)", () =>
  evaluate({
    evidenceFiles: [
      { path: "/tmp/SP-x-build-builder.return.txt", mtimeMs: null, sha256: null, unreadable: true },
    ],
    ledgerLines: ["{}"],
    nowMs: NOW_MS,
  }));

h.done();
