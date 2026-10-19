#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const HOOK = path.join(__dirname, "session-start.js");

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

function runStart(opts = {}) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "ss-proj-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ss-home-"));
  fs.mkdirSync(path.join(proj, ".claude", "runtime"), { recursive: true });
  if (opts.mode) {
    fs.writeFileSync(
      path.join(proj, ".claude", "runtime", "mode.json"),
      JSON.stringify({ mode: opts.mode }),
    );
  }
  if (opts.teamMembers) {
    const cfg = path.join(home, ".claude", "teams", "proj-team");
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, "config.json"), JSON.stringify({ members: opts.teamMembers }));
  }
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify({ source: "startup" }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: proj, HOME: home, USERPROFILE: home },
    encoding: "utf8",
  });
  try {
    const o = JSON.parse(r.stdout || "{}");
    return (o.hookSpecificOutput && o.hookSpecificOutput.additionalContext) || "";
  } catch {
    return "";
  }
}

const DEAD_CALL_RE = new RegExp("\\bTeam(?:Create|Delete)\\s*\\(");
const sprintDirective = (c) =>
  /SPRINT MODE IS ACTIVE/.test(c) &&
  /Agent\(subagent_type:"epsilon"/.test(c) &&
  /Agent\(subagent_type:"beta"/.test(c) &&
  /run_in_background:true/.test(c) &&
  !DEAD_CALL_RE.test(c);

ok("sprint + NO team => directive FIRES with the exact ε+β Step-1.75 spawn calls", () => {
  const c = runStart({ mode: "sprint" });
  assert.ok(sprintDirective(c), "must inject the named-Agent ε+β spawn init (no TeamCreate call)");
  assert.ok(/FIRST action MUST be/.test(c), "must be framed as the mandatory first action");
});

ok("sprint + team WITHOUT ε (generic workers) => directive FIRES (wrong-roster miss)", () => {
  const c = runStart({
    mode: "sprint",
    teamMembers: [{ name: "reviewer", agentType: "general-purpose" }, { name: "builder", agentType: "general-purpose" }],
  });
  assert.ok(sprintDirective(c), "a team lacking ε is not the correct sprint roster — must still fire");
});

ok("sprint + team WITH ε+β => directive SUPPRESSED", () => {
  const c = runStart({
    mode: "sprint",
    teamMembers: [{ name: "Epsilon", agentType: "epsilon" }, { name: "Beta", agentType: "beta" }],
  });
  assert.ok(!/SPRINT MODE IS ACTIVE/.test(c), "the correct team is live — no directive");
});

ok("adhoc + NO team => directive FIRES with β+γ faces", () => {
  const c = runStart({ mode: "adhoc" });
  assert.ok(/ADHOC MODE IS ACTIVE/.test(c) && /beta/.test(c) && /gamma/.test(c), "adhoc faces are β+γ");
});

ok("solo mode => NO directive", () => {
  const c = runStart({ mode: "solo" });
  assert.ok(!/MODE IS ACTIVE/.test(c), "solo has no persistent team");
});

console.log(`\nsession-start-teaminit: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
