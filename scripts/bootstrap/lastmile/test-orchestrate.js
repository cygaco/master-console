#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";
/**
 * test-orchestrate.js — fixture e2e + unit test for bootstrap:lastmile.
 *
 * Proves (canonical, no real product stood up):
 *   - driver: planPhases (default/--phase/--resume) + phase-state round-trip
 *   - preflight: pass (runCheck 0)->done; refuse (1)->failed
 *   - detect: all 8 holdout fixtures match their expected gaps
 *   - score: 9 dimensions + composite; sensitive caps privacy/security
 *   - adapters: all 8 conform to the contract + key behavioral assertions
 *   - chain: preflight -> audit(done,data) -> plan(done,artifacts) -> inject(needs_orchestration)
 *   - artifacts: a real (non-dry-run) audit writes gap-report.md to disk
 *   - handoff: done + headline data
 *
 * Exit 0 = all pass, 1 = any failure.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const driver = require("./orchestrate");
const { detectRepoState } = require("./lib/detect");
const { recommendStack } = require("./lib/profiles");
const { scoreReadiness } = require("./lib/score");
const { validateAdapter } = require("./lib/adapter-contract");
const { CASES, materialize, getByPath } = require("./fixtures");

const preflight = require("./phases/preflight");
const audit = require("./phases/audit");
const plan = require("./phases/plan");
const inject = require("./phases/inject");
const execute = require("./phases/execute");
const handoff = require("./phases/handoff");

const MODULE_NAMES = ["database", "auth", "payments", "crm", "website", "deployment", "security", "analytics"];

let passed = 0;
let failed = 0;
function ok(n) { passed++; process.stdout.write(`  ok    ${n}\n`); }
function fail(n, d) { failed++; process.stdout.write(`  FAIL  ${n}\n`); if (d) process.stdout.write(`        ${d}\n`); }
function mkctx(over) {
  return Object.assign(
    { repoRoot: process.cwd(), profile: null, module: null, outDir: "_docs/last-mile", research: "off", dryRun: true, args: {}, log: () => {} },
    over,
  );
}

// ---------------------------------------------------------- driver
function testDriver() {
  process.stdout.write("\nUNIT — driver (orchestrate.js)\n");
  const fresh = { completed: [], phases: {} };
  const all = driver.planPhases({ phase: null, resume: false }, fresh);
  if (JSON.stringify(all.phases) === JSON.stringify(driver.PHASES)) ok("default plans all 6 phases in order");
  else fail("default plan", JSON.stringify(all));

  const single = driver.planPhases({ phase: "audit", resume: false }, fresh);
  if (single.phases[0] === "preflight" && single.phases.includes("audit") && single.phases.length === 2)
    ok("--phase audit runs [preflight, audit] (gate first)");
  else fail("--phase plan", JSON.stringify(single));

  const resumed = driver.planPhases({ phase: null, resume: true }, { completed: ["preflight", "audit"], phases: {} });
  if (!resumed.phases.includes("audit") && resumed.phases.includes("plan") && resumed.phases.includes("handoff"))
    ok("--resume continues after last completed phase");
  else fail("--resume plan", JSON.stringify(resumed));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lastmile-state-"));
  const args = { state: path.join(tmp, "s.json"), dryRun: false, repoRoot: tmp };
  const st = driver.loadState(args);
  st.completed.push("preflight");
  driver.saveState(args, st);
  if (driver.loadState(args).completed.includes("preflight")) ok("phase-state persists + reloads (--resume durability)");
  else fail("state round-trip");
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------- preflight
async function testPreflight() {
  process.stdout.write("\nUNIT — preflight gate\n");
  const r1 = await preflight.run(mkctx({ args: { _runCheck: () => ({ code: 0 }) } }));
  if (r1.ok && r1.status === "done") ok("preflight passes complete install");
  else fail("preflight pass", JSON.stringify(r1));
  const r2 = await preflight.run(mkctx({ args: { _runCheck: () => ({ code: 1 }) } }));
  if (!r2.ok && r2.status === "failed") ok("preflight REFUSES gappy install");
  else fail("preflight refuse", JSON.stringify(r2));
}

// ---------------------------------------------------------- detect (8 holdout fixtures)
function testFixtures() {
  process.stdout.write("\nE2E — detect on 8 holdout fixtures\n");
  for (const c of CASES) {
    const dir = materialize(c);
    const st = detectRepoState(dir);
    let allPass = true;
    const misses = [];
    for (const e of c.expect) {
      const v = getByPath(st, e.path);
      if (v !== e.equals) { allPass = false; misses.push(`${e.path}=${JSON.stringify(v)}≠${JSON.stringify(e.equals)}`); }
    }
    if (allPass) ok(`fixture ${c.name} — gap detected (${c.why})`);
    else fail(`fixture ${c.name}`, misses.join(", "));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeDeclaredStack(repo, paymentsChoice) {
  const dir = path.join(repo, "_requirements", "00-canonical");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "DATA_AND_ACCOUNTS.md"),
    [
      "# Acme - Data & Accounts",
      "",
      "## Tech Stack",
      "| Layer | Declared Choice | Rationale |",
      "| --- | --- | --- |",
      "| Framework | Next.js | intake |",
      "| Database | Supabase | intake |",
      "| Authentication | Clerk | intake |",
      `| Payments | ${paymentsChoice} | intake |`,
      "| Hosting | Vercel | intake |",
      "| Analytics | PostHog | intake |",
      "",
    ].join("\n"),
    "utf8",
  );
}

async function testDeclaredStack() {
  process.stdout.write("\nUNIT - declared Tech Stack prefill + drift\n");
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "lastmile-declared-stack-"));
  fs.writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify({ dependencies: { next: "latest", stripe: "latest" } }, null, 2),
    "utf8",
  );
  writeDeclaredStack(repo, "Paddle");
  const st = detectRepoState(repo);
  if (st.declaredStack && st.declaredStack.present && st.declaredStack.values.database === "Supabase")
    ok("detectRepoState loads declared Tech Stack from canonical DATA_AND_ACCOUNTS");
  else fail("declared stack detect", JSON.stringify(st.declaredStack));

  const rec = recommendStack(null, st);
  if (rec.stack.db === "Supabase (declared)" && rec.stack.auth === "Clerk (declared)")
    ok("recommendStack pre-fills missing providers from declared stack");
  else fail("declared stack prefill", JSON.stringify(rec.stack));
  if (rec.stack.payments === "stripe (existing)" && rec.stackDrift.some((e) => e.layer === "payments" && e.detected === "stripe"))
    ok("recommendStack keeps detected implementation provider and emits stack_drift");
  else fail("stack drift", JSON.stringify({ stack: rec.stack, drift: rec.stackDrift }));

  const rp = await plan.run(mkctx({ repoRoot: repo, dryRun: false }));
  const launch = path.join(repo, "_docs", "last-mile", "launch-plan.md");
  const launchText = fs.existsSync(launch) ? fs.readFileSync(launch, "utf8") : "";
  if (rp.data && rp.data.stack_drift.length && /Stack Drift Events/.test(launchText) && /stack_drift/.test(launchText))
    ok("plan: stack_drift is visible in launch-plan artifact and JSON data");
  else fail("plan stack_drift visibility", JSON.stringify({ data: rp.data && rp.data.stack_drift, launch: launchText.slice(0, 300) }));

  fs.rmSync(repo, { recursive: true, force: true });
}

// ---------------------------------------------------------- score
function testScore() {
  process.stdout.write("\nUNIT — score\n");
  const sensitive = CASES.find((c) => c.name === "sensitive-data-redflag");
  const dir = materialize(sensitive);
  const s = scoreReadiness(detectRepoState(dir));
  if (Object.keys(s.dimensions).length === 9 && typeof s.composite === "number") ok("score: 9 dimensions + numeric composite");
  else fail("score shape", JSON.stringify(s.dimensions));
  if (s.sensitiveEscalation && s.dimensions.privacy <= 40 && s.dimensions.security <= 40)
    ok("score: sensitive data caps privacy + security ≤40 + sets escalation");
  else fail("score sensitive cap", `privacy=${s.dimensions.privacy} security=${s.dimensions.security} esc=${s.sensitiveEscalation}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------- adapters
function testAdapters() {
  process.stdout.write("\nUNIT — adapter contract + behavior\n");
  let bad = 0;
  for (const n of MODULE_NAMES) {
    const r = validateAdapter(require(`./modules/${n}`));
    if (!r.ok) { bad++; fail(`adapter ${n} contract`, r.errors.join("; ")); }
  }
  if (!bad) ok("all 8 adapters conform to the contract");

  // F1 negative: an adapter whose plan() omits tests/risks must be rejected
  const badAdapter = {
    name: "x", title: "X",
    detect: () => ({ status: "absent", evidence: [] }),
    recommend: () => ({ choice: "y", alternatives: [] }),
    plan: () => ({ summary: "s", steps: [], envVars: [], gates: [], template: "launch-plan" }),
  };
  const neg = validateAdapter(badAdapter);
  if (!neg.ok && neg.errors.some((e) => /tests/.test(e)) && neg.errors.some((e) => /risks/.test(e)))
    ok("validateAdapter rejects an adapter missing plan().tests/risks (F1 negative)");
  else fail("F1 negative", JSON.stringify(neg));

  // behavioral: payments flags unverified webhook on the stripe fixture
  const stripeDir = materialize(CASES.find((c) => c.name === "stripe-no-webhook-verify"));
  const ps = require("./modules/payments").detect(detectRepoState(stripeDir));
  if (ps.present && ps.webhookVerified === false && ps.status === "partial")
    ok("payments adapter: flags Stripe-without-verified-webhook as partial");
  else fail("payments behavior", JSON.stringify(ps));
  fs.rmSync(stripeDir, { recursive: true, force: true });

  // behavioral: security escalates on sensitive fixture
  const sensDir = materialize(CASES.find((c) => c.name === "sensitive-data-redflag"));
  const sec = require("./modules/security").detect(detectRepoState(sensDir));
  if (sec.escalate && sec.status === "absent") ok("security adapter: escalates + status absent on sensitive data");
  else fail("security behavior", JSON.stringify(sec));
  fs.rmSync(sensDir, { recursive: true, force: true });
}

// ---------------------------------------------------------- chain + artifacts
async function testChain() {
  process.stdout.write("\nE2E — chain audit -> plan -> inject (+ real artifact write)\n");
  const repo = materialize(CASES.find((c) => c.name === "auth-no-payments"));

  const ra = await audit.run(mkctx({ repoRoot: repo, dryRun: true }));
  if (ra.ok && ra.status === "done" && typeof ra.data.composite === "number" && ra.data.detections.length === 8)
    ok("audit: returns score + 8 module detections");
  else fail("audit phase", JSON.stringify(ra).slice(0, 200));

  const rp = await plan.run(mkctx({ repoRoot: repo, dryRun: true }));
  if (rp.ok && rp.status === "done" && Array.isArray(rp.data.gates) && rp.data.modules.length === 8)
    ok("plan: returns gates + 8 module plans");
  else fail("plan phase", JSON.stringify(rp).slice(0, 200));
  if (rp.data.gates.includes("stripe-live")) ok("plan: surfaces the stripe-live approval gate");
  else fail("plan gates", JSON.stringify(rp.data.gates));

  const ri = await inject.run(mkctx({ repoRoot: repo }));
  if (ri.status === "needs_orchestration" && ri.orchestration_prompt) ok("inject: needs_orchestration with a concrete prompt");
  else fail("inject phase", JSON.stringify(ri).slice(0, 160));
  const ip = ri.orchestration_prompt || "";
  if (/\/sprint:plan/.test(ip) && /verified_by/.test(ip) && /\/roadmap:add/.test(ip))
    ok("inject prompt cites /sprint:plan + verified_by + /roadmap:add (sprint-ready, not advice)");
  else fail("inject prompt content (REQ-3)", ip.slice(0, 140));

  const re = await execute.run(mkctx({ repoRoot: repo }));
  if (re.status === "needs_orchestration") ok("execute: needs_orchestration");
  else fail("execute phase", JSON.stringify(re).slice(0, 160));
  const ep = re.orchestration_prompt || "";
  if (/\/sprint:execute/.test(ep)) ok("execute prompt cites /sprint:execute");
  else fail("execute prompt content (REQ-3)", ep.slice(0, 140));

  // real artifact write (non-dry-run) into the fixture repo
  const ra2 = await audit.run(mkctx({ repoRoot: repo, dryRun: false }));
  const gapPath = path.join(repo, "_docs", "last-mile", "gap-report.md");
  if (ra2.data.gapReport && fs.existsSync(gapPath)) ok("audit: writes gap-report.md product-side (non-dry-run)");
  else fail("audit artifact", gapPath);

  const rh = await handoff.run(mkctx({ repoRoot: repo, dryRun: false }));
  const hoPath = path.join(repo, "last-mile-handoff.md");
  if (rh.ok && fs.existsSync(hoPath)) ok("handoff: writes last-mile-handoff.md at product root");
  else fail("handoff artifact", hoPath);

  fs.rmSync(repo, { recursive: true, force: true });
}

// ---------------------------------------------------------- resume after orchestration (N1)
function testResume() {
  process.stdout.write("\nUNIT — resume after needs_orchestration (N1 regression)\n");
  const st = { completed: ["preflight", "audit", "plan"], awaiting: "inject", phases: {} };
  driver.resolveResume({ resume: true }, st);
  if (st.completed.includes("inject") && st.awaiting == null) ok("resolveResume marks fulfilled inject completed + clears awaiting");
  else fail("resolveResume inject", JSON.stringify(st));
  const p = driver.planPhases({ phase: null, resume: true }, st);
  if (p.phases.includes("execute") && p.phases.includes("handoff") && !p.phases.includes("inject"))
    ok("resume advances past inject → execute/handoff (no re-halt loop)");
  else fail("resume plan after inject", JSON.stringify(p.phases));
  const st2 = { completed: ["preflight", "audit", "plan", "inject"], awaiting: "execute", phases: {} };
  driver.resolveResume({ resume: true }, st2);
  const p2 = driver.planPhases({ phase: null, resume: true }, st2);
  if (p2.phases.includes("handoff") && !p2.phases.includes("execute"))
    ok("resume advances past execute → handoff (pipeline completes)");
  else fail("resume plan after execute", JSON.stringify(p2.phases));
}

// ---------------------------------------------------------- gate registry (N3)
function testGateRegistry() {
  process.stdout.write("\nUNIT — module gates ⊆ approval-gate registry (N3)\n");
  const { GATE_IDS } = require("./lib/approval-gates");
  const { sampleState } = require("./lib/adapter-contract");
  const states = [
    sampleState(),
    Object.assign(sampleState(), { platform: "mobile" }),
    Object.assign(sampleState(), { sensitive: { signals: ["health"], escalate: true } }),
  ];
  let bad = 0;
  for (const n of MODULE_NAMES) {
    const mod = require(`./modules/${n}`);
    for (const st of states) {
      for (const g of mod.plan(st, "web-saas").gates || []) {
        if (!GATE_IDS.includes(g)) { bad++; fail(`module ${n} gate "${g}"`, "not in approval-gate registry"); }
      }
    }
  }
  if (!bad) ok("all module plan().gates are valid registry ids (sample/mobile/sensitive states)");
}

// ---------------------------------------------------------- scored-gap text per fixture (F2)
function testScoredGaps() {
  process.stdout.write("\nUNIT — scored gaps name each fixture's defect (F2 — all 7)\n");
  const run = (name) => {
    const d = materialize(CASES.find((c) => c.name === name));
    const s = scoreReadiness(detectRepoState(d));
    fs.rmSync(d, { recursive: true, force: true });
    return s;
  };
  const checks = [
    ["no-auth", (s) => s.gaps.some((g) => g.dim === "security" && /auth/i.test(g.gap))],
    ["auth-no-payments", (s) => s.gaps.some((g) => g.dim === "monetization")],
    ["stripe-no-webhook-verify", (s) => s.gaps.some((g) => /webhook/i.test(g.gap))],
    ["db-no-deletion-path", (s) => s.gaps.some((g) => g.dim === "privacy" && /deletion/i.test(g.gap))],
    ["no-funnel", (s) => s.gaps.some((g) => g.dim === "funnel")],
    ["mobile-appstore", (s) => s.gaps.some((g) => g.dim === "monetization")],
    ["sensitive-data-redflag", (s) => s.sensitiveEscalation && s.gaps.some((g) => /sensitive/i.test(g.gap))],
  ];
  for (const [name, pred] of checks) {
    const s = run(name);
    if (pred(s)) ok(`${name} → scored gap names the defect`);
    else fail(`${name} scored gap`, JSON.stringify(s.gaps));
  }
}

// ---------------------------------------------------------- gate coverage (GATE-COV)
function testGateCoverage() {
  process.stdout.write("\nUNIT — every approval gate is test-locked (GATE-COV)\n");
  const { sampleState } = require("./lib/adapter-contract");
  const base = sampleState();
  const sensitive = Object.assign(sampleState(), { sensitive: { signals: ["health"], escalate: true } });
  const mobile = Object.assign(sampleState(), { platform: "mobile" });
  const G = (n, st, prof) => require(`./modules/${n}`).plan(st, prof || "web-saas").gates || [];
  const checks = [
    ["prod-db-migration", G("database", base)],
    ["stripe-live", G("payments", base)],
    ["app-store-submit", G("payments", mobile, "mobile-app")],
    ["email-real-users", G("crm", base)],
    ["domain-dns", G("deployment", base)],
    ["app-store-submit", G("deployment", mobile, "mobile-app")],
    ["publish-legal-docs", G("security", base)],
    ["collect-sensitive-data", G("security", sensitive)],
  ];
  for (const [gate, gates] of checks) {
    if (gates.includes(gate)) ok(`gate "${gate}" surfaces on its triggering state`);
    else fail(`gate ${gate}`, `not surfaced; got ${JSON.stringify(gates)}`);
  }
  const secSteps = require("./modules/security").plan(sensitive, "web-saas").steps;
  if (secSteps.some((s) => /HARD STOP/i.test(s))) ok("security.plan() emits the HARD STOP step on sensitive data");
  else fail("HARD STOP step", JSON.stringify(secSteps.slice(0, 1)));
  const mobilePaymentGates = G("payments", mobile, "mobile-app");
  if (!mobilePaymentGates.includes("stripe-live")) ok("mobile payments do not surface stripe-live for platform billing");
  else fail("mobile payment gates", JSON.stringify(mobilePaymentGates));
}

// ---------------------------------------------------------- arg validation (LM-NEW-2)
function testArgsHardening() {
  process.stdout.write("\nUNIT — arg validation before side effects (LM-NEW-2)\n");
  const P = (extra) => driver.parseArgs(["node", "orchestrate.js", ...extra]);
  if (P(["--dryrun"]).error) ok("parseArgs rejects an unknown flag (--dryrun typo)");
  else fail("unknown flag", "should error");
  if (P(["--state", "--json"]).error) ok("parseArgs rejects a flag-looking value (--state --json)");
  else fail("missing value", "should error");
  if (P(["--repo-root"]).error) ok("parseArgs rejects a value flag with no value");
  else fail("no value", "should error");
  const good = P(["--phase", "audit", "--resume", "--json"]);
  if (!good.error && good.phase === "audit" && good.resume && good.json) ok("parseArgs accepts a valid mix");
  else fail("valid mix", JSON.stringify(good));
}

// ---------------------------------------------------------- resume guard (LM-NEW-1)
function testResumeGuard() {
  process.stdout.write("\nUNIT — resolveResume never fires with --phase (LM-NEW-1)\n");
  const st = { completed: ["preflight"], awaiting: "inject", phases: {} };
  const changed = driver.resolveResume({ resume: true, phase: "audit" }, st);
  if (!changed && st.awaiting === "inject" && !st.completed.includes("inject"))
    ok("--resume + --phase does NOT consume the awaiting orchestration marker");
  else fail("resume guard", JSON.stringify({ changed, st }));
}

// ---------------------------------------------------------- corrupt state (LM-NEW-3)
function testCorruptState() {
  process.stdout.write("\nUNIT — corrupt state quarantined, not silently reset (LM-NEW-3)\n");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lastmile-corrupt-"));
  const sf = path.join(tmp, "s.json");
  fs.writeFileSync(sf, "{ not valid json", "utf8");
  const st = driver.loadState({ state: sf });
  const quarantined = fs.readdirSync(tmp).some((f) => f.includes(".corrupt-"));
  if (st._corrupt === true && quarantined && st.completed.length === 0)
    ok("loadState quarantines corrupt state + flags _corrupt + returns fresh");
  else fail("corrupt state", JSON.stringify({ corrupt: st._corrupt, files: fs.readdirSync(tmp) }));
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ------------------------------------------------ main() arg-order, end-to-end (LM-NEW-1 integration)
// LM-NEW-1 was an ORDER bug in main(); the unit guards cover the pieces, this locks
// the wiring: a bad --phase + --resume must exit 2 and leave durable state untouched.
function testMainArgOrder() {
  process.stdout.write("\nE2E — main() validates --phase BEFORE any state write (LM-NEW-1 integration)\n");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lastmile-argorder-"));
  const sf = path.join(tmp, "s.json");
  const seeded = { schema: "mc/bootstrap/lastmile-state/v1", completed: ["preflight", "audit", "plan"], awaiting: "inject", phases: {} };
  fs.writeFileSync(sf, JSON.stringify(seeded), "utf8");
  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, "orchestrate.js"), "--resume", "--phase", "injcet", "--state", sf, "--repo-root", tmp],
    { encoding: "utf8" },
  );
  const after = JSON.parse(fs.readFileSync(sf, "utf8"));
  if (r.status === 2 && after.awaiting === "inject" && !after.completed.includes("inject"))
    ok("bad --phase + --resume exits 2 with durable state UNTOUCHED (marker not consumed)");
  else fail("main arg-order", `exit=${r.status} awaiting=${after.awaiting} completed=${JSON.stringify(after.completed)}`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

(async () => {
  testDriver();
  await testPreflight();
  testFixtures();
  await testDeclaredStack();
  testScore();
  testScoredGaps();
  testAdapters();
  testGateRegistry();
  testGateCoverage();
  testResume();
  testResumeGuard();
  testArgsHardening();
  testCorruptState();
  testMainArgOrder();
  await testChain();
  process.stdout.write(`\nlastmile-orchestrate test: ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
