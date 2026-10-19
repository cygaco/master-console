#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const lib = require("./sprint-beta-honesty");

const argv = process.argv.slice(2);
const SUBCMD = argv[0];
function arg(name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}
function has(name) {
  return argv.includes(name);
}
const JSON_OUT = has("--json");
const DRY_RUN = has("--dry-run");
const SINCE = arg("--since") || lib.CUTOFF;

function die(msg, code = 2) {
  process.stderr.write(`ERROR [beta-honesty-triage] ${msg}\n`);
  process.exit(code);
}

function usage() {
  process.stderr.write(
    "Usage:\n" +
      "  node scripts/checks/beta-honesty-triage.js list [--since <ISO>] [--json]\n" +
      '  node scripts/checks/beta-honesty-triage.js waive --reason "<r>" --approver "<a>" \\\n' +
      "       ( --sprint <SP-id> | --fingerprint <hex> | --all --expect <N> ) \\\n" +
      "       [--batch <id>] [--since <ISO>] [--dry-run] [--json]\n",
  );
}

function rawFindings() {
  if (SINCE !== lib.CUTOFF && !lib.validateIsoDate(SINCE)) {
    die(`invalid --since value: "${SINCE}" — must be a valid ISO date YYYY-MM-DD`);
  }
  const ctx = lib.loadAuditContext();
  const result = lib.computeFindings(
    ctx.rawEvents,
    ctx.sprintDates,
    SINCE,
    ctx.reportsData,
    null,
  );
  return result.findings;
}

function cmdList() {
  const findings = rawFindings();
  const waived = lib.loadWaivers(lib.waiverLedgerPath());
  const rows = findings.map((f) => ({
    fingerprint: f.fingerprint,
    waived: waived.has(String(f.fingerprint).toLowerCase()),
    sprint_id: f.sprint_id,
    finding_type: f.finding_type,
    phase: f.phase,
    evidence: f.evidence,
  }));
  const unwaived = rows.filter((r) => !r.waived);
  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        { total: rows.length, waived: rows.length - unwaived.length, unwaived: unwaived.length, since: SINCE, findings: rows },
        null,
        2,
      ),
    );
    return;
  }
  console.log(
    `beta-honesty findings since ${SINCE}: ${rows.length} total, ${rows.length - unwaived.length} waived, ${unwaived.length} un-waived (blocking)\n`,
  );
  for (const r of rows) {
    console.log(
      `  ${r.waived ? "✓waived " : "✗BLOCK  "} ${r.fingerprint.slice(0, 12)}  ${String(r.sprint_id).padEnd(18)} ${String(r.finding_type).padEnd(28)} ${r.evidence}`,
    );
  }
}

function cmdWaive() {
  const reason = arg("--reason");
  const approver = arg("--approver");
  const batch = arg("--batch") || null;
  if (!reason || !reason.trim()) die("`waive` requires --reason \"<text>\"");
  if (!approver || !approver.trim()) die("`waive` requires --approver \"<who>\"");

  const sprint = arg("--sprint");
  const fingerprint = arg("--fingerprint");
  const all = has("--all");
  const selectors = [sprint, fingerprint, all ? "--all" : undefined].filter(Boolean);
  if (selectors.length === 0)
    die("`waive` needs a selector: --sprint <id> | --fingerprint <hex> | --all --expect <N>");
  if (selectors.length > 1)
    die("`waive` selectors are mutually exclusive: pick ONE of --sprint / --fingerprint / --all");

  const findings = rawFindings();
  const alreadyWaived = lib.loadWaivers(lib.waiverLedgerPath());

  let candidates;
  if (sprint) {
    candidates = findings.filter((f) => f.sprint_id === sprint);
    if (candidates.length === 0)
      die(`no findings for sprint "${sprint}" since ${SINCE} — nothing to waive`, 1);
  } else if (fingerprint) {
    candidates = findings.filter(
      (f) => String(f.fingerprint).toLowerCase() === String(fingerprint).toLowerCase(),
    );
    if (candidates.length === 0)
      die(`no current finding matches fingerprint "${fingerprint}" — refusing to waive a phantom`, 1);
  } else {
    const expectStr = arg("--expect");
    if (expectStr === undefined)
      die("`--all` requires `--expect <N>` (the exact count of un-waived findings) — refusing a blind bulk waive");
    const expect = Number(expectStr);
    if (!Number.isInteger(expect) || expect < 0)
      die(`--expect must be a non-negative integer, got "${expectStr}"`);
    const unwaivedCount = findings.filter(
      (f) => !alreadyWaived.has(String(f.fingerprint).toLowerCase()),
    ).length;
    if (expect !== unwaivedCount)
      die(
        `--expect ${expect} does not match the ${unwaivedCount} un-waived finding(s) since ${SINCE}. ` +
          `Re-run \`list\` to inspect, then pass --expect ${unwaivedCount} if that is intended.`,
        1,
      );
    candidates = findings.slice();
  }

  const fresh = candidates.filter(
    (f) => !alreadyWaived.has(String(f.fingerprint).toLowerCase()),
  );
  const skipped = candidates.length - fresh.length;

  const ts = new Date().toISOString();
  const entries = fresh.map((f) => ({
    id: `BHW-${ts.slice(0, 10).replace(/-/g, "")}-${String(f.fingerprint).slice(0, 8)}`,
    ts,
    fingerprint: f.fingerprint,
    sprint_id: f.sprint_id,
    finding_type: f.finding_type,
    phase_boundary: f.expected_consult || null,
    evidence: f.evidence,
    reason: reason.trim(),
    approver: approver.trim(),
    batch,
  }));

  if (DRY_RUN) {
    if (JSON_OUT) console.log(JSON.stringify({ dryRun: true, wouldWaive: entries.length, skipped, entries }, null, 2));
    else
      console.log(
        `[dry-run] would waive ${entries.length} finding(s), ${skipped} already waived (skipped). Ledger NOT written.`,
      );
    return;
  }

  const ledger = lib.waiverLedgerPath();
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  if (entries.length) {
    const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
    fs.appendFileSync(ledger, lines);
  }

  if (JSON_OUT)
    console.log(JSON.stringify({ waived: entries.length, skipped, ledger, entries }, null, 2));
  else
    console.log(
      `Waived ${entries.length} finding(s)${skipped ? `, ${skipped} already waived (skipped)` : ""}. ` +
        `Ledger: ${ledger}\n  reason: ${reason.trim()}\n  approver: ${approver.trim()}${batch ? `\n  batch: ${batch}` : ""}`,
    );
}

if (SUBCMD === "list") {
  cmdList();
} else if (SUBCMD === "waive") {
  cmdWaive();
} else {
  usage();
  process.exit(SUBCMD ? 2 : 0);
}
