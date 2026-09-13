#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// adhoc-team-hygiene-extension.test.js — S-LC-05. Coverage for the orphan/stale
// extension to scripts/checks/adhoc-team-hygiene.js.
//
// The scan runs in a SEALED subprocess with WARPOS_TEAMS_DIR_OVERRIDE pointed at
// a temp fixture so the REAL ~/.claude/teams (other projects' live teams) is
// never read.
//
//   AC-5.6  -N accretion duplicate → HARD finding (exit 1)
//   AC-5.7  stale-team handle → ADVISORY (exit 0 default; exit 1 under --strict)
//   AC-5.8  clean fixture → exit 0 (the gate stays green)
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCAN = path.join(ROOT, "scripts", "checks", "adhoc-team-hygiene.js");

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.stack || e.message}`);
  }
}

function freshTeams() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "slc05-hyg-"));
  fs.mkdirSync(base, { recursive: true });
  return base;
}

function plantTeam(teamsRoot, name, members, opts = {}) {
  const dir = path.join(teamsRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "config.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      name,
      leadSessionId: "00000000-0000-0000-0000-000000000000",
      members: members.map((m) => ({ name: m, agentType: m })),
    }),
  );
  if (opts.ageHours) {
    const t = Date.now() - opts.ageHours * 3_600_000;
    fs.utimesSync(file, new Date(t), new Date(t));
  }
}

function runScan(teamsRoot, extraArgs = []) {
  const r = spawnSync("node", [SCAN, "--json", ...extraArgs], {
    env: { ...process.env, WARPOS_TEAMS_DIR_OVERRIDE: teamsRoot },
    encoding: "utf8",
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* leave null */
  }
  return { status: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

// ── AC-5.6 — -N accretion is a HARD finding (exit 1) ─────────────────────────
ok("AC-5.6 -N accretion duplicate → exit 1 (hard)", () => {
  const teamsRoot = freshTeams();
  plantTeam(teamsRoot, "mc-adhoc", ["team-lead", "beta", "gamma", "gamma-2"]);
  const r = runScan(teamsRoot);
  assert.strictEqual(r.status, 1, `expected exit 1, got ${r.status}`);
  assert.ok(r.json && r.json.hardFindings >= 1, "no hard finding reported");
  assert.ok(
    r.json.teams.some((t) =>
      (t.findings || []).some((f) => f.type === "duplicate-suffix"),
    ),
    "duplicate-suffix not in report",
  );
});

// ── AC-5.7 — stale-team is ADVISORY ──────────────────────────────────────────
ok("AC-5.7 stale-team → advisory: exit 0 by default", () => {
  const teamsRoot = freshTeams();
  plantTeam(teamsRoot, "mc-adhoc", ["team-lead", "beta", "gamma"], {
    ageHours: 48,
  });
  const r = runScan(teamsRoot);
  assert.strictEqual(r.status, 0, `stale should NOT red the gate, got ${r.status}`);
  assert.ok(r.json.advisoryFindings >= 1, "stale not counted as advisory");
  assert.strictEqual(r.json.hardFindings, 0, "stale must not be a hard finding");
  assert.ok(
    r.json.teams.some((t) =>
      (t.findings || []).some((f) => f.type === "stale-team"),
    ),
    "stale-team not in report",
  );
});

ok("AC-5.7b stale-team under --strict → exit 1", () => {
  const teamsRoot = freshTeams();
  plantTeam(teamsRoot, "mc-adhoc", ["team-lead", "beta", "gamma"], {
    ageHours: 48,
  });
  const r = runScan(teamsRoot, ["--strict"]);
  assert.strictEqual(r.status, 1, "advisory should fail under --strict");
});

// ── AC-5.8 — clean fixture → exit 0 (gate stays green) ───────────────────────
ok("AC-5.8 fresh, clean team → exit 0", () => {
  const teamsRoot = freshTeams();
  plantTeam(teamsRoot, "mc-adhoc", ["team-lead", "beta", "gamma"]);
  const r = runScan(teamsRoot);
  assert.strictEqual(r.status, 0, `clean team should be exit 0, got ${r.status}`);
  assert.strictEqual(r.json.hardFindings, 0);
  assert.strictEqual(r.json.advisoryFindings, 0);
});

ok("AC-5.8b empty teams dir → exit 0", () => {
  const teamsRoot = freshTeams();
  const r = runScan(teamsRoot);
  assert.strictEqual(r.status, 0);
});

console.log(`\nadhoc-team-hygiene-extension.test.js: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
