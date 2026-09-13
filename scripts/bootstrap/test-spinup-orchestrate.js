#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";
/**
 * scripts/bootstrap/test-spinup-orchestrate.js — per-step seam + anti-degrade +
 * headless-contract test for the step-driven bootstrap:spinup orchestrator
 * (MC-PROMPT §7). The named enforcer of the consumer dispatch contract.
 *
 * Proves WITHOUT real research spend and WITHOUT a degrade shortcut:
 *   - driver: planSteps (default/positional/--resume) + phase-state round-trip + seedCarry.
 *   - setup (headless): structured intake (--name/--what/--who) → done, NO interactive
 *     prompt, NO exit-3 dead-end, valid data; missing intent source → failed (clear).
 *   - canon (anti-degrade): thin canon → needs_orchestration (synthesis handoff);
 *     synthesized canon → done; raw {{token}} → failed; fail-closed on empty dir;
 *     --allow-needs-input audits a single field.
 *   - roadmap: bare canon → needs_orchestration; grounded ROADMAP.md → done.
 *   - paint.verifyServe: build-clean + HTTP 200 → pass; build-clean + non-200 →
 *     FAIL ("builds != serves"); paint.run → needs_orchestration (no --auto).
 *   - REJECTED: `--research off` and any degrade alias (light/auto/fast) exit non-zero.
 *   - headless --json: LLM steps emit a parseable status with orchestration_prompt.
 *
 * Exit 0 = all pass, 1 = any failure.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const FIXTURE = path.join(REPO, "scripts", "canon", "fixtures", "acme-intent.md");
const ORCH = path.join(REPO, "scripts", "bootstrap", "spinup-orchestrate.js");
const driver = require("./spinup-orchestrate");
const setup = require("./phases/setup");
const canon = require("./phases/canon");
const roadmap = require("./phases/roadmap");
const paint = require("./phases/paint");
const { NARRATIVE, STRUCTURED } = require("../canon/generate");
const EXPECTED_CANON_ARTIFACTS = NARRATIVE.length + STRUCTURED.length;

let passed = 0;
let failed = 0;
function ok(n) { passed++; process.stdout.write(`  ok    ${n}\n`); }
function fail(n, d) { failed++; process.stdout.write(`  FAIL  ${n}\n`); if (d) process.stdout.write(`        ${d}\n`); }

function mkctx(over) {
  return Object.assign(
    { repoRoot: REPO, product: "Acme", intentFile: null, cloneTarget: null, outDir: "_requirements/00-canonical", research: "simple", dryRun: false, args: {}, allowNeedsInput: [], log: () => {} },
    over,
  );
}

// ---------------------------------------------------------- driver
function testDriver() {
  process.stdout.write("\nUNIT — driver (spinup-orchestrate.js)\n");
  const fresh = { completed: [], phases: {} };
  const all = driver.planSteps({ step: null, resume: false }, fresh);
  if (JSON.stringify(all.steps) === JSON.stringify(driver.STEPS)) ok("default plans all 4 steps in order");
  else fail("default plan", JSON.stringify(all));

  const single = driver.planSteps({ step: "canon", resume: false }, fresh);
  if (single.steps.length === 1 && single.steps[0] === "canon") ok("positional <step> runs JUST that step (independent)");
  else fail("single-step plan", JSON.stringify(single));

  const resumed = driver.planSteps({ step: null, resume: true }, { completed: ["setup", "canon"], phases: {} });
  if (!resumed.steps.includes("canon") && resumed.steps[0] === "roadmap" && resumed.steps.includes("paint"))
    ok("--resume continues after last completed step");
  else fail("--resume plan", JSON.stringify(resumed));

  const carry = driver.seedCarry({ completed: ["setup"], phases: { setup: { data: { intentFile: "_docs/briefs/x/x.brief.md", platform: "ios" } } } });
  if (carry.intentFile && carry.platform === "ios") ok("seedCarry threads setup output to later steps");
  else fail("seedCarry", JSON.stringify(carry));

  // state round-trip
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "spinup-state-"));
  const args = { state: path.join(tmp, "s.json"), dryRun: false };
  const st = driver.loadState(args);
  st.completed.push("setup");
  driver.saveState(args, st);
  const re = driver.loadState(args);
  if (re.completed.includes("setup")) ok("phase-state persists + reloads (--resume durability)");
  else fail("state round-trip", JSON.stringify(re));
  fs.rmSync(tmp, { recursive: true, force: true });

  // normalizeData always carries the stable consumer-contract keys
  const nd = driver.normalizeData({ roadmapPath: "ROADMAP.md" });
  if ("serveUrl" in nd && "firstAction" in nd && nd.roadmapPath === "ROADMAP.md") ok("normalizeData carries {serveUrl,firstAction,roadmapPath}");
  else fail("normalizeData", JSON.stringify(nd));
}

// ---------------------------------------------------------- setup (headless, deterministic)
async function testSetup() {
  process.stdout.write("\nUNIT — setup step (deterministic, headless)\n");
  // A temp repo that LOOKS installed (has .claude + package.json) so setup goes
  // in-place and writes the brief there — never touches canonical.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "spinup-setup-"));
  fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "package.json"), "{}\n");

  const passCheck = () => ({ code: 0, stdout: "", stderr: "" });
  const r1 = await setup.run(mkctx({
    repoRoot: tmp,
    product: "Acme",
    name: "Acme",
    what: "do X",
    who: "people",
    framework: "Next.js",
    database: "Supabase",
    auth: "Clerk",
    payments: "Stripe",
    hosting: "Vercel",
    analytics: "PostHog",
    args: { _runCheck: passCheck },
  }));
  if (r1.ok && r1.status === "done" && r1.data && r1.data.intentFile && r1.data.mode === "structured")
    ok("setup: structured --name/--what/--who → done (no interactive prompt)");
  else fail("setup structured", JSON.stringify(r1));

  const briefText = r1.data && r1.data.intentFile
    ? fs.readFileSync(path.join(tmp, r1.data.intentFile), "utf8")
    : "";
  if (/## Tech Stack/.test(briefText) && /Framework: Next\.js/.test(briefText) && /Analytics: PostHog/.test(briefText))
    ok("setup: structured stack intake captured in founding brief");
  else fail("setup stack intake", briefText.slice(0, 400));

  // idempotent: 2nd run reuses the brief, still done
  const r2 = await setup.run(mkctx({ repoRoot: tmp, product: "Acme", args: { _runCheck: passCheck } }));
  if (r2.ok && r2.status === "done" && (r2.data.mode === "brief-reuse" || r2.data.mode === "structured")) ok("setup: 2nd run idempotent (reuses brief)");
  else fail("setup idempotent", JSON.stringify(r2));

  // missing intent source → failed (deterministic; NOT needs_orchestration / NOT exit-3)
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "spinup-setup2-"));
  fs.mkdirSync(path.join(tmp2, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(tmp2, "package.json"), "{}\n");
  const r3 = await setup.run(mkctx({ repoRoot: tmp2, product: "Zzz", args: { _runCheck: passCheck } }));
  if (!r3.ok && r3.status === "failed" && /intent source/.test(r3.message)) ok("setup: no intent source → failed (no exit-3 dead-end)");
  else fail("setup no-source", JSON.stringify(r3));

  // preflight gate: gappy install → failed
  const r4 = await setup.run(mkctx({ repoRoot: tmp, product: "Acme", args: { _runCheck: () => ({ code: 1, stdout: "", stderr: "" }) } }));
  if (!r4.ok && r4.status === "failed" && /install incomplete|scan:install/.test(r4.message)) ok("setup: preflight REFUSES gappy install");
  else fail("setup preflight", JSON.stringify(r4));

  // bad --where → failed
  const r5 = await setup.run(mkctx({ repoRoot: tmp, product: "Acme", where: "playstation", args: { _runCheck: passCheck } }));
  if (!r5.ok && /bad --where/.test(r5.message)) ok("setup: bad --where → failed");
  else fail("setup bad-where", JSON.stringify(r5));

  // good --where threaded into data + brief
  const r6 = await setup.run(mkctx({ repoRoot: tmp, product: "Acme", name: "Acme", what: "x", who: "y", where: "ios", args: { _runCheck: passCheck } }));
  if (r6.ok && r6.data.platform === "ios") ok("setup: --where ios recorded in data (web/PWA baseline)");
  else fail("setup where-ios", JSON.stringify(r6));

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(tmp2, { recursive: true, force: true });
}

// ---------------------------------------------------------- canon (anti-degrade)
function fillNeedsInput(dir) {
  for (const f of fs.readdirSync(dir)) {
    if (!/\.(md|json)$/.test(f)) continue;
    const p = path.join(dir, f);
    let body = fs.readFileSync(p, "utf8");
    body = body.replace(/\*needs input:\s*([a-zA-Z0-9_]+)\s*\*/g, (_m, field) => `Synthesized ${field} substance.`);
    fs.writeFileSync(p, body, "utf8");
  }
}

