#!/usr/bin/env node
"use strict";
/**
 * F2 falsify-unwarranted-allowlist-entry (BLOCKING tier) — S-OS-06 T2, AC-7.1 / AC-7.3.
 *
 * Every allow-view entry must carry a ONE-LINE warrant. Plants an empty / missing /
 * placeholder / multi-line / whitespace warrant into the fixture partition and asserts
 * cutover-completeness exits 1 naming F2 — and ONLY F2 (the plant keeps the entry keys, so
 * the freeze is untouched). GREEN companion: the fully warranted partition exits 0.
 *
 *   node --test tests/regression/S-OS-06/falsify-unwarranted-allowlist-entry.test.js
 */
const FALSIFIER_ID = "F2";

const test = require("node:test");
const assert = require("node:assert");
const H = require("./falsifier-harness");

test(`${FALSIFIER_ID} GREEN: fully warranted frozen partition — cutover exits 0, PASS verdict, suppressed counts emitted`, () => {
  H.withFixture({}, (fx) => {
    const human = fx.runCutover([]);
    assert.strictEqual(human.status, 0, human.out);
    assert.match(human.stdout, /PASS \[cutover-completeness\]/);
    assert.match(human.stdout, /suppressed counts/);
    assert.match(human.stdout, /class-4 history\/\*\*/);
    const r = fx.runCutover(["--json"]);
    assert.strictEqual(r.status, 0, r.out);
    assert.deepStrictEqual(H.json(r).partition.problems, []);
  });
});

const VARIANTS = [
  ["an empty warrant on a path glob", (p) => { p.pathGlobs[0].warrant = ""; }],
  ["a whitespace-only warrant on a path glob", (p) => { p.pathGlobs[0].warrant = "   "; }],
  ["a missing warrant on an occurrence pin", (p) => { delete p.occurrencePins[0].warrant; }],
  ["a placeholder warrant (TODO) on a Class-3 glob", (p) => { p.pathGlobs[1].warrant = "TODO"; }],
  ["a multi-line warrant on a generated view", (p) => { p.generatedViews[0].warrant = "first line\nsecond line"; }],
  ["a non-string warrant on an occurrence pin", (p) => { p.occurrencePins[0].warrant = 42; }],
];

for (const [label, mutate] of VARIANTS) {
  test(`${FALSIFIER_ID} RED: ${label} -> cutover exit 1 naming F2 (and nothing else)`, () => {
    H.withFixture({}, (fx) => {
      const p = fx.readPartition();
      mutate(p);
      fx.writePartition(p);

      const human = fx.runCutover([]);
      assert.strictEqual(human.status, 1, human.out);
      assert.match(human.stderr, /FAIL \[cutover-completeness\] rename partition/);
      assert.match(human.stderr, /\[F2\]/);
      assert.match(human.stderr, /suppressed counts/, "the counts are emitted on a FAIL too, never swallowed");

      const r = fx.runCutover(["--json"]);
      assert.strictEqual(r.status, 1, r.out);
      const ids = [...new Set(H.json(r).partition.problems.map((x) => x.id))];
      assert.deepStrictEqual(ids, ["F2"], `only the planted defect may fire: ${r.stdout.slice(0, 800)}`);
    });
  });
}
