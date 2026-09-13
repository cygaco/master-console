#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// team-guard-sprint.test.js — P5 planted-violation test for the ED-035 sprint
// persistent-team advisory added to team-guard.js. Spawns the REAL hook as a
// subprocess with a sealed temp CLAUDE_PROJECT_DIR + HOME and synthetic Agent
// events, asserting:
//   • PLANTED VIOLATION: sprint + one-off worker dispatch #>=2 + no active team
//     => advisory FIRES (this is the skip that recurred 2026-06-06 & 06-08).
//   • team_name present => NO advisory (flowing through a team).
//   • research one-off (Explore) => NO advisory.
//   • solo mode => NO advisory.
//   • active team under ~/.claude/teams => advisory SUPPRESSED.
//   • first one-off (ramp, n<2) => NO advisory.
//   • REGRESSION: adhoc + build-chain type still BLOCKS (decision:block).
// The advisory is NON-BLOCKING — assert it never emits decision:block.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const mcEnv = require("./lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const HOOK = path.join(__dirname, "team-guard.js");

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

// Run the hook with a sealed env + event. opts: {mode, teamName, seedCount,
// activeTeam, agentType, name}. Returns { stdout, status }.
function runGuard(opts = {}) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "tg-proj-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tg-home-"));
  fs.mkdirSync(path.join(proj, ".claude", "runtime"), { recursive: true });
  if (opts.mode) {
    fs.writeFileSync(
      path.join(proj, ".claude", "runtime", "mode.json"),
      JSON.stringify({ mode: opts.mode }),
    );
  }
  fs.writeFileSync(path.join(proj, ".claude", "runtime", ".session-id"), "s-test");
  if (typeof opts.seedCount === "number") {
    fs.writeFileSync(
      path.join(proj, ".claude", "runtime", ".sprint-oneoff-count"),
      String(opts.seedCount),
    );
  }
  if (opts.activeTeam) {
    const cfg = path.join(home, ".claude", "teams", "mc-sprint");
    fs.mkdirSync(cfg, { recursive: true });
    const members = opts.teamHasEpsilon
      ? [{ name: "epsilon", agentType: "epsilon" }, { name: "beta", agentType: "beta" }]
      : [{ name: "reviewer", agentType: "general-purpose" }, { name: "builder", agentType: "general-purpose" }];
    fs.writeFileSync(path.join(cfg, "config.json"), JSON.stringify({ members })); // fresh mtime = now
  }
  const event = {
    tool_name: "Agent",
    tool_input: {
      subagent_type: opts.agentType || "general-purpose",
      name: opts.name || "worker",
      ...(opts.teamName ? { team_name: opts.teamName } : {}),
    },
  };
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify(event),
    // This suite validates the Layer-b ADVISORY (the soft ramp). Since S-12c now
    // ships the hard gate DEFAULT-ON (it would BLOCK these cases before the
    // advisory is reached), soften it back to advisory for these assertions via
    // MC_TEAM_GATE_SOFT=1. The DEFAULT-ON block path is covered by
    // team-guard-gate.test.js.
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: proj,
      HOME: home,
      USERPROFILE: home,
      ...mcEnv.envPair("TEAM_GATE_SOFT", "1"),
    },
    encoding: "utf8",
  });
  return { stdout: r.stdout || "", status: r.status };
}

const fires = (s) => /SPRINT MODE/.test(s) && /ED-035/.test(s);
const missingEps = (s) => /MISSING ε/.test(s) || /MISSING .{0,3}Epsilon/i.test(s);
const blocks = (s) => /"decision"\s*:\s*"block"/.test(s);

// ── PLANTED VIOLATION — the recurring skip must be caught ──
ok("PLANTED: sprint + 2nd one-off worker + no team => advisory FIRES (non-blocking)", () => {
  const { stdout } = runGuard({ mode: "sprint", seedCount: 1, agentType: "general-purpose" });
  assert.ok(fires(stdout), "advisory should fire");
  assert.ok(!blocks(stdout), "advisory must NEVER block");
});

ok("sprint + verified team_name present => NO advisory (flowing through a team)", () => {
  // AC-1.1 (SP-20260611-002): a team_name suppresses the advisory ONLY when it
  // VERIFIES against a real fresh ε-team — so the fixture stands one up. A bare
  // unbacked team_name no longer short-circuits (covered by team-guard-verify).
  const { stdout } = runGuard({
    mode: "sprint",
    seedCount: 5,
    teamName: "mc-sprint",
    activeTeam: true,
    teamHasEpsilon: true,
  });
  assert.ok(!fires(stdout), "should not advise when dispatching into a verified ε-team");
});

ok("sprint + research one-off (Explore) => NO advisory", () => {
  const { stdout } = runGuard({ mode: "sprint", seedCount: 5, agentType: "explore" });
  assert.ok(!fires(stdout), "research one-offs are legitimate");
});

ok("solo mode => NO advisory", () => {
  const { stdout } = runGuard({ mode: "solo", seedCount: 5, agentType: "general-purpose" });
  assert.ok(!fires(stdout), "solo is opt-out");
});

ok("sprint + active team WITHOUT ε => advisory FIRES (missing epsilon — the 2026-06-08 miss)", () => {
  const { stdout } = runGuard({ mode: "sprint", seedCount: 5, activeTeam: true, teamHasEpsilon: false, agentType: "general-purpose" });
  assert.ok(fires(stdout), "a team of only generic workers (no ε) should still advise");
  assert.ok(missingEps(stdout), "the advice must name the missing ε/Epsilon");
  assert.ok(!blocks(stdout), "advisory must NEVER block");
});

ok("sprint + active team WITH ε => advisory SUPPRESSED (the right faces)", () => {
  const { stdout } = runGuard({ mode: "sprint", seedCount: 5, activeTeam: true, teamHasEpsilon: true, agentType: "general-purpose" });
  assert.ok(!fires(stdout), "a team carrying ε is the correct sprint roster — no advisory");
});

ok("sprint + first one-off (n<2 ramp) => NO advisory", () => {
  const { stdout } = runGuard({ mode: "sprint", seedCount: 0, agentType: "general-purpose" });
  assert.ok(!fires(stdout), "ramp: do not advise on the first one-off");
});

// ── REGRESSION — the existing adhoc build-chain block must still work ──
ok("REGRESSION: adhoc + build-chain type still BLOCKS", () => {
  const { stdout } = runGuard({ mode: "adhoc", agentType: "builder" });
  assert.ok(blocks(stdout), "adhoc build-chain block must still fire");
});

console.log(`\nteam-guard-sprint: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
