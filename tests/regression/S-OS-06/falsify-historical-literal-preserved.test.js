#!/usr/bin/env node
"use strict";
/**
 * F5 falsify-historical-literal-preserved (S-OS-06 fix-cycle r2, DEFECT class) — the invariant
 * that the codemod NEVER rewrites a prior-art release/evidence tag name `warpos@<semver>` and
 * NEVER rewrites the sanctioned brand-history phrase `formerly WarpOS`. The 2026-09-13 apply
 * `7021ff55` rewrote both inside tracker prose (`mc@0.1.4`, `formerly MC`) — evidence tags are
 * kept forever, so that was a defect. Restored in r2 and pinned; this test is its teeth.
 *
 * Structural (fixture): a live file carrying `warpos@1.2.3` + `Master Console (formerly WarpOS)`,
 * both pinned, survives the codemod --apply byte-for-byte, while an UNpinned control `warpos`
 * in the same file IS rewritten to `mc` (proving the run is not vacuous). RED companion: with the
 * pin lever removed, the tag is rewritten to `mc@1.2.3`.
 *
 * Real-tree invariant: every tracked-file occurrence of `warpos@<semver>` and of `formerly WarpOS`
 * is dispositioned by the partition (pinned/compat/derived/suppressed), never live-unallowed — a
 * live-unallowed occurrence is one the codemod would rewrite, which is exactly the defect.
 *
 *   node --test tests/regression/S-OS-06/falsify-historical-literal-preserved.test.js
 */
const FALSIFIER_ID = "F5-HIST-LITERAL";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const H = require("./falsifier-harness");

// Built from H.SLUG so this file plants no literal hit of its own (it is a Class-3 write-protected path).
const TAG = `${H.SLUG}@1.2.3`;
const BRAND = `Master Console (formerly ${H.SLUG[0].toUpperCase()}${H.SLUG.slice(1, 4)}OS)`; // "…(formerly WarpOS)"
const FORMERLY = BRAND.slice(BRAND.indexOf("formerly"), BRAND.length - 1); // "formerly WarpOS"
const HIST_REL = "src/history.js";
const PIN_LEVER = "const pin = partition.findOccurrencePin(relPath, lineText);";

function fixtureFiles() {
  return {
    [HIST_REL]: `// prior-art tag ${TAG} provably untouched; ${BRAND}.\n// control: a plain ${H.SLUG} literal that the codemod rewrites\n`,
  };
}
function pinHistoricalLiterals(p) {
  p.occurrencePins.push(
    { file: HIST_REL, matchText: TAG, warrant: "fixture prior-art release tag; evidence tags are kept forever, never rewritten" },
    { file: HIST_REL, matchText: FORMERLY, warrant: "fixture sanctioned brand-history phrase; pinned wherever it appears" }
  );
}

test(`${FALSIFIER_ID} GREEN: --apply preserves the pinned tag + brand-history phrase byte-for-byte, and rewrites the unpinned control`, () => {
  H.withFixture({ extraFiles: fixtureFiles(), partition: H.basePartition({ mutate: pinHistoricalLiterals }) }, (fx) => {
    const before = fx.read(HIST_REL);
    const apply = fx.runCodemod(["--apply"]);
    assert.strictEqual(apply.status, 0, apply.out);
    const after = fx.read(HIST_REL);
    assert.ok(after.includes(TAG), `the pinned tag must survive: ${after}`);
    assert.ok(after.includes(FORMERLY), `the pinned brand-history phrase must survive: ${after}`);
    // non-vacuous: the unpinned control on line 2 was rewritten warpos -> mc
    assert.ok(after.includes("plain mc literal"), `the unpinned control must be rewritten (proves the run is real): ${after}`);
    assert.notStrictEqual(after, before, "the apply must have changed the control line");
    assert.strictEqual(fx.runCutover([]).status, 0, "cutover pin-test stays green when the literals are pinned");
  });
});

test(`${FALSIFIER_ID} RED: with the pin lever removed, the codemod rewrites the tag name to mc@1.2.3`, () => {
  H.withFixture({ extraFiles: fixtureFiles(), partition: H.basePartition({ mutate: pinHistoricalLiterals }) }, (fx) => {
    const src = fx.read(H.REL.codemod);
    assert.ok(src.includes(PIN_LEVER), "the pin lever must exist — otherwise the mutant is hollow");
    fx.write(H.REL.codemod, src.replace(PIN_LEVER, "const pin = null; // F5 mutant: pin lever removed"));
    const apply = fx.runCodemod(["--apply"]);
    assert.strictEqual(apply.status, 0, apply.out);
    const after = fx.read(HIST_REL);
    assert.ok(after.includes("mc@1.2.3") && !after.includes(TAG), `the mutant must rewrite the tag name: ${after}`);
  });
});

test(`${FALSIFIER_ID} real-tree invariant: every warpos@<semver> and "formerly WarpOS" occurrence is dispositioned, never live-unallowed`, () => {
  const root = H.REAL_ROOT;
  const { loadPartition } = require(path.join(root, "scripts", "open-source", "partition-loader.js"));
  const partition = loadPartition({ forceReload: true });
  const files = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
  const tagRe = new RegExp(`${H.SLUG}@\\d+\\.\\d+\\.\\d+`, "gi");
  const brandRe = new RegExp(`formerly ${H.SLUG[0].toUpperCase()}${H.SLUG.slice(1, 4)}OS`, "gi");
  const offenders = [];
  for (const rel of files) {
    // Scope to the LIVE surface the codemod would rewrite (Class-1/2, not write-protected).
    // A tag/brand literal inside Class-3/4 historical data or a generated view is legitimately
    // suppressed/derived — the codemod never rewrites it, so the invariant does not apply there.
    const cls = partition.classifyPath(rel);
    if (!(cls && (cls.class === 1 || cls.class === 2) && !cls.writeProtected)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    if (!tagRe.test(text) && !brandRe.test(text)) continue;
    // CHANGELOG.md's < 2.0.0 sections carry their release-tag URLs under the changelog-historical
    // disposition (not a pin) — a legitimate non-rewrite the loader honours line by line.
    const changelogHist = rel === "CHANGELOG.md" ? partition.historicalChangelogLines(text) : null;
    text.split(/\r?\n/).forEach((line, i) => {
      if (changelogHist && changelogHist.has(i + 1)) return;
      for (const re of [tagRe, brandRe]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) {
          // the slug offset inside the match (tag = at 0; "formerly WarpOS" = after "formerly ")
          const slugIdx = m.index + m[0].toLowerCase().indexOf(H.SLUG);
          if (!partition.dispositionAt(rel, line, slugIdx)) offenders.push(`${rel}:${i + 1} ${JSON.stringify(m[0])}`);
        }
      }
    });
  }
  assert.deepStrictEqual(offenders, [], `these historical literals are live-unallowed (the codemod would rewrite them) — pin them:\n${offenders.join("\n")}`);
});
