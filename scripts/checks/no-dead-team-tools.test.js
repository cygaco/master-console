#!/usr/bin/env node
"use strict";

const assert = require("node:assert");
const { harness } = require("./lib/fixture-harness");
const { evaluate, relSkipped } = require("./no-dead-team-tools");

const h = harness("no-dead-team-tools");

h.test("skips are path-prefix-scoped, not basename-scoped", () => {
  assert(relSkipped(".claude/project/events/events.jsonl"), "the event log is skipped");
  assert(relSkipped(".claude/agents/president/_system/policy/adr/0015-x.md"), "ADRs are skipped");
  assert(relSkipped("_mc/BASELINE/_requirements/x.md"), "the shipped baseline is skipped");
  assert(relSkipped("tests/regression/X/y.test.js"), "regression fixtures are skipped");
  assert(relSkipped("scripts/checks/no-dead-team-tools.js"), "the enforcer's own file (exact path) is skipped");
  assert(!relSkipped("scripts/runtime/governance.js"), "an ACTIVE scripts/runtime/* file is scanned (not the runtime/ basename skip)");
  assert(!relSkipped(".claude/commands/events/log.md"), "an ACTIVE commands/events/* file is scanned");
  assert(!relSkipped("scripts/events/cli.js"), "an ACTIVE scripts/events/* file is scanned");
  assert(!relSkipped("scripts/dispatch/reap-orphans.js"), "a normal active script is scanned");
  assert(!relSkipped("scripts/other/no-dead-team-tools.js"), "a same-basename file in a DIFFERENT path is NOT skipped (exact-path self-exempt)");
});

h.violation("a live TeamCreate( directive (no marker) is flagged", () =>
  evaluate({ files: [{ path: "a.md", content: 'Run: TeamCreate(team_name:"x")\n' }] }));

h.test("the planted TeamCreate( yields exactly one offender on the right line", () => {
  const r = evaluate({ files: [{ path: "a.md", content: 'Run: TeamCreate(team_name:"x")\n' }] });
  assert.strictEqual(r.ok, false, "must be ok:false");
  assert.strictEqual(r.offenders.length, 1, "exactly one offender");
  assert.strictEqual(r.offenders[0].lineno, 1, "offender on line 1");
  assert.ok(/TeamCreate\(/.test(r.offenders[0].text), "offender text quotes the directive");
});

h.violation("a live TeamDelete( directive (no marker) is flagged", () =>
  evaluate({ files: [{ path: "b.js", content: "cleanup(); TeamDelete(team_name);\n" }] }));

h.pass("historical 'TeamCreate/TeamDelete were removed in v2.1.178' (non-call form) passes", () =>
  evaluate({
    files: [
      {
        path: "doc.md",
        content: "Note: TeamCreate/TeamDelete were removed in v2.1.178; use Agent spawn.\n",
      },
    ],
  }));

h.pass("'the Node-side surrogate for TeamDelete' (non-call form) passes", () =>
  evaluate({
    files: [
      { path: "notes.md", content: "We kept the Node-side surrogate for TeamDelete during migration.\n" },
    ],
  }));

h.pass("a file with no team-tool reference passes", () =>
  evaluate({ files: [{ path: "c.js", content: "const x = 1;\nfunction f(){ return x; }\n" }] }));

h.pass("the clean migrated Agent(run_in_background:true) directive passes", () =>
  evaluate({
    files: [
      {
        path: "mode.md",
        content: 'Spawn: Agent(subagent_type:"epsilon", run_in_background:true, name:"Epsilon")\n',
      },
    ],
  }));

h.violation("a live TeamCreate(...) with a trailing '// legacy' marker word is STILL flagged", () =>
  evaluate({ files: [{ path: "sneaky.js", content: 'TeamCreate(team_name:"x"); // legacy path\n' }] }));
h.violation("a live TeamCreate(...) with a trailing 'deprecated' word is STILL flagged", () =>
  evaluate({ files: [{ path: "sneaky2.md", content: 'Run TeamCreate(team_name:"x") (deprecated wrapper)\n' }] }));
h.violation("a live TeamDelete(...) followed by the word 'gone' is STILL flagged", () =>
  evaluate({ files: [{ path: "sneaky3.js", content: 'TeamDelete(t); // the old team is gone now\n' }] }));

h.violation("`TeamCreate (` with a space before the paren is flagged", () =>
  evaluate({ files: [{ path: "ws.js", content: 'TeamCreate ("x")\n' }] }));

h.test("the masked live call yields exactly one offender", () => {
  const r = evaluate({ files: [{ path: "s.js", content: 'TeamCreate(team_name:"x"); // legacy\n' }] });
  assert.strictEqual(r.ok, false, "masked live call must be ok:false");
  assert.strictEqual(r.offenders.length, 1, "exactly one offender");
});

h.pass("non-call-form prose ('the TeamCreate call is no longer available') passes", () =>
  evaluate({ files: [{ path: "doc2.md", content: "The TeamCreate call is no longer available as of v2.1.178.\n" }] }));

h.violation("a call-form in prose ('TeamCreate(...) was removed') IS flagged in the active layer", () =>
  evaluate({ files: [{ path: "active.md", content: "TeamCreate(team_name) was removed in v2.1.178.\n" }] }));

h.violation("`TeamCreate({}); // no-dead-team-tools` is STILL flagged (no self-marker escape)", () =>
  evaluate({ files: [{ path: "evil.js", content: "TeamCreate({}); // no-dead-team-tools\n" }] }));
h.violation("`TeamDelete(t); // DEAD_TOOL_RE` is STILL flagged", () =>
  evaluate({ files: [{ path: "evil2.js", content: "TeamDelete(t); // DEAD_TOOL_RE\n" }] }));
h.violation("`TeamCreate(x); // SELF_PATTERN_RE` is STILL flagged", () =>
  evaluate({ files: [{ path: "evil3.js", content: "TeamCreate(x); // SELF_PATTERN_RE\n" }] }));

h.done();
