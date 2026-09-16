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
 * S-OS-06 r4 B2 (removal-history teeth): the history layer used to `continue` whenever a commit ADDED no key, so
 * a REMOVAL was never judged for marker / partition-only / record. Now the removed set (parent minus commit) is
 * judged exactly like additions, and a removal needs an explicit {key, removed: true, warrant} record (at that
 * commit or on the current artifact). Triple: a proper removal amendment is GREEN with the swept history population
 * emitted (1 removing commit), the SAME removal folded into a gate-fixing commit is RED (the old loop was blind:
 * zero keys added), and resetting back to the proper commit re-observes GREEN over the same population.
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

// ── S-OS-06 r4 B2: removal-history teeth ──────────────────────────────────────────────────────────────────────────

const HISTORY_NOTE_RE = /history swept: (\d+) post-freeze partition commit\(s\) — (\d+) adding (\d+) key\(s\), (\d+) removing (\d+) key\(s\)/;

/** The swept F8 history population, parsed from cutover --json partition.notes (a zero without it is a bare count). */
function historyPopulation(fx) {
  const r = fx.runCutover(["--json"]);
  const j = H.json(r);
  const note = (j.partition.notes || []).find((n) => HISTORY_NOTE_RE.test(n));
  assert.ok(note, `cutover must emit the swept F8 history population: ${JSON.stringify(j.partition.notes)}`);
  const m = note.match(HISTORY_NOTE_RE);
  return {
    status: r.status,
    problems: j.partition.problems,
    inspected: Number(m[1]),
    adding: Number(m[2]),
    keysAdded: Number(m[3]),
    removing: Number(m[4]),
    keysRemoved: Number(m[5]),
    note,
  };
}

function pinKey(pin) {
  return `pin|${pin.file}|${pin.matchText}|${pin.anchor || ""}`;
}

/** Remove the base fixture's src/paths.js pin; withRecord adds the {key, removed: true, warrant} record. */
function removeBasePin(fx, { withRecord = true } = {}) {
  const p = fx.readPartition();
  const removed = p.occurrencePins.find((pin) => pin.file === "src/paths.js");
  assert.ok(removed, "the base fixture must carry the src/paths.js pin");
  p.occurrencePins = p.occurrencePins.filter((pin) => pin !== removed);
  if (withRecord) p.$freeze.amendments.push({ key: pinKey(removed), removed: true, warrant: "fixture: the pinned literal was rewritten away; retired as a warranted removal" });
  fx.writePartition(p);
  return pinKey(removed);
}

test(`${FALSIFIER_ID} r4 B2 TRIPLE: proper removal amendment GREEN -> same removal folded into a gate fix RED -> reset GREEN (population emitted each time)`, (t) => {
  H.withFixture({}, (fx) => {
    // (0) the unmutated fixture: the swept history population is empty and says so.
    const empty = historyPopulation(fx);
    t.diagnostic(`unmutated fixture: exit=${empty.status} problems=${empty.problems.length} :: ${empty.note}`);
    assert.strictEqual(empty.status, 0, JSON.stringify(empty.problems));
    assert.strictEqual(empty.inspected, 0);

    // (1) GREEN control: the removal is its OWN marked, partition-only amendment with a removal record.
    const key = removeBasePin(fx);
    const control = fx.commit("partition-amendment: retire the src/paths.js pin (literal rewritten away)", [H.REL.partition]);
    const green = historyPopulation(fx);
    t.diagnostic(`control ${control.slice(0, 12)}: exit=${green.status} problems=${green.problems.length} :: ${green.note}`);
    assert.strictEqual(green.status, 0, JSON.stringify(green.problems));
    assert.deepStrictEqual([green.inspected, green.removing, green.keysRemoved, green.adding], [1, 1, 1, 0], "the removal commit is INSIDE the swept history population");

    // (2) RED plant: the SAME removal (record and marker intact) folded into a commit that also fixes live code.
    // The pre-r4 loop saw zero ADDED keys here and skipped the commit — the blind spot.
    fx.write("src/app.js", 'module.exports = { name: "fixture", gateFixed: true };\n');
    fx.git(["add", "--", "src/app.js"]);
    fx.git(["commit", "-q", "--amend", "-m", "partition-amendment: fix the gate and retire the src/paths.js pin"]);
    const red = historyPopulation(fx);
    t.diagnostic(`plant (amended into a gate fix): exit=${red.status} problems=${red.problems.length} :: ${red.note}`);
    assert.strictEqual(red.status, 1, "a removal folded into a gate-fixing commit must be a NON-ZERO exit");
    assert.deepStrictEqual([red.inspected, red.removing, red.keysRemoved], [1, 1, 1], "the plant sits inside the same swept population");
    assert.deepStrictEqual([...new Set(red.problems.map((p) => p.id))], ["F8"]);
    assert.ok(
      red.problems.some(
        (p) =>
          /removes \[.*\] inside a commit that also changes src\/app\.js — a post-freeze addition or removal must be its OWN warranted amendment commit/.test(p.message) &&
          p.message.includes(key)
      ),
      JSON.stringify(red.problems)
    );
    assertOnlyF8(fx, /never folded into a gate-fixing commit/);

    // (3) revert: back to the proper amendment commit -> GREEN again over the same population.
    fx.git(["reset", "-q", "--hard", control]);
    const again = historyPopulation(fx);
    t.diagnostic(`reverted to ${control.slice(0, 12)}: exit=${again.status} problems=${again.problems.length} :: ${again.note}`);
    assert.strictEqual(again.status, 0, JSON.stringify(again.problems));
    assert.deepStrictEqual([again.inspected, again.removing, again.keysRemoved], [1, 1, 1]);
  });
});

