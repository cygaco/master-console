#!/usr/bin/env node
"use strict";
const mcEnv = require("../../../scripts/hooks/lib/mc-env"); // S-OS-06 read-both env (clears MC_X and the legacy name together)

/**
 * review-fallback-shape.test.js — regression for SP-20260611-001 fix 2 (T-311, R-2).
 *
 * Finding (crossfam-findings-2026-06-10 §A.2): in dispatch-claude.js the sanctioned
 * --review-fallback informational branch was gated `if (reviewFallback && !blocking)`.
 * Under MC_DISPATCH_CONTRACT_ENFORCE=block (the W2 ENFORCE flip) the sanctioned lane
 * fell into the VIOLATION branch and exited 1 — the flip would BRICK the fallback exactly
 * when it is most needed (a provider is quota-dead).
 *
 * The fix (registry-as-SoT): the review-fallback lane is REGISTERED as a sanctioned shape
 * in the dispatch-contract layer (`sanctioned_lanes.review_fallback`). dispatch-claude.js
 * consults `sanctionedLane(...)`; the informational note prints in BOTH report-only and
 * blocking modes and the lane NEVER exits 1. A genuinely-mismatched NON-sanctioned shape
 * under blocking still refuses exactly as before. Scoped to ONLY this lane (no wildcard).
 *
 * Exploit-shaped (BC-16): asserts the OLD brick (ENFORCE + sanctioned lane → exit 1) is
 * closed, while a real non-sanctioned violation under ENFORCE still exits 1.
 *
 *   node tests/regression/SP-20260611-001/review-fallback-shape.test.js
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../../..");
const DISPATCH_CLAUDE = path.join(ROOT, "scripts", "dispatch-claude.js");
const EPIC = path.join(ROOT, "_planning", "epics", "E-DISPATCH-SHAPE-001.md");
const { sanctionedLane } = require(path.join(ROOT, "scripts", "dispatch", "dispatch-contract"));

let passed = 0;
let failed = 0;
function ok(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Isolated scratch + fake claude bin (a node script that emits a well-formed ok envelope).
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rf-shape-test-"));
process.on("exit", () => { try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {} });
const fakeHappy = path.join(scratch, "fake-happy.js");
fs.writeFileSync(fakeHappy, 'process.stdout.write(JSON.stringify({ agent: "reviewer", ok: true, findings: [] }));\n');
const promptFile = path.join(scratch, "prompt.txt");
fs.writeFileSync(promptFile, "Review the diff per spec.\n");

function runWrapper({ role, extraArgs = [], enforce = false, ledgerName }) {
  const ledgerDir = path.join(scratch, ledgerName);
  fs.mkdirSync(ledgerDir, { recursive: true });
  const env = {
    ...process.env,
    DISPATCH_LEDGER_DIR: ledgerDir,
    DISPATCH_CLAUDE_BIN: process.execPath,
    DISPATCH_CLAUDE_BIN_ARGS: JSON.stringify([fakeHappy]),
  };
  if (enforce) env.MC_DISPATCH_CONTRACT_ENFORCE = "block";
  else mcEnv.unsetEnv("DISPATCH_CONTRACT_ENFORCE", env);
  const res = spawnSync(
    process.execPath,
    [DISPATCH_CLAUDE, role, promptFile, "--model", "sonnet", ...extraArgs],
    { env, encoding: "utf8", timeout: 60000 },
  );
  return res;
}

console.log("(1) fallback-lane-is-registered-valid-shape:");
{
  // A cross-provider reviewer routed through subprocess-claude via the review_fallback lane
  // resolves as a SANCTIONED (registered) shape — not suppressed by a wrapper conditional.
  const v = sanctionedLane({ role: "qa-reviewer", shape: "subprocess-claude", lane: "review_fallback" });
  ok("qa-reviewer (cross_provider_reviewer) → sanctioned via review_fallback", v.sanctioned === true, JSON.stringify(v));
  ok("sanctioned verdict names the lane + class", v.lane === "review_fallback" && v.class === "cross_provider_reviewer");

  const v2 = sanctionedLane({ role: "security-reviewer", shape: "subprocess-claude", lane: "review_fallback" });
  ok("security-reviewer (gemini, cross_provider_reviewer) → also sanctioned", v2.sanctioned === true);

  // NO wildcard / over-breadth (redteam): a build-chain role is NOT in the lane's classes.
  const v3 = sanctionedLane({ role: "backend-builder", shape: "subprocess-claude", lane: "review_fallback" });
  ok("backend-builder (build_chain_worker) → NOT sanctioned (no over-breadth)", v3.sanctioned === false, JSON.stringify(v3));

  // Wrong shape for the lane → not sanctioned.
  const v4 = sanctionedLane({ role: "qa-reviewer", shape: "in-process-agent", lane: "review_fallback" });
  ok("qa-reviewer + wrong shape (in-process-agent) → NOT sanctioned", v4.sanctioned === false);

  // Unregistered lane name → not sanctioned (fail closed).
  const v5 = sanctionedLane({ role: "qa-reviewer", shape: "subprocess-claude", lane: "no_such_lane" });
  ok("unregistered lane name → NOT sanctioned (fail closed)", v5.sanctioned === false);
}

console.log("\n(2) enforce-flip-does-not-brick-sanctioned-lane:");
{
  // THE BUG, weaponized: a sanctioned --review-fallback reviewer dispatch under ENFORCE=block
  // must NOT exit 1 on a contract violation. (cross_provider_reviewer's default shape is
  // subprocess-cross-provider, so validateDispatch DOES flag subprocess-claude — the lane is
  // what rescues it.) It should run the (fake) happy path → exit 0.
  const enforced = runWrapper({ role: "backend-reviewer", extraArgs: ["--review-fallback"], enforce: true, ledgerName: "rf-enforce" });
  ok(
    "ENFORCE=block + --review-fallback reviewer → does NOT exit 1 (lane not bricked)",
    enforced.status !== 1,
    `status=${enforced.status} stderr=${(enforced.stderr || "").slice(0, 400)}`,
  );
  ok(
    "ENFORCE=block + --review-fallback reviewer → exit 0 (happy path runs)",
    enforced.status === 0,
    `status=${enforced.status} stderr=${(enforced.stderr || "").slice(0, 400)}`,
  );
  ok(
    "stderr distinguishes 'sanctioned lane' from a suppressed mismatch (C-2)",
    /sanctioned lane/i.test(enforced.stderr || ""),
    `stderr=${(enforced.stderr || "").slice(0, 400)}`,
  );
  // No contract_violation JSON on stdout (that is the exit-1 brick signature).
  ok(
    "no dispatch_contract_violation emitted for the sanctioned lane under ENFORCE",
    !/dispatch_contract_violation/.test(enforced.stdout || ""),
    `stdout=${(enforced.stdout || "").slice(0, 400)}`,
  );

  // The OTHER half: a genuinely-mismatched NON-sanctioned dispatch under ENFORCE STILL refuses.
  // An unknown role (not in role-registry) under block → validateDispatch fails-closed → exit 1.
  const refused = runWrapper({ role: "totally-unknown-role", enforce: true, ledgerName: "rf-refuse" });
  ok(
    "ENFORCE=block + non-sanctioned unknown role → STILL exits 1 (refusal preserved)",
    refused.status === 1,
    `status=${refused.status} stderr=${(refused.stderr || "").slice(0, 400)}`,
  );
  ok(
    "the non-sanctioned refusal still carries dispatch_contract_violation",
    /dispatch_contract_violation/.test(refused.stdout || ""),
    `stdout=${(refused.stdout || "").slice(0, 400)}`,
  );

  // Report-only mode: the sanctioned lane was ALWAYS allowed there; confirm no regression.
  const reportOnly = runWrapper({ role: "backend-reviewer", extraArgs: ["--review-fallback"], enforce: false, ledgerName: "rf-report" });
  ok(
    "report-only + --review-fallback reviewer → exit 0 (unchanged from before the fix)",
    reportOnly.status === 0,
    `status=${reportOnly.status} stderr=${(reportOnly.stderr || "").slice(0, 400)}`,
  );
}

console.log("\n(3) w2-entry-gate-text-present:");
{
  const epic = fs.readFileSync(EPIC, "utf8");
  const sectionIdx = epic.indexOf("### 12.2");
  const section = sectionIdx >= 0 ? epic.slice(sectionIdx, epic.indexOf("### 12.3", sectionIdx)) : "";
  ok("§12.2 section exists in the epic", sectionIdx >= 0);
  ok(
    "§12.2 entry gate carries the sanctioned-lane precondition line",
    /sanctioned --review-fallback lane is shape-registered in the dispatch-contract layer before ENFORCE flips/.test(section),
    "precondition line missing from §12.2",
  );
}

console.log("\n(4) advisory-suppression-keyed-on-sanctioned-verdict-not-the-flag (FIX-A3):");
{
  // FIX-A3: the shape-mismatch advisory suppression was keyed on the bare --review-fallback
  // FLAG — any --review-fallback dispatch silenced the advisory, even for a role the contract
  // does NOT sanction on the review_fallback lane. Narrowed: suppress ONLY when
  // sanctionedLane(...).sanctioned === true. A NON-sanctioned --review-fallback must STILL emit
  // the advisory.
  //
  // 'design-lead' (class cross_provider_consult_lead) is a NON-build, NON-sanctioned role whose
  // expected shape is subprocess-cross-provider — so subprocess-claude is a genuine shape
  // mismatch, it is NOT refused by the build-chain guard, and it is NOT in the review_fallback
  // lane's applies_to_classes. It is the exact case the bare-flag suppression wrongly silenced.
  const nonSanctioned = sanctionedLane({ role: "design-lead", shape: "subprocess-claude", lane: "review_fallback" });
  ok("design-lead is NOT sanctioned on review_fallback (precondition)", nonSanctioned.sanctioned === false, JSON.stringify(nonSanctioned));

  // Non-sanctioned --review-fallback → advisory STILL emitted (report-only, so it does not exit 1).
  const nonSanc = runWrapper({ role: "design-lead", extraArgs: ["--review-fallback"], enforce: false, ledgerName: "rf-nonsanc" });
  ok(
    "non-sanctioned --review-fallback STILL emits the shape-resolver advisory (not silenced by the flag)",
    /shape-resolver (advisory|VIOLATION)/i.test(nonSanc.stderr || ""),
    `status=${nonSanc.status} stderr=${(nonSanc.stderr || "").slice(0, 400)}`,
  );
  ok(
    "non-sanctioned --review-fallback does NOT print the sanctioned-lane note (it is not sanctioned)",
    !/sanctioned lane/i.test(nonSanc.stderr || ""),
    `stderr=${(nonSanc.stderr || "").slice(0, 400)}`,
  );

  // The sanctioned reviewer lane: advisory IS suppressed (the sanctioned-lane note prints instead).
  const sanc = runWrapper({ role: "backend-reviewer", extraArgs: ["--review-fallback"], enforce: false, ledgerName: "rf-sanc-a3" });
  ok(
    "sanctioned --review-fallback reviewer does NOT emit the shape-resolver advisory",
    !/shape-resolver advisory/i.test(sanc.stderr || ""),
    `stderr=${(sanc.stderr || "").slice(0, 400)}`,
  );
  ok(
    "sanctioned --review-fallback reviewer prints the sanctioned-lane note instead",
    /sanctioned lane/i.test(sanc.stderr || ""),
    `stderr=${(sanc.stderr || "").slice(0, 400)}`,
  );

  // Under ENFORCE, a non-sanctioned high-severity mismatch via --review-fallback must REFUSE
  // (the flag no longer rescues it). design-lead's mismatch severity governs whether it exits 1;
  // assert at minimum that the advisory is NOT suppressed under ENFORCE either.
  const nonSancEnforce = runWrapper({ role: "design-lead", extraArgs: ["--review-fallback"], enforce: true, ledgerName: "rf-nonsanc-enf" });
  ok(
    "non-sanctioned --review-fallback under ENFORCE is NOT silenced by the flag (advisory or violation present)",
    /shape-resolver (advisory|VIOLATION)/i.test(nonSancEnforce.stderr || "") || /dispatch_contract_violation/.test(nonSancEnforce.stdout || ""),
    `status=${nonSancEnforce.status} stderr=${(nonSancEnforce.stderr || "").slice(0, 400)} stdout=${(nonSancEnforce.stdout || "").slice(0, 200)}`,
  );
}

console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — review-fallback-shape: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
