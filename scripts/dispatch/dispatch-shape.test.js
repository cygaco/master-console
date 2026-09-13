#!/usr/bin/env node
"use strict";

/**
 * dispatch-shape.test.js — gauntlet for the LIVE dispatch-shape resolver (PLAN §17).
 *
 * Authored by Alex ε (sprint SP-20260608-001, ticket T-20260608-270) under β guardrail
 * G2: the suite MUST exercise a LIVE mismatched-shape — a dispatch whose ACTUAL route
 * diverges from what resolveShape picks, caught by shapeMismatch (non-null finding,
 * correct expected shape + severity), AND the converse (the RIGHT shape → null). "Tests
 * pass" is not acceptance; the mismatch assertions below FAIL if shapeMismatch is broken.
 *
 * Coverage:
 *   1. agent → contract (every class's canonical shape).
 *   2. skill → skillExecution, FAIL-CLOSED on the earn-it proof — incl. the VERIFIED
 *      branch driven through a fixture skillExecution so "proven → subprocess" is really
 *      exercised (the live registry has 0 stamped skills today).
 *   3. adhoc → the decision rule, every branch.
 *   4. THE G2 LIVE MISMATCH (load-bearing): a build-chain role dispatched the WRONG
 *      (dangerous in-process) shape is flagged; the right shape returns null; an UNPROVEN
 *      subprocess skill dispatched subprocess-claude is flagged severity=high.
 *   5. fail-open: an unknown role / contract-read error resolves inline, proven=false,
 *      never throws, never picks a spawning shape on error.
 *
 * House style: prints "dispatch-shape fixture-test: N/N passed (incl. K …)", exit 1 on
 * any failure. Zero deps.
 */

const assert = require("assert");
const path = require("path");

const shapeMod = require("./dispatch-shape.js");
const { resolveShape, shapeMismatch, resolveSkill } = shapeMod;
const contract = require("./dispatch-contract.js");

let passed = 0;
let failed = 0;
let planted = 0;
const fails = [];

function test(name, fn, isPlanted) {
  try {
    fn();
    passed++;
    if (isPlanted) planted++;
  } catch (e) {
    failed++;
    fails.push(`  ✗ ${name}: ${e.message}`);
  }
}

// ── 1. agent → the contract is the authority ────────────────────────────────
test("agent: frontend-builder → subprocess-claude (build-chain worker)", () => {
  const r = resolveShape({ kind: "agent", id: "frontend-builder" });
  assert.strictEqual(r.shape, "subprocess-claude", JSON.stringify(r));
  assert.strictEqual(r.source, "contract");
  assert.strictEqual(r.proven, true);
});
test("agent: backend-builder → subprocess-claude", () => {
  assert.strictEqual(resolveShape({ kind: "agent", id: "backend-builder" }).shape, "subprocess-claude");
});
// The cross-provider reviewer is REGISTRY-DERIVED, not a literal: the operator ruling of
// 2026-08-18 re-pinned qa-/frontend-/backend-reviewer to claude (claude_pinned_reviewer →
// in-process-agent), so a hard-coded role id rots the moment the registry moves. Resolve
// any live cross_provider_reviewer; fail loudly if the class has no member.
const XP_REVIEWER = Object.keys(contract.loadRegistry().roles || {})
  .find((r) => contract.classForRole(r) === "cross_provider_reviewer");
assert.ok(XP_REVIEWER, "registry has no cross_provider_reviewer role — the cross-provider shape has no subject");
test(`agent: cross-provider reviewer (${XP_REVIEWER}) → subprocess-cross-provider (independent review)`, () => {
  assert.strictEqual(resolveShape({ kind: "agent", id: XP_REVIEWER }).shape, "subprocess-cross-provider");
});
test("agent: qa-reviewer → in-process-agent (claude-pinned since the 2026-08-18 re-pin)", () => {
  assert.strictEqual(resolveShape({ kind: "agent", id: "qa-reviewer" }).shape, "in-process-agent");
});
test("agent: backend-reviewer → in-process-agent (claude-pinned since the 2026-08-18 re-pin)", () => {
  assert.strictEqual(resolveShape({ kind: "agent", id: "backend-reviewer" }).shape, "in-process-agent");
});
test("agent: director-of-engineering → in-process-agent (manager/face class)", () => {
  assert.strictEqual(resolveShape({ kind: "agent", id: "director-of-engineering" }).shape, "in-process-agent");
});
test("agent: product-lead → subprocess-cross-provider (GPT cross_provider_consult_lead, W2 — provider:openai)", () => {
  assert.strictEqual(resolveShape({ kind: "agent", id: "product-lead" }).shape, "subprocess-cross-provider");
});

