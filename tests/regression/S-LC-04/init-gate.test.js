#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// init-gate.test.js — S-LC-04 (E-LIFECYCLE-001): the mode:init:gate
// generalization of scripts/hooks/team-guard.js from HARDCODED-sprint-only to
// REGISTRY-DRIVEN for all modes.
//
// Spawns the REAL hook as a subprocess with a sealed temp CLAUDE_PROJECT_DIR +
// HOME. Because lib/paths resolves PROJECT from CLAUDE_PROJECT_DIR, planting a
// .claude/agents/_org/mode-lifecycle.json under the temp proj makes the hook read
// THAT registry — so we can prove the gate FOLLOWS the registry (not a hardcoded
// "epsilon"). No planted registry => the shared reader falls back to FALLBACK,
// which mirrors the canonical registry rosters.
//
// Acceptance criteria (S-LC-04 build brief):
//   A. GOLDEN PRESERVED  — team-guard-gate 13/13 + team-guard-sprint 8/8 still
//      pass, UNCHANGED (this suite spawns both and asserts the exact counts).
//   B. REGISTRY-DRIVEN   — the gate resolves required-team from mode-lifecycle.json
//      per mode: planted wrong-roster in sprint still BLOCKs; a re-pointed registry
//      (different conductor face) re-points the gate with NO code change; a
//      non-sprint requires_team mode (adhoc) LOGS AN ADVISORY but does NOT block
//      (report-only ramp).
//   C. FAIL-OPEN         — a malformed/unreadable registry => the gate fails OPEN
//      (allows for non-sprint; never throws / never crashes the dispatch).
//   D. IDEMPOTENCY       — repeated init for the SAME mode does not duplicate
//      (deterministic decision, no team dirs created by the hook, counter resets).
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const HOOKS_DIR = path.resolve(__dirname, "..", "..", "..", "scripts", "hooks");
const HOOK = path.join(HOOKS_DIR, "team-guard.js");

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

// A canonical well-formed registry (mirrors .claude/agents/_org/mode-lifecycle.json
// rosters). Tests clone + mutate this to plant alternate registries.
function baseRegistry() {
  return {
    $schema: "mc/mode-lifecycle/v0.1",
    version: "v0.1",
    modes: {
      solo: { roster: [], requires_team: false },
      adhoc: { roster: ["alpha", "beta", "gamma"], requires_team: true },
      oneshot: { roster: ["delta"], requires_team: false },
      sprint: { roster: ["alpha", "epsilon", "beta"], requires_team: true },
    },
  };
}

