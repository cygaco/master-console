#!/usr/bin/env node
"use strict";
const mcEnv = require("../../../scripts/hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * wrapper-door.test.js — E-DISPATCH-SHAPE-001 W2-core (SP-20260616-001), AC-2.1/2.2/4.1.
 *
 * dispatch-claude BEHAVIORAL via the DISPATCH_CLAUDE_BIN seam (a fake claude emitting ok JSON):
 *   - report mode (default) → a shape mismatch is advisory, the dispatch proceeds (exit 0).
 *   - sanctioned --review-fallback reviewer under the NEW WARPOS_SHAPE_DOOR=enforce → not bricked (exit 0).
 * dispatch-agent has no clean provider seam (it calls runProvider), so its door wiring + the
 * exit-2 distinction + the "shape gate reads through the door, contract block keeps its own toggle"
 * (β#2) split are asserted STRUCTURALLY. The door's refuse/back-compat LOGIC is fully unit-tested
 * in shape-door.test.js.
 *
 *   node tests/regression/SP-20260616-001/wrapper-door.test.js
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../../..");
const DC = path.join(ROOT, "scripts", "dispatch-claude.js");

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; fails.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "wd-"));
process.on("exit", () => { try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {} });
const fake = path.join(scratch, "fake.js");
fs.writeFileSync(fake, 'process.stdout.write(JSON.stringify({ agent: "x", ok: true, findings: [] }));\n');
const pf = path.join(scratch, "p.txt");
fs.writeFileSync(pf, "review the diff\n");

let n = 0;
function runClaude({ role, extra = [], env = {} }) {
  const ld = path.join(scratch, "l" + (n++));
  fs.mkdirSync(ld, { recursive: true });
  const e = { ...process.env, DISPATCH_LEDGER_DIR: ld, DISPATCH_CLAUDE_BIN: process.execPath, DISPATCH_CLAUDE_BIN_ARGS: JSON.stringify([fake]) };
  delete e.WARPOS_DISPATCH_CONTRACT_ENFORCE; delete e.WARPOS_SHAPE_DOOR; delete e.WARPOS_DISABLE_SHAPE_DOOR;
  Object.assign(e, env);
  return spawnSync(process.execPath, [DC, role, pf, "--model", "sonnet", ...extra], { env: e, encoding: "utf8", timeout: 60000 });
}

