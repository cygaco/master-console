#!/usr/bin/env node
"use strict";
/**
 * F7 falsify-stale-allowlist-entry — S-OS-06 T2, AC-7.3 (β r3: a NON-ZERO exit, not "surfaced").
 *
 * An allow-view entry that matches NOTHING is a green badge on nothing. Plants a path glob
 * matching no tracked path, a pin whose literal is gone, a pin on an untracked file, an
 * ambiguous pin, a hollow pin on a Class-4 file, and a generated-view entry with no file —
 * each must make cutover-completeness exit 1 naming F7, and ONLY F7 (plants that change the
 * entry set re-freeze the working-tree baseline so the freeze check stays quiet; nothing is
 * committed). GREEN companions: the clean partition exits 0, and a glob over a gitignored
 * tree is reported as protective, not stale.
 *
 *   node --test tests/regression/S-OS-06/falsify-stale-allowlist-entry.test.js
 */
const FALSIFIER_ID = "F7";

const test = require("node:test");
const assert = require("node:assert");
const H = require("./falsifier-harness");

function plantPartition(fx, mutate) {
  const p = fx.readPartition();
  mutate(p);
  p.$freeze.baselineKeys = H.LOADER.entryKeys(p); // isolate F7 from F8 (working tree only; nothing committed)
  fx.writePartition(p);
}

function assertOnlyF7(fx, messageRe) {
  const human = fx.runCutover([]);
  assert.strictEqual(human.status, 1, `a stale entry must be a NON-ZERO exit: ${human.out}`);
  assert.match(human.stderr, /\[F7\]/);
  assert.match(human.stderr, messageRe);
  const r = fx.runCutover(["--json"]);
  assert.strictEqual(r.status, 1, r.out);
  assert.deepStrictEqual([...new Set(H.json(r).partition.problems.map((p) => p.id))], ["F7"], r.stdout.slice(0, 800));
}

test(`${FALSIFIER_ID} GREEN: every entry matches something — cutover exits 0`, () => {
  H.withFixture({}, (fx) => {
    const r = fx.runCutover([]);
    assert.strictEqual(r.status, 0, r.out);
  });
});

test(`${FALSIFIER_ID} GREEN: a glob over a gitignored tree matches 0 tracked paths but is protective, not stale (exit 0, noted)`, () => {
  H.withFixture({ extraFiles: { ".gitignore": "cache/\n" } }, (fx) => {
    plantPartition(fx, (p) => p.pathGlobs.push({ pattern: "cache/**", class: 4, writeProtected: true, warrant: "fixture local cache tree" }));
    const r = fx.runCutover([]);
    assert.strictEqual(r.status, 0, r.out);
    assert.match(r.stdout, /guarded-ignored: 'cache\/\*\*'/);
  });
});

test(`${FALSIFIER_ID} RED: a path glob that matches no tracked path -> exit 1`, () => {
  H.withFixture({}, (fx) => {
    plantPartition(fx, (p) =>
      p.pathGlobs.push({ pattern: "legacy-tools/**", class: 4, writeProtected: true, warrant: "fixture tree that no longer exists" })
    );
    assertOnlyF7(fx, /stale allow-list entry 'legacy-tools\/\*\*' matches NOTHING/);
  });
});

test(`${FALSIFIER_ID} RED: an occurrence pin whose literal is gone from its file -> exit 1`, () => {
  H.withFixture({}, (fx) => {
    fx.write("src/paths.js", "const LEGACY_HOME_SEGMENT = null;\nmodule.exports = { LEGACY_HOME_SEGMENT };\n");
    assertOnlyF7(fx, /stale occurrence pin .* matches NOTHING/);
  });
});

test(`${FALSIFIER_ID} RED: an occurrence pin on a file that is not tracked -> exit 1`, () => {
  H.withFixture({}, (fx) => {
    plantPartition(fx, (p) =>
      p.occurrencePins.push({ file: "src/removed.js", matchText: `"${H.SLUG}"`, warrant: "fixture pin on a deleted file" })
    );
    assertOnlyF7(fx, /its file is not tracked/);
  });
});

test(`${FALSIFIER_ID} RED: an ambiguous occurrence pin (its literal on two lines) -> exit 1`, () => {
  H.withFixture({}, (fx) => {
    const line = fx.read("src/paths.js").split("\n")[0];
    fx.write("src/paths.js", `${line}\n${line}\nmodule.exports = { LEGACY_HOME_SEGMENT };\n`);
    assertOnlyF7(fx, /ambiguous occurrence pin .* matches 2 lines/);
  });
});

test(`${FALSIFIER_ID} RED: a hollow occurrence pin on a Class-4 file -> exit 1`, () => {
  H.withFixture({}, (fx) => {
    plantPartition(fx, (p) =>
      p.occurrencePins.push({ file: "history/2026-notes.md", matchText: `the ${H.SLUG} era`, warrant: "fixture pin inside a historical tree" })
    );
    assertOnlyF7(fx, /hollow occurrence pin/);
  });
});

test(`${FALSIFIER_ID} RED: a generated-view entry with no tracked file -> exit 1`, () => {
  H.withFixture({}, (fx) => {
    plantPartition(fx, (p) => p.generatedViews.push({ path: ".claude/gone.json", class: 1, warrant: "fixture view that is no longer generated" }));
    assertOnlyF7(fx, /stale generated-view entry '\.claude\/gone\.json'/);
  });
});