// Run the hook with a sealed env + synthetic Agent event.
// opts: { mode, agentType, name, teamName, soft, killSwitchEnv, killSwitchMarker,
//         activeTeam, teamMembers, teamHasEpsilon, staleConfig, heartbeat,
//         seedSprintCount, seedInitgateCount, registry }
//   registry: undefined => plant nothing (reader uses FALLBACK)
//             "MALFORMED" => plant invalid JSON
//             "UNREADABLE" => plant the registry PATH as a directory (read throws)
//             object => plant JSON.stringify(object)
function runGuard(opts = {}) {
  // opts.proj / opts.home REUSE an existing sealed dir across calls — this is how
  // the COLD-START test runs dispatch #1 then #2 against the SAME project so the
  // counter file written by #1 actually persists to #2 (a fresh mkdtemp per call
  // would never exercise the no-file→file→increment sequence).
  const proj = opts.proj || fs.mkdtempSync(path.join(os.tmpdir(), "lc04-proj-"));
  const home = opts.home || fs.mkdtempSync(path.join(os.tmpdir(), "lc04-home-"));
  fs.mkdirSync(path.join(proj, ".claude", "runtime"), { recursive: true });
  fs.mkdirSync(path.join(home, ".claude", "runtime"), { recursive: true });

  // Plant (or don't) a mode-lifecycle registry the hook will read via PROJECT.
  if (opts.registry !== undefined) {
    const orgDir = path.join(proj, ".claude", "agents", "_org");
    const regPath = path.join(orgDir, "mode-lifecycle.json");
    fs.mkdirSync(orgDir, { recursive: true });
    if (opts.registry === "UNREADABLE") {
      // make the registry path a DIRECTORY so readFileSync throws EISDIR
      fs.mkdirSync(regPath, { recursive: true });
    } else if (opts.registry === "MALFORMED") {
      fs.writeFileSync(regPath, "{ this is : not json ]");
    } else {
      fs.writeFileSync(regPath, JSON.stringify(opts.registry));
    }
  }

  if (opts.mode) {
    fs.writeFileSync(
      path.join(proj, ".claude", "runtime", "mode.json"),
      JSON.stringify({ mode: opts.mode }),
    );
  }
  const sid = "s-lc04";
  fs.writeFileSync(path.join(proj, ".claude", "runtime", ".session-id"), sid);
  if (typeof opts.seedSprintCount === "number") {
    fs.writeFileSync(
      path.join(proj, ".claude", "runtime", ".sprint-oneoff-count"),
      String(opts.seedSprintCount),
    );
  }
  if (typeof opts.seedInitgateCount === "number") {
    // Per-mode counter filename (S-LC-04 FIX 2): seed the SAME file the hook reads.
    const safeMode = String(opts.mode || "")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "");
    fs.writeFileSync(
      path.join(proj, ".claude", "runtime", `.initgate-${safeMode}-oneoff-count`),
      String(opts.seedInitgateCount),
    );
  }
  if (opts.killSwitchMarker) {
    fs.writeFileSync(
      path.join(proj, ".claude", "runtime", ".team-gate-off"),
      "",
    );
  }
  if (opts.activeTeam) {
    const teamName = opts.teamName || "mc-sprint";
    const cfgDir = path.join(home, ".claude", "teams", teamName);
    fs.mkdirSync(cfgDir, { recursive: true });
    const members =
      opts.teamMembers ||
      (opts.teamHasEpsilon
        ? [
            { name: "epsilon", agentType: "epsilon" },
            { name: "beta", agentType: "beta" },
          ]
        : [
            { name: "reviewer", agentType: "general-purpose" },
            { name: "builder", agentType: "general-purpose" },
          ]);
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
      ...(opts.teamName && opts.dispatchIntoTeam
        ? { team_name: opts.teamName }
        : {}),
    },
  };
  const env = {
    ...process.env,
    CLAUDE_PROJECT_DIR: proj,
    HOME: home,
    USERPROFILE: home,
  };
  delete env.WARPOS_TEAM_GATE_HARD;
  if (opts.soft) env.WARPOS_TEAM_GATE_SOFT = "1";
  else delete env.WARPOS_TEAM_GATE_SOFT;
  if (opts.killSwitchEnv) env.WARPOS_DISABLE_TEAM_GATE = "1";
  else delete env.WARPOS_DISABLE_TEAM_GATE;

  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify(event),
    env,
    encoding: "utf8",
  });
  return {
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    status: r.status,
    home,
    proj,
  };
}

const blocks = (s) => /"decision"\s*:\s*"block"/.test(s);
const advises = (s) =>
  /\[init-gate\]/.test(s) && /S-LC-04/.test(s) && /REPORT-ONLY/.test(s);
const listTeams = (home) => {
  try {
    return fs
      .readdirSync(path.join(home, ".claude", "teams"))
      .sort()
      .join(",");
  } catch {
    return "";
  }
};

// ════════════════════════════════════════════════════════════════════════════
// A. GOLDEN PRESERVED — spawn both golden suites; assert the EXACT pass counts.
// ════════════════════════════════════════════════════════════════════════════
ok("A1) team-guard-gate.test.js still 13/13 (golden UNCHANGED)", () => {
  const r = spawnSync("node", [path.join(HOOKS_DIR, "team-guard-gate.test.js")], {
    encoding: "utf8",
  });
  assert.strictEqual(r.status, 0, "golden gate suite must exit 0");
  assert.ok(
    /team-guard-gate:\s*13\/13 pass/.test(r.stdout || ""),
    `expected 13/13, got:\n${r.stdout}`,
  );
});

