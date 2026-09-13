#!/usr/bin/env node
"use strict";

/**
 * Isolated P5 test for no-dead-team-tools.js. Proves the pure `evaluate` core:
 *   - CATCHES a planted live TeamCreate( / TeamDelete( directive (a regression),
 *   - EXEMPTS a legitimate historical mention ("removed in v2.1.178") and a
 *     descriptive "surrogate for TeamDelete" line,
 *   - PASSES files with no team-tool reference and the clean migrated Agent shape.
 *
 *   node scripts/checks/no-dead-team-tools.test.js
 */

const assert = require("node:assert");
const { harness } = require("./lib/fixture-harness");
const { evaluate, relSkipped } = require("./no-dead-team-tools");

const h = harness("no-dead-team-tools");

// qa-final: PATH-SCOPING precision — skips are path-qualified, NOT bare basenames, so
// an ACTIVE path that happens to contain a skip-named segment is STILL scanned.
h.test("qa-final: skips are path-prefix-scoped, not basename-scoped", () => {
  // SKIPPED (the real history/decision/per-run/baseline locations):
  assert(relSkipped(".claude/project/events/events.jsonl"), "the event log is skipped");
  assert(relSkipped(".claude/agents/president/_system/policy/adr/0015-x.md"), "ADRs are skipped");
  assert(relSkipped("_mc/BASELINE/_requirements/x.md"), "the shipped baseline is skipped");
  assert(relSkipped("tests/regression/X/y.test.js"), "regression fixtures are skipped");
  assert(relSkipped("scripts/checks/no-dead-team-tools.js"), "the enforcer's own file (exact path) is skipped");
  // NOT skipped (ACTIVE paths a bare-basename skip would have wrongly excluded):
  assert(!relSkipped("scripts/runtime/governance.js"), "an ACTIVE scripts/runtime/* file is scanned (not the runtime/ basename skip)");
  assert(!relSkipped(".claude/commands/events/log.md"), "an ACTIVE commands/events/* file is scanned");
  assert(!relSkipped("scripts/events/cli.js"), "an ACTIVE scripts/events/* file is scanned");
  assert(!relSkipped("scripts/dispatch/reap-orphans.js"), "a normal active script is scanned");
  // a future active file sharing the enforcer's BASENAME elsewhere is NOT skipped:
  assert(!relSkipped("scripts/other/no-dead-team-tools.js"), "a same-basename file in a DIFFERENT path is NOT skipped (exact-path self-exempt)");
});

// 1) PLANTED VIOLATION — a live TeamCreate( directive with NO exemption marker.
// h.violation asserts the enforcer result is NOT a pass (ok:false ⇒ caught).
h.violation("a live TeamCreate( directive (no marker) is flagged", () =>
  evaluate({ files: [{ path: "a.md", content: 'Run: TeamCreate(team_name:"x")\n' }] }));

