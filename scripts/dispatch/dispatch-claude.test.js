#!/usr/bin/env node
/**
 * dispatch-claude.test.js — torture test for the RI-004 / ED-018 reap fix.
 *
 * Deterministically reproduces a builder reap WITHOUT requiring the real
 * `claude` CLI, by pointing DISPATCH_CLAUDE_BIN at a fake node script and
 * isolating the ledger to a temp dir via DISPATCH_LEDGER_DIR.
 *
 * Fixtures:
 *   1. timeout reap   — fake sleeps past the bound → killed → death record + exit≠0
 *   2. zero-byte reap — fake exits 0 with NO stdout (the ED-018 signature) → death + exit≠0
 *   3. happy path     — fake prints output → ok:true completion, NO death, exit 0
 *                       AND gauntlet-verify({roles:["builder"]}) greens on the record
 *   4. worktree guard — happy run with --worktree <tmp>: records land in the
 *                       canonical/test ledger, NEVER in the worktree (ED-016 class)
 *
 * Run: node scripts/dispatch/dispatch-claude.test.js
 * Exit 0 = all pass; 1 = any failure.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { verifyGauntlet } = require("./gauntlet-verify");
const { evaluate: coverageEvaluate } = require("./coverage-gate");

const DISPATCH_CLAUDE = path.join(__dirname, "..", "dispatch-claude.js");
const REPO_ROOT = path.resolve(__dirname, "..", ".."); // == the wrapper's AGENT_ROOT

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL ${name}\n       ${e && e.message ? e.message : e}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

// ── Scratch dir + fixtures ──────────────────────────────────
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-claude-test-"));
function cleanup() {
  try {
    fs.rmSync(scratch, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
process.on("exit", cleanup);

// Fake claude bins (node scripts; ignore their argv, act out a scenario).
const fakeTimeout = path.join(scratch, "fake-timeout.js");
fs.writeFileSync(fakeTimeout, "setTimeout(() => process.exit(0), 30000);\n");
const fakeZero = path.join(scratch, "fake-zero.js");
fs.writeFileSync(fakeZero, "process.exit(0);\n"); // exits clean, emits nothing
const fakeHappy = path.join(scratch, "fake-happy.js");
fs.writeFileSync(
  fakeHappy,
  'process.stdout.write(JSON.stringify({ agent: "builder", ok: true, findings: [] }));\n',
);
const fakeWhitespace = path.join(scratch, "fake-ws.js");
fs.writeFileSync(fakeWhitespace, 'process.stdout.write("   \\n  \\t\\n");\n'); // exit 0, only whitespace

const promptFile = path.join(scratch, "prompt.txt");
fs.writeFileSync(promptFile, "Build the thing per spec.\n");

// Run the wrapper as a subprocess with an isolated ledger + fake bin.
// iso: "w" (default, forwards -w) | "worktree:<path>" | "none" (no isolation flag)
// role: role to dispatch (default "builder" for backward compat with all existing tests)
function runWrapper({ fake, ledgerDir, extraArgs = [], timeoutMs, iso = "w", role = "builder" }) {
  fs.mkdirSync(ledgerDir, { recursive: true });
  const env = {
    ...process.env,
    DISPATCH_LEDGER_DIR: ledgerDir,
    DISPATCH_CLAUDE_BIN: process.execPath, // node
    DISPATCH_CLAUDE_BIN_ARGS: JSON.stringify([fake]),
  };
  if (timeoutMs) env.DISPATCH_BUILDER_TIMEOUT_MS = String(timeoutMs);
  const isoArgs =
    iso === "w" ? ["-w"] : iso.startsWith("worktree:") ? ["--worktree", iso.slice(9)] : [];
  const res = spawnSync(
    process.execPath,
    [DISPATCH_CLAUDE, role, promptFile, "--model", "sonnet", ...isoArgs, ...extraArgs],
    { env, encoding: "utf8", timeout: 60000 },
  );
  return res;
}

function readLedger(ledgerDir, name) {
  const f = path.join(ledgerDir, name);
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

// BE-2 (SP-20260718-005 / ED-069): every real dispatch now ALSO writes a
// write-ahead started-row (phase:"started", ok:false) to the SAME
// dispatch-completions ledger, before the terminal record. Tests that care
// about "the completion record" must filter it out — a started row is never
// a completion (isWellFormedOkRecord requires ok===true), so this is a
// correctness fix to the test's own record-shape assumption, not a workaround.
function completionsOnly(records) {
  return records.filter((r) => r.phase !== "started");
}

// ── 1. Timeout reap ─────────────────────────────────────────
test("timeout reap → exit≠0 + builder_timeout_reap death + ok:false completion", () => {
  const ledger = path.join(scratch, "l1");
  const res = runWrapper({ fake: fakeTimeout, ledgerDir: ledger, timeoutMs: 500 });
  assert(res.status !== 0, `expected non-zero exit, got ${res.status}`);
  const deaths = readLedger(ledger, "dispatch-deaths.jsonl");
  assert(
    deaths.some((d) => d.reason === "builder_timeout_reap" && d.role === "builder"),
    `expected a builder_timeout_reap death record, got ${JSON.stringify(deaths)}`,
  );
  const comps = completionsOnly(readLedger(ledger, "dispatch-completions.jsonl"));
  assert(comps.length === 1 && comps[0].ok === false, "expected one ok:false completion record");
});

// ── 2. Zero-byte reap ───────────────────────────────────────
test("zero-byte reap → exit≠0 + builder_zero_byte_reap death (even on exit 0)", () => {
  const ledger = path.join(scratch, "l2");
  const res = runWrapper({ fake: fakeZero, ledgerDir: ledger });
  assert(res.status !== 0, `expected non-zero exit, got ${res.status}`);
  const deaths = readLedger(ledger, "dispatch-deaths.jsonl");
  assert(
    deaths.some((d) => d.reason === "builder_zero_byte_reap"),
    `expected a builder_zero_byte_reap death record, got ${JSON.stringify(deaths)}`,
  );
  const comps = completionsOnly(readLedger(ledger, "dispatch-completions.jsonl"));
  assert(comps.length === 1 && comps[0].ok === false, "expected one ok:false completion record");
});

// ── 3. Happy path + gauntlet-verify greens ──────────────────
test("happy path → exit 0 + ok:true well-formed completion + NO death", () => {
  const ledger = path.join(scratch, "l3");
  const res = runWrapper({ fake: fakeHappy, ledgerDir: ledger });
  assert(res.status === 0, `expected exit 0, got ${res.status} (stderr: ${res.stderr})`);
  const deaths = readLedger(ledger, "dispatch-deaths.jsonl");
  assert(deaths.length === 0, `expected NO death records, got ${JSON.stringify(deaths)}`);
  const allRecs = readLedger(ledger, "dispatch-completions.jsonl");
  const comps = completionsOnly(allRecs);
  assert(comps.length === 1 && comps[0].ok === true, "expected one ok:true completion record");
  assert(comps[0].provider === "claude" && comps[0].role === "builder", "record fields wrong");

  // End-to-end: gauntlet-verify must GREEN on the builder record.
  const v = verifyGauntlet({
    roles: ["builder"],
    completionsFile: path.join(ledger, "dispatch-completions.jsonl"),
    since: comps[0].started_at,
  });
  assert(v.ok === true, `gauntlet-verify should pass on a real builder record: ${JSON.stringify(v.roles)}`);
  assert(v.roles[0].status === "ran", `expected builder status 'ran', got '${v.roles[0].status}'`);
});

// ── 3b. BE-2 (ED-069/ED-070): started-row + quota wiring, correlated by dispatch_id ──
test("BE-2: a written-ahead started-row precedes the completion, correlated by dispatch_id; completion carries quota", () => {
  const ledger = path.join(scratch, "l3"); // reuse the happy-path ledger from test 3
  const allRecs = readLedger(ledger, "dispatch-completions.jsonl");
  const started = allRecs.filter((r) => r.phase === "started");
  const comps = completionsOnly(allRecs);
  assert(started.length === 1, `expected exactly one started-row, got ${JSON.stringify(started)}`);
  assert(started[0].ok === false, "a started-row must never carry ok:true");
  assert(
    started[0].dispatch_id && started[0].dispatch_id === comps[0].dispatch_id,
    "started-row and completion must correlate by the SAME dispatch_id",
  );
  assert(started[0].role === "builder" && started[0].provider === "claude", "started-row role/provider must match the dispatch");
  assert(allRecs.indexOf(started[0]) < allRecs.indexOf(comps[0]), "the started-row must be written BEFORE the completion");
  assert(
    comps[0].quota && typeof comps[0].quota === "object" && typeof comps[0].quota.known === "boolean",
    `completion must carry a quota fragment, got ${JSON.stringify(comps[0].quota)}`,
  );
});

// ── 4. gauntlet-verify RED's when builder never ran (the reap, weaponized) ──
test("no builder record → gauntlet-verify FAILS (absence is the death signal)", () => {
  const ledger = path.join(scratch, "l3"); // reuse l3 but verify a DIFFERENT window
  // A window in the far past where no builder ran → no-record → RED.
  const v = verifyGauntlet({
    roles: ["builder"],
    completionsFile: path.join(ledger, "dispatch-completions.jsonl"),
    since: "2020-01-01T00:00:00.000Z",
    until: "2020-01-02T00:00:00.000Z",
  });
  assert(v.ok === false, "gauntlet-verify must RED when builder has no in-window record");
  assert(v.roles[0].status === "no-record", `expected 'no-record', got '${v.roles[0].status}'`);
});

// ── 5. Worktree guard (ED-016 class) ────────────────────────
test("worktree run → records land in canonical/test ledger, NOT the worktree", () => {
  const ledger = path.join(scratch, "l5");
  const worktree = path.join(scratch, "wt");
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(worktree, ".git"), "gitdir: /fake/.git/worktrees/wt\n"); // a real worktree has a .git link
  const res = runWrapper({
    fake: fakeHappy,
    ledgerDir: ledger,
    iso: `worktree:${worktree}`,
  });
  assert(res.status === 0, `expected exit 0, got ${res.status}`);
  const comps = completionsOnly(readLedger(ledger, "dispatch-completions.jsonl"));
  assert(comps.length === 1 && comps[0].ok === true, "record should be in the test ledger");
  // The worktree must NOT have grown its own runtime ledger.
  const leaked = path.join(worktree, ".claude", "runtime", "dispatch-completions.jsonl");
  assert(!fs.existsSync(leaked), "record LEAKED into the worktree (ED-016 regression)");
});

// ── 6. Whitespace-only stdout is NOT a success (reviewer-HIGH false-green) ──
test("whitespace-only stdout → exit≠0 + zero_byte_reap (no false-green)", () => {
  const ledger = path.join(scratch, "l6");
  const res = runWrapper({ fake: fakeWhitespace, ledgerDir: ledger });
  assert(res.status !== 0, `whitespace-only output must NOT be success, got exit ${res.status}`);
  const comps = completionsOnly(readLedger(ledger, "dispatch-completions.jsonl"));
  assert(comps.length === 1 && comps[0].ok === false, "expected ok:false completion");
  const deaths = readLedger(ledger, "dispatch-deaths.jsonl");
  assert(
    deaths.some((d) => d.reason === "builder_zero_byte_reap"),
    `expected zero_byte_reap death for whitespace-only, got ${JSON.stringify(deaths)}`,
  );
});

// ── 7. Build role with NO isolation → refused (reviewer-CRITICAL) ──
test("build role without -w/--worktree → exit 2, refuses to run in canonical", () => {
  const ledger = path.join(scratch, "l7");
  const res = runWrapper({ fake: fakeHappy, ledgerDir: ledger, iso: "none" });
  assert(res.status === 2, `expected usage exit 2 (isolation required), got ${res.status}`);
  // No dispatch happened → no completion record written.
  const comps = readLedger(ledger, "dispatch-completions.jsonl");
  assert(comps.length === 0, "no record should be written when isolation is refused");
});

// ── 8. --worktree = canonical root → refused (reviewer-CRITICAL ×2) ──
test("--worktree <canonical root> → exit 2 (cannot pass canonical off as a worktree)", () => {
  const ledger = path.join(scratch, "l8");
  const res = runWrapper({ fake: fakeHappy, ledgerDir: ledger, iso: `worktree:${REPO_ROOT}` });
  assert(res.status === 2, `expected exit 2 for --worktree=canonical, got ${res.status}`);
  const comps = readLedger(ledger, "dispatch-completions.jsonl");
  assert(comps.length === 0, "no record when canonical is refused as worktree");
});

// ── 9. --worktree = non-worktree subdir (no .git link) → refused ──
test("--worktree <subdir without .git> → exit 2 (not a real worktree)", () => {
  const ledger = path.join(scratch, "l9");
  const subdir = path.join(REPO_ROOT, "scripts"); // exists, but no own .git link
  const res = runWrapper({ fake: fakeHappy, ledgerDir: ledger, iso: `worktree:${subdir}` });
  assert(res.status === 2, `expected exit 2 for non-worktree subdir, got ${res.status}`);
  const comps = readLedger(ledger, "dispatch-completions.jsonl");
  assert(comps.length === 0, "no record when a plain subdir is refused");
});

// ── 10. G1: generic build id 'builder' → advisory is TRUTHFUL ──────────────────
test("G1: generic build id 'builder' advisory is truthful — no '(fail-closed)' lie", () => {
  const ledger = path.join(scratch, "l10");
  const res = runWrapper({ fake: fakeHappy, ledgerDir: ledger });
  // Dispatch must still succeed — proceed-on-advisory default is unchanged (W0).
  assert(res.status === 0, `expected exit 0 after G1 fix, got ${res.status} (stderr: ${(res.stderr || "").slice(0, 500)})`);
  // G1 PLANTED VIOLATION: the OLD advisory said "(fail-closed)" for 'builder' — that was a lie.
  // After the fix, the advisory must NOT contain "(fail-closed)".
  // If this assertion fails, it means the GENERIC_BUILD_IDS re-route was not applied.
  assert(
    !(res.stderr || "").includes("(fail-closed)"),
    `G1 REGRESSION: advisory still says '(fail-closed)' for generic build id 'builder'. stderr: ${(res.stderr || "").slice(0, 500)}`,
  );
  // The record must still be written correctly.
  const comps = completionsOnly(readLedger(ledger, "dispatch-completions.jsonl"));
  assert(comps.length === 1 && comps[0].ok === true, "completion record must still be ok:true after G1 fix");
});

// ── 11. review-fallback happy path ─────────────────────────
// The review-fallback lane applies to the cross_provider_reviewer class ONLY. The role
// is REGISTRY-DERIVED, not a literal: the operator ruling of 2026-08-18 re-pinned
// backend-reviewer (the former subject) to claude, which moved it to the
// claude_pinned_reviewer class — a class the lane does not cover, so the wrapper now
// (correctly) refuses it. Resolve a live cross_provider_reviewer and expect the
// fallback-origin stamp to carry THAT role's registry provider (not a literal "openai").
const { classForRole: _classForRole, loadRegistry: _loadRegistry } = require("./dispatch-contract");
const XP_REVIEWER = Object.keys(_loadRegistry().roles || {}).find((r) => _classForRole(r) === "cross_provider_reviewer");
assert(XP_REVIEWER, "registry has no cross_provider_reviewer role — the review-fallback lane has no subject");
const XP_PROVIDER = _loadRegistry().roles[XP_REVIEWER].provider;
assert(XP_PROVIDER && XP_PROVIDER !== "claude", `cross_provider_reviewer '${XP_REVIEWER}' must carry a non-claude provider (got ${XP_PROVIDER})`);
test(`review-fallback: reviewer role (${XP_REVIEWER}) w/o -w → exit 0 + ok:true record with fallback:true + provider:claude + quota_fallback_from(${XP_PROVIDER})`, () => {
  const ledger = path.join(scratch, "l11");
  const res = runWrapper({
    fake: fakeHappy,
    ledgerDir: ledger,
    role: XP_REVIEWER,
    iso: "none",
    extraArgs: ["--review-fallback"],
  });
  assert(res.status === 0, `expected exit 0 for review-fallback reviewer, got ${res.status} (stderr: ${(res.stderr || "").slice(0, 500)})`);
  const comps = completionsOnly(readLedger(ledger, "dispatch-completions.jsonl"));
  assert(comps.length === 1 && comps[0].ok === true, "expected one ok:true completion record");
  assert(comps[0].fallback === true, `expected fallback:true, got ${JSON.stringify(comps[0].fallback)}`);
  assert(comps[0].provider === "claude", `expected provider:"claude", got ${JSON.stringify(comps[0].provider)}`);
  assert(
    comps[0].quota_fallback_from && comps[0].quota_fallback_from.provider === XP_PROVIDER,
    `expected quota_fallback_from.provider==="${XP_PROVIDER}", got ${JSON.stringify(comps[0].quota_fallback_from)}`,
  );
});
// Converse: a claude-PINNED reviewer (backend-reviewer since 2026-08-18) is NOT on the
// review-fallback lane — the wrapper must refuse it (exit≠0) and write NO completion.
test("review-fallback: claude-pinned reviewer ('backend-reviewer') via --review-fallback → refused, no record", () => {
  const ledger = path.join(scratch, "l11b");
  const res = runWrapper({
    fake: fakeHappy,
    ledgerDir: ledger,
    role: "backend-reviewer",
    iso: "none",
    extraArgs: ["--review-fallback"],
  });
  assert(res.status !== 0, `expected a non-zero exit for a claude-pinned reviewer on the review-fallback lane, got ${res.status}`);
  const comps = completionsOnly(readLedger(ledger, "dispatch-completions.jsonl"));
  assert(comps.length === 0, `no completion record should be written for a refused lane, got ${comps.length}`);
});

// ── 12. review-fallback + gauntlet-verify ──────────────────
test("review-fallback: gauntlet-verify sees the record → status 'fell-back' (not 'no-record')", () => {
  const ledger = path.join(scratch, "l11"); // reuse l11 record
  const comps = completionsOnly(readLedger(ledger, "dispatch-completions.jsonl"));
  const rec = comps[0];
  const v = verifyGauntlet({
    roles: [XP_REVIEWER],
    completionsFile: path.join(ledger, "dispatch-completions.jsonl"),
    since: rec.started_at,
  });
  assert(v.ok === true, `gauntlet-verify should pass (fell-back counts as ran): ${JSON.stringify(v.roles)}`);
  assert(
    v.roles[0].status === "fell-back",
    `expected status 'fell-back', got '${v.roles[0].status}' (the record has fallback:true so gauntlet recognises it as a fallback run, not a silent gap)`,
  );
});

// ── 13. coverage-gate trips cross_provider_required on a claude fallback record ──
test("review-fallback: coverage-gate FLAGS claude record as cross_provider_required debt (no silent green)", () => {
  const ledger = path.join(scratch, "l11"); // reuse l11 record
  const comps = readLedger(ledger, "dispatch-completions.jsonl");
  const result = coverageEvaluate({
    records: comps,
    expected: [{ role: XP_REVIEWER }],
  });
  // The gate MUST NOT be ok:true — a claude-only fallback record never silently satisfies
  // the cross-provider requirement. The violation must name the provider-diversity problem.
  assert(result.ok === false, "coverage-gate should NOT pass when cross_provider_required role ran on claude (fallback record is visible debt, not green)");
  assert(
    result.violations.some((v) => /cross.?provider|diversity|claude/i.test(v)),
    `expected a cross-provider violation, got: ${JSON.stringify(result.violations)}`,
  );
});

// ── 14. build-chain role via --review-fallback → refused ───
test("review-fallback: build-chain role ('builder') via --review-fallback → exit 2 + refusal message", () => {
  const ledger = path.join(scratch, "l14");
  const res = runWrapper({
    fake: fakeHappy,
    ledgerDir: ledger,
    role: "builder",
    iso: "none",
    extraArgs: ["--review-fallback"],
  });
  assert(res.status === 2, `expected exit 2 (usage refusal), got ${res.status}`);
  assert(
    (res.stderr || "").includes("review-fallback") && (res.stderr || "").toLowerCase().includes("build-chain"),
    `expected refusal message mentioning 'review-fallback' and 'build-chain', got stderr: ${(res.stderr || "").slice(0, 500)}`,
  );
  // No completion record should be written for a refused dispatch.
  const comps = readLedger(ledger, "dispatch-completions.jsonl");
  assert(comps.length === 0, "no completion record should be written when review-fallback is refused");
});

// ── 15. G2.4: dispatched worker gets the identity-override preamble ───
test("G2.4: a dispatched builder's prompt is prefixed with the worker-identity override (President neutralized)", () => {
  const ledger = path.join(scratch, "l15");
  const captureFile = path.join(scratch, "captured-prompt.txt");
  const fakeCapture = path.join(scratch, "fake-capture.js");
  fs.writeFileSync(
    fakeCapture,
    `let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{require("fs").writeFileSync(${JSON.stringify(
      captureFile,
    )}, s);process.stdout.write("ok");});\n`,
  );
  const res = runWrapper({ fake: fakeCapture, ledgerDir: ledger, role: "backend-builder" });
  assert(res.status === 0, `expected exit 0, got ${res.status} stderr=${(res.stderr || "").slice(0, 300)}`);
  const captured = fs.existsSync(captureFile) ? fs.readFileSync(captureFile, "utf8") : "";
  assert(/DISPATCHED WORKER/.test(captured), `preamble missing from builder prompt; head: ${captured.slice(0, 200)}`);
  assert(/INERT for you/.test(captured), "preamble must neutralize ambient President identity");
  assert(/Build the thing per spec/.test(captured), "the original prompt must survive after the preamble");
});

// ── 16. G2.4/CORE-1: President via the Claude bridge is refused pre-spawn ───
test("G2.4/CORE-1: dispatching the President role via dispatch-claude is refused (exit 2, no record)", () => {
  const ledger = path.join(scratch, "l16");
  const res = runWrapper({ fake: fakeHappy, ledgerDir: ledger, role: "President", iso: "none" });
  assert(res.status === 2, `expected exit 2 (fail-closed refusal), got ${res.status}`);
  assert(/REFUSED|top_level_session-only|President-leak/i.test(res.stderr || ""), "expected a CORE-1 refusal message");
  const comps = readLedger(ledger, "dispatch-completions.jsonl");
  assert(comps.length === 0, "no completion record for a refused President dispatch");
});

// ── 17. Gauntlet R1 SR-ID-002: a President ALIAS via the bridge is refused fail-closed ───
test("SR-ID-002: dispatching a President ALIAS ('alex_alpha') via dispatch-claude is refused (exit 2)", () => {
  const ledger = path.join(scratch, "l17");
  const res = runWrapper({ fake: fakeHappy, ledgerDir: ledger, role: "alex_alpha", iso: "none" });
  assert(res.status === 2, `expected exit 2 (fail-closed refusal for a President alias), got ${res.status}`);
  assert(/REFUSED|President-identity/i.test(res.stderr || ""), "expected a CORE-1 President-identity refusal");
  assert(readLedger(ledger, "dispatch-completions.jsonl").length === 0, "no record for a refused alias dispatch");
});

// ── Summary ─────────────────────────────────────────────────
console.log(`\ndispatch-claude.test.js — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
