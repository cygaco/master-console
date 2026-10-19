#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const mcEnv = require("./lib/mc-env");
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
      const old = (Date.now() - 48 * 3600 * 1000) / 1000;
      fs.utimesSync(cfgPath, old, old);
    }
  }
  if (opts.heartbeat) {
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
  mcEnv.unsetEnv("TEAM_GATE_HARD", env);
  if (opts.hardGate === false) mcEnv.setEnv("TEAM_GATE_SOFT", "1", env);
  else mcEnv.unsetEnv("TEAM_GATE_SOFT", env);
  if (opts.killSwitchEnv) mcEnv.setEnv("DISABLE_TEAM_GATE", "1", env);
  else mcEnv.unsetEnv("DISABLE_TEAM_GATE", env);
  const r = spawnSync("node", [HOOK], { input: JSON.stringify(event), env, encoding: "utf8" });
  return { stdout: r.stdout || "", status: r.status };
}

const blocks = (s) => /"decision"\s*:\s*"block"/.test(s);
const isGateBlock = (s) => blocks(s) && /SPRINT MODE \+ no correct team live/.test(s);

ok("(1) sprint + no team + general-purpose worker => BLOCK", () => {
  const { stdout } = runGuard({ mode: "sprint", hardGate: true, agentType: "general-purpose" });
  assert.ok(isGateBlock(stdout), "must block a worker when no correct team is live");
});

ok("(2) sprint + no team + subagent_type:epsilon => ALLOW (bootstrap)", () => {
  const { stdout } = runGuard({ mode: "sprint", hardGate: true, agentType: "epsilon" });
  assert.ok(!blocks(stdout), "the conductor face must never be blocked");
});

ok("(3) sprint + no team + explore => ALLOW (research)", () => {
  const { stdout } = runGuard({ mode: "sprint", hardGate: true, agentType: "explore" });
  assert.ok(!blocks(stdout), "research one-offs are legitimate");
});

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

ok("(5) sprint + team WITH ε => ALLOW worker", () => {
  const { stdout } = runGuard({ mode: "sprint", hardGate: true, agentType: "general-purpose", activeTeam: true, teamHasEpsilon: true });
  assert.ok(!blocks(stdout), "a correct team (α+ε+β) live => workers flow");
});

ok("(6) sprint + team WITHOUT ε => BLOCK worker (wrong roster)", () => {
  const { stdout } = runGuard({ mode: "sprint", hardGate: true, agentType: "general-purpose", activeTeam: true, teamHasEpsilon: false });
  assert.ok(isGateBlock(stdout), "a team of only generic workers (no ε) is the wrong roster");
  assert.ok(/MISSING ε/.test(stdout), "the block reason must name the missing ε");
});

ok("(7a) kill-switch (env) set => ALLOW", () => {
  const { stdout } = runGuard({ mode: "sprint", hardGate: true, killSwitchEnv: true, agentType: "general-purpose" });
  assert.ok(!blocks(stdout), "env kill-switch must bypass the gate");
});
ok("(7b) kill-switch (marker file) set => ALLOW", () => {
  const { stdout } = runGuard({ mode: "sprint", hardGate: true, killSwitchMarker: true, agentType: "general-purpose" });
  assert.ok(!blocks(stdout), "marker kill-switch must bypass the gate");
});

ok("(8) heartbeat fresh but config-mtime >24h => ALLOW (no false-block)", () => {
  const { stdout } = runGuard({
    mode: "sprint",
    hardGate: true,
    agentType: "general-purpose",
    activeTeam: true,
    teamHasEpsilon: true,
    staleConfig: true,
    heartbeat: true,
  });
  assert.ok(!blocks(stdout), "a long-idle but live team must not false-block");
});

ok("(+) DEFAULT (no flag) + no team + worker => BLOCK (gate ships ON)", () => {
  const { stdout } = runGuard({ mode: "sprint", hardGate: true, agentType: "general-purpose" });
  assert.ok(isGateBlock(stdout), "the gate must block by default — no marker required");
});

ok("(+) MC_TEAM_GATE_SOFT=1 + no team + worker => ALLOW (soft ramp-off)", () => {
  const { stdout } = runGuard({ mode: "sprint", hardGate: false, agentType: "general-purpose" });
  assert.ok(!blocks(stdout), "the soft kill ramps the gate to advisory-only");
});

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

ok("(+) HARD_GATE on + delta face => ALLOW (bootstrap face)", () => {
  const { stdout } = runGuard({ mode: "sprint", hardGate: true, agentType: "delta" });
  assert.ok(!blocks(stdout), "all faces are bootstrap-allowed");
});

console.log(`\nteam-guard-gate: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
