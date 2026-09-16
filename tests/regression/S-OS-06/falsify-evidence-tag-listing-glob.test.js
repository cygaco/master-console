#!/usr/bin/env node
"use strict";
/**
 * B4 falsify-evidence-tag-listing-glob (S-OS-06 r4 lane B, β 6d4a2f18 Q1 proof: the `<lab>@0.14*` listing glob needed
 * interim pin d5c74318 precisely because it is not a semver token).
 *
 * r4 widens the pinned:evidence-tag RULE to own the tag-LISTING glob — a numeric version prefix of one to three parts
 * ending in `*` — so that case is closed by RULE and the interim per-file pin can retire.
 *
 * A widening can only fail in one direction that matters: absorbing MORE than it should. So the triple's plant is the
 * boundary the widened rule must NOT absorb (a partial, non-glob version beside the glob), not a spot the old rule was
 * blind to. The old rule's blindness runs the other way and is asserted as the control itself: the glob line carries
 * NO pin, and the gate is green only because the rule now owns it (pre-r4 this exact control was live-unallowed).
 *
 *   node --test tests/regression/S-OS-06/falsify-evidence-tag-listing-glob.test.js
 */
const FALSIFIER_ID = "B4-LISTING-GLOB";

const test = require("node:test");
const assert = require("node:assert");
const H = require("./falsifier-harness");

const LEG = H.SLUG;
const DOC = "docs/verify.md";
const GLOB_LINE = `- \`git tag --list "${LEG}@0.14*"\` lists the 0.14 release line`;
const PLANT_LINE = `- \`git tag --list "${LEG}@0.14*"\` lists the 0.14 release line, then checks out "${LEG}@0.14"`;

function docFile(line) {
  return `# verification transcript\n\n${line}\n`;
}

function purityFrame(fx) {
  const r = fx.runPurity(["--json"]);
  const j = H.json(r);
  const d = j.legacy_slug.dispositions;
  const row = j.legacy_slug.formatted.find((l) => /pinned:evidence-tag/.test(l));
  return {
    status: r.status,
    liveUnallowed: j.legacy_slug.live_unallowed,
    pinned: j.legacy_slug.pinned,
    evidenceTag: row ? Number(row.trim().split(/\s+/)[0]) : 0,
    scanned: j.scanned,
    occurrences: d.pinned + d.derived + d.compat + d.historicalAllowListed + d.liveUnallowed,
    findingPaths: j.findings.legacy_slug.map((f) => f.path),
    out: r.out,
  };
}

test(`${FALSIFIER_ID} unit: the RULE owns numeric-prefix listing globs and nothing wider`, () => {
  const partition = H.LOADER.buildPartition(H.basePartition());
  const ruleOf = (s) => {
    const at = partition.dispositionAt("docs/x.md", s, s.toLowerCase().indexOf(LEG));
    return at ? at.rule || at.kind : null;
  };
  for (const s of [`${LEG}@0.14*`, `${LEG}@0.*`, `${LEG}@1*`, `${LEG}@1.2.*`, `${LEG}@0.15.3*`, `"${LEG}@0.14*"`, `${LEG}@1.2.0`, `${LEG}@*`]) {
    assert.strictEqual(ruleOf(s), "evidence-tag", `${s} is an evidence-tag reference`);
  }
  for (const s of [`${LEG}@0.14`, `${LEG}@foo*`, `${LEG}@v0.14*`, `${LEG}@x.*`, `${LEG}-0.14*`, `${LEG}@`, `${LEG}@.14*`]) {
    assert.strictEqual(ruleOf(s), null, `${s} must NOT be absorbed by the widened rule`);
  }
});

test(`${FALSIFIER_ID} TRIPLE: unpinned listing glob GREEN by RULE -> non-glob partial planted beside it RED -> revert GREEN (population emitted)`, (t) => {
  H.withFixture({ version: "2.0.0", extraFiles: { [DOC]: docFile(GLOB_LINE) } }, (fx) => {
    assert.ok(!fx.readPartition().occurrencePins.some((p) => p.file === DOC), "the control carries NO pin — only the RULE can close it");

    // (1) GREEN control: the glob is pinned:evidence-tag by RULE.
    const green = purityFrame(fx);
    t.diagnostic(`control: exit=${green.status} live_unallowed=${green.liveUnallowed} pinned:evidence-tag=${green.evidenceTag} over ${green.occurrences} occurrence(s) in scanned=${green.scanned} file(s)`);
    assert.strictEqual(green.status, 0, green.out.slice(0, 1500));
    assert.strictEqual(green.liveUnallowed, 0);
    assert.strictEqual(green.evidenceTag, 1, "the listing glob is closed by the evidence-tag RULE, not a pin");
    assert.ok(green.scanned > 0 && green.occurrences > 0);

    // (2) RED plant: a partial, non-glob version on the SAME line — the widening must not absorb it.
    fx.write(DOC, docFile(PLANT_LINE));
    const red = purityFrame(fx);
    t.diagnostic(`plant: exit=${red.status} live_unallowed=${red.liveUnallowed} pinned:evidence-tag=${red.evidenceTag} over ${red.occurrences} occurrence(s) in scanned=${red.scanned} file(s)`);
    assert.strictEqual(red.status, 1, red.out.slice(0, 1500));
    assert.strictEqual(red.liveUnallowed, 1);
    assert.deepStrictEqual(red.findingPaths, [DOC]);
    assert.strictEqual(red.evidenceTag, green.evidenceTag, "the plant is not absorbed by the widened rule");
    assert.strictEqual(red.occurrences, green.occurrences + 1, "the plant is inside the swept population");

    // (3) revert
    fx.write(DOC, docFile(GLOB_LINE));
    const again = purityFrame(fx);
    t.diagnostic(`reverted: exit=${again.status} live_unallowed=${again.liveUnallowed} pinned:evidence-tag=${again.evidenceTag} over ${again.occurrences} occurrence(s) in scanned=${again.scanned} file(s)`);
    assert.strictEqual(again.status, 0, again.out.slice(0, 1500));
    assert.deepStrictEqual([again.liveUnallowed, again.evidenceTag, again.occurrences], [0, 1, green.occurrences]);
  });
});
