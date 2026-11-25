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
      JSON.stringify(opts.enteredAt ? { mode: opts.mode, enteredAt: opts.enteredAt } : { mode: opts.mode }),
    );
  }
  if (opts.teamMembers) {
    const cfg = path.join(home, ".claude", "teams", "proj-team");
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, "config.json"), JSON.stringify({ members: opts.teamMembers }));
  }
  for (const [rel, model] of Object.entries(opts.specs || {})) {
    const p = path.join(proj, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `---\nname: fixture\nmodel: ${model}\n---\nbody\n`);
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
  assert.ok(!/do NOT proceed/.test(c), "the directive does not forbid proceeding with the task");
  assert.ok(!/team_name/.test(c), "no team_name: the harness names the session team itself");
  assert.ok(/name:"Epsilon"/.test(c) && /name:"Beta"/.test(c), "plain names the Agent tool accepts");
  for (const m of c.matchAll(/name:"([^"]*)"/g)) {
    assert.ok(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(m[1]), `name the Agent tool accepts: ${m[1]}`);
  }
});

ok("sprint marker entered more than a day ago => NO spawn order, one stale line naming the clear command", () => {
  const old = new Date(Date.now() - 3 * 24 * 3600000).toISOString();
  const c = runStart({ mode: "sprint", enteredAt: old });
  assert.ok(!/MODE IS ACTIVE/.test(c), "a stale marker does not order a team spawn");
  assert.ok(!/Agent\(subagent_type:/.test(c), "no spawn calls for a stale marker");
  assert.ok(/stale/.test(c) && /node scripts\/mode-set\.js solo/.test(c), "names the marker as stale and how to clear it");
});

ok("sprint marker entered within the day => directive still fires", () => {
  const recent = new Date(Date.now() - 2 * 3600000).toISOString();
  const c = runStart({ mode: "sprint", enteredAt: recent });
  assert.ok(sprintDirective(c), "a fresh marker is a live mode");
});

ok("cold-start dispatch reference names the build-chain wrapper", () => {
  const c = runStart({});
  assert.ok(/node scripts\/dispatch-claude\.js <role> <prompt-file> -w/.test(c), "build roles use dispatch-claude.js");
  assert.ok(!/claude -p --agent/.test(c), "no raw claude -p --agent hint");
  assert.ok(!/v2\.1\.178/.test(c), "no tool-version anchor");
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

ok("sprint directive: no face spawn carries a model parameter (the spec's resolver-written model decides)", () => {
  const c = runStart({
    mode: "sprint",
    specs: {
      ".claude/agents/president/beta.md": "claude-opus-5-5",
      ".claude/agents/president/epsilon.md": "claude-opus-5-5",
    },
  });
  const lines = c.split("\n").filter((l) => /Agent\(subagent_type:"/.test(l));
  assert.ok(lines.length >= 2, `face spawn lines present: ${lines.length}`);
  for (const l of lines) assert.ok(!/model:/.test(l), `no model parameter on a face spawn: ${l}`);
});

ok("solo mode => NO directive", () => {
  const c = runStart({ mode: "solo" });
  assert.ok(!/MODE IS ACTIVE/.test(c), "solo has no persistent team");
});

console.log(`\nsession-start-teaminit: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
