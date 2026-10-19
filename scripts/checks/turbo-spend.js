#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const ledgerMod = require("../turbo/spend-ledger");
const profileMod = require("../turbo/permission-profile");
const preflightMod = require("../turbo/classifier-preflight");

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
    preflightConsistency: null,
    findings: [],
    notices: [],
  };

  try {
    const led = ledgerMod.computeLedger(opts.ledgerOpts || {});
    result.spend = led;
    for (const w of led.warnings) result.notices.push(`spend: ${w}`);
    for (const n of led.notices) result.notices.push(`spend: ${n}`);
    if (led.error) result.notices.push(`spend ledger fault (fail-open): ${led.error}`);
  } catch (e) {
    result.spend = { reportOnly: true, error: String(e.message || e) };
    result.notices.push(`spend ledger fault (fail-open): ${String(e.message || e)}`);
  }

  let profileToCheck = null;
  let profileSource = "canonical";
  if (opts.profileFile) {
    try {
      profileToCheck = JSON.parse(fs.readFileSync(opts.profileFile, "utf8"));
      profileSource = opts.profileFile;
    } catch (e) {
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
    pushLevel: profileToCheck["push-to-main"] && profileToCheck["push-to-main"].level,
    violations: v.violations,
  };
  for (const x of v.violations) result.findings.push(`profile: ${x}`);

  try {
    const pushClass = preflightMod.classify("push-to-main");
    const pushLevel =
      profileToCheck["push-to-main"] && profileToCheck["push-to-main"].level;
    const consistent =
      pushClass === "gated" ? pushLevel === "confirm" || pushLevel === "never" : true;
    result.preflightConsistency = {
      pushClassifiedAs: pushClass,
      pushProfileLevel: pushLevel,
      consistent,
    };
    if (!consistent) {
      result.findings.push(
        `preflight: push-to-main is classifier-GATED but the profile level is "${pushLevel}" ` +
          `(must be confirm/never — the profile must reflect classifier reality, not aspiration).`,
      );
    }
  } catch (e) {
    result.notices.push(`preflight consistency check skipped (fail-open): ${String(e.message || e)}`);
  }

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
      `  profile:  push-to-main=${r.profile.pushLevel} — honesty ${r.profile.ok ? "OK" : "VIOLATED"} (${r.profile.source})`,
    );
  }
  if (r.preflightConsistency) {
    lines.push(
      `  preflight: push-to-main classified ${r.preflightConsistency.pushClassifiedAs} → profile ${r.preflightConsistency.pushProfileLevel} (${r.preflightConsistency.consistent ? "consistent" : "INCONSISTENT"})`,
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

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  let r;
  try {
    r = run({ profileFile: args.profileFile });
  } catch (e) {
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
