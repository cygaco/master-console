#!/usr/bin/env node
"use strict";
/**
 * F6 falsify-codemod-rewrites-class3-literal (BLOCKING tier) — S-OS-06 T2, AC-4.2 / AC-6.2 / AC-7.3.
 *
 * A pinned historical/compat literal inside a live file must survive the codemod. The
 * PIN-TEST is the partition's occurrence-pin check (cutover-completeness: a pin whose
 * literal matches nothing is a non-zero exit). Mutates the ONE codemod lever that honours
 * pins (baseline-first: the lever is asserted present so the mutant is never hollow), runs
 * the mutant --apply, and asserts the pin-test exits 1 — while framework-purity alone stays
 * green, which is exactly why the pin-test must exist. A hand "fix" sweep over the pinned
 * literal is caught the same way. GREEN companion: the real codemod --apply preserves the
 * pinned literal and the Class-3 migration data byte-for-byte, and the pin-test exits 0.
 *
 * Ceiling (flagged): Class-3 PATH-GLOB content (migration data) is protected by
 * writeProtected + classification in the codemod, proven byte-identical here; an
 * exit-code detector for a rewrite of glob-protected content is AC-6.2's migration test (T3).
 *
 *   node --test tests/regression/S-OS-06/falsify-codemod-rewrites-class3-literal.test.js
 */
const FALSIFIER_ID = "F6";

const test = require("node:test");
const assert = require("node:assert");
const H = require("./falsifier-harness");

const BANNER = { "src/banner.js": `// ${H.SLUG} banner\n` };
const MIGRATION_REL = "migrations/1.2.0-to-2.0.0/migrate.js";
const PINNED_LITERAL = `".${H.SLUG}"`;
const PIN_LEVER = "const pin = partition.findOccurrencePin(relPath, lineText);";

function installPinLeverMutant(fx) {
  const src = fx.read(H.REL.codemod);
  assert.ok(src.includes(PIN_LEVER), "the codemod's pin lever must exist — otherwise this mutant is hollow and proves nothing");
  fx.write(H.REL.codemod, src.replace(PIN_LEVER, "const pin = null; // F6 mutant: the pin lever is removed"));
}

function assertPinTestRed(fx) {
  const human = fx.runCutover([]);
  assert.strictEqual(human.status, 1, `the pin-test must exit 1: ${human.out}`);
  assert.ok(
    human.stderr.includes(`[F7] stale occurrence pin 'pin|src/paths.js|${PINNED_LITERAL}|const LEGACY_HOME_SEGMENT = ' matches NOTHING`),
    `the stale pin must be named: ${human.stderr.slice(0, 1200)}`
  );
  const r = fx.runCutover(["--json"]);
  assert.strictEqual(r.status, 1, r.out);
  assert.deepStrictEqual([...new Set(H.json(r).partition.problems.map((p) => p.id))], ["F7"]);
}

test(`${FALSIFIER_ID} GREEN: the real codemod --apply preserves the pinned literal and the Class-3 migration data; the pin-test exits 0`, () => {
  H.withFixture({ extraFiles: BANNER }, (fx) => {
    const pinned = fx.read("src/paths.js");
    const migration = fx.read(MIGRATION_REL);
    const apply = fx.runCodemod(["--apply"]);
    assert.strictEqual(apply.status, 0, apply.out);
    assert.strictEqual(fx.read("src/banner.js"), "// mc banner\n", "the GREEN apply must really rewrite live content");
    assert.strictEqual(fx.read("src/paths.js"), pinned, "the pinned literal's file is byte-identical");
    assert.strictEqual(fx.read(MIGRATION_REL), migration, "Class-3 migration data is byte-identical");
    const cut = fx.runCutover([]);
    assert.strictEqual(cut.status, 0, cut.out);
  });
});

test(`${FALSIFIER_ID} RED: a codemod with its pin lever removed rewrites the Class-3 literal -> the pin-test exits 1 (purity alone stays green)`, () => {
  H.withFixture({ extraFiles: BANNER }, (fx) => {
    installPinLeverMutant(fx);
    const apply = fx.runCodemod(["--apply"]);
    assert.strictEqual(apply.status, 0, `the mutant applies without complaint: ${apply.out}`);
    const after = fx.read("src/paths.js");
    assert.ok(!after.includes(PINNED_LITERAL) && after.includes('".mc"'), `the mutant must really rewrite the pinned literal: ${after}`);

    assertPinTestRed(fx);

    const purity = fx.runPurity([]);
    assert.strictEqual(purity.status, 0, `purity cannot see a rewritten literal — the pin-test is the guard: ${purity.out}`);
  });
});

test(`${FALSIFIER_ID} RED: a hand "fix" sweep over the pinned literal (a gate-fixing edit) -> the pin-test exits 1`, () => {
  H.withFixture({}, (fx) => {
    fx.write("src/paths.js", fx.read("src/paths.js").replace(PINNED_LITERAL, '".mc"'));
    assertPinTestRed(fx);
  });
});
