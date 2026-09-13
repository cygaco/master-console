#!/usr/bin/env node
"use strict";
/**
 * F4 falsify-unclassified-path (BLOCKING tier) — S-OS-06 T2, AC-1.1 / AC-7.3.
 *
 * A tracked path whose partition entry carries no valid class (out of range, wrong type,
 * absent) is UNCLASSIFIED: the loader propagates the invalid class instead of coercing it
 * to Class 1, and `rename-mc.js --apply` must refuse before writing anything; the dry-run
 * must exit 1 with unclassified=1 naming the path. GREEN companion: a fully classified
 * fixture dry-runs unclassified=0 and --apply really runs.
 *
 *   node --test tests/regression/S-OS-06/falsify-unclassified-path.test.js
 */
const FALSIFIER_ID = "F4";

const test = require("node:test");
const assert = require("node:assert");
const H = require("./falsifier-harness");

const BANNER = { "src/banner.js": `// ${H.SLUG} banner\n` };
const VENDOR = `module.exports = "${H.SLUG}-vendor";\n`;

test(`${FALSIFIER_ID} GREEN: every tracked path classified — dry-run prints unclassified=0 and --apply runs (exit 0)`, () => {
  H.withFixture({ extraFiles: BANNER }, (fx) => {
    const dry = fx.runCodemod(["--dry-run"]);
    assert.strictEqual(dry.status, 0, dry.out);
    assert.match(dry.stdout, /unclassified=0/);
    const apply = fx.runCodemod(["--apply"]);
    assert.strictEqual(apply.status, 0, apply.out);
    assert.strictEqual(fx.read("src/banner.js"), "// mc banner\n", "the GREEN apply must really rewrite live content");
  });
});

const INVALID = [
  ["an out-of-range class (7)", 7],
  ["a string class (\"3\")", "3"],
  ["no class field at all", undefined],
  ["a null class", null],
];

for (const [label, cls] of INVALID) {
  test(`${FALSIFIER_ID} RED: a tracked path whose entry carries ${label} -> --apply refuses and writes nothing`, () => {
    H.withFixture({ extraFiles: { ...BANNER, "vendor/lib.js": VENDOR } }, (fx) => {
      const p = fx.readPartition();
      const entry = { pattern: "vendor/**", class: cls, writeProtected: true, warrant: "fixture vendor tree" };
      if (cls === undefined) delete entry.class;
      p.pathGlobs.push(entry);
      fx.writePartition(p);

      const apply = fx.runCodemod(["--apply"]);
      assert.notStrictEqual(apply.status, 0, `--apply must refuse: ${apply.out}`);
      assert.match(apply.stderr, /--apply refused: 1 unclassified path/);
      assert.strictEqual(fx.read("src/banner.js"), BANNER["src/banner.js"], "the refusal happens before ANY rewrite");
      assert.strictEqual(fx.read("vendor/lib.js"), VENDOR);

      const dry = fx.runCodemod(["--dry-run"]);
      assert.strictEqual(dry.status, 1, dry.out);
      assert.match(dry.stdout, /unclassified=1/);
      assert.match(dry.stderr, /vendor\/lib\.js/);
    });
  });
}
