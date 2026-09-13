#!/usr/bin/env node
"use strict";
/**
 * scripts/bootstrap/lastmile/orchestrate.js — the bootstrap:lastmile orchestration
 * driver. Turns the documented phase hooks in .claude/commands/bootstrap/lastmile.md
 * into an executable prototype→monetizable-product on-ramp.
 *
 * Architecture (mirrors scripts/bootstrap/spinup-orchestrate.js / SP-20260525-023):
 * a real driver module so --phase/--resume state is durable and the chain is
 * CI-testable via a fixture e2e — NOT skill-body string-parsing.
 *
 * BUILT in canonical, EXECUTES product-side. The driver sequences six phases and
 * persists phase-state. Each phase is a module under
 * scripts/bootstrap/lastmile/phases/ exporting `{ name, run(ctx) }`. DETERMINISTIC
 * phases (preflight, audit, the detection half of plan) do their work in-process
 * by reusing the detect/score/profile libs + shelling to existing engines
 * (scripts/check/install.js). LLM-ORCHESTRATED steps (the minimal intake, roadmap/
 * sprint synthesis, real sprint execution) cannot run from a node process, so a
 * phase returns status `needs_orchestration` with an `orchestration_prompt`; the
 * skill body (lastmile.md / Alpha) fulfills it, then re-invokes with --resume.
 * This mirrors spinup's research bridge and respects the dispatch-route-guard.
 *
 * Canonical proves the CHAIN + the readiness detectors on fixtures; standing up a
 * real product launch is a non-goal — that happens product-side behind the
 * human-approval gates.
 *
 * Usage:
 *   node scripts/bootstrap/lastmile/orchestrate.js \
 *     [--profile <name>] [--phase preflight|audit|plan|inject|execute|handoff] \
 *     [--module <name>] [--resume] [--research off|deep] \
 *     [--out <docs-dir>] [--state <state-file>] [--repo-root <dir>] [--json] [--dry-run]
 *
 * Exit: 0 ok (pipeline complete or single phase done),
 *       1 phase failed,
 *       3 phase needs orchestration (skill body must fulfill + re-invoke),
 *       2 bad args.
 */

const fs = require("fs");
const path = require("path");

const PHASES = ["preflight", "audit", "plan", "inject", "execute", "handoff"];
const NEEDS_ORCH = 3;
// MIRRORS lib/profiles.js PROFILES — keep IDENTICAL (the --profile validator).
const PROFILES = [
  "web-saas",
  "mobile-app",
  "desktop-app",
  "ai-tool",
  "marketplace",
  "content-community",
  "internal-external",
  "self-hosted",
  "unknown",
];
const MODULES = [
  "database",
  "auth",
  "payments",
  "crm",
  "website",
  "deployment",
  "security",
  "analytics",
];

const VALUE_FLAGS = {
  "--profile": "profile",
  "--phase": "phase",
  "--module": "module",
  "--out": "out",
  "--research": "research",
  "--state": "state",
  "--repo-root": "repoRoot",
};
const BOOL_FLAGS = { "--resume": "resume", "--json": "json", "--dry-run": "dryRun" };

// Strict parse: reject unknown flags + value-flags with a missing/flag-looking
// value (LM-NEW-2 — silent mis-parse let `--dryrun` typos and `--state --json`
// swallow args). Sets out.error; the caller returns exit 2 BEFORE any side effect.
function parseArgs(argv) {
  const out = {
    profile: null,
    phase: null,
    module: null,
    resume: false,
    out: "_docs/last-mile",
    research: "off",
    state: null,
    repoRoot: process.cwd(),
    json: false,
    dryRun: false,
    error: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (Object.prototype.hasOwnProperty.call(VALUE_FLAGS, a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) {
        out.error = `flag ${a} requires a value`;
        return out;
      }
      const key = VALUE_FLAGS[a];
      out[key] = key === "repoRoot" ? path.resolve(v) : v;
      i++;
    } else if (Object.prototype.hasOwnProperty.call(BOOL_FLAGS, a)) {
      out[BOOL_FLAGS[a]] = true;
    } else {
      out.error = `unknown argument: ${a}`;
      return out;
    }
  }
  return out;
}

