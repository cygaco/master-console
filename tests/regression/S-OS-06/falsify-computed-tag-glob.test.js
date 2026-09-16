#!/usr/bin/env node
"use strict";
/**
 * J1 falsify-computed-tag-glob (S-OS-06 r4 lane J, rework of lane B's B4; β verdict id 8e5f3a02 ledger row 474:
 * "Globs: NOT warranted — COMPUTED. Expand against that lab's tag list; satisfied iff it matches >= 1 real tag").
 *
 * Supersedes B4's falsify-evidence-tag-listing-glob, which asserted the OPPOSITE: that the evidence-tag RULE had been
 * widened to own the numeric-prefix listing glob. A form rule cannot tell a glob that matches real tags from one that
 * matches nothing, so the widening buried exactly the globs β said are likely further falsifications. The evidence-tag
 * RULE no longer subsumes ANY glob (neither `<lab>@0.14*` nor the bare `<lab>@*`); partition-loader#computeTagGlob — the
 * one implementation, also called by lane G's join — expands the glob against the REAL tag list.
 *
 * What this file proves (every count printed beside its population):
 *   unit       the glob grammar + its boundary forms; the four treatments (computed-satisfied / violation / restore /
 *              uncomputable); dispositionAt closes a glob ONLY by computation and never lets the form RULE bury a
 *              zero-matching glob (`<lab>@9.9.9*`, which the full-semver RULE arm would otherwise swallow).
 *   TRIPLE     GREEN: an unpinned listing glob that expands to a real fixture tag -> purity exit 0, pinned:tag-glob=1,
 *              member emitted; RED: the same line naming a glob that matches NO tag -> exit 1, live-unallowed 1, residue
 *              VIOLATION emitted; revert -> GREEN.
 *   REALITY    the verdict follows the TAG LIST, not the text: the RED line turns GREEN when (only) the tag it names is
 *              created in the fixture repo — no text edit.
 *   BLIND      the plant is sited where the OLD predicate was blind: with the 43f9e007 widened RULE restored and the
 *              computation disabled in the fixture's loader copy, the zero-matching plant exits 0.
 *   FAIL-CLOSED a fixture with no tag list at all (no tags, no remote) -> the glob is UNCOMPUTABLE, exit 1, never satisfied.
 *
 * Tags are created ONLY inside the throwaway fixture repo (its own `git init`, never a worktree of the real repository);
 * no tag is deleted or moved anywhere.
 *
 *   node --test tests/regression/S-OS-06/falsify-computed-tag-glob.test.js
 */
const FALSIFIER_ID = "J1-COMPUTED-TAG-GLOB";

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const H = require("./falsifier-harness");

const LEG = H.SLUG;
const DOC = "docs/verify.md";
const globLine = (pattern) => `- \`git tag --list "${LEG}@${pattern}"\` lists that release line`;
const docFile = (line) => `# verification transcript\n\n${line}\n`;

function purityFrame(fx) {
  const r = fx.runPurity(["--json"]);
  const j = H.json(r);
  const d = j.legacy_slug.dispositions;
  return {
    status: r.status,
    liveUnallowed: j.legacy_slug.live_unallowed,
    tagGlob: d.pinnedBreakdown.tagGlobComputed,
    satisfied: d.tagGlobSatisfied,
    residue: d.tagGlobResidue,
    evidenceTagRow: j.legacy_slug.formatted.find((l) => /pinned:evidence-tag/.test(l)) || null,
    scanned: j.scanned,
    occurrences: d.pinned + d.derived + d.compat + d.historicalAllowListed + d.liveUnallowed,
    findingPaths: j.findings.legacy_slug.map((f) => f.path),
    out: r.out,
  };
}

function describe(f) {
  return `exit=${f.status} live_unallowed=${f.liveUnallowed} pinned:tag-glob=${f.tagGlob} residue=${f.residue.length} over ${f.occurrences} occurrence(s) in scanned=${f.scanned} file(s)`;
}

/** Guard: a fixture's tag operations must never run against the real repository. */
function assertIsolated(fx) {
  const rel = path.relative(H.REAL_ROOT, fx.dir);
  assert.ok(rel.startsWith("..") || path.isAbsolute(rel), `fixture ${fx.dir} must not live inside the real repository`);
  const common = fx.git(["rev-parse", "--git-common-dir"]).stdout.trim();
  assert.ok(!path.resolve(fx.dir, common).startsWith(H.REAL_ROOT), "the fixture repo must not share the real repository's refs");
}