async function testCanon() {
  process.stdout.write("\nUNIT — canon step (anti-degrade fail-closed gate)\n");
  if (!fs.existsSync(FIXTURE)) { fail("fixture present", FIXTURE); return; }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "spinup-canon-"));
  const outRel = path.relative(REPO, out);

  // thin canon → needs_orchestration (synthesis handoff; gate has needs-input)
  const c1 = await canon.run(mkctx({ intentFile: FIXTURE, outDir: outRel, product: "Acme" }));
  if (c1.status === "needs_orchestration" && Array.isArray(c1.data.needs_input) && c1.data.needs_input.length > 0 && c1.orchestration_prompt)
    ok(`canon: thin intent → needs_orchestration (${c1.data.needs_input.length} fields, prompt present)`);
  else fail("canon thin", JSON.stringify(c1).slice(0, 300));

  const emitted = fs.existsSync(path.join(out, "CORE_BRIEF.md"));
  if (emitted) ok(`canon: ${EXPECTED_CANON_ARTIFACTS}-artifact scaffold on disk`);
  else fail("canon disk", "CORE_BRIEF.md missing");

  // simulate AI synthesis (fill markers) → re-run → gate clean → done. NO re-render
  // clobber (artifacts present → skip generate).
  fillNeedsInput(out);
  const c2 = await canon.run(mkctx({ intentFile: FIXTURE, outDir: outRel, product: "Acme" }));
  if (c2.ok && c2.status === "done") ok("canon: synthesized canon → done (gate clean, no clobber)");
  else fail("canon synthesized", JSON.stringify(c2).slice(0, 300));

  // raw {{token}} injected → failed
  const cb = fs.readFileSync(path.join(out, "CORE_BRIEF.md"), "utf8");
  fs.writeFileSync(path.join(out, "CORE_BRIEF.md"), cb + "\nLeak: {{vision}}\n");
  const c3 = await canon.run(mkctx({ intentFile: FIXTURE, outDir: outRel, product: "Acme" }));
  if (!c3.ok && c3.status === "failed" && /raw unfilled tokens/.test(c3.message)) ok("canon: raw {{token}} → failed (engine-bug gate)");
  else fail("canon raw-token", JSON.stringify(c3).slice(0, 300));

  // fail-closed on empty dir
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "spinup-canon-empty-"));
  const g = canon.runGate(REPO, empty);
  if (g.code === 2) ok("canon gate: empty dir → fail-closed (exit 2)");
  else fail("canon gate empty", JSON.stringify(g));
  fs.rmSync(empty, { recursive: true, force: true });

  const noStack = fs.mkdtempSync(path.join(os.tmpdir(), "spinup-canon-no-stack-"));
  fs.writeFileSync(path.join(noStack, "DATA_AND_ACCOUNTS.md"), "# Acme\n\n## Data Model\nx\n", "utf8");
  const sg = canon.runTechStackGate(REPO, noStack);
  if (sg.code === 1 && sg.errors.some((e) => /Tech Stack/.test(e))) ok("canon tech-stack gate: missing block => failed");
  else fail("canon tech-stack missing", JSON.stringify(sg));
  fs.rmSync(noStack, { recursive: true, force: true });

  // --allow-needs-input audits a single field: full canon, all synthesized EXCEPT
  // one genuinely-external field, allow-listed → done (artifacts present → no re-render).
  const aud = fs.mkdtempSync(path.join(os.tmpdir(), "spinup-canon-aud-"));
  await canon.run(mkctx({ intentFile: FIXTURE, outDir: aud, product: "Acme" })); // generate the 12-artifact scaffold
  fillNeedsInput(aud); // synthesize every field
  fs.appendFileSync(path.join(aud, "CORE_BRIEF.md"), "\nDUNS: *needs input: dunsNumber*\n"); // one external field remains
  const c4 = await canon.run(mkctx({ intentFile: FIXTURE, outDir: aud, product: "Acme", allowNeedsInput: ["dunsNumber"] }));
  if (c4.ok && c4.status === "done" && Array.isArray(c4.data.audited_needs_input) && c4.data.audited_needs_input.length === 1)
    ok("canon: --allow-needs-input audits a genuinely-external single field → done");
  else fail("canon allow-needs-input", JSON.stringify(c4).slice(0, 300));
  fs.rmSync(aud, { recursive: true, force: true });

  fs.rmSync(out, { recursive: true, force: true });
}

