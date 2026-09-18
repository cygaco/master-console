#!/usr/bin/env node
"use strict";

/**
 * Self-test for the S-OS-06 r4 STAGE 1 oracles: proves each instrument is NOT hollow — every RED case below is a
 * seeded fixture the oracle must flag or refuse, each paired with a GREEN control it must pass. Fixtures come from the
 * S-OS-06 falsifier harness (throwaway git repo, its own partition, the real loader + codemod copied in untracked).
 *
 * Run: node --test runtime/S-OS-06/r4/oracles/self-test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const H = require(path.resolve(__dirname, "..", "..", "..", "..", "tests", "regression", "S-OS-06", "falsifier-harness.js"));
const L = require("./lib");
const O1 = require("./oracle-i-tag-claims");
const O2 = require("./oracle-ii-slug-sweep");
const O3 = require("./oracle-iii-category-delta");

const S = H.SLUG;
const ODD = S[0].toUpperCase() + S.slice(1, 4) + S[4].toUpperCase() + S.slice(5); // a case mix outside the four forms the rewriter maps
const oddCheck = L.caseForm(ODD, require(path.join(H.REAL_ROOT, "scripts", "open-source", "rename-mc.js")));

/** regen stub for fixtures: a fixture has no builders, so the "regenerated" bytes are the fixture's committed view bytes. */
function stubRegen({ root, sha, partition, trackedFiles }) {
  const views = new Map();
  for (const g of partition.generatedViews) {
    for (const p of partition.viewPathCandidates(g)) {
      if (trackedFiles.includes(p)) views.set(p, fs.readFileSync(path.join(root, p), "utf8"));
    }
  }
  return { sha, cloneDir: "(fixture stub)", kept: false, steps: [], views, comparison: [] };
}

function compatPartition(extraMutate) {
  return H.basePartition({
    mutate: (p) => {
      p.compatWindows = [
        {
          surface: "home-read-both",
          expires: "2.1.0",
          warrant: "fixture legacy HOME fallback read, one release",
          occurrences: [{ file: "src/home.js", matchText: `".${S}"`, anchor: "const LEGACY = " }],
        },
      ];
      if (extraMutate) extraMutate(p);
    },
  });
}

test("fixture sanity: the odd-case literal is outside the rewriter's four case forms", () => {
  assert.equal(oddCheck, "odd-case");
});

// S-OS-06 r4 (β 7d3a91c5 item 4): the sub-assertion on the CODEMOD's own delta was STALE, not a live
// regression. It asserted codemodDelta.delta === 0 on the premise that the codemod skips a compat line
// WHOLE. Lane B's `43f9e007` (B3 "compat-line occurrence grain") DELETED that skip — the diff removes the
// `&& !partition.findCompatOccurrence(relPath, lineText)` predicate and replaces it with the comment
// "compat lines are NOT skipped whole". So the codemod now detects the occurrence too and the delta reads 1.
// Determined by MEASUREMENT (the commit diff), not inferred from commit order, per the ruling.
// The claim is CORRECTED rather than deleted: pinning it at 1 keeps the teeth — re-introducing the
// whole-line skip would drive it back to 0 and fail this case again. The oracle's own behaviour
// (occurrence-grain delta 1, onCompatLine, exit code 1) is unchanged and still asserted below.
//
// β 7d3a91c5 item 4 (b) — THE RED LEG IS LOAD-BEARING, PROVEN BY FALSIFICATION, not asserted.
// Removing the planted ODD literal from this fixture makes THIS case FAIL (suite exit 1, "✖ (iii) RED"),
// while the unmutated suite exits 0. So the case still depends on the plant and is not a case rewritten
// to match observed output — the failure mode β names. The title states the property that HOLDS after
// `43f9e007`, not the obsolete premise that the codemod misses the occurrence.
test("(iii) RED: an odd-case mix on a registered compat line enters the occurrence-grain delta; post-B3 the codemod DETECTS it too", () => {
  H.withFixture(
    {
      extraFiles: { "src/home.js": `const LEGACY = ".${S}"; // legacy ${ODD} home\nmodule.exports = { LEGACY };\n` },
      partition: compatPartition(),
    },
    (fx) => {
      const r = O3.measure({ root: fx.dir });
      const tot = Object.values(r.cats).reduce((a, s) => a + s.delta, 0);
      assert.equal(tot, 1, `oracle delta must be 1: ${JSON.stringify(r.cats)}`);
      assert.equal(r.deltaRows[0].onCompatLine, true);
      assert.equal(r.compatLine.delta, 1);
      assert.equal(
        r.codemodDelta.delta,
        1,
        "post-B3 (43f9e007) the codemod no longer skips a compat line whole, so its own delta must AGREE at 1; " +
          "a 0 here means the whole-line findCompatOccurrence skip has been re-introduced",
      );
      assert.equal(O3.format(r).code, 1);
    }
  );
});

