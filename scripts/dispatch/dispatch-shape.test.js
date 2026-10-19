#!/usr/bin/env node
"use strict";

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

test("agent: frontend-builder → subprocess-claude (build-chain worker)", () => {
  const r = resolveShape({ kind: "agent", id: "frontend-builder" });
  assert.strictEqual(r.shape, "subprocess-claude", JSON.stringify(r));
  assert.strictEqual(r.source, "contract");
  assert.strictEqual(r.proven, true);
});
test("agent: backend-builder → subprocess-claude", () => {
  assert.strictEqual(resolveShape({ kind: "agent", id: "backend-builder" }).shape, "subprocess-claude");
});
const XP_REVIEWER = Object.keys(contract.loadRegistry().roles || {})
  .find((r) => contract.classForRole(r) === "cross_provider_reviewer");
assert.ok(XP_REVIEWER, "registry has no cross_provider_reviewer role — the cross-provider shape has no subject");
test(`agent: cross-provider reviewer (${XP_REVIEWER}) → subprocess-cross-provider (independent review)`, () => {
  assert.strictEqual(resolveShape({ kind: "agent", id: XP_REVIEWER }).shape, "subprocess-cross-provider");
});
test("agent: qa-reviewer → in-process-agent (claude-pinned)", () => {
  assert.strictEqual(resolveShape({ kind: "agent", id: "qa-reviewer" }).shape, "in-process-agent");
});
test("agent: backend-reviewer → in-process-agent (claude-pinned)", () => {
  assert.strictEqual(resolveShape({ kind: "agent", id: "backend-reviewer" }).shape, "in-process-agent");
});
test("agent: director-of-engineering → in-process-agent (manager/face class)", () => {
  assert.strictEqual(resolveShape({ kind: "agent", id: "director-of-engineering" }).shape, "in-process-agent");
});
test("agent: product-lead → subprocess-cross-provider (GPT cross_provider_consult_lead — provider:openai)", () => {
  assert.strictEqual(resolveShape({ kind: "agent", id: "product-lead" }).shape, "subprocess-cross-provider");
});

test("skill: scan:full (unverified subprocess) → inline, proven=false (fail-closed)", () => {
  const r = resolveShape({ kind: "skill", id: "scan:full" });
  assert.strictEqual(r.shape, "inline", JSON.stringify(r));
  assert.strictEqual(r.proven, false, "an unproven subprocess skill must NOT be reported proven");
});

function withSkillExecution(stub, fn) {
  const orig = contract.skillExecution;
  contract.skillExecution = stub;
  try {
    return fn();
  } finally {
    contract.skillExecution = orig;
  }
}

test("skill: a VERIFIED subprocess skill → subprocess-claude, proven=true (earned)", () => {
  withSkillExecution(
    () => ({ skill: "fixture:earned", execution: "subprocess", verified: true, source: "candidate" }),
    () => {
      const r = resolveSkill("fixture:earned");
      assert.strictEqual(r.shape, "subprocess-skill", `proven subprocess skill must route subprocess-skill, got ${JSON.stringify(r)}`);
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

test("skill: inline-required → inline (needs the live conversation)", () => {
  withSkillExecution(
    () => ({ skill: "fixture:live", execution: "inline-required", verified: false, source: "candidate" }),
    () => {
      const r = resolveSkill("fixture:live");
      assert.strictEqual(r.shape, "inline");
      assert.strictEqual(r.proven, true);
    },
  );
});

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

test("mismatch: build-chain role dispatched in-process-agent is FLAGGED (wrong shape self-detects)", () => {
  const unit = { kind: "agent", id: "frontend-builder" };
  const m = shapeMismatch("in-process-agent", unit);
  assert.ok(m && m.mismatch === true, `a wrong-shape dispatch MUST be flagged, got ${JSON.stringify(m)}`);
  assert.strictEqual(m.expected, "subprocess-claude", `expected shape wrong: ${JSON.stringify(m)}`);
  assert.strictEqual(m.actual, "in-process-agent");
  assert.strictEqual(m.severity, "high",
    `build-chain role dispatched in-process-agent MUST be severity=high (isolation violation), got '${m.severity}'`);
}, true);

test("converse: the SAME build-chain role dispatched its RIGHT shape → null (no false-positive)", () => {
  const unit = { kind: "agent", id: "frontend-builder" };
  const m = shapeMismatch("subprocess-claude", unit);
  assert.strictEqual(m, null, `the correct shape must NOT be flagged, got ${JSON.stringify(m)}`);
});

test("mismatch: UNPROVEN subprocess skill dispatched subprocess-claude → severity HIGH", () => {
  const m = withSkillExecution(
    () => ({ skill: "fixture:unearned", execution: "subprocess", verified: false, source: "candidate" }),
    () => shapeMismatch("subprocess-claude", { kind: "skill", id: "fixture:unearned" }),
  );
  assert.ok(m && m.mismatch === true, `must flag, got ${JSON.stringify(m)}`);
  assert.strictEqual(m.expected, "inline", JSON.stringify(m));
  assert.strictEqual(m.severity, "high", `unproven subprocess dispatch must be HIGH severity, got ${JSON.stringify(m)}`);
}, true);

test("an unknown shape string is flagged as a mismatch (not silently accepted)", () => {
  const m = shapeMismatch("teleport", { kind: "agent", id: "frontend-builder" });
  assert.ok(m && m.mismatch === true, JSON.stringify(m));
}, true);

test("teeth: shapeMismatch is unit-sensitive (not a constant) — reviewer vs builder differ", () => {
  const asBuilder = shapeMismatch("in-process-agent", { kind: "agent", id: "frontend-builder" });
  const asReviewer = shapeMismatch("in-process-agent", { kind: "agent", id: XP_REVIEWER });
  assert.strictEqual(asBuilder.expected, "subprocess-claude");
  assert.strictEqual(asReviewer.expected, "subprocess-cross-provider");
  assert.notStrictEqual(asBuilder.expected, asReviewer.expected, "if these were equal the resolver is a constant — false-green");
}, true);

test("fail-open: an unknown role resolves WITHOUT throwing + never picks a spawning shape blindly", () => {
  const r = resolveShape({ kind: "agent", id: "this-role-does-not-exist-xyz" });
  assert.strictEqual(r.shape, "inline", JSON.stringify(r));
});

test("fail-open: a contract-read error resolves inline, proven=false (never throws)", () => {
  const r = withSkillExecution(
    () => { throw new Error("simulated contract read failure"); },
    () => resolveSkill("fixture:boom"),
  );
  assert.strictEqual(r.shape, "inline", JSON.stringify(r));
  assert.strictEqual(r.proven, false);
}, true);

test("unknown role 'custom-data-builder' → subprocess-claude (name-heuristic, NOT inline)", () => {
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

if (failed) {
  process.stderr.write(fails.join("\n") + "\n");
  process.stderr.write(`dispatch-shape fixture-test: ${passed}/${passed + failed} passed, ${failed} FAILED\n`);
  process.exit(1);
}
process.stdout.write(
  `dispatch-shape fixture-test: ${passed}/${passed} passed (incl. ${planted} planted/mismatch assertion(s))\n`,
);
process.exit(0);
