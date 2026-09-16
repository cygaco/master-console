#!/usr/bin/env node
"use strict";
/**
 * B1 falsify-changelog-historical-unregistered (S-OS-06 r4 lane B, β 6d4a2f18 unasked finding).
 *
 * Before r4 a legacy-slug occurrence on a CHANGELOG.md line inside a < 2.0.0 section was absolved by an INLINE
 * BOOLEAN (rename-mc.js:679 delta + :755 ledger `changelog-historical`, and the same boolean in the loader's gate
 * tally) — closed by an `if`, with no register entry behind it. r4 removes the boolean; each such occurrence is
 * closed only by its OWN registered occurrence pin.
 *
 * TRIPLE (one fixture):
 *   GREEN control — a < 2.0.0 CHANGELOG line whose slug carries its own pin: purity exit 0 (live_unallowed 0) and the
 *     codemod pins it; the scanned file count and the occurrence population are emitted beside the zero.
 *   RED plant — an UNREGISTERED slug on another line of the SAME < 2.0.0 section (where the old boolean was blind):
 *     purity exit 1 naming CHANGELOG.md with live_unallowed 1, the population grows by exactly that one occurrence,
 *     and the codemod ledger dispositions it `rewritten` (never `pinned` by a section rule).
 *   revert — the plant removed: GREEN again over the control population.
 *
 *   node --test tests/regression/S-OS-06/falsify-changelog-historical-unregistered.test.js
 */
const FALSIFIER_ID = "B1-CHANGELOG-HIST";

const test = require("node:test");
const assert = require("node:assert");
const H = require("./falsifier-harness");

const LEG = H.SLUG; // built from the slug so this file plants no literal of its own (the directory is Class-3 anyway)
const CHANGELOG = "CHANGELOG.md";
const PINNED_LITERAL = `\`_${LEG}/templates\``;
const PLANT_LINE = `- shipped: the home state dir ~/.${LEG}/state was introduced`;

function changelog({ plant = false } = {}) {
  return [
    "# Changelog",
    "",
    "## [2.0.0] — Unreleased",
    "- live entry, nothing legacy here",
    "",
    "## [1.2.0] — 2026-07-29",
    `- shipped: templates moved out of ${PINNED_LITERAL}`,
    ...(plant ? [PLANT_LINE] : []),
    "",
  ].join("\n");
}

function pinChangelog(p) {
  p.occurrencePins.push({
    file: CHANGELOG,
    matchText: PINNED_LITERAL,
    warrant: "fixture CHANGELOG history: the [1.2.0] entry names the directory as it was at that release",
  });
}

function fixture(fn) {
  return H.withFixture({ version: "2.0.0", extraFiles: { [CHANGELOG]: changelog() }, partition: H.basePartition({ mutate: pinChangelog }) }, fn);
}

/** Purity's legacy-slug frame: exit, live_unallowed, pinned, scanned files and the whole occurrence population. */
function purityFrame(fx) {
  const r = fx.runPurity(["--json"]);
  const j = H.json(r);
  const d = j.legacy_slug.dispositions;
  return {
    status: r.status,
    liveUnallowed: j.legacy_slug.live_unallowed,
    pinned: j.legacy_slug.pinned,
    scanned: j.scanned,
    occurrences: d.pinned + d.derived + d.compat + d.historicalAllowListed + d.liveUnallowed,
    findingPaths: j.findings.legacy_slug.map((f) => f.path),
    hasChangelogHistoricalTerm: Object.prototype.hasOwnProperty.call(j.legacy_slug, "changelog_historical"),
    out: r.out,
  };
}

function dryCounts(fx) {
  const dry = fx.runCodemod(["--dry-run"]);
  const m = dry.stdout.match(/disposition counts: rewritten=(\d+) pinned=(\d+) compat=(\d+) derived=(\d+)/);
  assert.ok(m, `the dry-run must print its disposition counts: ${dry.out.slice(0, 1500)}`);
  return { status: dry.status, rewritten: Number(m[1]), pinned: Number(m[2]), out: dry.out };
}

