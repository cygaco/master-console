#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// team-guard-gate.test.js — P5 planted-violation test for the S-12c HARD
// PreToolUse readiness GATE in team-guard.js (E-SYSTEM-ORG-001).
//
// The gate makes sprint team-init UN-SKIPPABLE: with HARD_GATE on and no correct
// team live, a WORKER dispatch is BLOCKED from the 1st (no ramp) — while the
// bootstrap/read-only ALLOW-list (faces / explore / plan / any team_name) keeps
// the team standable-up. False-block guards: heartbeat-liveness, a kill-switch,
// and fail-open.
//
// Spawns the REAL hook as a subprocess with a sealed temp CLAUDE_PROJECT_DIR +
// HOME and synthetic Agent events. Acceptance criteria (epic S-12 Layer c):
//   (1) sprint + no team + general-purpose worker  => BLOCK
//   (2) sprint + no team + subagent_type:epsilon   => ALLOW (bootstrap)
//   (3) sprint + no team + explore                 => ALLOW (research)
//   (4) sprint + dispatch WITH team_name           => ALLOW (into team)
//   (5) sprint + team WITH ε                        => ALLOW worker
//   (6) sprint + team WITHOUT ε                     => BLOCK worker (wrong roster)
//   (7) kill-switch set                            => ALLOW
//   (8) heartbeat fresh but config-mtime >24h      => ALLOW (no false-block)
//   (+) HARD_GATE OFF (default) + no team + worker => ALLOW (advisory only, ramp)
//   (+) HARD_GATE on + delta face                  => ALLOW (bootstrap face)
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const mcEnv = require("./lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
const { spawnSync } = require("child_process");

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

// Run the hook with a sealed env + event.
// opts: { mode, hardGate, killSwitchEnv, killSwitchMarker, teamName, agentType,
//         name, activeTeam, teamHasEpsilon, staleConfig, heartbeat }
function runGuard(opts = {}) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "tgg-proj-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tgg-home-"));
  fs.mkdirSync(path.join(proj, ".claude", "runtime"), { recursive: true });
  fs.mkdirSync(path.join(home, ".claude", "runtime"), { recursive: true });
  if (opts.mode) {
    fs.writeFileSync(
      path.join(proj, ".claude", "runtime", "mode.json"),
      JSON.stringify({ mode: opts.mode }),
    );
  }
  const sid = "s-test";
  fs.writeFileSync(path.join(proj, ".claude", "runtime", ".session-id"), sid);
  // Always seed the ramp counter high so the (b) advisory would fire if the
  // gate fell through — isolates the gate's block from the advisory.
  fs.writeFileSync(
    path.join(proj, ".claude", "runtime", ".sprint-oneoff-count"),
    "5",
  );
  if (opts.killSwitchMarker) {
    fs.writeFileSync(
      path.join(proj, ".claude", "runtime", ".team-gate-off"),
      "",
    );
  }
  if (opts.activeTeam) {
    const cfgDir = path.join(home, ".claude", "teams", "mc-sprint");
    fs.mkdirSync(cfgDir, { recursive: true });
    const members = opts.teamHasEpsilon
      ? [
          { name: "epsilon", agentType: "epsilon" },
          { name: "beta", agentType: "beta" },
        ]
      : [
          { name: "reviewer", agentType: "general-purpose" },
          { name: "builder", agentType: "general-purpose" },
        ];
    const cfgPath = path.join(cfgDir, "config.json");
    fs.writeFileSync(cfgPath, JSON.stringify({ members }));
    if (opts.staleConfig) {
      // Backdate >24h so the liveness window filters it out (teamActive=false).
      const old = (Date.now() - 48 * 3600 * 1000) / 1000;
      fs.utimesSync(cfgPath, old, old);
    }
  }
  if (opts.heartbeat) {
    // sid-keyed liveness marker, fresh mtime = now.
    fs.writeFileSync(
      path.join(home, ".claude", "runtime", `.team-live-${sid}`),
      JSON.stringify({ ts: new Date().toISOString() }),
    );
  }
  const event = {
    tool_name: "Agent",
    tool_input: {
      subagent_type: opts.agentType || "general-purpose",
      name: opts.name || "worker",
      ...(opts.teamName ? { team_name: opts.teamName } : {}),
    },
  };
  const env = { ...process.env, CLAUDE_PROJECT_DIR: proj, HOME: home, USERPROFILE: home };
  // S-12c is now DEFAULT-ON: the gate is active unless MC_TEAM_GATE_SOFT=1.
  // `hardGate:true` is the normal shipped posture (no env needed); `hardGate:false`
  // means "explicitly soften the gate back to advisory-only" (the ramp-off path).
  mcEnv.unsetEnv("TEAM_GATE_HARD", env); // legacy force-on; default-on no longer needs it
  if (opts.hardGate === false) mcEnv.setEnv("TEAM_GATE_SOFT", "1", env);
  else mcEnv.unsetEnv("TEAM_GATE_SOFT", env);
  if (opts.killSwitchEnv) mcEnv.setEnv("DISABLE_TEAM_GATE", "1", env);
  else mcEnv.unsetEnv("DISABLE_TEAM_GATE", env);
  const r = spawnSync("node", [HOOK], { input: JSON.stringify(event), env, encoding: "utf8" });
  return { stdout: r.stdout || "", status: r.status };
}