test(`${FALSIFIER_ID} unit: glob grammar, the four treatments, and the RULE never closes a glob`, () => {
  const L = H.LOADER;
  assert.strictEqual(L.LEGACY_LAB, LEG, "the legacy lab is read from the evidence-tag RULE's pinned literal");
  for (const g of ["0.14*", "0.*", "1*", "1.2.*", "0.15.3*", "*", "x", "1.x"]) assert.strictEqual(L.isTagGlobVersion(g), true, `${g} is a glob`);
  for (const n of ["0.14", "1.2.0", "foo*", "v0.14*", "x.*", ".14*", "", "<semver>"]) assert.strictEqual(L.isTagGlobVersion(n), false, `${n} is NOT a glob`);

  const byLab = { [LEG]: ["0.14.0", "0.15.3", "1.2.0"] };
  const ok = { ok: true, byLab };
  const sat = L.computeTagGlob({ lab: LEG, pattern: "0.14*", tags: ok });
  assert.deepStrictEqual([sat.treatment, sat.satisfied, sat.members], ["computed-satisfied", true, ["0.14.0"]]);
  assert.deepStrictEqual(L.computeTagGlob({ lab: LEG, pattern: "*", tags: ok }).members, ["0.14.0", "0.15.3", "1.2.0"], "members are emitted, version-sorted");
  const none = L.computeTagGlob({ lab: LEG, pattern: "9.9*", tags: ok });
  assert.deepStrictEqual([none.treatment, none.satisfied, none.members], ["violation", false, []]);
  const falsified = L.computeTagGlob({ lab: "mc", pattern: "0.14*", tags: ok, currentLab: "mc" });
  assert.deepStrictEqual([falsified.treatment, falsified.satisfied, falsified.legacyMembers, falsified.restoreTo], ["restore", false, ["0.14.0"], { lab: LEG, pattern: "0.14*" }]);
  assert.strictEqual(L.computeTagGlob({ lab: "mc", pattern: "9.9*", tags: ok, currentLab: "mc" }).treatment, "violation", "no legacy equivalent -> violation, not restore");
  const unc = L.computeTagGlob({ lab: LEG, pattern: "0.14*", tags: { ok: false, reason: "fixture: no tag list" } });
  assert.deepStrictEqual([unc.treatment, unc.satisfied], ["uncomputable", false]);

  const at = (tags, s) => {
    const p = L.buildPartition(H.basePartition(), { tags });
    const r = p.dispositionAt("docs/x.md", s, s.toLowerCase().indexOf(LEG));
    return r ? r.rule || r.kind : null;
  };
  assert.strictEqual(at(ok, `"${LEG}@0.14*"`), "tag-glob");
  assert.strictEqual(at(ok, `${LEG}@0.15.3*`), "tag-glob", "a glob token is computed even where a full-semver prefix sits inside it");
  assert.strictEqual(at(ok, `${LEG}@1.2.0`), "evidence-tag", "a full semver stays with the RULE");
  assert.strictEqual(at(ok, `${LEG}@<semver>`), "evidence-tag", "the placeholder stays with the RULE");
  for (const s of [`${LEG}@9.9*`, `${LEG}@9.9.9*`, `${LEG}@0.19*`]) assert.strictEqual(at(ok, s), null, `${s} matches no tag — the form RULE must NOT close it`);
  for (const s of [`${LEG}@0.14*`, `${LEG}@*`]) assert.strictEqual(at({ ok: false, reason: "none" }, s), null, `${s} with no tag list is uncomputable — never closed by the RULE`);
  for (const s of [`${LEG}@0.14`, `${LEG}@foo*`, `${LEG}@v0.14*`, `${LEG}@x.*`, `${LEG}@.14*`]) assert.strictEqual(at(ok, s), null, `${s} is outside both the glob grammar and the RULE`);
});