test(`${FALSIFIER_ID} unit: the loader tally has NO section-based absolution — an unregistered < 2.0.0 CHANGELOG occurrence is live-unallowed`, () => {
  const partition = H.LOADER.buildPartition(H.basePartition({ mutate: pinChangelog }));
  const content = changelog({ plant: true });
  assert.ok(partition.historicalChangelogLines(content).has(content.split("\n").indexOf(PLANT_LINE) + 1), "fixture sanity: the plant sits in a < 2.0.0 section");
  const tally = partition.createLegacySlugTally({ version: "2.0.0" });
  partition.tallyLegacySlug(tally, CHANGELOG, content, LEG);
  assert.strictEqual(tally.pendingTotal, 1, "the unregistered historical-section occurrence is live-unallowed");
  assert.strictEqual(tally.pinnedTotal, 1, "the pinned one is closed by its registered pin");
  assert.ok(!Object.keys(tally).some((k) => /changelog/i.test(k)), `no changelog-historical counter survives: ${Object.keys(tally)}`);
  const summary = partition.dispositionSummary(tally);
  assert.ok(!("changelogHistorical" in summary.historicalAllowListedBreakdown), "historical-allow-listed carries no section term");
});

test(`${FALSIFIER_ID} TRIPLE: pinned < 2.0.0 occurrence GREEN -> unregistered one planted in the same section RED -> revert GREEN (population emitted)`, (t) => {
  fixture((fx) => {
    // (1) GREEN control
    const green = purityFrame(fx);
    const gDry = dryCounts(fx);
    t.diagnostic(`control: purity exit=${green.status} live_unallowed=${green.liveUnallowed} pinned=${green.pinned} over ${green.occurrences} occurrence(s) in scanned=${green.scanned} file(s); codemod rewritten=${gDry.rewritten} pinned=${gDry.pinned}`);
    assert.strictEqual(green.status, 0, green.out.slice(0, 1500));
    assert.strictEqual(green.liveUnallowed, 0);
    assert.strictEqual(green.pinned, 2, "src/paths.js pin + the CHANGELOG occurrence pin");
    assert.ok(green.scanned > 0 && green.occurrences > 0, "a zero over an empty sweep is not a clean zero");
    assert.strictEqual(green.hasChangelogHistoricalTerm, false, "the gate emits no changelog_historical term");
    assert.deepStrictEqual([gDry.status, gDry.rewritten, gDry.pinned], [0, 0, 2]);

    // (2) RED plant: an unregistered slug on a < 2.0.0 line — the pre-r4 boolean absolved exactly this.
    fx.write(CHANGELOG, changelog({ plant: true }));
    const red = purityFrame(fx);
    const rDry = dryCounts(fx);
    t.diagnostic(`plant: purity exit=${red.status} live_unallowed=${red.liveUnallowed} pinned=${red.pinned} over ${red.occurrences} occurrence(s) in scanned=${red.scanned} file(s); codemod rewritten=${rDry.rewritten} pinned=${rDry.pinned}`);
    assert.strictEqual(red.status, 1, `an unregistered occurrence in a < 2.0.0 CHANGELOG section must fail the gate: ${red.out.slice(0, 1500)}`);
    assert.strictEqual(red.liveUnallowed, 1);
    assert.deepStrictEqual(red.findingPaths, [CHANGELOG]);
    assert.strictEqual(red.pinned, green.pinned, "no pin (and no section rule) absorbs the plant");
    assert.strictEqual(red.occurrences, green.occurrences + 1, "the plant is inside the swept population: exactly one more occurrence");
    assert.strictEqual(red.scanned, green.scanned);
    assert.strictEqual(rDry.pinned, gDry.pinned, `the codemod ledger must not pin the plant: ${rDry.out.slice(0, 800)}`);
    assert.strictEqual(rDry.rewritten, 1, "the unregistered occurrence is dispositioned rewritten, never changelog-historical");

    // (3) revert
    fx.write(CHANGELOG, changelog());
    const again = purityFrame(fx);
    const aDry = dryCounts(fx);
    t.diagnostic(`reverted: purity exit=${again.status} live_unallowed=${again.liveUnallowed} pinned=${again.pinned} over ${again.occurrences} occurrence(s) in scanned=${again.scanned} file(s); codemod rewritten=${aDry.rewritten} pinned=${aDry.pinned}`);
    assert.strictEqual(again.status, 0, again.out.slice(0, 1500));
    assert.deepStrictEqual([again.liveUnallowed, again.pinned, again.occurrences, again.scanned], [0, green.pinned, green.occurrences, green.scanned]);
    assert.deepStrictEqual([aDry.rewritten, aDry.pinned], [0, gDry.pinned]);
  });
});