ok("A2) team-guard-sprint.test.js still 8/8 (golden UNCHANGED)", () => {
  const r = spawnSync(
    "node",
    [path.join(HOOKS_DIR, "team-guard-sprint.test.js")],
    { encoding: "utf8" },
  );
  assert.strictEqual(r.status, 0, "golden sprint suite must exit 0");
  assert.ok(
    /team-guard-sprint:\s*8\/8 pass/.test(r.stdout || ""),
    `expected 8/8, got:\n${r.stdout}`,
  );
});

// ════════════════════════════════════════════════════════════════════════════
// B. REGISTRY-DRIVEN — the gate resolves required-team from the registry.
// ════════════════════════════════════════════════════════════════════════════

// B1) planted wrong-roster in sprint still BLOCKs (FALLBACK registry, conductor=ε).
ok("B1) sprint + wrong-roster team (no ε) => BLOCK (registry conductor required)", () => {
  const { stdout } = runGuard({
    mode: "sprint",
    agentType: "general-purpose",
    activeTeam: true,
    teamHasEpsilon: false,
    seedSprintCount: 5,
  });
  assert.ok(blocks(stdout), "a sprint team missing the conductor must block");
  assert.ok(/MISSING ε/.test(stdout), "block reason names the missing ε");
});

// B2) DECISIVE — a RE-POINTED registry (sprint conductor changed to γ) re-points
// the gate with NO code change: a team WITH ε but no γ now BLOCKs; a team WITH γ
// ALLOWs. Proves the gate FOLLOWS the registry, not a hardcoded "epsilon".
ok("B2) re-pointed registry (sprint conductor=γ) + team has ε not γ => BLOCK", () => {
  const reg = baseRegistry();
  reg.modes.sprint.roster = ["alpha", "gamma", "beta"]; // conductor => gamma
  const { stdout } = runGuard({
    mode: "sprint",
    agentType: "general-purpose",
    registry: reg,
    activeTeam: true,
    teamMembers: [
      { name: "epsilon", agentType: "epsilon" },
      { name: "beta", agentType: "beta" },
    ],
    seedSprintCount: 5,
  });
  assert.ok(
    blocks(stdout),
    "registry now requires γ — a team carrying only ε must block",
  );
});

ok("B3) re-pointed registry (sprint conductor=γ) + team HAS γ => ALLOW", () => {
  const reg = baseRegistry();
  reg.modes.sprint.roster = ["alpha", "gamma", "beta"]; // conductor => gamma
  const { stdout } = runGuard({
    mode: "sprint",
    agentType: "general-purpose",
    registry: reg,
    activeTeam: true,
    teamMembers: [
      { name: "gamma", agentType: "gamma" },
      { name: "beta", agentType: "beta" },
    ],
    seedSprintCount: 5,
  });
  assert.ok(
    !blocks(stdout),
    "registry conductor γ is present => the worker flows",
  );
});

// B4) a NON-sprint requires_team mode (adhoc) LOGS AN ADVISORY but does NOT block.
ok("B4) adhoc + worker + no team => REPORT-ONLY advisory, NOT a block", () => {
  const { stdout } = runGuard({
    mode: "adhoc",
    agentType: "general-purpose",
    seedInitgateCount: 1, // => n becomes 2, past the ramp
  });
  assert.ok(advises(stdout), "the generalized init-gate must advise in adhoc");
  assert.ok(!blocks(stdout), "non-sprint modes are REPORT-ONLY — never block");
});