console.log("(1) report-mode-no-regression-both-wrappers:");
{
  // backend-reviewer through dispatch-claude = a routing error: the contract gate catches the
  // shape-not-allowed VIOLATION and the shape-door sees a (medium) mismatch. ADR-0013 flipped the
  // CONTRACT gate to enforce-by-default, so report mode is now explicit (=report).
  const r = runClaude({ role: "backend-reviewer", env: { WARPOS_DISPATCH_CONTRACT_ENFORCE: "report" } });
  ok("dispatch-claude report mode (CONTRACT_ENFORCE=report) → exit 0 (advisory, no refuse)", r.status === 0, `status=${r.status} stderr=${(r.stderr || "").slice(0, 220)}`);
  // β#4: the report-mode SHAPE-DOOR advisory must be BYTE-IDENTICAL to the pre-door legacy —
  // `advisory:` with NO `(mode)` label (the gauntlet finding GPT-5.5 caught). Guard the regression.
  ok("report-mode shape-door advisory is byte-identical legacy form (no mode label — β#4)",
    /shape-resolver advisory: role/.test(r.stderr || "") && !/shape-resolver advisory \(/.test(r.stderr || ""),
    (r.stderr || "").slice(0, 220));
  // ADR-0013 (amended SP-20260627-001): the `-w` worktree-pending fix shipped (+ fixer in
  // GENERIC_BUILD_IDS + role normalization), so the contract gate now ENFORCES BY DEFAULT.
  // backend-reviewer via the claude wrapper is a real shape-not-allowed violation: under the
  // default it refuses exit 1 (contract VIOLATION, distinct from the door's exit 2). The
  // report-only kill-switch (WARPOS_DISPATCH_CONTRACT_ENFORCE=report|off|0) still reverts it.
  const rEnf = runClaude({ role: "backend-reviewer", env: { WARPOS_DISPATCH_CONTRACT_ENFORCE: "enforce" } });
  ok("dispatch-claude contract enforce (explicit, = the default now) → exit 1 (VIOLATION) on a real shape-not-allowed", rEnf.status === 1, `status=${rEnf.status} stderr=${(rEnf.stderr || "").slice(0, 200)}`);
  // The report-only kill-switch still reverts to advisory (exit 0) — reversibility preserved.
  ok("dispatch-claude contract =report kill-switch → exit 0 (advisory, reversible)",
    runClaude({ role: "backend-reviewer", env: { WARPOS_DISPATCH_CONTRACT_ENFORCE: "report" } }).status === 0);
  ok("dispatch-claude contract DEFAULT is now ENFORCE (ADR-0013 amended SP-20260627-001) → exit 1 (VIOLATION)",
    runClaude({ role: "backend-reviewer" }).status === 1);
}

console.log("\n(2) dispatch-claude-sanctioned-lane-preserved (new WARPOS_SHAPE_DOOR toggle):");
{
  // The sanctioned --review-fallback reviewer must proceed even under the NEW enforce toggle (β#1).
  const r = runClaude({ role: "backend-reviewer", extra: ["--review-fallback"], env: { WARPOS_SHAPE_DOOR: "enforce" } });
  ok("sanctioned --review-fallback + WARPOS_SHAPE_DOOR=enforce → exit 0 (lane not bricked)", r.status === 0, `status=${r.status} stderr=${(r.stderr || "").slice(0, 220)}`);
}

console.log("\n(3) two-toggle-coherence-backcompat (β#2, DoE-C2 — STRUCTURAL):");
{
  const dcSrc = fs.readFileSync(DC, "utf8");
  const daSrc = fs.readFileSync(path.join(ROOT, "scripts", "dispatch-agent.js"), "utf8");
  // Slice each shape block from its header to the block's natural end-marker (robust to comment length).
  const dcStart = dcSrc.indexOf("Shape-resolver self-detection");
  const dcShape = dcSrc.slice(dcStart, dcSrc.indexOf("── Spawn", dcStart));
  const daStart = daSrc.indexOf("Shape-resolver self-detection");
  const daShape = daSrc.slice(daStart, daSrc.indexOf("Phase 5T F8", daStart));
  // The SHAPE block reads through shapeDoor() (not an inline env check).
  ok("dispatch-claude shape block calls shapeDoor(subprocess-claude)", /shapeDoor\("subprocess-claude",\s*\{\s*kind:\s*"agent",\s*id:\s*role\s*\}/.test(dcShape));
  ok("dispatch-agent shape block calls shapeDoor(subprocess-cross-provider)", /shapeDoor\("subprocess-cross-provider",\s*\{\s*kind:\s*"agent",\s*id:\s*role\s*\}/.test(daShape));
  // The door refusal exits 2 (distinct from the contract-consult exit 1).
  ok("dispatch-claude door refusal uses exit 2", /door\.action === "refuse"/.test(dcShape) && /process\.exit\(2\)/.test(dcShape));
  ok("dispatch-agent door refusal uses exit 2", /door\.action === "refuse"/.test(daShape) && /process\.exit\(2\)/.test(daShape));
  // The contract-consult block keeps its OWN enforce toggle (one switch per concern), now via the
  // shared contractEnforceMode helper (ADR-0013 flip: enforce-by-default + WARPOS_DISPATCH_CONTRACT_ENFORCE=report kill).
  ok("the contract-consult enforce is env-controllable via contractEnforceMode (ADR-0013; kept, not removed)", /contractEnforceMode\(/.test(dcSrc));
  // The shape block no longer inlines a DISPATCH_CONTRACT_ENFORCE env check — raw or via the read-both helper
  // (folded into the door — β#2 one-switch).
  ok("dispatch-claude shape block no longer inlines a DISPATCH_CONTRACT_ENFORCE env check", !/process\.env\.WARPOS_DISPATCH_CONTRACT_ENFORCE|readEnv\(\s*["']DISPATCH_CONTRACT_ENFORCE["']/.test(dcShape));
}

console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — wrapper-door: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
