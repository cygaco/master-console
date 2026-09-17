#!/usr/bin/env node
"use strict";

/**
 * S-OS-06 r4 — STOP-CONDITION section 8, GAP 2: a GAP PROOF, NOT A COVERAGE CASE.
 *
 * This file closes nothing. It proves that the two amendment classes CANNOT be covered by a case against the
 * instruments as they stand at 796e8799. Adding a case would need an instrument change, and that is out of scope
 * for a case-adding dispatch. It is deliberately not a node:test file and not named *.test.js, so no suite counts it.
 *
 *   P1  Amendment 1 (computed `forthcoming-release-self-reference`): oracle (i) has no computed disposition. A token
 *       whose version EQUALS the tree's declared version and one whose version does NOT are classified identically
 *       (candidate, unwarranted, violation). The only discharge path is a per-occurrence warrant, which is the
 *       REGISTRATION that Amendment 1 forbids. No RED/GREEN pair can separate the class: there is nothing to separate.
 *   P2  Amendment 2 (ORDERING: the join runs BEFORE the historical slice is dispositioned): seed the ordering violation,
 *       a warrant written on a codemod falsification in a class-4 historical file. No instrument goes RED. Oracle (i)
 *       goes GREEN (0 violations). The join prints the same member set with or without the premature warrant, because
 *       measureJoin takes no warrant input and bindWarrants never consults the join.
 *
 * Exit 0 = every gap assertion reproduced. Exit 1 = an assertion no longer holds: the instrument has changed, so re-read
 * it before trusting this proof. Every lab-at token is assembled at runtime, so this source adds no grammar-G token.
 * Run: node runtime/S-OS-06/r4/section8/section8-gap-proof.probe.js
 */

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const H = require(path.join(ROOT, "tests", "regression", "S-OS-06", "falsifier-harness.js"));
const O1 = require(path.join(ROOT, "runtime", "S-OS-06", "r4", "oracles", "oracle-i-tag-claims"));
const J = require(path.join(ROOT, "runtime", "S-OS-06", "r4", "oracles", "cross-lab-join"));

const AT = String.fromCharCode(64);
const LEG = H.SLUG;
const CUR = ["m", "c"].join("");
const tok = (lab, v) => [lab, v].join(AT);
const TREE_VERSION = "2.0.0";
const PKG = JSON.stringify({ name: CUR, version: TREE_VERSION, private: true }, null, 2) + "\n";
const esc = (s) => String(s).split(AT).join("\\x40");

function stubRegen({ sha, partition, trackedFiles, root }) {
  const views = new Map();
  for (const g of partition.generatedViews) {
    for (const p of partition.viewPathCandidates(g)) if (trackedFiles.includes(p)) views.set(p, fs.readFileSync(path.join(root, p), "utf8"));
  }
  return { sha, cloneDir: "(fixture stub)", kept: false, steps: [], views, comparison: [] };
}

function register(dir, warrants) {
  const file = path.join(dir, `warrants-untracked-${Math.random().toString(36).slice(2)}.json`); // untracked: outside the measured population
  fs.writeFileSync(file, JSON.stringify({ $question: "section 8 gap proof", warrants }));
  return file;
}

const out = [];
const say = (s) => {
  out.push(s);
  console.log(s);
};
say(`platform ${process.platform}/node${process.versions.node}`);

// ── P1: Amendment 1 — the computed class does not exist in oracle (i) ─────────────────────────────────────────────
H.withFixture(
  {
    extraFiles: {
      "docs/self.md": `# self\n\nThis tree is becoming ${tok(CUR, TREE_VERSION)}.\nA later release is ${tok(CUR, "2.1.0")}.\n`,
      "package.json": PKG,
    },
  },
  (fx) => {
    fx.git(["tag", tok(LEG, "0.1.0")]);
    const r = O1.measure({ root: fx.dir, regenFn: stubRegen });
    const mine = r.occurrences.filter((o) => o.file === "docs/self.md");
    assert.equal(mine.length, 2, "both self-reference tokens are G tokens (the population is not empty)");
    const self = mine.find((o) => o.version === TREE_VERSION);
    const beyond = mine.find((o) => o.version === "2.1.0");
    // strip the fields that legitimately differ (position, version, text) and compare what the oracle DECIDED
    const decided = (o) => {
      const { file, line, col0, token, version, lineText, index, ...rest } = o;
      return rest;
    };
    assert.deepEqual(decided(self), decided(beyond), "oracle (i) decides a version==tree-version token and a version-beyond-tree token IDENTICALLY");
    assert.equal(self.candidate, true);
    assert.ok(r.violations.includes(self), "the tree's own declared version is a VIOLATION: no computed disposition discharges it");
    assert.equal(O1.format(r).code, 1);
    const keys = Object.keys(self).sort();
    assert.ok(!keys.some((k) => /disposition|computed|self|forthcoming|treeVersion/i.test(k)), `no disposition field on an occurrence: ${keys.join(",")}`);
    assert.ok(!Object.keys(r).some((k) => /disposition|computed|forthcoming|treeVersion/i.test(k)), `no computed-class field on the result: ${Object.keys(r).join(",")}`);
    say(`P1 GAP REPRODUCED: tree version ${TREE_VERSION}; the self-reference token and the beyond-tree token have identical decided fields ${esc(JSON.stringify(decided(self)))}`);
    say(`P1   violations=${r.violations.length} (both), format code=${O1.format(r).code}; occurrence keys: ${keys.join(",")}`);
    // the only discharge path is REGISTRATION, which Amendment 1 forbids
    const w = O1.measure({
      root: fx.dir,
      regenFn: stubRegen,
      warrantsPath: register(fx.dir, [{ file: "docs/self.md", token: tok(CUR, TREE_VERSION), anchor: `becoming ${tok(CUR, TREE_VERSION)}`, warrant: "names the release this tree is becoming" }]),
    });
    assert.equal(w.violations.length, 1);
    assert.ok(!w.violations.some((o) => o.version === TREE_VERSION));
    say(`P1   only discharge path: a per-occurrence WARRANT (registration) -> violations=${w.violations.length}, the self-reference bound by warrant, not computed`);
  }
);