// B5) adhoc advisory SUPPRESSED once a ready team (carrying the adhoc conductor β)
// is live — registry-driven readiness, idempotent reset.
ok("B5) adhoc + worker + team carrying β => advisory SUPPRESSED", () => {
  const { stdout } = runGuard({
    mode: "adhoc",
    agentType: "general-purpose",
    seedInitgateCount: 5,
    activeTeam: true,
    teamMembers: [
      { name: "beta", agentType: "beta" },
      { name: "gamma", agentType: "gamma" },
    ],
  });
  assert.ok(!advises(stdout), "a ready adhoc team suppresses the advisory");
  assert.ok(!blocks(stdout), "still never blocks in adhoc");
});

// B6) RAMP — the first one-off (n<2) does NOT advise in adhoc.
ok("B6) adhoc + first worker (n<2 ramp) => NO advisory", () => {
  const { stdout } = runGuard({
    mode: "adhoc",
    agentType: "general-purpose",
    seedInitgateCount: 0, // => n becomes 1
  });
  assert.ok(!advises(stdout), "ramp: do not advise on the first one-off");
});

// B7) the adhoc advisory must NOT fire for a research one-off (Explore) or a face.
ok("B7) adhoc + research one-off (explore) => NO advisory", () => {
  const { stdout } = runGuard({
    mode: "adhoc",
    agentType: "explore",
    seedInitgateCount: 5,
  });
  assert.ok(!advises(stdout), "research one-offs are legitimate — no advisory");
});

// B8) COLD START — NO pre-seed. This exercises the no-file path that every other
// test masked by pre-seeding the counter. It FAILS against the dead-counter code
// (where a cold-start ENOENT on read skipped the write, the file was never created,
// n stayed 1, and the advisory never fired) and PASSES after FIX 1. dispatch #1 in
// a fresh project must CREATE the per-mode counter file = "1" with NO advisory
// (ramp); dispatch #2 against the SAME project must read 1 → write "2" → the
// advisory FIRES. Reuses one sealed proj/home across both dispatches.
ok("B8) COLD START adhoc: #1 creates file=1 + NO advisory; #2 => file=2 + advisory FIRES", () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "lc04-cold-proj-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lc04-cold-home-"));
  fs.mkdirSync(path.join(proj, ".claude", "runtime"), { recursive: true });
  const cPath = path.join(
    proj,
    ".claude",
    "runtime",
    ".initgate-adhoc-oneoff-count",
  );
  // PRECONDITION: genuine cold start — the per-mode counter file does NOT exist.
  assert.ok(
    !fs.existsSync(cPath),
    "cold-start precondition: no counter file pre-seeded",
  );

  // dispatch #1 — ramp: the hook must CREATE the file = "1" and NOT advise.
  const r1 = runGuard({ proj, home, mode: "adhoc", agentType: "general-purpose" });
  assert.ok(
    fs.existsSync(cPath),
    "dispatch #1 must CREATE the per-mode counter file on cold start (FIX 1)",
  );
  assert.strictEqual(
    fs.readFileSync(cPath, "utf8").trim(),
    "1",
    "cold-start dispatch #1 => counter file = 1",
  );
  assert.ok(!advises(r1.stdout), "dispatch #1 ramps — no advisory yet");
  assert.ok(!blocks(r1.stdout), "non-sprint stays REPORT-ONLY — never blocks");

  // dispatch #2 — SAME proj: read 1 → write 2 → the advisory FIRES.
  const r2 = runGuard({ proj, home, mode: "adhoc", agentType: "general-purpose" });
  assert.strictEqual(
    fs.readFileSync(cPath, "utf8").trim(),
    "2",
    "cold-start dispatch #2 => counter file = 2",
  );
  assert.ok(
    advises(r2.stdout),
    "dispatch #2 from cold start => the generalized init-gate advisory FIRES",
  );
  assert.ok(!blocks(r2.stdout), "still never blocks in adhoc");
});