const blocks = (s) => /"decision"\s*:\s*"block"/.test(s);
const isGateBlock = (s) => blocks(s) && /S-12c/.test(s);

// (1) PLANTED VIOLATION — the recurring skip, now BLOCKED with HARD_GATE on.
ok("(1) sprint + no team + general-purpose worker => BLOCK", () => {
  const { stdout } = runGuard({ mode: "sprint", hardGate: true, agentType: "general-purpose" });
  assert.ok(isGateBlock(stdout), "must block a worker when no correct team is live");
});

// (2) bootstrap — ε must be allowed so the team CAN be created.
ok("(2) sprint + no team + subagent_type:epsilon => ALLOW (bootstrap)", () => {
  const { stdout } = runGuard({ mode: "sprint", hardGate: true, agentType: "epsilon" });
  assert.ok(!blocks(stdout), "the conductor face must never be blocked");
});

// (3) research one-off — allowed.
ok("(3) sprint + no team + explore => ALLOW (research)", () => {
  const { stdout } = runGuard({ mode: "sprint", hardGate: true, agentType: "explore" });
  assert.ok(!blocks(stdout), "research one-offs are legitimate");
});

// (4) into-team dispatch — allowed (this is the desired end state). AC-1.1
// (SP-20260611-002): a team_name is honored ONLY when it VERIFIES against a real
// fresh ε-team config — so the fixture now stands up that backing team. A bare
// unbacked team_name no longer short-circuits the gate (covered by
// team-guard-verify.test.js::fabricated-team-name-does-not-bypass-readiness).
ok("(4) sprint + dispatch WITH verified team_name => ALLOW (into team)", () => {
  const { stdout } = runGuard({
    mode: "sprint",
    hardGate: true,
    agentType: "general-purpose",
    teamName: "mc-sprint",
    activeTeam: true,
    teamHasEpsilon: true,
  });
  assert.ok(!blocks(stdout), "dispatching a worker INTO a verified ε-team is the goal");
});

// (5) correct roster live — worker allowed.
ok("(5) sprint + team WITH ε => ALLOW worker", () => {
  const { stdout } = runGuard({ mode: "sprint", hardGate: true, agentType: "general-purpose", activeTeam: true, teamHasEpsilon: true });
  assert.ok(!blocks(stdout), "a correct team (α+ε+β) live => workers flow");
});

// (6) wrong roster — block (the 2026-06-08 missing-ε miss, now hard).
ok("(6) sprint + team WITHOUT ε => BLOCK worker (wrong roster)", () => {
  const { stdout } = runGuard({ mode: "sprint", hardGate: true, agentType: "general-purpose", activeTeam: true, teamHasEpsilon: false });
  assert.ok(isGateBlock(stdout), "a team of only generic workers (no ε) is the wrong roster");
  assert.ok(/MISSING ε/.test(stdout), "the block reason must name the missing ε");
});

