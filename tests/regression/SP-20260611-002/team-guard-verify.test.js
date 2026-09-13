#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// team-guard-verify.test.js — SP-20260611-002 WS-G1 / R-1 (S-1) exploit-shaped
// regression for the team-guard verify-don't-trust hardening (T-316).
//
// Each test asserts the OLD ATTACK NOW FAILS CLOSED (false-green is the bug class,
// BC-16). The team-guard hook IS an enforcer — a wrong fix is an enforcement
// regression. Per-surface isolation (Hard AC #4): this file covers ONLY
// scripts/hooks/team-guard.js, so a red localizes here.
//
// FIXTURE NAMESPACING (Hard AC #9 / P-059): every planted attack fixture (a
// fabricated team_name, a planted `.team-live-<sid>` marker, a planted
// `mode.json {mode:"solo"}`) is built in a SEALED per-test temp dir under the OS
// tmpdir — NEVER in a live runtime path — so a /scan can never read a planted
// marker as a REAL bypass. The hook is spawned as a real subprocess with the
// sealed CLAUDE_PROJECT_DIR + HOME, exactly as the shipped guard runs.
//
// Covered ACs:
//   AC-1.1  fabricated-team-name-does-not-bypass-readiness
//   AC-1.2  planted-team-live-marker-not-trusted-on-presence-alone
//   AC-1.3  planted-solo-mode-json-cannot-disable-agent-gate
//   AC-1.4  team-gate-kill-switch-logs-loud-with-attestation
//   AC-1.6  legitimate-verified-team-still-passes
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const HOOK = path.resolve(__dirname, "..", "..", "..", "scripts", "hooks", "team-guard.js");

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