// ════════════════════════════════════════════════════════════════════════════
// C. FAIL-OPEN — a malformed/unreadable registry must never throw, and the
//    non-sprint gate must fail OPEN (allow).
// ════════════════════════════════════════════════════════════════════════════
ok("C1) MALFORMED registry + adhoc worker => ALLOW (fail-open, no crash)", () => {
  const { stdout, status, stderr } = runGuard({
    mode: "adhoc",
    agentType: "general-purpose",
    registry: "MALFORMED",
    seedInitgateCount: 1,
  });
  assert.strictEqual(status, 0, "hook must exit 0 (never crash)");
  assert.ok(!/Error:|at Object|at Module/.test(stderr), "no thrown stack trace");
  assert.ok(!blocks(stdout), "fail-open => the dispatch is allowed");
});

ok("C2) UNREADABLE registry (dir) + adhoc worker => ALLOW (fail-open, no crash)", () => {
  const { stdout, status, stderr } = runGuard({
    mode: "adhoc",
    agentType: "general-purpose",
    registry: "UNREADABLE",
    seedInitgateCount: 1,
  });
  assert.strictEqual(status, 0, "hook must exit 0 on an unreadable registry");
  assert.ok(!/Error:|at Object|at Module/.test(stderr), "no thrown stack trace");
  assert.ok(!blocks(stdout), "fail-open => allowed");
});

ok("C3) MALFORMED registry + sprint worker => does NOT throw (FALLBACK preserves gate)", () => {
  const { status, stderr } = runGuard({
    mode: "sprint",
    agentType: "general-purpose",
    registry: "MALFORMED",
    seedSprintCount: 5,
  });
  // sprint falls back to the known-good ε gate (it may BLOCK — the safe default),
  // but it must NEVER crash on a bad registry.
  assert.strictEqual(status, 0, "hook must exit 0 even on a malformed registry");
  assert.ok(!/Error:|at Object|at Module/.test(stderr), "no thrown stack trace");
});

// ════════════════════════════════════════════════════════════════════════════
// D. IDEMPOTENCY — repeated init for the SAME mode does not duplicate.
// ════════════════════════════════════════════════════════════════════════════
ok("D1) sprint + ready team, dispatched 3x => deterministic ALLOW, no duplicate teams", () => {
  const before = (h) => listTeams(h);
  const outs = [];
  let teamsConst = null;
  for (let i = 0; i < 3; i++) {
    const r = runGuard({
      mode: "sprint",
      agentType: "general-purpose",
      activeTeam: true,
      teamHasEpsilon: true,
      seedSprintCount: 5,
    });
    outs.push(blocks(r.stdout));
    // the hook must NEVER create/duplicate a team dir under ~/.claude/teams
    const teams = before(r.home);
    if (teamsConst === null) teamsConst = teams;
    assert.strictEqual(
      teams,
      "mc-sprint",
      "the hook must not create extra team dirs (idempotent)",
    );
  }
  assert.deepStrictEqual(
    outs,
    [false, false, false],
    "every repeat must deterministically ALLOW (ready team)",
  );
});

ok("D2) adhoc + ready team, repeated => counter RESETS to 0 (no accumulation)", () => {
  // A ready team resets the per-mode ramp counter to 0 every call — repeated init
  // for the same mode never accumulates / duplicates the advisory.
  const r = runGuard({
    mode: "adhoc",
    agentType: "general-purpose",
    seedInitgateCount: 9,
    activeTeam: true,
    teamMembers: [{ name: "beta", agentType: "beta" }],
  });
  const cPath = path.join(
    r.proj,
    ".claude",
    "runtime",
    ".initgate-adhoc-oneoff-count",
  );
  const val = fs.readFileSync(cPath, "utf8").trim();
  assert.strictEqual(val, "0", "a ready team resets the ramp counter to 0");
  assert.ok(!advises(r.stdout) && !blocks(r.stdout), "ready => no advisory/block");
});

console.log(`\nS-LC-04 init-gate: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
