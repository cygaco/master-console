#!/usr/bin/env node
"use strict";
/**
 * scripts/bootstrap/spinup-orchestrate.js — the step-driven bootstrap:spinup
 * driver (MC-PROMPT §1/§2). Each step is INDEPENDENTLY dispatchable, idempotent,
 * and resumable; LLM steps return `needs_orchestration` with a machine-readable
 * `orchestration_prompt` so any consumer — an in-loop Alpha session OR a product-side
 * headless runner (the Master Console cockpit) — can drive one step = one turn.
 *
 * INVOCATION CONTRACT (positional subcommand, like `git commit`):
 *   node scripts/bootstrap/spinup-orchestrate.js [<step>] [--clone <url>]
 *     [--name <n>] [--what <w>] [--who <c>] [--where android|ios|web|desktop-pc|desktop-mac]
 *     [--framework <f>] [--database <d>] [--auth <a>] [--payments <p>] [--hosting <h>] [--analytics <a>]
 *     [--product <name>] [--intent <file>] [--out <dir>] [--research simple|deep]
 *     [--research-in <file>] [--allow-needs-input <field>]... [--repo-root <dir>]
 *     [--resume] [--json] [--dry-run] [--force]
 *
 *   <step> ∈ { setup, canon, roadmap, paint }. Omitted ⇒ full chain. `--phase <step>`
 *   is accepted as a back-compat alias. NOT a dashed-flag-only contract.
 *
 * STABLE --json STATUS:
 *   { phase, status: "ok"|"needs_orchestration"|"failed", ran:[...], orchestration_prompt,
 *     data: { serveUrl, firstAction, roadmapPath, ... } }
 *
 * ANTI-DEGRADE (§2): there is NO `--research off`/`light`, NO `--auto`/`--fast`/skip,
 * and no tier/alias that resolves to off. Floor = `simple` (cheap real research,
 * default); `deep` = explicit opt-up. `--research off` is REJECTED non-zero.
 *
 * Exit: 0 ok (step/chain complete), 1 step failed, 3 needs orchestration, 2 bad args.
 */

const fs = require("fs");
const path = require("path");

const STEPS = ["setup", "canon", "roadmap", "paint"];
const NEEDS_ORCH = 3;

// Anti-degrade: the ONLY accepted research modes. `off`/`light`/`none` are rejected
// (no path to un-synthesized canon). Floor = simple; deep = explicit opt-up.
const RESEARCH_MODES = ["simple", "deep"];
const DEFAULT_RESEARCH = "simple";
// Aliases that historically resolved to a no-spend/degraded mode — now REJECTED so a
// renamed hole can't reintroduce the WI-51 degrade path.
const REJECTED_RESEARCH = new Set(["off", "light", "none", "skip", "auto", "fast"]);

function parseArgs(argv) {
  const out = {
    step: null,
    product: null,
    name: null,
    what: null,
    who: null,
    where: null,
    framework: null,
    database: null,
    auth: null,
    payments: null,
    hosting: null,
    analytics: null,
    intent: null,
    clone: null,
    resume: false,
    out: "_requirements/00-canonical",
    research: null, // null ⇒ resolveResearch() → DEFAULT_RESEARCH
    researchIn: null,
    allowNeedsInput: [],
    state: null,
    repoRoot: process.cwd(),
    json: false,
    dryRun: false,
    force: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--phase" || a === "--step") out.step = argv[++i];
    else if (a === "--product") out.product = argv[++i];
    else if (a === "--name") out.name = argv[++i];
    else if (a === "--what") out.what = argv[++i];
    else if (a === "--who") out.who = argv[++i];
    else if (a === "--where") out.where = argv[++i];
    else if (a === "--framework" || a === "--stack-framework") out.framework = argv[++i];
    else if (a === "--database" || a === "--stack-database") out.database = argv[++i];
    else if (a === "--auth" || a === "--stack-auth") out.auth = argv[++i];
    else if (a === "--payments" || a === "--stack-payments") out.payments = argv[++i];
    else if (a === "--hosting" || a === "--stack-hosting") out.hosting = argv[++i];
    else if (a === "--analytics" || a === "--stack-analytics") out.analytics = argv[++i];
    else if (a === "--intent") out.intent = argv[++i];
    else if (a === "--clone") out.clone = argv[++i];
    else if (a === "--resume") out.resume = true;
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--research") out.research = argv[++i];
    else if (a === "--research-in") out.researchIn = argv[++i];
    else if (a === "--allow-needs-input") out.allowNeedsInput.push(argv[++i]);
    else if (a === "--state") out.state = argv[++i];
    else if (a === "--repo-root") out.repoRoot = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--force") out.force = true;
    else if (!a.startsWith("-") && out.step === null && STEPS.includes(a)) out.step = a; // positional subcommand
    else if (!a.startsWith("-") && out.step === null && out._badPositional == null) out._badPositional = a; // unknown bare arg
  }
  return out;
}