// ---------------------------------------------------------- roadmap
async function testRoadmap() {
  process.stdout.write("\nUNIT — roadmap step\n");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "spinup-rm-"));
  // seed the canon grounding docs the roadmap step requires
  fs.writeFileSync(path.join(out, "CORE_BRIEF.md"), "# Brief\nReal product.\n");
  fs.writeFileSync(path.join(out, "GOLDEN_PATHS.md"), "# Paths\nReal path.\n");
  const repoTmp = fs.mkdtempSync(path.join(os.tmpdir(), "spinup-rmrepo-"));

  const r1 = await roadmap.run(mkctx({ repoRoot: repoTmp, outDir: path.relative(repoTmp, out) === "" ? out : out, product: "Acme" }));
  // (outDir is absolute here; canonDir handles absolute) — bare canon → needs_orchestration
  if (r1.status === "needs_orchestration" && r1.orchestration_prompt && /roadmap:create/.test(r1.orchestration_prompt) && /[Ee]pic/.test(r1.orchestration_prompt))
    ok("roadmap: bare canon → needs_orchestration (roadmap:create, EPIC-worded)");
  else fail("roadmap bare", JSON.stringify(r1).slice(0, 300));

  // grounded ROADMAP.md (epics + ledger anchor) → done
  fs.writeFileSync(path.join(repoTmp, "ROADMAP.md"), "# R\n## Epics\n### E-1\n## Sprints\n<!-- ledger:sprints -->\n");
  const r2 = await roadmap.run(mkctx({ repoRoot: repoTmp, outDir: out, product: "Acme" }));
  if (r2.ok && r2.status === "done" && r2.data.grounded) ok("roadmap: grounded epics+ledger ROADMAP.md → done");
  else fail("roadmap grounded", JSON.stringify(r2).slice(0, 300));

  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(repoTmp, { recursive: true, force: true });
}

