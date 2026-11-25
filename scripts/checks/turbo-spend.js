#!/usr/bin/env node
/**
 * scripts/checks/turbo-spend.js — /scan:turbo-spend check.
 *
 * A scan intentionally SEPARATE from /scan:full. It reports the turbo
 * session's spend state and asserts
 * the permission-profile honesty invariant.
 *
 * ── REPORT-ONLY for SPEND, FAIL-OPEN on a ledger fault ────────────────────────
 *   - The spend ledger is REPORT-ONLY: budget-approach warnings + under-budget
 *     notices never fail the scan. A malformed/absent ledger → fail-open (exit 0).
 *   - The PROFILE HONESTY invariant DOES have teeth: turbo grants no push, so a
 *     profile that declares any push scope at `auto`/`notice` (or breaks a
 *     hard-ceiling level) is a dishonest overclaim → HARD finding (exit 1). By default the CANONICAL
 *     profile is validated (always honest → exit 0). Point `--profile <file>` at
 *     a candidate profile to validate it; a planted auto-push profile is flagged.
 *
 * Exit codes:
 *   0 — spend reported; profile honest (the normal path).
 *   1 — profile honesty/ceiling violation (only when a dishonest profile is found).
 *   (spend state NEVER drives a non-zero exit.)
 *
 * Usage:
 *   node scripts/checks/turbo-spend.js [--json] [--profile <file>]
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ledgerMod = require("../turbo/spend-ledger");
const profileMod = require("../turbo/permission-profile");

function parseArgs(argv) {
  const out = { json: false, profileFile: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--json") out.json = true;
    else if (argv[i] === "--profile") out.profileFile = String(argv[++i] || "");
  }
  return out;
}

function run(opts = {}) {
  const result = {
    scan: "turbo-spend",
    reportOnly: true,
    spend: null,
    profile: null,
    findings: [], // HARD findings only (drive exit 1)
    notices: [],
  };

  // 1. SPEND — report-only, fail-open.
  try {
    const led = ledgerMod.computeLedger(opts.ledgerOpts || {});
    result.spend = led;
    for (const w of led.warnings) result.notices.push(`spend: ${w}`);
    for (const n of led.notices) result.notices.push(`spend: ${n}`);
    if (led.error) result.notices.push(`spend ledger fault (fail-open): ${led.error}`);
  } catch (e) {
    // Belt-and-suspenders: computeLedger is already fail-open, but never let the
    // scan crash on the spend leg.
    result.spend = { reportOnly: true, error: String(e.message || e) };
    result.notices.push(`spend ledger fault (fail-open): ${String(e.message || e)}`);
  }

  // 2. PROFILE HONESTY — has teeth.
  let profileToCheck = null;
  let profileSource = "canonical";
  if (opts.profileFile) {
    try {
      profileToCheck = JSON.parse(fs.readFileSync(opts.profileFile, "utf8"));
      profileSource = opts.profileFile;
    } catch (e) {
      // A bad --profile file is itself a finding (we were asked to check it).
      result.findings.push(
        `profile file unreadable (${opts.profileFile}): ${String(e.message || e)}`,
      );
    }
  }
  if (!profileToCheck) profileToCheck = profileMod.getProfile();

  const v = profileMod.validateProfile(profileToCheck);
  result.profile = {
    source: profileSource,
    ok: v.ok,
    violations: v.violations,
  };
  for (const x of v.violations) result.findings.push(`profile: ${x}`);

  result.exitCode = result.findings.length > 0 ? 1 : 0;
  return result;
}

function render(r) {
  const lines = [`/scan:turbo-spend — ${r.findings.length ? "FINDINGS" : "OK"} (report-only for spend)`, ""];
  if (r.spend && typeof r.spend.spentUsd === "number") {
    lines.push(
      `  spend:    est $${r.spend.spentUsd.toFixed(2)} / $${r.spend.ceilingUsd.toFixed(
        2,
      )} (${r.spend.ceilingSource}, ${(r.spend.pct * 100).toFixed(0)}%, ${r.spend.calls} paid call(s))`,
    );
  } else {
    lines.push("  spend:    (unavailable — fail-open)");
  }
  if (r.profile) {
    lines.push(
      `  profile:  turbo grants no push — honesty ${r.profile.ok ? "OK" : "VIOLATED"} (${r.profile.source})`,
    );
  }
  if (r.notices.length) {
    lines.push("", "  notices:");
    for (const n of r.notices) lines.push(`    - ${n}`);
  }
  if (r.findings.length) {
    lines.push("", "  FINDINGS (exit 1):");
    for (const f of r.findings) lines.push(`    ! ${f}`);
  }
  return lines.join("\n");
}

module.exports = { run, render, parseArgs };

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  let r;
  try {
    r = run({ profileFile: args.profileFile });
  } catch (e) {
    // Ultimate fail-open: never crash the scan harness on an unexpected fault.
    process.stdout.write(`/scan:turbo-spend — fail-open: ${String(e.message || e)}\n`);
    process.exit(0);
  }
  if (args.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else {
    process.stdout.write(render(r) + "\n");
  }
  process.exit(r.exitCode);
}