test(`${FALSIFIER_ID} r4 B2 RED: a partition-only removal commit WITHOUT the partition-amendment: marker -> exit 1`, () => {
  H.withFixture({}, (fx) => {
    removeBasePin(fx);
    fx.commit("chore: drop a pin", [H.REL.partition]);
    const pop = historyPopulation(fx);
    assert.strictEqual(pop.removing, 1, "the unmarked removal commit is inside the swept population");
    assertOnlyF8(fx, /removes \[.*\] without the 'partition-amendment:' marker/);
  });
});

test(`${FALSIFIER_ID} r4 B2 RED: an AMENDED entry removed together with its own addition record (marked, partition-only) -> exit 1`, () => {
  // The 247f9170 shape: the worktree layer never sees a non-baseline key disappear, and the pre-r4 history layer
  // skipped the commit (nothing added) — so retiring an amended entry AND erasing its record was invisible.
  H.withFixture({ extraFiles: VENDOR }, (fx) => {
    const p = fx.readPartition();
    addVendorGlob(p);
    p.$freeze.amendments.push({ key: NEW_KEY, warrant: "vendored tree added after the freeze, reviewed as its own amendment" });
    fx.writePartition(p);
    fx.commit("partition-amendment: allow vendor/** (vendored third-party tree)", [H.REL.partition]);
    assertGreen(fx);

    const q = fx.readPartition();
    q.pathGlobs = q.pathGlobs.filter((g) => g.pattern !== "vendor/**");
    q.$freeze.amendments = q.$freeze.amendments.filter((a) => a.key !== NEW_KEY);
    fx.writePartition(q);
    fx.commit("partition-amendment: retire vendor/**", [H.REL.partition]);
    const pop = historyPopulation(fx);
    assert.deepStrictEqual([pop.inspected, pop.adding, pop.removing], [2, 1, 1], pop.note);
    assertOnlyF8(fx, /removes 'glob\|vendor\/\*\*' without a removal amendment record/);
  });
});

test(`${FALSIFIER_ID} r4 B2 RED: an addition record is NOT a removal warrant — retiring an amended entry needs removed:true -> exit 1`, () => {
  H.withFixture({ extraFiles: VENDOR }, (fx) => {
    const p = fx.readPartition();
    addVendorGlob(p);
    p.$freeze.amendments.push({ key: NEW_KEY, warrant: "vendored tree added after the freeze, reviewed as its own amendment" });
    fx.writePartition(p);
    fx.commit("partition-amendment: allow vendor/**", [H.REL.partition]);
    const q = fx.readPartition();
    q.pathGlobs = q.pathGlobs.filter((g) => g.pattern !== "vendor/**");
    fx.writePartition(q); // the addition record stays; no removal record is written
    fx.commit("partition-amendment: retire vendor/**", [H.REL.partition]);
    assertOnlyF8(fx, /removes 'glob\|vendor\/\*\*' without a removal amendment record/);
  });
});

test(`${FALSIFIER_ID} r4 B2 GREEN: retiring an amended entry with a removed:true record in its own marked partition-only commit -> exit 0`, () => {
  H.withFixture({ extraFiles: VENDOR }, (fx) => {
    const p = fx.readPartition();
    addVendorGlob(p);
    p.$freeze.amendments.push({ key: NEW_KEY, warrant: "vendored tree added after the freeze, reviewed as its own amendment" });
    fx.writePartition(p);
    fx.commit("partition-amendment: allow vendor/**", [H.REL.partition]);
    const q = fx.readPartition();
    q.pathGlobs = q.pathGlobs.filter((g) => g.pattern !== "vendor/**");
    q.$freeze.amendments.push({ key: NEW_KEY, removed: true, warrant: "the vendored tree was deleted; its glob is retired" });
    fx.writePartition(q);
    fx.commit("partition-amendment: retire vendor/** (tree deleted)", [H.REL.partition]);
    const pop = historyPopulation(fx);
    assert.strictEqual(pop.status, 0, JSON.stringify(pop.problems));
    assert.deepStrictEqual([pop.inspected, pop.adding, pop.keysAdded, pop.removing, pop.keysRemoved], [2, 1, 1, 1, 1], pop.note);
  });
});

test(`${FALSIFIER_ID} r4 B2 GREEN: a removal recorded LATER (a still-registered removal record on the current artifact) -> exit 0`, () => {
  // The β R4 precedent (8f1bfd87): a removal that was partition-only and marked, whose record was added afterwards.
  H.withFixture({}, (fx) => {
    const key = removeBasePin(fx, { withRecord: false });
    fx.commit("partition-amendment: retire the src/paths.js pin", [H.REL.partition]);
    const p = fx.readPartition();
    p.$freeze.amendments.push({ key, removed: true, warrant: "retroactive removal record for the retired src/paths.js pin" });
    fx.writePartition(p);
    fx.commit("partition-amendment: record the src/paths.js pin removal", [H.REL.partition]);
    const pop = historyPopulation(fx);
    assert.strictEqual(pop.status, 0, JSON.stringify(pop.problems));
    assert.deepStrictEqual([pop.inspected, pop.removing, pop.keysRemoved], [2, 1, 1], pop.note);
  });
});