// ---------------------------------------------------------- paint verify-before-claim
async function testPaint() {
  process.stdout.write("\nUNIT — paint verify-before-claim (builds != serves)\n");
  const okGet = async () => ({ status: 200 });
  const badGet = async () => ({ status: 500 });
  const okRun = () => ({ code: 0, stdout: "", stderr: "" });

  const a = await paint.verifyServe({ buildCmd: "build", serveUrl: "http://localhost:1", entryModule: null, cwd: ".", runCmd: okRun, httpGet: okGet });
  if (a.pass) ok("serve gate: build clean + HTTP 200 → pass");
  else fail("serve pass", JSON.stringify(a));

  const b = await paint.verifyServe({ buildCmd: "build", serveUrl: "http://localhost:1", entryModule: null, cwd: ".", runCmd: okRun, httpGet: badGet });
  if (!b.pass) ok("serve gate: build clean but HTTP != 200 → FAIL (builds != serves)");
  else fail("serve builds-not-serves", JSON.stringify(b));

  // run() is product-side, no --auto self-complete → needs_orchestration
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "spinup-paint-"));
  fs.writeFileSync(path.join(tmp, "package.json"), "{}\n"); // skip scaffold net
  const rr = await paint.run(mkctx({ repoRoot: tmp }));
  if (rr.status === "needs_orchestration" && !/auto/i.test(JSON.stringify(rr))) ok("paint.run: product-side (needs_orchestration; no --auto path)");
  else fail("paint run", JSON.stringify(rr).slice(0, 200));
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------- anti-degrade CLI contract
function testResearchRejection() {
  process.stdout.write("\nUNIT — anti-degrade: --research off + degrade aliases REJECTED non-zero\n");
  for (const bad of ["off", "light", "none", "auto", "fast"]) {
    const r = spawnSync(process.execPath, [ORCH, "--research", bad], { cwd: REPO, encoding: "utf8" });
    if (r.status === 2) ok(`--research ${bad} → exit 2 (rejected)`);
    else fail(`--research ${bad}`, `exit ${r.status}`);
  }
  // valid modes accepted by the parser (deep is the opt-up; simple the floor)
  if (driver.RESEARCH_MODES.join(",") === "simple,deep" && driver.DEFAULT_RESEARCH === "simple")
    ok("RESEARCH_MODES = simple,deep; DEFAULT = simple (floor)");
  else fail("research modes", JSON.stringify(driver.RESEARCH_MODES));
  // bad step → exit 2
  const bs = spawnSync(process.execPath, [ORCH, "badstep"], { cwd: REPO, encoding: "utf8" });
  if (bs.status === 2) ok("unknown <step> → exit 2");
  else fail("bad step exit", `exit ${bs.status}`);
}

