#!/usr/bin/env node
"use strict";
/**
 * F8 falsify-postfreeze-silent-addition (BLOCKING tier, β r3) — S-OS-06 T2, AC-7.3.
 *
 * After the freeze, an allow-list addition must be its OWN warranted amendment: a separate
 * commit touching only the partition (+ the occurrence ledger), carrying
 * `partition-amendment:` in its message, with an {key, warrant} amendment record — and the
 * frozen baseline is immutable. The freeze is keyed on entry keys (file + matchText
 * [+ anchor] for pins), never line numbers.
 *
 * RED: an entry folded into a gate-fixing commit; a silent working-tree addition; an
 * unmarked commit; a baseline rewrite that launders a new entry; an unwarranted amendment;
 * a removed $freeze — each makes cutover-completeness exit 1 naming F8, and only F8.
 * GREEN: an unrelated post-freeze commit, a proper amendment commit, and an edit ABOVE a
 * pinned line (its line number moves, its key does not) all exit 0.
 *
 *   node --test tests/regression/S-OS-06/falsify-postfreeze-silent-addition.test.js
 */
const FALSIFIER_ID = "F8";

const test = require("node:test");
const assert = require("node:assert");
const H = require("./falsifier-harness");

const VENDOR = { "vendor/lib.js": "module.exports = 1;\n" };
const NEW_KEY = "glob|vendor/**";

function addVendorGlob(p) {
  p.pathGlobs.push({ pattern: "vendor/**", class: 4, writeProtected: true, warrant: "fixture vendored third-party tree" });
}

function assertGreen(fx, noteRe) {
  const r = fx.runCutover([]);
  assert.strictEqual(r.status, 0, r.out);
  if (noteRe) assert.match(r.stdout, noteRe);
}

function assertOnlyF8(fx, messageRe) {
  const human = fx.runCutover([]);
  assert.strictEqual(human.status, 1, `a post-freeze silent addition must be a NON-ZERO exit: ${human.out}`);
  assert.match(human.stderr, /\[F8\]/);
  assert.match(human.stderr, messageRe);
  const r = fx.runCutover(["--json"]);
  assert.strictEqual(r.status, 1, r.out);
  assert.deepStrictEqual([...new Set(H.json(r).partition.problems.map((p) => p.id))], ["F8"], r.stdout.slice(0, 1200));
}

test(`${FALSIFIER_ID} GREEN: a post-freeze commit that touches only live code (no partition change) -> exit 0`, () => {
  H.withFixture({ extraFiles: VENDOR }, (fx) => {
    fx.write("src/app.js", 'module.exports = { name: "fixture", v: 2 };\n');
    fx.commit("fix: live tweak after the freeze", ["src/app.js"]);
    assertGreen(fx, /F8: frozen at [0-9a-f]{12}; 0 amendment\(s\) on record/);
  });
});

test(`${FALSIFIER_ID} GREEN: a separate, marked, warranted, partition-only amendment commit -> exit 0`, () => {
  H.withFixture({ extraFiles: VENDOR }, (fx) => {
    const p = fx.readPartition();
    addVendorGlob(p);
    p.$freeze.amendments.push({ key: NEW_KEY, warrant: "vendored tree added after the freeze, reviewed as its own amendment" });
    fx.writePartition(p);
    fx.commit("partition-amendment: allow vendor/** (vendored third-party tree)", [H.REL.partition]);
    assertGreen(fx, /1 amendment\(s\) on record/);
  });
});

test(`${FALSIFIER_ID} GREEN (R4 keying): an edit ABOVE a pinned line moves its line number — the pin and the freeze still hold`, () => {
  H.withFixture({}, (fx) => {
    fx.write("src/paths.js", `// header added above the pin\n// a second header line\n${fx.read("src/paths.js")}`);
    fx.commit("docs: header comments above the compat literal", ["src/paths.js"]);
    assertGreen(fx);
  });
});