// ── 2. skill → skillExecution, fail-closed on the earn-it proof ──────────────
// A real unverified subprocess skill (the live registry pre-downgrades it) → inline.
test("skill: scan:full (unverified subprocess) → inline, proven=false (fail-closed)", () => {
  const r = resolveShape({ kind: "skill", id: "scan:full" });
  assert.strictEqual(r.shape, "inline", JSON.stringify(r));
  assert.strictEqual(r.proven, false, "an unproven subprocess skill must NOT be reported proven");
});

// Drive resolveSkill through a FIXTURE skillExecution so each execution shape is exercised
// independently of what the live registry happens to carry. We monkeypatch the contract's
// skillExecution for the duration of each case (the resolver reads it lazily via require-
// cache, so replacing the export is honored).
function withSkillExecution(stub, fn) {
  const orig = contract.skillExecution;
  contract.skillExecution = stub;
  try {
    return fn();
  } finally {
    contract.skillExecution = orig;
  }
}

test("skill: a VERIFIED subprocess skill → subprocess-claude, proven=true (earned §13.6+§13.7)", () => {
  // The REAL contract object for a verified candidate is {execution:"subprocess",
  // verified:true} — note the field is `verified`, NOT `subprocess_verified`. The
  // resolver MUST honor that as proven (this guards the field-name bug the gauntlet
  // found: reading only exec.subprocess_verified routes a proven skill inline).
  withSkillExecution(
    () => ({ skill: "fixture:earned", execution: "subprocess", verified: true, source: "candidate" }),
    () => {
      const r = resolveSkill("fixture:earned");
      assert.strictEqual(r.shape, "subprocess-skill", `proven subprocess skill must route subprocess-skill (ED-057), got ${JSON.stringify(r)}`);
      assert.strictEqual(r.proven, true);
    },
  );
});

test("skill: a subprocess skill NOT yet earned → inline, proven=false (fail-closed)", () => {
  withSkillExecution(
    () => ({ skill: "fixture:unearned", execution: "subprocess", verified: false, source: "candidate" }),
    () => {
      const r = resolveSkill("fixture:unearned");
      assert.strictEqual(r.shape, "inline", JSON.stringify(r));
      assert.strictEqual(r.proven, false);
    },
  );
}, true);

test("skill: inline-required → inline (needs the live conversation; §13.5)", () => {
  withSkillExecution(
    () => ({ skill: "fixture:live", execution: "inline-required", verified: false, source: "candidate" }),
    () => {
      const r = resolveSkill("fixture:live");
      assert.strictEqual(r.shape, "inline");
      assert.strictEqual(r.proven, true);
    },
  );
});

