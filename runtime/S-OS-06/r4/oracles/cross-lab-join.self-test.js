#!/usr/bin/env node
"use strict";

/**
 * Self-test, S-OS-06 r4 lane G — the owed cases that do NOT depend on a disposition (β verdict 8e5f3a02 section 8):
 *
 *   T1  ORACLE (i) GREEN CONTROL (gap 1), as the three-part triple: green on the unmutated fixture WITH the scanned
 *       population printed beside the zero -> RED on a planted nonexistent-tag claim -> revert -> green re-observed.
 *   T2  CROSS-LAB JOIN (gap 2, join half), the same triple: green (current-lab tokens that name no legacy tag, legacy
 *       tokens naming real tags) -> RED on a codemod-shaped legacy->current rewrite -> revert -> green.
 *   T3  the join's PROVENANCE discriminates: a codemod-shaped rewrite reads `rewrite`; a sentence WRITTEN with the
 *       current-lab token (describing the falsification) reads `authored` — both are join members by tag reality.
 *   T4  pattern members: a rewritten glob transcript joins by expansion; a rewrite-with-edits into a new file is traced
 *       across files (the blame rename-threshold defect found in the first real run).
 *   T5  G4 self-contamination: printout and members file carry zero lab-at sightings while members exist; the guard
 *       REFUSES a text that carries one.
 *
 * NOT covered here (deliberately): the computed forthcoming-release-self-reference class (Amendment 1) — lane G stopped
 * before implementing any disposition, see runtime/S-OS-06/r4/lane-g-report.md.
 *
 * Every lab-at token below is assembled at runtime, so this source adds no grammar-G token to the measured tree.
 * Run: node --test runtime/S-OS-06/r4/oracles/cross-lab-join.self-test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const H = require(path.resolve(__dirname, "..", "..", "..", "..", "tests", "regression", "S-OS-06", "falsifier-harness.js"));
const O1 = require("./oracle-i-tag-claims");
const J = require("./cross-lab-join");

const AT = String.fromCharCode(64);
const LEG = H.SLUG;
const CUR = ["m", "c"].join("");
const tok = (lab, v) => [lab, v].join(AT);

function stubRegen({ sha, partition, trackedFiles, root }) {
  const views = new Map();
  for (const g of partition.generatedViews) {
    for (const p of partition.viewPathCandidates(g)) if (trackedFiles.includes(p)) views.set(p, fs.readFileSync(path.join(root, p), "utf8"));
  }
  return { sha, cloneDir: "(fixture stub)", kept: false, steps: [], views, comparison: [] };
}

const PKG = JSON.stringify({ name: CUR, version: "2.0.0", private: true }, null, 2) + "\n";

function frameShowsPopulationBesideVerdict(lines, scanned) {
  const pop = lines.findIndex((l) => /POPULATION RECONCILIATION/.test(l) && /holds=true/.test(l));
  const n = lines.findIndex((l) => l.includes(`N FILES SCANNED: ${scanned}`));
  const verdict = lines.findIndex((l) => /^\s+VERDICT: VIOLATIONS=/.test(l));
  return pop >= 0 && n > pop && verdict > n && lines[verdict].includes(`over N=${scanned} scanned files`);
}

test("T1 oracle (i) GREEN control -> RED plant -> revert -> GREEN (the zero printed with its population)", () => {
  const doc = `# releases\n\nThe prior-art tag is ${tok(LEG, "0.1.0")} (git rev-parse resolves it).\n`;
  H.withFixture({ extraFiles: { "docs/releases.md": doc, "package.json": PKG } }, (fx) => {
    fx.git(["tag", tok(LEG, "0.1.0")]);

    // (1) GREEN control on the unmutated fixture
    const g1 = O1.measure({ root: fx.dir, regenFn: stubRegen });
    assert.ok(g1.occurrences.length >= 1, "the control must contain a real G token, or its zero is vacuous");
    assert.equal(g1.candidates.length, 0);
    assert.equal(g1.violations.length, 0);
    const f1 = O1.format(g1);
    assert.equal(f1.code, 0, "oracle (i) exits 0 — it CAN print zero");
    assert.ok(f1.lines.some((l) => /VERDICT: VIOLATIONS=0\b/.test(l)));
    assert.ok(frameShowsPopulationBesideVerdict(f1.lines, g1.pop.terms.scanned), "the zero ships with its reconciliation, N and grammar frame");
    assert.ok(f1.lines.some((l) => l.includes("TOKENS MATCHING G: " + g1.occurrences.length)));

    // (2) RED: the old context-test predicate was blind to a tag-LISTING transcript; plant one naming no real tag
    fx.write("docs/releases.md", doc + `\nVerified: \`git tag --list "${tok(CUR, "0.1*")}"\` -> ${tok(LEG, "0.1.0")}\n`);
    const planted = fx.commit("plant: a listing transcript naming a nonexistent tag", ["docs/releases.md"]);
    const r = O1.measure({ root: fx.dir, regenFn: stubRegen });
    assert.equal(r.violations.length, 1, JSON.stringify(r.violations.map((o) => [o.file, o.line, o.lab, o.version])));
    assert.equal(r.violations[0].file, "docs/releases.md");
    assert.equal(O1.format(r).code, 1);

    // (3) revert and re-observe green
    fx.git(["revert", "--no-edit", planted]);
    assert.equal(fx.trackedDirty(), "");
    const g2 = O1.measure({ root: fx.dir, regenFn: stubRegen });
    assert.equal(g2.violations.length, 0);
    assert.equal(O1.format(g2).code, 0);
    assert.equal(g2.pop.terms.scanned, g1.pop.terms.scanned, "same swept population before and after");
  });
});

test("T2 cross-lab join GREEN control -> RED codemod-shaped rewrite -> revert -> GREEN", () => {
  const line = `Scheduled for removal at \`${tok(LEG, "0.1.0")}\`.`;
  const doc = `# alias\n\n${line}\nThis tree is becoming ${tok(CUR, "2.0.0")}; see also ${tok(CUR, "9.9.9")}.\n`;
  H.withFixture({ extraFiles: { "docs/alias.md": doc, "package.json": PKG } }, (fx) => {
    fx.git(["tag", tok(LEG, "0.1.0")]);

    // (1) GREEN: two current-lab candidates exist (so the zero is not vacuous) but neither names a legacy tag
    const g1 = J.measureJoin({ root: fx.dir, regenFn: stubRegen });
    assert.equal(g1.currentCands.length, 2);
    assert.equal(g1.members.length, 0);
    const f1 = J.format(g1);
    assert.equal(f1.code, 0);
    assert.ok(f1.lines.some((l) => /CROSS-LAB JOIN \(tag reality/.test(l) && /MEMBERS=0 /.test(l) && /holds=true/.test(l)), "tally line is printed inside oracle (i)'s frame");
    assert.ok(f1.lines.some((l) => /VERDICT: CROSS-LAB MEMBERS=0 of 2 current-lab candidate\(s\) over N=\d+ scanned files/.test(l)));
    assert.ok(frameShowsPopulationBesideVerdict(f1.lines, g1.r.pop.terms.scanned));

    // (2) RED: the codemod shape — the real legacy tag reference rewritten into the current lab
    fx.write("docs/alias.md", doc.replace(tok(LEG, "0.1.0"), tok(CUR, "0.1.0")));
    const planted = fx.commit("plant: codemod-shaped legacy->current tag rewrite", ["docs/alias.md"]);
    const r = J.measureJoin({ root: fx.dir, regenFn: stubRegen });
    assert.equal(r.members.length, 1);
    const m = r.members[0];
    assert.equal(m.o.file, "docs/alias.md");
    assert.equal(m.kind, "exact");
    assert.deepEqual(m.matched, ["0.1.0"]);
    assert.equal(m.prov.kind, "rewrite", JSON.stringify(m.prov));
    assert.equal(m.prov.commit, planted);
    assert.equal(J.format(r).code, 1);

    // (3) revert and re-observe green
    fx.git(["revert", "--no-edit", planted]);
    const g2 = J.measureJoin({ root: fx.dir, regenFn: stubRegen });
    assert.equal(g2.members.length, 0);
    assert.equal(J.format(g2).code, 0);
  });
});

test("T3 provenance discriminates: a rewrite reads `rewrite`; a sentence written with the current-lab token reads `authored` (both are members)", () => {
  const doc = `# epic\n\nGoal: the prior-art tag ${tok(LEG, "0.1.0")} resolves.\n`;
  H.withFixture({ extraFiles: { "docs/epic.md": doc, "package.json": PKG } }, (fx) => {
    fx.git(["tag", tok(LEG, "0.1.0")]);
    fx.write("docs/epic.md", doc.replace(tok(LEG, "0.1.0"), tok(CUR, "0.1.0")));
    const rewrite = fx.commit("codemod apply", ["docs/epic.md"]);
    fx.write("notes/finding.md", `# finding\n\nThe epic had been rewritten to \`${tok(CUR, "0.1.0")}\`, which does not exist as a tag.\n`);
    const authored = fx.commit("tracker: record the finding", ["notes/finding.md"]);
    // the TRACKER.md:7 shape: a header line that ALREADY carried the legacy token keeps it and GAINS the current-lab token
    fx.write("HEADER.md", `Last Updated: the tag is ${tok(LEG, "0.1.0")} on disk.\n`);
    fx.commit("header v1", ["HEADER.md"]);
    fx.write("HEADER.md", `Last Updated: the tag is ${tok(LEG, "0.1.0")} on disk but the epic had been rewritten to ${tok(CUR, "0.1.0")}.\n`);
    const header = fx.commit("header v2", ["HEADER.md"]);
    const r = J.measureJoin({ root: fx.dir, regenFn: stubRegen });
    const byFile = Object.fromEntries(r.members.map((m) => [m.o.file, m]));
    assert.equal(r.members.length, 3);
    assert.equal(byFile["docs/epic.md"].prov.kind, "rewrite");
    assert.equal(byFile["docs/epic.md"].prov.commit, rewrite);
    assert.equal(byFile["notes/finding.md"].prov.kind, "authored", JSON.stringify(byFile["notes/finding.md"].prov));
    assert.equal(byFile["notes/finding.md"].prov.commit, authored);
    assert.equal(byFile["HEADER.md"].prov.kind, "authored", "the legacy token did not LEAVE the line — presence alone is not a rewrite: " + JSON.stringify(byFile["HEADER.md"].prov));
    assert.equal(byFile["HEADER.md"].prov.commit, header);
    assert.ok(J.format(r).lines.some((l) => /PROVENANCE .*authored=2; rewrite=1/.test(l)));
  });
});

test("T4 pattern member via glob expansion; a rename-with-edits is traced across files", () => {
  const transcript = `| tag | \`git tag --list "${tok(LEG, "0.1*")}"\` -> ${tok(LEG, "0.1.0")} |`;
  const alias = `This alias is scheduled for removal at \`${tok(LEG, "0.1.0")}\`. Update any docs that still call \`/old:sync\`.`;
  H.withFixture({ extraFiles: { "docs/tracker.md": `# t\n\n${transcript}\n`, "cmds/old/sync.md": `# sync\n\n${alias}\n`, "package.json": PKG } }, (fx) => {
    fx.git(["tag", tok(LEG, "0.1.0")]);
    fx.write("docs/tracker.md", `# t\n\n${transcript.replace(tok(LEG, "0.1*"), tok(CUR, "0.1*"))}\n`);
    const globRewrite = fx.commit("codemod apply (glob)", ["docs/tracker.md"]);
    // rename with edits to EVERY line, below git's rename-similarity threshold for a short file
    fx.git(["rm", "-q", "cmds/old/sync.md"]);
    fx.write("cmds/new/sync.md", `# new sync alias\n\n${alias.replace(tok(LEG, "0.1.0"), tok(CUR, "0.1.0")).replace("/old:sync", "/new:sync")}\n`);
    const renamed = fx.commit("namespace move", ["cmds/new/sync.md"]);
    const r = J.measureJoin({ root: fx.dir, regenFn: stubRegen });
    const byFile = Object.fromEntries(r.members.map((m) => [m.o.file, m]));
    assert.equal(r.members.length, 2, JSON.stringify(r.members.map((m) => [m.o.file, m.o.version])));
    assert.equal(byFile["docs/tracker.md"].kind, "pattern");
    assert.deepEqual(byFile["docs/tracker.md"].matched, ["0.1.0"]);
    assert.equal(byFile["docs/tracker.md"].prov.kind, "rewrite");
    assert.equal(byFile["docs/tracker.md"].prov.commit, globRewrite);
    const moved = byFile["cmds/new/sync.md"].prov;
    assert.equal(moved.kind, "rewrite", JSON.stringify(moved));
    assert.equal(moved.commit, renamed);
    assert.match(moved.alignment, /cross-file\(cmds\/old\/sync\.md/);
  });
});

test("T5 G4: printout and members file carry zero lab-at sightings while members exist; the guard refuses a sighting", () => {
  const doc = `# d\n\nremoval at \`${tok(LEG, "0.1.0")}\`\n`;
  H.withFixture({ extraFiles: { "docs/d.md": doc, "package.json": PKG } }, (fx) => {
    fx.git(["tag", tok(LEG, "0.1.0")]);
    fx.write("docs/d.md", doc.replace(tok(LEG, "0.1.0"), tok(CUR, "0.1.0")));
    fx.commit("codemod apply", ["docs/d.md"]);
    const r = J.measureJoin({ root: fx.dir, regenFn: stubRegen });
    assert.equal(r.members.length, 1);
    const text = J.format(r).lines.join("\n");
    const body = JSON.stringify(J.membersDoc(r), null, 1);
    assert.doesNotThrow(() => J.assertNoSightings(r.r.grammar, text, "printout"));
    assert.doesNotThrow(() => J.assertNoSightings(r.r.grammar, body, "members"));
    assert.equal((text.match(r.r.grammar.sightingRe()) || []).length, 0);
    const doc2 = JSON.parse(body);
    assert.deepEqual(doc2.rows[0].oldToken, { lab: CUR, version: "0.1.0" });
    assert.deepEqual(doc2.rows[0].tagRealityRestoreTo, { lab: LEG, version: "0.1.0" });
    assert.throws(() => J.assertNoSightings(r.r.grammar, `x ${tok(CUR, "0.1.0")} y`, "planted"), /self-contamination guard/);
  });
});
