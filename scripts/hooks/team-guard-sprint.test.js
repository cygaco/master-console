#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const mcEnv = require("./lib/mc-env");

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
    fs.writeFileSync(path.join(cfg, "config.json"), JSON.stringify({ members }));
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

const fires = (s) => /SPRINT MODE/.test(s) && /one-off worker dispatch/.test(s);
const missingEps = (s) => /MISSING ε/.test(s) || /MISSING .{0,3}Epsilon/i.test(s);
const blocks = (s) => /"decision"\s*:\s*"block"/.test(s);

ok("PLANTED: sprint + 2nd one-off worker + no team => advisory FIRES (non-blocking)", () => {
  const { stdout } = runGuard({ mode: "sprint", seedCount: 1, agentType: "general-purpose" });
  assert.ok(fires(stdout), "advisory should fire");
  assert.ok(!blocks(stdout), "advisory must NEVER block");
});

ok("sprint + verified team_name present => NO advisory (flowing through a team)", () => {
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

ok("sprint + active team WITHOUT ε => advisory FIRES (missing epsilon)", () => {
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

ok("REGRESSION: adhoc + build-chain type still BLOCKS", () => {
  const { stdout } = runGuard({ mode: "adhoc", agentType: "builder" });
  assert.ok(blocks(stdout), "adhoc build-chain block must still fire");
});

console.log(`\nteam-guard-sprint: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