test("(iii) GREEN control: only the registered compat slug on the compat line -> delta 0", () => {
  H.withFixture(
    {
      extraFiles: { "src/home.js": `const LEGACY = ".${S}"; // legacy home\nmodule.exports = { LEGACY };\n` },
      partition: compatPartition(),
    },
    (fx) => {
      const r = O3.measure({ root: fx.dir });
      assert.equal(Object.values(r.cats).reduce((a, s) => a + s.delta, 0), 0);
      assert.equal(r.compatLine.pinned, 1);
      assert.equal(O3.format(r).code, 0);
    }
  );
});

test("(ii) RED: the same odd-case mix is residue odd-case-unrewritable; control is clean", () => {
  H.withFixture(
    {
      extraFiles: { "src/home.js": `const LEGACY = ".${S}"; // legacy ${ODD} home\nmodule.exports = { LEGACY };\n` },
      partition: compatPartition(),
    },
    (fx) => {
      const r = O2.measure({ root: fx.dir, regenFn: stubRegen });
      assert.equal(r.residue["odd-case-unrewritable"], 1);
      assert.equal(r.dispTotals.compat, 1);
      assert.equal(O2.format(r).code, 1);
    }
  );
});

test("(ii) changelog-historical inline boolean is counted as UNREGISTERED ABSOLUTION, an [Unreleased] line is not", () => {
  H.withFixture(
    {
      extraFiles: { "CHANGELOG.md": `# Changelog\n\n## [Unreleased]\n- drop the ${S} name\n\n## [1.0.0]\n- the ${S} era\n` },
    },
    (fx) => {
      const r = O2.measure({ root: fx.dir, regenFn: stubRegen });
      assert.equal(r.absolution["changelog-historical"], 1);
      assert.equal(r.D.rewritten["rewritten:prose"], 1);
      assert.ok(O2.format(r).lines.some((l) => /changelog-historical\s+1\b/.test(l)));
    }
  );
});

test("(ii) derived-without-pinned-source: a view string naming no tracked Class-3 path counts; one naming a Class-3 slug-named path does not", () => {
  // base fixture view `.claude/paths.json` = { "templates": "_<slug>/templates" } — not a tracked path -> no source
  H.withFixture({}, (fx) => {
    const r = O2.measure({ root: fx.dir, regenFn: stubRegen });
    assert.equal(r.derivedWithoutStrict, 1, JSON.stringify(r.derivedAnalysis));
    assert.equal(O2.format(r).code, 1);
  });
  const files = { ...H.baseFiles() };
  files[".claude/paths.json"] = `{ "src": "migrations/1.2.0-to-2.0.0/${S}-data.js" }\n`;
  files[`migrations/1.2.0-to-2.0.0/${S}-data.js`] = "module.exports = {};\n";
  H.withFixture({ files }, (fx) => {
    const r = O2.measure({ root: fx.dir, regenFn: stubRegen });
    assert.equal(r.derivedWithoutStrict, 0, JSON.stringify(r.derivedAnalysis));
    assert.equal(r.derivedAnalysis.bySource["class-3:path"], 1);
  });
});

test("population: unreadable REFUSES; a term sum that misses a file REFUSES; a term without a stated rule REFUSES", () => {
  const codemod = require(path.join(H.REAL_ROOT, "scripts", "open-source", "rename-mc.js"));
  assert.equal(L.readForScan(path.join(H.REAL_ROOT, "does-not-exist-" + Date.now()), codemod).status, "unreadable");
  const mk = () => {
    const p = L.newPopulation("t");
    for (const t of L.TERM_ORDER) p.rules[t] = "stated";
    return p;
  };
  const a = mk();
  a.eligible = 2;
  L.popAdd(a, "scanned");
  L.popAdd(a, "unreadable");
  a.unreadableFiles.push("x");
  assert.throws(() => L.assertPopulation(a), L.OracleRefusal);
  const b = mk();
  b.eligible = 2;
  L.popAdd(b, "scanned");
  assert.throws(() => L.assertPopulation(b), /does not hold/);
  const c = mk();
  delete c.rules.binary;
  assert.throws(() => L.assertPopulation(c), /without a stated rule/);
});

test("measured head: a dirty tracked tree REFUSES", () => {
  H.withFixture({}, (fx) => {
    fx.write("src/app.js", "module.exports = { dirty: true };\n");
    assert.throws(() => L.measuredHead(fx.dir), /DIRTY/);
  });
});

test("(i) R5: no legacy-lab tag locally and no remote -> REFUSE; remote listing is the second method; local tags certify", () => {
  H.withFixture({}, (fx) => {
    assert.throws(() => O1.measure({ root: fx.dir, regenFn: stubRegen }), /R5 fail-closed/);
    fx.git(["remote", "add", "origin", "https://example.invalid/none.git"]);
    const remoteFn = () => ({ status: 0, stdout: `0123456789abcdef\trefs/tags/${S}@0.1.0\n0123456789abcdef\trefs/tags/${S}@0.1.0^{}\n`, stderr: "" });
    const r = O1.measure({ root: fx.dir, regenFn: stubRegen, remoteFn });
    assert.equal(r.tags.method, "remote:origin");
    const failing = () => ({ status: 128, stdout: "", stderr: "could not resolve host" });
    assert.throws(() => O1.measure({ root: fx.dir, regenFn: stubRegen, remoteFn: failing }), /R5 fail-closed/);
    fx.git(["tag", `${S}@0.1.0`]);
    assert.equal(O1.measure({ root: fx.dir, regenFn: stubRegen }).tags.method, "local");
  });
});