// ── P2: Amendment 2 — the ordering has no instrument ──────────────────────────────────────────────────────────────
const epic = `# epic (dated record)\n\nGoal: the prior-art tag ${tok(LEG, "0.1.0")} resolves.\n`;
H.withFixture({ extraFiles: { "history/epic.md": epic, "package.json": PKG } }, (fx) => {
  fx.git(["tag", tok(LEG, "0.1.0")]);
  fx.write("history/epic.md", epic.replace(tok(LEG, "0.1.0"), tok(CUR, "0.1.0")));
  const rewrite = fx.commit("codemod apply into a class-4 historical file", ["history/epic.md"]);

  // ORDERING HONORED: join first, nothing dispositioned
  const o1Honored = O1.measure({ root: fx.dir, regenFn: stubRegen });
  const jHonored = J.measureJoin({ root: fx.dir, regenFn: stubRegen });
  const hist = o1Honored.occurrences.find((o) => o.file === "history/epic.md");
  assert.ok(hist && /^class-4/.test(hist.cls), `the falsification sits in the historical slice: ${hist && hist.cls}`);
  assert.equal(jHonored.members.length, 1);
  assert.equal(jHonored.members[0].prov.kind, "rewrite");
  assert.equal(jHonored.members[0].prov.commit, rewrite);
  assert.equal(o1Honored.violations.length, 1);

  // ORDERING VIOLATED: the historical occurrence is dispositioned (warranted) BEFORE / without the join
  const wp = register(fx.dir, [{ file: "history/epic.md", token: tok(CUR, "0.1.0"), anchor: `tag ${tok(CUR, "0.1.0")} resolves`, warrant: "historical epic body, a dated record" }]);
  const o1Violated = O1.measure({ root: fx.dir, regenFn: stubRegen, warrantsPath: wp });
  assert.equal(o1Violated.bound.size, 1, "bindWarrants accepts a warrant on a join member: it never consults the join");
  assert.equal(o1Violated.violations.length, 0, "oracle (i) goes GREEN on the seeded ordering violation");
  assert.equal(O1.format(o1Violated).code, 0);
  // warrantsPath is passed and IGNORED: measureJoin (cross-lab-join.js:338-341) forwards only {root, regenFn, remoteFn} to O1.measure
  const jViolated = J.measureJoin({ root: fx.dir, regenFn: stubRegen, warrantsPath: wp });
  assert.deepEqual(
    jViolated.members.map((m) => [m.o.file, m.o.line, m.o.col0, m.o.version, m.prov.kind]),
    jHonored.members.map((m) => [m.o.file, m.o.line, m.o.col0, m.o.version, m.prov.kind]),
    "the join's member set is identical whether or not a disposition preceded it"
  );
  assert.equal(J.format(jViolated).code, J.format(jHonored).code);
  say(`P2 GAP REPRODUCED: codemod falsification in ${hist.cls} file history/epic.md (rewrite ${rewrite.slice(0, 8)})`);
  say(`P2   ordering honored : oracle(i) violations=${o1Honored.violations.length} code=${O1.format(o1Honored).code}; join members=${jHonored.members.length} code=${J.format(jHonored).code}`);
  say(`P2   ordering VIOLATED: oracle(i) violations=${o1Violated.violations.length} code=${O1.format(o1Violated).code} (warrant bound=${o1Violated.bound.size}); join members=${jViolated.members.length} code=${J.format(jViolated).code}`);
  say(`P2   -> the seeded ordering violation turns NO instrument RED; it turns oracle (i) GREEN. Nothing intersects warrants with join members.`);
});

say("RESULT: both gap assertions reproduced (exit 0). These are gaps, not coverage.");