// Resolve the effective research mode. Anti-degrade: reject any off/degrade alias.
function resolveResearch(args) {
  if (args.research) {
    return { mode: args.research, source: "explicit --research" };
  }
  return { mode: DEFAULT_RESEARCH, source: "default (simple)" };
}

function stateFile(args) {
  return args.state || mcProjectPath(args.repoRoot, ".mc/spinup-state.json");
}

// S-OS-06 T3 4c: `.mc/` first, else an existing legacy state file IN PLACE (never moved). Guarded require.
function mcProjectPath(root, rel) {
  try {
    return require("../hooks/lib/mc-dirs").resolveProjectPath(root, rel);
  } catch {
    return path.join(root, rel);
  }
}

function loadState(args) {
  const f = stateFile(args);
  if (fs.existsSync(f)) {
    try { return JSON.parse(fs.readFileSync(f, "utf8")); }
    catch { /* fall through to fresh */ }
  }
  return { schema: "mc/bootstrap/spinup-state/v2", completed: [], phases: {} };
}

function saveState(args, state) {
  if (args.dryRun) return;
  const f = stateFile(args);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function loadPhase(name) {
  return require(path.join(__dirname, "phases", `${name}.js`));
}

// Decide which steps to run this invocation. Each step is independent — a single
// step runs JUST that step (no gate-prepend), reading prior-step output from saved
// state. --resume continues after the last completed step. Default = full chain.
function planSteps(args, state) {
  if (args.step) {
    if (!STEPS.includes(args.step)) return { error: `unknown step "${args.step}" (setup|canon|roadmap|paint)` };
    return { steps: [args.step] };
  }
  if (args.resume) {
    const lastIdx = state.completed.length ? Math.max(...state.completed.map((p) => STEPS.indexOf(p))) : -1;
    return { steps: STEPS.slice(lastIdx + 1) };
  }
  return { steps: STEPS.slice() };
}

// Seed the cross-step carry from saved state so a standalone `canon`/`roadmap`/`paint`
// run reads the setup step's intent/platform/out without re-running setup.
function seedCarry(state) {
  const carry = {};
  for (const step of STEPS) {
    const d = state.phases[step] && state.phases[step].data;
    if (d) Object.assign(carry, d);
  }
  return carry;
}

function buildCtx(args, research, carry) {
  return {
    repoRoot: carry.repoRoot || args.repoRoot,
    product: args.product || args.name || carry.product || null,
    name: args.name,
    what: args.what,
    who: args.who,
    where: args.where || carry.platform || null,
    framework: args.framework || (carry.stack && carry.stack.framework) || null,
    database: args.database || (carry.stack && carry.stack.database) || null,
    auth: args.auth || (carry.stack && carry.stack.auth) || null,
    payments: args.payments || (carry.stack && carry.stack.payments) || null,
    hosting: args.hosting || (carry.stack && carry.stack.hosting) || null,
    analytics: args.analytics || (carry.stack && carry.stack.analytics) || null,
    stack: {
      framework: args.framework || (carry.stack && carry.stack.framework) || "",
      database: args.database || (carry.stack && carry.stack.database) || "",
      auth: args.auth || (carry.stack && carry.stack.auth) || "",
      payments: args.payments || (carry.stack && carry.stack.payments) || "",
      hosting: args.hosting || (carry.stack && carry.stack.hosting) || "",
      analytics: args.analytics || (carry.stack && carry.stack.analytics) || "",
    },
    intentFile: args.intent || carry.intentFile || null,
    cloneTarget: args.clone,
    outDir: args.out,
    research,
    researchIn: args.researchIn,
    allowNeedsInput: args.allowNeedsInput,
    dryRun: args.dryRun,
    args,
    log: (m) => { if (!args.json) process.stdout.write(`  ${m}\n`); },
  };
}

// Normalize the per-step data into the stable consumer-contract shape.
function normalizeData(data) {
  const d = data || {};
  return Object.assign(
    { serveUrl: d.serveUrl || null, firstAction: d.firstAction || null, roadmapPath: d.roadmapPath || null },
    d,
  );
}

function emitJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

async function main() {
  const args = parseArgs(process.argv);

  if (args._badPositional != null) {
    const msg = `unknown step "${args._badPositional}" (setup|canon|roadmap|paint); product name goes via --name/--product`;
    if (args.json) emitJson({ phase: "args", status: "failed", ran: [], orchestration_prompt: null, data: normalizeData(), message: msg });
    else process.stderr.write(msg + "\n");
    return 2;
  }

  // ── Anti-degrade arg validation (§2) — reject any off/degrade research mode ──
  if (args.research) {
    if (REJECTED_RESEARCH.has(args.research)) {
      const msg = `--research "${args.research}" is rejected: there is NO path to degraded/un-synthesized canon. Use --research simple (default) or --research deep.`;
      if (args.json) emitJson({ phase: args.step || "args", status: "failed", ran: [], orchestration_prompt: null, data: normalizeData(), message: msg });
      else process.stderr.write(msg + "\n");
      return 2;
    }
    if (!RESEARCH_MODES.includes(args.research)) {
      const msg = `bad --research "${args.research}" (simple|deep)`;
      if (args.json) emitJson({ phase: args.step || "args", status: "failed", ran: [], orchestration_prompt: null, data: normalizeData(), message: msg });
      else process.stderr.write(msg + "\n");
      return 2;
    }
  }

  const { mode: research, source: researchSource } = resolveResearch(args);
  const state = loadState(args);
  const plan = planSteps(args, state);
  if (plan.error) {
    if (args.json) emitJson({ phase: args.step || "args", status: "failed", ran: [], orchestration_prompt: null, data: normalizeData(), message: plan.error });
    else process.stderr.write(plan.error + "\n");
    return 2;
  }

  if (!args.json) process.stdout.write(`spinup: research = ${research} (${researchSource}) — live research spend\n`);

  const carry = seedCarry(state);
  const ran = [];
  let lastData = {};

  for (const name of plan.steps) {
    let phaseObj;
    try { phaseObj = loadPhase(name); }
    catch (e) {
      const msg = `step module missing: ${name} (${e.message})`;
      if (args.json) emitJson({ phase: name, status: "failed", ran: ran.map((r) => r.phase), orchestration_prompt: null, data: normalizeData(lastData), message: msg });
      else process.stderr.write(msg + "\n");
      return 1;
    }
    if (!args.json) process.stdout.write(`spinup: step ${name}...\n`);

    const ctx = buildCtx(args, research, carry);
    let res;
    try { res = await phaseObj.run(ctx); }
    catch (e) { res = { ok: false, status: "failed", message: e.message }; }
    ran.push({ phase: name, ...res });
    if (res.data) { Object.assign(carry, res.data); lastData = Object.assign({}, lastData, res.data); }

    if (res.status === "needs_orchestration") {
      const out = { phase: name, status: "needs_orchestration", ran: ran.map((r) => r.phase), orchestration_prompt: res.orchestration_prompt || null, data: normalizeData(lastData), message: res.message };
      if (args.json) emitJson(out);
      else {
        process.stdout.write(`  NEEDS ORCHESTRATION (${name}): ${res.message}\n`);
        if (res.orchestration_prompt) process.stdout.write(`  → ${res.orchestration_prompt}\n`);
      }
      return NEEDS_ORCH;
    }
    if (!res.ok) {
      const out = { phase: name, status: "failed", ran: ran.map((r) => r.phase), orchestration_prompt: null, data: normalizeData(lastData), message: res.message };
      if (args.json) emitJson(out);
      else process.stdout.write(`  FAILED (${name}): ${res.message}\n`);
      return 1;
    }
    if (!state.completed.includes(name)) state.completed.push(name);
    state.phases[name] = { ok: true, at: new Date().toISOString(), data: res.data || null };
    saveState(args, state);
  }

  const lastPhase = ran.length ? ran[ran.length - 1].phase : (args.step || null);
  const out = {
    phase: lastPhase,
    status: "ok",
    ran: ran.map((r) => r.phase),
    orchestration_prompt: null,
    data: normalizeData(lastData),
    state_file: stateFile(args),
    completed: state.completed,
    research,
    research_source: researchSource,
  };
  if (args.json) emitJson(out);
  else process.stdout.write(`spinup: ${ran.length} step(s) complete — ${ran.map((r) => r.phase).join(" → ")}\n`);
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((e) => {
    process.stderr.write(`spinup-orchestrate fatal: ${e.stack || e.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs, planSteps, loadState, saveState, stateFile, buildCtx, seedCarry, normalizeData,
  resolveResearch, RESEARCH_MODES, REJECTED_RESEARCH, DEFAULT_RESEARCH, STEPS, NEEDS_ORCH,
};