test("(i) inverted predicate: every G token whose version is not a tag is a candidate — non-existence prose, case mixes, globs, placeholders and bare lab@ included", () => {
  const text = [
    `release tag ${S}@0.1.0 exists`, // existing tag -> not a candidate
    `${S}@0.2.0 was never cut`, // asserts NON-existence -> still a candidate (no context test)
    `see mc@0.1.0.`, // forward lab below 2.0.0 -> candidate; sentence period not part of the version
    `${S.toUpperCase()}@0.14* listing glob`, // case-insensitive lab + glob -> candidate
    `placeholder ${S}@<semver> and bare mc@ here and mc@1.2.3rc1`, // placeholder, empty, unparsed -> 3 candidates
  ].join("\n");
  H.withFixture({ extraFiles: { "docs/tags.md": text + "\n", "package.json": JSON.stringify({ name: "mc", version: "2.0.0" }) + "\n" } }, (fx) => {
    fx.git(["tag", `${S}@0.1.0`]);
    const r = O1.measure({ root: fx.dir, regenFn: stubRegen });
    const mine = r.occurrences.filter((o) => o.file === "docs/tags.md");
    assert.equal(mine.length, 7, JSON.stringify(mine.map((o) => [o.lab, o.version])));
    assert.equal(mine.filter((o) => o.candidate).length, 6);
    const v = Object.fromEntries(mine.map((o) => [`${o.lab}|${o.version}`, o.form]));
    assert.equal(v["mc|0.1.0"], "full-semver");
    assert.equal(v[`${S}|0.14*`], "glob");
    assert.equal(v[`${S}|<semver>`], "placeholder");
    assert.equal(v["mc|"], "unparsed(empty)");
    assert.equal(v["mc|1.2.3rc1"], "unparsed");
    assert.equal(r.sightings, r.occurrences.length);
    const f = O1.format(r);
    assert.equal(f.code, 1);
    assert.ok(!f.lines.some((l) => /zero nonexistent-tag claims/i.test(l)), "the frame never prints a bare zero claim");
    assert.ok(f.lines.some((l) => l.includes("GRAMMAR G")) && f.lines.some((l) => l.includes("N FILES SCANNED")) && f.lines.some((l) => l.includes("M REGISTERED NON-ASSERTION WARRANTS")));
  });
});

test("(i) warrants are PER-OCCURRENCE: exact binding counts; a glob file, an ambiguous anchor, a stale warrant and a double claim all REFUSE", () => {
  const text = `a ${S}@0.2.0 was never cut\nb ${S}@0.2.0 was never cut\n`;
  H.withFixture({ extraFiles: { "docs/tags.md": text } }, (fx) => {
    fx.git(["tag", `${S}@0.1.0`]);
    const reg = (warrants) => {
      const file = path.join(fx.dir, `warrants-untracked-${Math.random().toString(36).slice(2)}.json`); // untracked: outside the measured population
      fs.writeFileSync(file, JSON.stringify({ $question: "fixture non-assertion warrants", warrants }));
      return file;
    };
    const tok = `${S}@0.2.0`;
    const ok = O1.measure({ root: fx.dir, regenFn: stubRegen, warrantsPath: reg([{ file: "docs/tags.md", token: tok, anchor: `a ${tok} was never`, warrant: "describes a tag that was never cut" }]) });
    assert.equal(ok.bound.size, 1);
    assert.equal(ok.violations.length, ok.candidates.length - 1);
    assert.throws(
      () => O1.measure({ root: fx.dir, regenFn: stubRegen, warrantsPath: reg([{ file: "docs/*.md", token: tok, anchor: tok, warrant: "blanket" }]) }),
      /glob/
    );
    assert.throws(
      () => O1.measure({ root: fx.dir, regenFn: stubRegen, warrantsPath: reg([{ file: "docs/tags.md", token: tok, anchor: `${tok} was never`, warrant: "two lines" }]) }),
      /ambiguous/
    );
    assert.throws(
      () => O1.measure({ root: fx.dir, regenFn: stubRegen, warrantsPath: reg([{ file: "docs/tags.md", token: tok, anchor: `zzz ${tok}`, warrant: "stale" }]) }),
      /stale/
    );
    assert.throws(
      () =>
        O1.measure({
          root: fx.dir,
          regenFn: stubRegen,
          warrantsPath: reg([
            { file: "docs/tags.md", token: tok, anchor: `a ${tok}`, warrant: "first" },
            { file: "docs/tags.md", token: tok, anchor: `a ${tok} was`, warrant: "second claim on the same occurrence" },
          ]),
        }),
      /already bound/
    );
  });
});
