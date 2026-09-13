#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
/**
 * ed060-sunset.js — the executable ED-060 sunset enforcer (SP-20260718-003 D9, AC-17).
 *
 * ED-060: the agy (Antigravity) security lab is CONTRACTED but not live — its liveness is
 * operator-owned (provision the account/tier → authenticate agy → produce one real fallback:false
 * ledger record). A doc-only sunset expires silently; THIS makes it enforceable: once the sunset date
 * (panel-lane-manifest.json sunset.date) has PASSED while ED-060 is still UNRESOLVED (agy lane down in
 * support-matrix), /scan:full exits NON-ZERO — a loud, dated deadline the operator cannot forget.
 *
 * Two-sided + falsifiable (AC-17, the class this sprint kills applied to its OWN tooling): a PAST-date
 * fixture → non-zero AND a FUTURE-date fixture → 0. Resolving ED-060 (agy live) → 0 regardless of date.
 *
 *   node scripts/checks/ed060-sunset.js [--json]
 * Exit: 0 not-yet-due OR resolved · 1 sunset passed unresolved (the finding) · 2 fail-closed (unreadable).
 */
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "ed060-sunset";

/**
 * PURE verdict. Given the sunset date, the current date, and whether ED-060 is resolved (agy live),
 * decide the exit. RESOLVED short-circuits (a live lane makes the deadline moot). Otherwise the sunset
 * is a hard finding IFF now >= sunsetDate.
 * @returns {{ ok, overdue, reason }}
 */
function evaluateSunset({ sunsetDate, now, resolved }) {
  if (resolved) return { ok: true, overdue: false, reason: "ED-060 resolved (agy lab live in support-matrix) — sunset moot" };
  const due = new Date(sunsetDate);
  const at = new Date(now);
  if (isNaN(due.getTime())) return { ok: false, overdue: false, reason: `unparseable sunset date '${sunsetDate}' (fail-closed)` };
  if (at.getTime() >= due.getTime()) {
    return {
      ok: false,
      overdue: true,
      reason: `ED-060 sunset ${sunsetDate} has PASSED while UNRESOLVED — the agy lab is still down. Provision the Antigravity account/tier, authenticate agy, and produce ONE real fallback:false agy ledger record; or consciously extend panel-lane-manifest.json sunset.date. The binding panel-3lab exit stays BLOCKED-ON-OPERATOR until then.`,
    };
  }
  return { ok: true, overdue: false, reason: `ED-060 sunset ${sunsetDate} is in the future — agy migration debt tracked, not yet overdue` };
}

/** Read the sunset date from the panel-lane manifest + the resolved status from support-matrix. */
function loadLive() {
  const pl = require(path.join(ROOT, "scripts", "dispatch", "panel-lanes"));
  const manifest = pl.loadManifest();
  let sunsetDate = manifest && manifest.sunset && manifest.sunset.date;
  if (!sunsetDate) throw new Error("panel-lane-manifest.json has no sunset.date (fail-closed — the enforcer needs a dated deadline)");
  let supportMatrix = null;
  try { supportMatrix = pl.loadSupportMatrix(); } catch { /* unreadable → treat as not-live (fail-closed) */ }
  let resolved = pl.agyLive(supportMatrix);
  // TEST-ONLY seam (AC-17 two-sided integration): let the /scan:full exit-path test drive a fixture
  // sunset date / resolved state through the REAL main() → exit code, WITHOUT mutating the shipped
  // manifest. Never set in production. This is what makes AC-17 a falsifiable INTEGRATION tooth (a
  // past-date fixture must make the actual CLI exit non-zero), not merely a pure-function assertion.
  if (mcEnv.readEnv("ED060_SUNSET_DATE_TEST")) sunsetDate = mcEnv.readEnv("ED060_SUNSET_DATE_TEST");
  if (mcEnv.readEnv("ED060_RESOLVED_TEST") != null) resolved = mcEnv.readEnv("ED060_RESOLVED_TEST") === "true";
  return { sunsetDate, resolved };
}

function main(argv) {
  const json = argv.includes("--json");
  let live;
  try {
    live = loadLive();
  } catch (e) {
    process.stderr.write(`FAIL [${NAME}] fail-closed: ${e.message}\n`);
    return 2;
  }
  const v = evaluateSunset({ sunsetDate: live.sunsetDate, now: new Date().toISOString(), resolved: live.resolved });
  if (json) {
    process.stdout.write(JSON.stringify({ check: NAME, sunset_date: live.sunsetDate, resolved: live.resolved, ...v }, null, 2) + "\n");
  } else if (v.ok) {
    process.stdout.write(`OK   [${NAME}] ${v.reason}\n`);
  } else {
    process.stderr.write(`FAIL [${NAME}] ${v.reason}\n`);
  }
  return v.ok ? 0 : v.overdue ? 1 : 2;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

// `main` is exported so the AC-17 two-sided integration test can drive the REAL exit-path in-process
// (loadLive + evaluateSunset + exit code) without a nested node spawn — the sandbox blocks nested
// spawnSync with EPERM (R2-AC17), and in-process still exercises the same code path /scan:full runs.
module.exports = { evaluateSunset, loadLive, main, NAME };