test(`${FALSIFIER_ID} TRIPLE + REALITY: glob expanding to a real tag GREEN -> glob matching no tag RED -> revert GREEN; then the tag list alone turns the RED text GREEN`, (t) => {
  H.withFixture({ version: "2.0.0", extraFiles: { [DOC]: docFile(globLine("0.14*")) } }, (fx) => {
    assertIsolated(fx);
    fx.git(["tag", `${LEG}@0.14.0`]);
    assert.ok(!fx.readPartition().occurrencePins.some((p) => p.file === DOC), "the control carries NO pin — only computation can close it");

    // (1) GREEN control
    const green = purityFrame(fx);
    t.diagnostic(`control: ${describe(green)}`);
    assert.strictEqual(green.status, 0, green.out.slice(0, 1500));
    assert.strictEqual(green.liveUnallowed, 0);
    assert.strictEqual(green.tagGlob, 1, "the listing glob is closed by COMPUTATION");
    assert.deepStrictEqual(Object.values(green.satisfied).map((r) => r.members), [["0.14.0"]], "the member it expands to is emitted");
    assert.strictEqual(green.residue.length, 0);
    assert.strictEqual(green.evidenceTagRow, null, "the evidence-tag RULE closes nothing here");
    assert.ok(green.scanned > 0 && green.occurrences > 0);

    // (2) RED plant: the same line naming a glob that matches no real tag
    fx.write(DOC, docFile(globLine("0.19*")));
    const red = purityFrame(fx);
    t.diagnostic(`plant: ${describe(red)}`);
    assert.strictEqual(red.status, 1, red.out.slice(0, 1500));
    assert.strictEqual(red.liveUnallowed, 1);
    assert.deepStrictEqual(red.findingPaths, [DOC]);
    assert.strictEqual(red.tagGlob, 0);
    assert.deepStrictEqual(
      red.residue.map((r) => [r.file, r.pattern, r.treatment, r.closedBy]),
      [[DOC, "0.19*", "violation", null]],
      "the zero-matching glob is EMITTED as residue, never buried"
    );
    assert.strictEqual(red.occurrences, green.occurrences, "the plant replaces the control inside the same swept population");

    // (3) revert
    fx.write(DOC, docFile(globLine("0.14*")));
    const again = purityFrame(fx);
    t.diagnostic(`reverted: ${describe(again)}`);
    assert.strictEqual(again.status, 0, again.out.slice(0, 1500));
    assert.deepStrictEqual([again.liveUnallowed, again.tagGlob, again.residue.length, again.occurrences], [0, 1, 0, green.occurrences]);

    // REALITY: re-plant a glob with no tag (RED), then create ONLY the tag it names — no text edit — and it turns GREEN.
    fx.write(DOC, docFile(globLine("0.15*")));
    const before = purityFrame(fx);
    t.diagnostic(`reality before tag: ${describe(before)}`);
    assert.strictEqual(before.status, 1, before.out.slice(0, 1500));
    fx.git(["tag", `${LEG}@0.15.0`]);
    const after = purityFrame(fx);
    t.diagnostic(`reality after tag: ${describe(after)}`);
    assert.strictEqual(after.status, 0, after.out.slice(0, 1500));
    assert.deepStrictEqual(Object.values(after.satisfied).map((r) => r.members), [["0.15.0"]]);
  });
});

test(`${FALSIFIER_ID} BLIND: the zero-matching plant exits 0 under the 43f9e007 widened RULE with the computation disabled`, (t) => {
  H.withFixture({ version: "2.0.0", extraFiles: { [DOC]: docFile(globLine("0.19*")) } }, (fx) => {
    assertIsolated(fx);
    fx.git(["tag", `${LEG}@0.14.0`]);
    const src = fx.read(H.REL.loader);
    const NARROW = `const EVIDENCE_TAG_RE = /${LEG}@(?:\\d+\\.\\d+\\.\\d+|<semver>|\\\\d)/gi;`;
    const WIDENED = `const EVIDENCE_TAG_RE = /${LEG}@(?:\\d+\\.\\d+\\.\\d+|\\d+(?:\\.\\d+){0,2}\\.?\\*|<semver>|\\*|\\\\d)/gi;`;
    const COMPUTE = "return pattern === null ? null : computeTagGlob(";
    assert.ok(src.includes(NARROW), "the narrowed RULE line must exist — otherwise the mutant is hollow");
    assert.ok(src.includes(COMPUTE), "the computation call must exist — otherwise the mutant is hollow");
    const current = purityFrame(fx);
    t.diagnostic(`current code: ${describe(current)}`);
    assert.strictEqual(current.status, 1, "the current code is RED on the plant");
    fx.write(H.REL.loader, src.replace(NARROW, WIDENED).replace(COMPUTE, "return null && computeTagGlob("));
    const blind = purityFrame(fx);
    t.diagnostic(`43f9e007 predicate (widened RULE, no computation): ${describe(blind)}`);
    assert.strictEqual(blind.status, 0, "the old form-keyed predicate passed a glob that matches no tag");
    assert.strictEqual(blind.liveUnallowed, 0);
    assert.strictEqual(blind.occurrences, current.occurrences, "same swept population under both predicates");
  });
});

test(`${FALSIFIER_ID} FAIL-CLOSED: no readable tag list (no tags, no remote) -> the glob is UNCOMPUTABLE and never satisfied`, (t) => {
  H.withFixture({ version: "2.0.0", extraFiles: { [DOC]: docFile(globLine("0.14*")) } }, (fx) => {
    assertIsolated(fx);
    assert.strictEqual(fx.git(["tag", "-l"]).stdout.trim(), "", "the fixture has no tags");
    assert.strictEqual(fx.git(["remote"]).stdout.trim(), "", "the fixture has no remote");
    const f = purityFrame(fx);
    t.diagnostic(`no tag list: ${describe(f)}`);
    assert.strictEqual(f.status, 1, f.out.slice(0, 1500));
    assert.strictEqual(f.liveUnallowed, 1);
    assert.deepStrictEqual(f.residue.map((r) => [r.file, r.treatment]), [[DOC, "uncomputable"]]);
  });
});
