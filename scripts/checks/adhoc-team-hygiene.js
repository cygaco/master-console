#!/usr/bin/env node

"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const os = require("os");
const path = require("path");

const JSON_OUT = process.argv.includes("--json");
const STRICT = process.argv.includes("--strict");
const TEAMS_DIR =
  mcEnv.readEnv("TEAMS_DIR_OVERRIDE") ||
  path.join(os.homedir(), ".claude", "teams");

const STALE_HOURS = 24;

const ADVISORY_TYPES = new Set(["stale-team"]);

const SUFFIX_RE = /-\d+$/;

const SESSION_ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function listTeamConfigs(dir) {
  let names;
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const d of names) {
    if (!d.isDirectory()) continue;
    const cfg = path.join(dir, d.name, "config.json");
    if (fs.existsSync(cfg)) out.push({ name: d.name, file: cfg });
  }
  return out;
}

function inspectTeam(teamFile) {
  let cfg;
  let ageHours = 0;
  try {
    ageHours = (Date.now() - fs.statSync(teamFile).mtimeMs) / 3_600_000;
    cfg = JSON.parse(fs.readFileSync(teamFile, "utf8"));
  } catch (e) {
    return { unreadable: true, error: e.message, findings: [] };
  }
  const members = Array.isArray(cfg.members) ? cfg.members : [];
  const leadSession = cfg.leadSessionId || null;
  const findings = [];

  if (ageHours >= STALE_HOURS) {
    findings.push({
      type: "stale-team",
      member: "<team>",
      detail: `team handle is ${Math.round(ageHours)}h old (≥${STALE_HOURS}h) — stale; reconcile before reuse`,
    });
  }

  for (const m of members) {
    const name = m.name || m.agentId || "<unnamed>";

    if (SUFFIX_RE.test(name)) {
      findings.push({
        type: "duplicate-suffix",
        member: name,
        detail: `name carries a -N de-dup suffix — a prior same-named member was never reconciled`,
      });
    }

    if (leadSession && typeof m.prompt === "string" && m.prompt.length) {
      const refs = m.prompt.match(SESSION_ID_RE) || [];
      const foreign = [...new Set(refs.map((r) => r.toLowerCase()))].filter(
        (r) => r !== leadSession.toLowerCase(),
      );
      if (foreign.length) {
        findings.push({
          type: "session-drift",
          member: name,
          detail: `prompt references session ${foreign
            .slice(0, 2)
            .join(", ")} ≠ team leadSessionId ${leadSession}`,
        });
      }
    }
  }

  return {
    unreadable: false,
    leadSession,
    memberCount: members.length,
    findings,
  };
}

function main() {
  const teams = listTeamConfigs(TEAMS_DIR);
  const report = [];
  let totalFindings = 0;
  let hardFindings = 0;
  let advisoryFindings = 0;
  let unreadable = 0;

  for (const t of teams) {
    const res = inspectTeam(t.file);
    if (res.unreadable) {
      unreadable++;
      report.push({ team: t.name, unreadable: true, error: res.error });
      continue;
    }
    if (res.findings.length) {
      totalFindings += res.findings.length;
      for (const f of res.findings) {
        if (ADVISORY_TYPES.has(f.type)) advisoryFindings++;
        else hardFindings++;
      }
      report.push({
        team: t.name,
        memberCount: res.memberCount,
        leadSessionId: res.leadSession,
        findings: res.findings,
      });
    }
  }

  const ok = hardFindings === 0 && (!STRICT || advisoryFindings === 0);

  if (JSON_OUT) {
    console.log(
      JSON.stringify({
        ok,
        teamsScanned: teams.length,
        teamsWithFindings: report.filter((r) => !r.unreadable).length,
        unreadable,
        findingCount: totalFindings,
        hardFindings,
        advisoryFindings,
        teams: report,
      }),
    );
    process.exit(ok ? 0 : 1);
  }

  if (teams.length === 0) {
    console.log("OK   [adhoc-team-hygiene] no teams under ~/.claude/teams");
    process.exit(0);
  }
  if (ok) {
    const note = advisoryFindings
      ? ` (${advisoryFindings} advisory stale finding(s) — not blocking; --strict to fail)`
      : "";
    console.log(
      `OK   [adhoc-team-hygiene] ${teams.length} team(s) scanned, no hard accretion${note}`,
    );
    process.exit(0);
  }

  console.error(
    `FAIL [adhoc-team-hygiene] ${hardFindings} hard + ${advisoryFindings} advisory finding(s) across ${report.filter((r) => !r.unreadable).length} team(s):`,
  );
  for (const r of report) {
    if (r.unreadable) {
      console.error(`  - ${r.team}: config.json unreadable (${r.error})`);
      continue;
    }
    console.error(`  - ${r.team} (${r.memberCount} members):`);
    for (const f of r.findings) {
      console.error(`      [${f.type}] ${f.member} — ${f.detail}`);
    }
  }
  console.error(
    "\nThese teams accreted members across sessions. Reconcile before reusing:\n" +
      "  • In /mode:adhoc, reconcile-before-spawn: reuse existing Beta/Gamma rather than re-adding.\n" +
      "  • Or start a fresh team name for a new session.\n" +
      "This check is read-only — it mutates nothing.",
  );
  process.exit(1);
}

main();