// Durable phase-state. Default location is product-side scratch under .mc/;
// the e2e overrides via --state to a temp file.
function stateFile(args) {
  return args.state || mcProjectPath(args.repoRoot, ".mc/lastmile-state.json");
}

// S-OS-06 T3 4c: `.mc/` first, else an existing legacy state file IN PLACE (never moved). Guarded require.
function mcProjectPath(root, rel) {
  try {
    return require("../../hooks/lib/mc-dirs").resolveProjectPath(root, rel);
  } catch {
    return path.join(root, rel);
  }
}

function freshState() {
  return {
    schema: "mc/bootstrap/lastmile-state/v1",
    completed: [],
    phases: {},
    awaiting: null,
  };
}

function loadState(args) {
  const f = stateFile(args);
  if (fs.existsSync(f)) {
    try {
      return JSON.parse(fs.readFileSync(f, "utf8"));
    } catch {
      // fail-safe (LM-NEW-3): quarantine the corrupt file rather than silently
      // starting fresh — a silent reset on --resume would lose orchestration
      // progress. Flag _corrupt so main() can warn + refuse --resume.
      try {
        fs.renameSync(f, `${f}.corrupt-${Date.now()}`);
      } catch {
        /* best effort */
      }
      const s = freshState();
      s._corrupt = true;
      return s;
    }
  }
  return freshState();
}

function saveState(args, state) {
  if (args.dryRun) return;
  const f = stateFile(args);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(state, null, 2) + "\n", "utf8");
}

// Load a phase module. Lazy so a single --phase run doesn't require every module
// present (resilient while modules land in parallel).
function loadPhase(name) {
  return require(path.join(__dirname, "phases", `${name}.js`));
}

// Decide which phases to run this invocation.
//   --phase <name> : just that one (preflight gate prepended unless it IS preflight).
//   --resume       : every phase after the last completed (preflight always re-runs — gate).
//   default        : all phases in order.
function planPhases(args, state) {
  if (args.phase) {
    if (!PHASES.includes(args.phase)) return { error: `unknown phase "${args.phase}"` };
    return { phases: args.phase === "preflight" ? ["preflight"] : ["preflight", args.phase] };
  }
  if (args.resume) {
    const lastIdx = state.completed.length
      ? Math.max(...state.completed.map((p) => PHASES.indexOf(p)))
      : -1;
    const remaining = PHASES.slice(lastIdx + 1);
    return { phases: remaining[0] === "preflight" ? remaining : ["preflight", ...remaining] };
  }
  return { phases: PHASES.slice() };
}

// On --resume after a needs_orchestration halt, the operator has fulfilled the
// orchestration prompt out-of-band (minted sprints / dispatched them). Mark that
// phase completed so planPhases advances PAST it instead of re-halting on it
// forever (N1 fix — needs_orchestration phases don't self-complete like spinup's
// artifact-driven phases do). Returns true if state changed.
function resolveResume(args, state) {
  // gate on !args.phase (LM-NEW-1): only a PURE --resume consumes the pending
  // orchestration marker — a targeted --phase run (even a typo'd one) must not.
  if (args.resume && !args.phase && state.awaiting) {
    if (!state.completed.includes(state.awaiting)) state.completed.push(state.awaiting);
    state.awaiting = null;
    return true;
  }
  return false;
}