// (7) kill-switch — never block (both env and marker forms).
ok("(7a) kill-switch (env) set => ALLOW", () => {
  const { stdout } = runGuard({ mode: "sprint", hardGate: true, killSwitchEnv: true, agentType: "general-purpose" });
  assert.ok(!blocks(stdout), "env kill-switch must bypass the gate");
});
ok("(7b) kill-switch (marker file) set => ALLOW", () => {
  const { stdout } = runGuard({ mode: "sprint", hardGate: true, killSwitchMarker: true, agentType: "general-purpose" });
  assert.ok(!blocks(stdout), "marker kill-switch must bypass the gate");
});

// (8) false-block mitigation #1 — fresh heartbeat survives a stale config.
ok("(8) heartbeat fresh but config-mtime >24h => ALLOW (no false-block)", () => {
  const { stdout } = runGuard({
    mode: "sprint",
    hardGate: true,
    agentType: "general-purpose",
    activeTeam: true,
    teamHasEpsilon: true,
    staleConfig: true, // >24h => teamActive=false via the window
    heartbeat: true, // but the sid-keyed liveness marker is fresh
  });
  assert.ok(!blocks(stdout), "a long-idle but live team must not false-block");
});

// (+) DEFAULT ON — the gate is now active out-of-the-box (S-12c mechanical flip,
// operator 2026-06-08). NO flag set => a worker with no correct team BLOCKS.
ok("(+) DEFAULT (no flag) + no team + worker => BLOCK (gate ships ON)", () => {
  const { stdout } = runGuard({ mode: "sprint", hardGate: true, agentType: "general-purpose" });
  assert.ok(isGateBlock(stdout), "the gate must block by default — no marker required");
});

// (+) SOFT opt-out — MC_TEAM_GATE_SOFT=1 ramps the gate back to advisory.
ok("(+) MC_TEAM_GATE_SOFT=1 + no team + worker => ALLOW (soft ramp-off)", () => {
  const { stdout } = runGuard({ mode: "sprint", hardGate: false, agentType: "general-purpose" });
  assert.ok(!blocks(stdout), "the soft kill ramps the gate to advisory-only");
});

// (+) SPOOF ε — a worker named/typed "epsilon-helper" must NOT satisfy readiness
// (cross-provider review 2026-06-08 HIGH: `/epsilon/` substring was spoofable).
ok("(+) team member 'epsilon-helper' (spoof) => BLOCK worker (not real ε)", () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "tgg-proj-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tgg-home-"));
  fs.mkdirSync(path.join(proj, ".claude", "runtime"), { recursive: true });
  fs.mkdirSync(path.join(home, ".claude", "runtime"), { recursive: true });
  fs.writeFileSync(
    path.join(proj, ".claude", "runtime", "mode.json"),
    JSON.stringify({ mode: "sprint" }),
  );
  fs.writeFileSync(path.join(proj, ".claude", "runtime", ".session-id"), "s-spoof");
  fs.writeFileSync(path.join(proj, ".claude", "runtime", ".sprint-oneoff-count"), "5");
  // a team whose only "ε-ish" member is a spoof substring match
  const cfgDir = path.join(home, ".claude", "teams", "mc-sprint");
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, "config.json"),
    JSON.stringify({
      members: [
        { name: "epsilon-helper", agentType: "general-purpose" },
        { name: "builder", agentType: "general-purpose" },
      ],
    }),
  );
  const event = {
    tool_name: "Agent",
    tool_input: { subagent_type: "general-purpose", name: "worker" },
  };
  const env = { ...process.env, CLAUDE_PROJECT_DIR: proj, HOME: home, USERPROFILE: home };
  for (const s of ["TEAM_GATE_HARD", "TEAM_GATE_SOFT", "DISABLE_TEAM_GATE"]) mcEnv.unsetEnv(s, env);
  const r = spawnSync("node", [HOOK], { input: JSON.stringify(event), env, encoding: "utf8" });
  assert.ok(isGateBlock(r.stdout || ""), "a spoof 'epsilon-helper' must not count as ε");
  assert.ok(/MISSING ε/.test(r.stdout || ""), "block reason names missing ε");
});

// (+) bootstrap — δ face (oneshot conductor) also allowed under the gate.
ok("(+) HARD_GATE on + delta face => ALLOW (bootstrap face)", () => {
  const { stdout } = runGuard({ mode: "sprint", hardGate: true, agentType: "delta" });
  assert.ok(!blocks(stdout), "all faces are bootstrap-allowed");
});

console.log(`\nteam-guard-gate: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