test(`${FALSIFIER_ID} RED: an allow-list entry folded into a gate-fixing commit (even marked and amended) -> exit 1`, () => {
  H.withFixture({ extraFiles: VENDOR }, (fx) => {
    const p = fx.readPartition();
    addVendorGlob(p);
    p.$freeze.amendments.push({ key: NEW_KEY, warrant: "looks warranted, but rides along with a gate fix" });
    fx.writePartition(p);
    fx.write("src/app.js", 'module.exports = { name: "fixture", gateFixed: true };\n');
    fx.commit("partition-amendment: fix the gate and allow vendor/**", [H.REL.partition, "src/app.js"]);
    assertOnlyF8(fx, /must be its OWN warranted amendment commit, never folded into a gate-fixing commit/);
  });
});

test(`${FALSIFIER_ID} RED: a silent working-tree addition with no amendment record -> exit 1`, () => {
  H.withFixture({ extraFiles: VENDOR }, (fx) => {
    const p = fx.readPartition();
    addVendorGlob(p);
    fx.writePartition(p);
    assertOnlyF8(fx, /post-freeze silent addition 'glob\|vendor\/\*\*'/);
  });
});

test(`${FALSIFIER_ID} RED: a partition-only commit adding an entry WITHOUT the partition-amendment: marker -> exit 1`, () => {
  H.withFixture({ extraFiles: VENDOR }, (fx) => {
    const p = fx.readPartition();
    addVendorGlob(p);
    p.$freeze.amendments.push({ key: NEW_KEY, warrant: "warranted but committed as a chore" });
    fx.writePartition(p);
    fx.commit("chore: allow vendor", [H.REL.partition]);
    assertOnlyF8(fx, /without the 'partition-amendment:' marker/);
  });
});

test(`${FALSIFIER_ID} RED: laundering — a commit that rewrites $freeze.baselineKeys to absorb a new entry -> exit 1`, () => {
  H.withFixture({ extraFiles: VENDOR }, (fx) => {
    const p = fx.readPartition();
    addVendorGlob(p);
    p.$freeze.baselineKeys = H.LOADER.entryKeys(p);
    fx.writePartition(p);
    fx.commit("partition-amendment: re-baseline", [H.REL.partition]);
    assertOnlyF8(fx, /rewrites \$freeze\.baselineKeys/);
  });
});

test(`${FALSIFIER_ID} RED: an amendment record with no warrant -> exit 1`, () => {
  H.withFixture({ extraFiles: VENDOR }, (fx) => {
    const p = fx.readPartition();
    addVendorGlob(p);
    p.$freeze.amendments.push({ key: NEW_KEY, warrant: "" });
    fx.writePartition(p);
    fx.commit("partition-amendment: allow vendor/**", [H.REL.partition]);
    assertOnlyF8(fx, /has no one-line warrant/);
  });
});

test(`${FALSIFIER_ID} RED: the $freeze block removed -> exit 1 (an unfrozen allow-list is not frozen)`, () => {
  H.withFixture({}, (fx) => {
    const p = fx.readPartition();
    delete p.$freeze;
    fx.writePartition(p);
    assertOnlyF8(fx, /carries no \$freeze block/);
  });
});

test(`${FALSIFIER_ID} RED (β R4 key-set equality): a frozen baseline entry REMOVED with no amendment -> exit 1`, () => {
  H.withFixture({}, (fx) => {
    const p = fx.readPartition();
    const removed = p.occurrencePins.find((pin) => pin.file === "src/paths.js");
    assert.ok(removed, "the base fixture must carry the src/paths.js pin");
    p.occurrencePins = p.occurrencePins.filter((pin) => pin !== removed);
    fx.writePartition(p);
    assertOnlyF8(fx, /post-freeze silent removal '.*' — a frozen baseline entry is gone with no warranted amendment/);
  });
});

test(`${FALSIFIER_ID} GREEN (β R4): a baseline entry removed WITH a warranted removal amendment -> exit 0`, () => {
  H.withFixture({}, (fx) => {
    const p = fx.readPartition();
    const removed = p.occurrencePins.find((pin) => pin.file === "src/paths.js");
    const key = `pin|${removed.file}|${removed.matchText}|${removed.anchor || ""}`;
    p.occurrencePins = p.occurrencePins.filter((pin) => pin !== removed);
    p.$freeze.amendments.push({ key, removed: true, warrant: "fixture: the pinned literal was rewritten away; the entry is retired as a warranted removal" });
    fx.writePartition(p);
    fx.commit("partition-amendment: retire the src/paths.js pin (literal rewritten away)", [H.REL.partition]);
    assertGreen(fx);
  });
});