// ---------------------------------------------------------- headless --json contract
function testHeadlessJson() {
  process.stdout.write("\nUNIT — headless --json status (consumer dispatch contract)\n");
  // canon step standalone with --json → a parseable needs_orchestration status with
  // an orchestration_prompt, paired with the exit-3 contract signal. --repo-root is
  // REPO (canon shells to REPO/scripts/canon/generate.js); --out + --state are temp
  // so canonical is never polluted.
  const outTmp = fs.mkdtempSync(path.join(os.tmpdir(), "spinup-hl-out-"));
  const stateTmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "spinup-hl-st-")), "s.json");
  const r = spawnSync(process.execPath, [ORCH, "canon", "--repo-root", REPO, "--intent", FIXTURE, "--product", "Acme", "--out", outTmp, "--state", stateTmp, "--json"], { cwd: REPO, encoding: "utf8" });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* */ }
  if (parsed && parsed.status === "needs_orchestration" && parsed.orchestration_prompt && parsed.phase === "canon" && parsed.data && "serveUrl" in parsed.data)
    ok("canon --json: parseable needs_orchestration status w/ orchestration_prompt + stable data shape");
  else fail("headless canon json", `exit ${r.status} body=${(r.stdout || r.stderr || "").slice(0, 240)}`);
  if (r.status === driver.NEEDS_ORCH) ok("canon --json: exit 3 (needs_orchestration signal)");
  else fail("headless canon exit", `exit ${r.status}`);
  fs.rmSync(outTmp, { recursive: true, force: true });
}

(async () => {
  testDriver();
  await testSetup();
  await testCanon();
  await testRoadmap();
  await testPaint();
  testResearchRejection();
  testHeadlessJson();
  process.stdout.write(`\nspinup-orchestrate test: ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
})();