// …and it's EXACTLY the planted line (1 offender), not a coincidental fail.
h.test("the planted TeamCreate( yields exactly one offender on the right line", () => {
  const r = evaluate({ files: [{ path: "a.md", content: 'Run: TeamCreate(team_name:"x")\n' }] });
  assert.strictEqual(r.ok, false, "must be ok:false");
  assert.strictEqual(r.offenders.length, 1, "exactly one offender");
  assert.strictEqual(r.offenders[0].lineno, 1, "offender on line 1");
  assert.ok(/TeamCreate\(/.test(r.offenders[0].text), "offender text quotes the directive");
});

// 2) PLANTED VIOLATION — a live TeamDelete( directive with NO marker.
h.violation("a live TeamDelete( directive (no marker) is flagged", () =>
  evaluate({ files: [{ path: "b.js", content: "cleanup(); TeamDelete(team_name);\n" }] }));

// 3) PASS — a historical mention in NON-CALL form (no open-paren) passes. Prose in
// the active layer describes the tools by NAME, never the call form.
h.pass("historical 'TeamCreate/TeamDelete were removed in v2.1.178' (non-call form) passes", () =>
  evaluate({
    files: [
      {
        path: "doc.md",
        content: "Note: TeamCreate/TeamDelete were removed in v2.1.178; use Agent spawn.\n",
      },
    ],
  }));

// 4) PASS — a descriptive 'surrogate for TeamDelete' line (NON-call form) passes.
h.pass("'the Node-side surrogate for TeamDelete' (non-call form) passes", () =>
  evaluate({
    files: [
      { path: "notes.md", content: "We kept the Node-side surrogate for TeamDelete during migration.\n" },
    ],
  }));

// 5) PASS — no team-tool reference at all.
h.pass("a file with no team-tool reference passes", () =>
  evaluate({ files: [{ path: "c.js", content: "const x = 1;\nfunction f(){ return x; }\n" }] }));

// 6) PASS — the clean migrated directive (Agent spawn) passes.
h.pass("the clean migrated Agent(run_in_background:true) directive passes", () =>
  evaluate({
    files: [
      {
        path: "mode.md",
        content: 'Spawn: Agent(subagent_type:"epsilon", run_in_background:true, name:"Epsilon")\n',
      },
    ],
  }));

// ── qa-CRITICAL: a MASKED live call (a real TeamCreate( with a stray marker WORD
// appended) must STILL be flagged — the prior whole-line substring exemption
// false-PASSED `TeamCreate(...) // legacy`, defeating the enforcer. The fix requires
// a REMOVAL-CONTEXT phrase, not a stray keyword.
h.violation("qa-CRIT: a live TeamCreate(...) with a trailing '// legacy' marker word is STILL flagged", () =>
  evaluate({ files: [{ path: "sneaky.js", content: 'TeamCreate(team_name:"x"); // legacy path\n' }] }));
h.violation("qa-CRIT: a live TeamCreate(...) with a trailing 'deprecated' word is STILL flagged", () =>
  evaluate({ files: [{ path: "sneaky2.md", content: 'Run TeamCreate(team_name:"x") (deprecated wrapper)\n' }] }));
h.violation("qa-CRIT: a live TeamDelete(...) followed by the word 'gone' is STILL flagged", () =>
  evaluate({ files: [{ path: "sneaky3.js", content: 'TeamDelete(t); // the old team is gone now\n' }] }));

// ── qa-HIGH: whitespace before the paren must NOT bypass (`TeamCreate (`).
h.violation("qa-HIGH: `TeamCreate (` with a space before the paren is flagged", () =>
  evaluate({ files: [{ path: "ws.js", content: 'TeamCreate ("x")\n' }] }));

// The masked-call tests, exactly one offender each (not a coincidental fail).
h.test("qa-CRIT: the masked live call yields exactly one offender", () => {
  const r = evaluate({ files: [{ path: "s.js", content: 'TeamCreate(team_name:"x"); // legacy\n' }] });
  assert.strictEqual(r.ok, false, "masked live call must be ok:false");
  assert.strictEqual(r.offenders.length, 1, "exactly one offender");
});

// Prose in NON-CALL form (the tool by name, no open-paren) is never flagged — the
// active layer describes the removed tools this way; the call form is reserved for
// (and only legitimate in) the path-skipped history/decision layer (adr/, _docs, …).
h.pass("non-call-form prose ('the TeamCreate call is no longer available') passes", () =>
  evaluate({ files: [{ path: "doc2.md", content: "The TeamCreate call is no longer available as of v2.1.178.\n" }] }));

// And a CALL-FORM in prose, even with removal language, IS flagged in the active
// layer (the reviewer's CRITICAL: no marker-word escape; rephrase to non-call form
// or move to the path-skipped doc layer).
h.violation("a call-form in prose ('TeamCreate(...) was removed') IS flagged in the active layer", () =>
  evaluate({ files: [{ path: "active.md", content: "TeamCreate(team_name) was removed in v2.1.178.\n" }] }));

// qa-CRIT r2: the residual SELF-PATTERN line exemption was ALSO a bypass — a masked
// live call carrying the enforcer's own identifier as a comment must STILL be flagged
// (the enforcer's own files are skipped wholesale by SELF_FILES in walk(), NOT by a
// line-level marker any scanned file could carry).
h.violation("qa-CRIT-r2: `TeamCreate({}); // no-dead-team-tools` is STILL flagged (no self-marker escape)", () =>
  evaluate({ files: [{ path: "evil.js", content: "TeamCreate({}); // no-dead-team-tools\n" }] }));
h.violation("qa-CRIT-r2: `TeamDelete(t); // DEAD_TOOL_RE` is STILL flagged", () =>
  evaluate({ files: [{ path: "evil2.js", content: "TeamDelete(t); // DEAD_TOOL_RE\n" }] }));
h.violation("qa-CRIT-r2: `TeamCreate(x); // SELF_PATTERN_RE` is STILL flagged", () =>
  evaluate({ files: [{ path: "evil3.js", content: "TeamCreate(x); // SELF_PATTERN_RE\n" }] }));

h.done();