// ── 3. adhoc → the decision rule, every branch ──────────────────────────────
test("adhoc: noCLIcapability → api (the only sanctioned API case)", () => {
  assert.strictEqual(resolveShape({ kind: "adhoc", signals: { noCLIcapability: true } }).shape, "api");
});
test("adhoc: independentReview → subprocess-cross-provider", () => {
  assert.strictEqual(resolveShape({ kind: "adhoc", signals: { independentReview: true } }).shape, "subprocess-cross-provider");
});
test("adhoc: buildChain → subprocess-claude (NEVER in-process)", () => {
  assert.strictEqual(resolveShape({ kind: "adhoc", signals: { buildChain: true } }).shape, "subprocess-claude");
});
test("adhoc: light → inline", () => {
  assert.strictEqual(resolveShape({ kind: "adhoc", signals: { light: true } }).shape, "inline");
});
test("adhoc: needsLiveConversation → inline", () => {
  assert.strictEqual(resolveShape({ kind: "adhoc", signals: { needsLiveConversation: true } }).shape, "inline");
});
test("adhoc: smallClaudeReturnNeedsContext → in-process-agent (the one sanctioned in-process lane)", () => {
  assert.strictEqual(resolveShape({ kind: "adhoc", signals: { smallClaudeReturnNeedsContext: true } }).shape, "in-process-agent");
});
test("adhoc: headlessCapable + provenSubprocess → subprocess-claude", () => {
  const r = resolveShape({ kind: "adhoc", signals: { headlessCapable: true, provenSubprocess: true } });
  assert.strictEqual(r.shape, "subprocess-claude");
  assert.strictEqual(r.proven, true);
});
test("adhoc: headlessCapable + UNPROVEN → inline, proven=false (fail-closed)", () => {
  const r = resolveShape({ kind: "adhoc", signals: { headlessCapable: true } });
  assert.strictEqual(r.shape, "inline", JSON.stringify(r));
  assert.strictEqual(r.proven, false);
}, true);
test("adhoc: no distinguishing signal → inline (safe default)", () => {
  assert.strictEqual(resolveShape({ kind: "adhoc", signals: {} }).shape, "inline");
});

// ── 4. THE G2 LIVE MISMATCH (load-bearing) ──────────────────────────────────
// A real build-chain role dispatched the WRONG (dangerous in-process) shape must be
// flagged by shapeMismatch; the RIGHT shape must return null. This test FAILS if
// shapeMismatch is broken — it is the β guardrail G2, not a "tests pass" placeholder.
test("G2 mismatch: build-chain role dispatched in-process-agent is FLAGGED (wrong shape self-detects)", () => {
  const unit = { kind: "agent", id: "frontend-builder" }; // resolves subprocess-claude
  const m = shapeMismatch("in-process-agent", unit);
  assert.ok(m && m.mismatch === true, `a wrong-shape dispatch MUST be flagged, got ${JSON.stringify(m)}`);
  assert.strictEqual(m.expected, "subprocess-claude", `expected shape wrong: ${JSON.stringify(m)}`);
  assert.strictEqual(m.actual, "in-process-agent");
  // G2 β guardrail: build-chain dispatched in-process is an isolation violation → HIGH severity.
  // (PLAN §2(iii): in-process-when-subprocess. Hardened in T-270 — was "medium" before.)
  assert.strictEqual(m.severity, "high",
    `build-chain role dispatched in-process-agent MUST be severity=high (isolation violation), got '${m.severity}'`);
}, true);

test("G2 converse: the SAME build-chain role dispatched its RIGHT shape → null (no false-positive)", () => {
  const unit = { kind: "agent", id: "frontend-builder" };
  const m = shapeMismatch("subprocess-claude", unit);
  assert.strictEqual(m, null, `the correct shape must NOT be flagged, got ${JSON.stringify(m)}`);
});

test("G2 mismatch: UNPROVEN subprocess skill dispatched subprocess-claude → severity HIGH", () => {
  // An unproven subprocess skill resolves INLINE (fail-closed). Dispatching it
  // subprocess-claude is the dangerous unproven-subprocess case → severity high.
  const m = withSkillExecution(
    () => ({ skill: "fixture:unearned", execution: "subprocess", verified: false, source: "candidate" }),
    () => shapeMismatch("subprocess-claude", { kind: "skill", id: "fixture:unearned" }),
  );
  assert.ok(m && m.mismatch === true, `must flag, got ${JSON.stringify(m)}`);
  assert.strictEqual(m.expected, "inline", JSON.stringify(m));
  assert.strictEqual(m.severity, "high", `unproven subprocess dispatch must be HIGH severity, got ${JSON.stringify(m)}`);
}, true);

test("G2: an unknown shape string is flagged as a mismatch (not silently accepted)", () => {
  const m = shapeMismatch("teleport", { kind: "agent", id: "frontend-builder" });
  assert.ok(m && m.mismatch === true, JSON.stringify(m));
}, true);