// Build a sealed project + home, plant the requested attack fixtures, run the
// REAL hook subprocess. opts:
//   mode            — written to mode.json (default "sprint")
//   teamName        — Agent tool_input.team_name (the verify-don't-trust target)
//   agentType       — Agent subagent_type (default "general-purpose" = a WORKER)
//   backingTeam     — "epsilon" | "workers" | false: create a fresh ~/.claude/teams
//                     config carrying ε / only generic workers / nothing
//   backingTeamName — the config team name (default "mc-sprint")
//   staleConfig     — backdate the backing config >24h (config-window bypass test)
//   plantHeartbeat  — write a bare `.team-live-<sid>` marker (the AC-1.2 spoof)
//   killEnv         — set WARPOS_DISABLE_TEAM_GATE=1
//   killMarker      — touch .team-gate-off
//   manifestSlug    — write .claude/manifest.json with project.slug (project-scope fixtures)
//   memberCwd       — include a member cwd in the backing team config
// Returns { stdout, stderr, status }.
function runGuard(opts = {}) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "tgv-proj-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tgv-home-"));
  fs.mkdirSync(path.join(proj, ".claude", "runtime"), { recursive: true });
  fs.mkdirSync(path.join(home, ".claude", "runtime"), { recursive: true });
  if (opts.manifestSlug) {
    fs.mkdirSync(path.join(proj, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(proj, ".claude", "manifest.json"),
      JSON.stringify({ project: { slug: opts.manifestSlug } }),
    );
  }
  const sid = "s-tgv";
  fs.writeFileSync(
    path.join(proj, ".claude", "runtime", "mode.json"),
    JSON.stringify({ mode: opts.mode || "sprint" }),
  );
  fs.writeFileSync(path.join(proj, ".claude", "runtime", ".session-id"), sid);
  // Seed the ramp counter high so the soft advisory would fire if the gate fell
  // through — isolates a block decision from the advisory.
  fs.writeFileSync(path.join(proj, ".claude", "runtime", ".sprint-oneoff-count"), "5");

  if (opts.backingTeam) {
    const teamName = opts.backingTeamName || "mc-sprint";
    const cfgDir = path.join(home, ".claude", "teams", teamName);
    fs.mkdirSync(cfgDir, { recursive: true });
    const members =
      opts.backingTeam === "epsilon"
        ? [
            { name: "epsilon", agentType: "epsilon", ...(opts.memberCwd ? { cwd: opts.memberCwd === true ? proj : opts.memberCwd } : {}) },
            { name: "beta", agentType: "beta" },
          ]
        : [{ name: "reviewer", agentType: "general-purpose" }, { name: "builder", agentType: "general-purpose" }];
    const cfgPath = path.join(cfgDir, "config.json");
    fs.writeFileSync(cfgPath, JSON.stringify({ name: teamName, members }));
    if (opts.staleConfig) {
      const old = (Date.now() - 48 * 3600 * 1000) / 1000;
      fs.utimesSync(cfgPath, old, old);
    }
  }
  if (opts.plantHeartbeat) {
    // A bare, content-free, operator-unauthenticated marker — the AC-1.2 spoof.
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
  delete env.WARPOS_TEAM_GATE_SOFT; // ship-default posture: hard gate ON
  delete env.WARPOS_TEAM_GATE_HARD;
  if (opts.killEnv) env.WARPOS_DISABLE_TEAM_GATE = "1";
  else delete env.WARPOS_DISABLE_TEAM_GATE;
  if (opts.killMarker) {
    fs.writeFileSync(path.join(proj, ".claude", "runtime", ".team-gate-off"), "");
  }
  const r = spawnSync("node", [HOOK], { input: JSON.stringify(event), env, encoding: "utf8" });
  return { stdout: r.stdout || "", stderr: r.stderr || "", status: r.status };
}

const blocks = (s) => /"decision"\s*:\s*"block"/.test(s);
const isGateBlock = (s) => blocks(s) && /S-12c/.test(s);

// ── AC-1.1 — a fabricated/foreign team_name must NOT short-circuit readiness ──
ok("fabricated-team-name-does-not-bypass-readiness", () => {
  // A worker passes a nonempty team_name with NO backing config.json. The OLD
  // `if (hasTeamName || !isWorker) exit(0)` opened the gate on the bare string.
  const { stdout } = runGuard({ teamName: "fabricated-foreign-team", backingTeam: false });
  assert.ok(isGateBlock(stdout), "an unverified team_name must NOT short-circuit the readiness gate");
});

ok("foreign-team-name-does-not-borrow-a-different-stale-teams-readiness", () => {
  // A foreign team_name must not BORROW readiness from a real-but-NOT-ready team:
  // here the only backing team carries ε but its config is stale (>24h) so it is
  // NOT teamReady, and no heartbeat corroborates it. The bogus team_name must not
  // open the gate — readiness fails closed (the verify is name-exact AND the
  // unverified name does not short-circuit the gate).
  const { stdout } = runGuard({
    teamName: "fabricated-foreign-team",
    backingTeam: "epsilon",
    backingTeamName: "mc-sprint",
    staleConfig: true,
  });
  assert.ok(isGateBlock(stdout), "a foreign team_name fails closed when no team is actually ready/live");
});

ok("finding-1-real-foreign-team-name-doogle-sprint-does-not-bypass-project-scope", () => {
  // The gauntlet bypass: a worker passes a REAL team_name from a sibling project
  // (doogle-sprint) that is fresh and carries epsilon. With a known MC slug,
  // named-team verification must reject it because it has neither the mc slug
  // nor a member cwd under this project.
  const { stdout } = runGuard({
    manifestSlug: "mc",
    teamName: "doogle-sprint",
    backingTeam: "epsilon",
    backingTeamName: "doogle-sprint",
  });
  assert.ok(isGateBlock(stdout), "a fresh foreign doogle-sprint team must not verify for the MC project");
});

ok("finding-2-globally-freshest-foreign-epsilon-team-is-filtered-before-readiness", () => {
  // The gauntlet bypass: readiness used the globally freshest team under
  // ~/.claude/teams. A fresh foreign epsilon team therefore opened the gate even
  // when THIS project had no correct team. With project scope, it is filtered out.
  const { stdout } = runGuard({
    manifestSlug: "mc",
    backingTeam: "epsilon",
    backingTeamName: "doogle-sprint",
  });
  assert.ok(isGateBlock(stdout), "a globally freshest foreign epsilon team must not satisfy this project's readiness");
});

ok("project-scoped-team-by-member-cwd-still-passes", () => {
  const { stdout } = runGuard({
    manifestSlug: "mc",
    teamName: "custom-sprint",
    backingTeam: "epsilon",
    backingTeamName: "custom-sprint",
    memberCwd: true,
  });
  assert.ok(!blocks(stdout), "a non-slug team with an epsilon member cwd under the project still verifies");
});

// ── AC-1.2 — a planted `.team-live-<sid>` marker must NOT flip teamLive alone ──
ok("planted-team-live-marker-not-trusted-on-presence-alone", () => {
  // The marker is planted but there is NO backing config-verified team identity.
  const { stdout } = runGuard({ plantHeartbeat: true, backingTeam: false });
  assert.ok(isGateBlock(stdout), "a bare planted heartbeat marker must not open the gate without a config-verified team");
});

ok("heartbeat-marker-honored-when-corroborated-by-stale-real-team", () => {
  // The marker IS corroborated by a real ε-team whose config is >24h old — this
  // is the legitimate long-idle case the marker exists to cover (must ALLOW).
  const { stdout } = runGuard({ plantHeartbeat: true, backingTeam: "epsilon", staleConfig: true });
  assert.ok(!blocks(stdout), "a heartbeat corroborated by a real (if stale-config) ε-team must not false-block");
});

// ── AC-1.3 — a planted solo/oneshot mode.json cannot disable the gate when a
//             real multi-agent team is active ───────────────────────────────────
ok("planted-solo-mode-json-cannot-disable-agent-gate", () => {
  // mode.json says "solo" (which would normally exit 0), but a real multi-agent
  // team is live → the gate must cross-check and NOT disable on the file's say-so.
  const { stdout, stderr } = runGuard({
    mode: "solo",
    agentType: "builder", // a build-chain worker the active-team gate must catch
    backingTeam: "epsilon",
  });
  assert.ok(blocks(stdout), "a planted solo mode.json must not disable the gate when a multi-agent team is live");
  assert.ok(/AC-1\.3/.test(stderr), "the cross-check mismatch is attested on stderr");
});

ok("planted-oneshot-mode-json-cannot-disable-agent-gate", () => {
  const { stdout } = runGuard({ mode: "oneshot", agentType: "builder", backingTeam: "epsilon" });
  assert.ok(blocks(stdout), "a planted oneshot mode.json must not disable the gate when a multi-agent team is live");
});

ok("legitimate-solo-mode-with-no-team-still-exits-early", () => {
  // A REAL solo session (no active multi-agent team) must NOT be disturbed — the
  // cross-check only fires when the file contradicts a live team (no over-block).
  const { stdout } = runGuard({ mode: "solo", agentType: "builder", backingTeam: false });
  assert.ok(!blocks(stdout), "a legitimate solo session (no active team) still exits early");
});

// ── AC-1.4 — a kill-switch bypass emits a LOUD attestation (event + stderr) ───
ok("team-gate-kill-switch-logs-loud-with-attestation", () => {
  // The env kill-switch causes a bypass that WOULD otherwise have blocked → the
  // bypass must be loud: a stderr attestation naming which switch + the reason.
  const { stdout, stderr } = runGuard({ killEnv: true, backingTeam: false });
  assert.ok(!blocks(stdout), "the kill-switch bypasses the gate (allows)");
  assert.ok(/KILL-SWITCH BYPASS/.test(stderr), "the bypass is attested loudly on stderr");
  assert.ok(/WARPOS_DISABLE_TEAM_GATE/.test(stderr), "the attestation names WHICH switch fired (env)");
  assert.ok(/AC-1\.4/.test(stderr), "the attestation cites the AC");
});

ok("team-gate-kill-switch-marker-logs-loud-with-attestation", () => {
  const { stderr } = runGuard({ killMarker: true, backingTeam: false });
  assert.ok(/KILL-SWITCH BYPASS/.test(stderr), "the marker bypass is attested loudly on stderr");
  assert.ok(/\.team-gate-off/.test(stderr), "the attestation names WHICH switch fired (marker)");
});

ok("no-kill-switch-attestation-on-a-ready-team", () => {
  // When the gate would have allowed anyway (a real ready team), a kill-switch
  // present must NOT spuriously emit a bypass attestation (it didn't bypass).
  const { stderr } = runGuard({ killEnv: true, backingTeam: "epsilon" });
  assert.ok(!/KILL-SWITCH BYPASS/.test(stderr), "no bypass attestation when the team was ready anyway");
});

// ── AC-1.6 — a REAL config-verified ready team still passes (no regression) ───
ok("legitimate-verified-team-still-passes", () => {
  // The fully-legitimate happy path: a fresh ε-team is live + the worker is
  // dispatched WITH the matching, VERIFIED team_name → the gate opens as before.
  const { stdout } = runGuard({ teamName: "mc-sprint", backingTeam: "epsilon" });
  assert.ok(!blocks(stdout), "a worker dispatched with a VERIFIED team_name into a real ε-team passes");
});

ok("legitimate-ready-team-no-teamname-still-passes", () => {
  // Even without team_name, a fresh ε-team live means the worker is not blocked
  // (teamReady opens the gate) — the verify-don't-trust change does not regress.
  const { stdout } = runGuard({ backingTeam: "epsilon" });
  assert.ok(!blocks(stdout), "a live ε-team opens the gate for a worker even with no team_name");
});

console.log(`\nteam-guard-verify: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