function buildCtx(args) {
  return {
    repoRoot: args.repoRoot,
    profile: args.profile,
    module: args.module,
    outDir: args.out,
    research: args.research,
    dryRun: args.dryRun,
    args,
    log: (m) => {
      if (!args.json) process.stdout.write(`  ${m}\n`);
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);
  // ── Validate ALL args BEFORE any state load/mutation. LM-NEW-1: a bad arg must
  //    never corrupt durable state by running resolveResume+saveState first. ──
  if (args.error) {
    process.stderr.write(`${args.error}\n`);
    return 2;
  }
  if (!["off", "deep"].includes(args.research)) {
    process.stderr.write(`bad --research "${args.research}" (off|deep)\n`);
    return 2;
  }
  if (args.profile && !PROFILES.includes(args.profile)) {
    process.stderr.write(`bad --profile "${args.profile}" (${PROFILES.join("|")})\n`);
    return 2;
  }
  if (args.module && !MODULES.includes(args.module)) {
    process.stderr.write(`bad --module "${args.module}" (${MODULES.join("|")})\n`);
    return 2;
  }
  if (args.phase && !PHASES.includes(args.phase)) {
    process.stderr.write(`unknown phase "${args.phase}" (${PHASES.join("|")})\n`);
    return 2;
  }
  const state = loadState(args);
  if (state._corrupt) {
    process.stderr.write(
      "lastmile: state file was corrupt — quarantined to *.corrupt-* and starting fresh.\n",
    );
    if (args.resume) {
      process.stderr.write(
        "refusing --resume on recovered state (would lose progress) — re-run without --resume.\n",
      );
      return 2;
    }
    delete state._corrupt;
  }
  if (resolveResume(args, state)) saveState(args, state);
  const plan = planPhases(args, state);
  if (plan.error) {
    process.stderr.write(plan.error + "\n");
    return 2;
  }
  const ctx = buildCtx(args);
  const ran = [];
  let phaseObj;
  for (const name of plan.phases) {
    try {
      phaseObj = loadPhase(name);
    } catch (e) {
      process.stderr.write(`phase module missing: ${name} (${e.message})\n`);
      return 1;
    }
    if (!args.json) process.stdout.write(`lastmile: phase ${name}...\n`);
    let res;
    try {
      res = await phaseObj.run(ctx);
    } catch (e) {
      res = { ok: false, status: "failed", message: e.message };
    }
    ran.push({ phase: name, ...res });

    if (res.status === "needs_orchestration") {
      // persist the awaiting marker so a later --resume advances past this phase
      // once the operator has fulfilled the orchestration prompt (N1 fix).
      state.awaiting = name;
      saveState(args, state);
      if (args.json)
        process.stdout.write(JSON.stringify({ ok: false, phase: name, ...res, ran }, null, 2) + "\n");
      else {
        process.stdout.write(`  NEEDS ORCHESTRATION (${name}): ${res.message}\n`);
        if (res.orchestration_prompt) process.stdout.write(`  → ${res.orchestration_prompt}\n`);
      }
      return NEEDS_ORCH;
    }
    if (!res.ok) {
      if (args.json)
        process.stdout.write(JSON.stringify({ ok: false, phase: name, ...res, ran }, null, 2) + "\n");
      else process.stdout.write(`  FAILED (${name}): ${res.message}\n`);
      return 1;
    }
    if (!state.completed.includes(name)) state.completed.push(name);
    state.phases[name] = { ok: true, at: new Date().toISOString(), data: res.data || null };
    saveState(args, state);
  }

  const result = {
    ok: true,
    ran: ran.map((r) => r.phase),
    state_file: stateFile(args),
    completed: state.completed,
  };
  if (args.json) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  else
    process.stdout.write(
      `lastmile: ${ran.length} phase(s) complete — ${ran.map((r) => r.phase).join(" → ")}\n`,
    );
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(`lastmile-orchestrate fatal: ${e.stack || e.message}\n`);
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  planPhases,
  resolveResume,
  loadState,
  saveState,
  stateFile,
  buildCtx,
  PHASES,
  PROFILES,
  MODULES,
  NEEDS_ORCH,
};