// SELF-CHECK that the G2 test has TEETH: deliberately break the expectation and confirm
// the assertion would fire (a placeholder that always passes is a false-green). We prove
// it by asserting the mismatch finding is sensitive to the unit — a DIFFERENT unit yields
// a DIFFERENT expected shape for the same actual shape.
test("G2 teeth: shapeMismatch is unit-sensitive (not a constant) — reviewer vs builder differ", () => {
  const asBuilder = shapeMismatch("in-process-agent", { kind: "agent", id: "frontend-builder" });
  const asReviewer = shapeMismatch("in-process-agent", { kind: "agent", id: XP_REVIEWER });
  assert.strictEqual(asBuilder.expected, "subprocess-claude");
  assert.strictEqual(asReviewer.expected, "subprocess-cross-provider");
  assert.notStrictEqual(asBuilder.expected, asReviewer.expected, "if these were equal the resolver is a constant — false-green");
}, true);

// ── 5. fail-open ────────────────────────────────────────────────────────────
test("fail-open: an unknown role resolves WITHOUT throwing + never picks a spawning shape blindly", () => {
  const r = resolveShape({ kind: "agent", id: "this-role-does-not-exist-xyz" });
  // unknown role → resolveAgent falls through to resolveAdhoc with no signals → inline.
  assert.strictEqual(r.shape, "inline", JSON.stringify(r));
});

test("fail-open: a contract-read error resolves inline, proven=false (never throws)", () => {
  // Force skillExecution to throw — the resolver must fail-open to inline.
  const r = withSkillExecution(
    () => { throw new Error("simulated contract read failure"); },
    () => resolveSkill("fixture:boom"),
  );
  assert.strictEqual(r.shape, "inline", JSON.stringify(r));
  assert.strictEqual(r.proven, false);
}, true);

// ── W2 fix-first: unknown-role name-heuristic (the resolver's "no distinguishing signal" weakness) ──
// An UNKNOWN role (not in the registry) whose id NAME indicates a build-chain worker or an
// independent reviewer must NOT fall to "no distinguishing signal → inline" — that WAS the W2
// weakness (a real subprocess builder once resolved inline). The pick is name-derived + labeled
// source="unknown-role-name-heuristic" so it stays auditable.
test("unknown role 'custom-data-builder' → subprocess-claude (name-heuristic, NOT inline — W2 fix)", () => {
  const r = resolveShape({ kind: "agent", id: "custom-data-builder" });
  assert.strictEqual(r.shape, "subprocess-claude", JSON.stringify(r));
  assert.strictEqual(r.source, "unknown-role-name-heuristic", JSON.stringify(r));
}, true);
test("unknown role 'widget-fixer' → subprocess-claude (name-heuristic)", () => {
  assert.strictEqual(resolveShape({ kind: "agent", id: "widget-fixer" }).shape, "subprocess-claude");
}, true);
test("unknown role 'compliance-reviewer' → subprocess-cross-provider (name-heuristic)", () => {
  const r = resolveShape({ kind: "agent", id: "compliance-reviewer" });
  assert.strictEqual(r.shape, "subprocess-cross-provider", JSON.stringify(r));
  assert.strictEqual(r.source, "unknown-role-name-heuristic");
}, true);
test("unknown role 'mystery-thing' (no name signal) → inline (safe default still holds)", () => {
  assert.strictEqual(resolveShape({ kind: "agent", id: "mystery-thing" }).shape, "inline");
}, true);
test("regression: a KNOWN builder still resolves via the CONTRACT, not the name-heuristic", () => {
  const r = resolveShape({ kind: "agent", id: "frontend-builder" });
  assert.strictEqual(r.shape, "subprocess-claude", JSON.stringify(r));
  assert.strictEqual(r.source, "contract", `known role must use contract, not name-heuristic: ${JSON.stringify(r)}`);
}, true);

// ── report ──────────────────────────────────────────────────────────────────
if (failed) {
  process.stderr.write(fails.join("\n") + "\n");
  process.stderr.write(`dispatch-shape fixture-test: ${passed}/${passed + failed} passed, ${failed} FAILED\n`);
  process.exit(1);
}
process.stdout.write(
  `dispatch-shape fixture-test: ${passed}/${passed} passed (incl. ${planted} planted/mismatch assertion(s))\n`,
);
process.exit(0);
