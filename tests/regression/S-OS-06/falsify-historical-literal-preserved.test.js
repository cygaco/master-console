#!/usr/bin/env node
"use strict";
/**
 * F5 falsify-historical-literal-preserved (S-OS-06 fix-cycle r3, DEFECT class) — the RULE that the
 * codemod NEVER rewrites a prior-art release/evidence tag `warpos@<semver>` nor the sanctioned
 * brand-history phrase `formerly WarpOS`. Every release tag is `warpos@*` (`git tag -l 'mc@*'` is
 * empty), so `mc@<semver>` below 2.0.0 that names a tag is a codemod-falsified ref. The 7021ff55 apply
 * produced exactly that (warpos@0.1.4 -> mc@0.1.4, formerly WarpOS -> formerly MC) because --apply was
 * line-scoped; r3 makes the invariant a RULE in partition-loader#dispositionAt and makes --apply
 * occurrence-scoped.
 *
 *  A (GREEN, rule works): a live file carrying warpos@9.9.9 (a version with NO tag — protected purely by
 *    the RULE, not any pin) + "Master Console (formerly WarpOS)" survives --apply byte-for-byte, while an
 *    unpinned control warpos is rewritten to mc; framework-purity classifies them pinned:evidence-tag /
 *    pinned:brand-history with live_unallowed 0.
 *  B (RED, rule has teeth): with the rule return in dispositionAt disabled, --apply rewrites warpos@9.9.9
 *    to mc@9.9.9 — proving the rule is what protects it.
 *  C (mc@ nonexistent-tag flag): no tracked file presents an `mc@<v<2.0.0>` as an EXISTING git tag
 *    (driven by `git tag -l 'mc@*'`; fail-closed if git is unavailable) — the codemod-falsified-tag class.
 *  Real-tree invariant: every warpos@<semver> / "formerly WarpOS" on the LIVE surface is dispositioned.
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

// Built from H.SLUG so this file plants no literal hit of its own (tests/regression/S-OS-06/ is Class-3).
const TAG = `${H.SLUG}@9.9.9`; // no such tag exists anywhere — only the RULE can keep it
const FORMERLY = `formerly ${H.SLUG[0].toUpperCase()}${H.SLUG.slice(1, 4)}OS`; // "formerly WarpOS"
const HIST_REL = "src/history.js";
const RULE_LINE = "if (ruleKind) return { kind: \"pinned\", rule: ruleKind };";

function fixtureFiles() {
  return {
    [HIST_REL]: `// prior-art tag ${TAG} kept forever; Master Console (${FORMERLY}).\n// control: a plain ${H.SLUG} literal that the codemod rewrites\n`,
  };
}

test(`${FALSIFIER_ID} A GREEN: --apply preserves the RULE-protected tag + brand phrase byte-for-byte; rewrites the unpinned control; purity classifies them`, () => {
  H.withFixture({ extraFiles: fixtureFiles() }, (fx) => {
    const before = fx.read(HIST_REL);
    const apply = fx.runCodemod(["--apply"]);
    assert.strictEqual(apply.status, 0, apply.out);
    const after = fx.read(HIST_REL);
    assert.ok(after.includes(TAG), `the RULE-protected tag must survive --apply: ${after}`);
    assert.ok(after.includes(FORMERLY), `the RULE-protected brand-history phrase must survive: ${after}`);
    assert.ok(after.includes("plain mc literal"), `the unpinned control must be rewritten (non-vacuous): ${after}`);
    assert.notStrictEqual(after, before);
    // purity: the tag + phrase are pinned by rule, nothing live-unallowed
    const j = H.json(fx.runPurity(["--json"]));
    assert.strictEqual(j.legacy_slug.live_unallowed, 0, "the RULE leaves nothing live-unallowed");
    const human = fx.runPurity([]);
    assert.match(human.stdout, /pinned:evidence-tag/, "evidence-tag emitted as its own sub-count");
    assert.match(human.stdout, /pinned:brand-history/, "brand-history emitted as its own sub-count");
  });
});

test(`${FALSIFIER_ID} B RED: with the dispositionAt RULE return disabled, --apply rewrites the tag to mc@9.9.9`, () => {
  H.withFixture({ extraFiles: fixtureFiles() }, (fx) => {
    const src = fx.read(H.REL.loader);
    assert.ok(src.includes(RULE_LINE), "the evidence-tag/brand RULE return must exist — otherwise this mutant is hollow");
    fx.write(H.REL.loader, src.replace(RULE_LINE, "if (false && ruleKind) return null; // F5 mutant: RULE disabled"));
    const apply = fx.runCodemod(["--apply"]);
    assert.strictEqual(apply.status, 0, apply.out);
    const after = fx.read(HIST_REL);
    assert.ok(after.includes("mc@9.9.9") && !after.includes(TAG), `the mutant must rewrite the tag: ${after}`);
  });
});

test(`${FALSIFIER_ID} C: no tracked file presents an mc@<v<2.0.0> as an EXISTING git tag (fail-closed on git)`, () => {
  const root = H.REAL_ROOT;
  let realMcTags;
  try {
    realMcTags = new Set(
      execFileSync("git", ["-C", root, "tag", "-l", "mc@*"], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean)
    );
  } catch (e) {
    assert.fail(`fail-closed: could not read git tags to verify the invariant (${e.message})`);
  }
  const files = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\0")
    .filter(Boolean);
  // A git-ref ASSERTION: "tag `mc@X`", "tags mc@X", "refs/tags/mc@X" (not a description like
  // "mc@0.1.4 does not exist" or a version-milestone "removal at mc@1.0.0").
  const assertRe = /(?:\btags?\s+[`'"]?|refs\/tags\/)mc@(\d+)\.(\d+)\.(\d+)/gi;
  const offenders = [];
  for (const rel of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    if (!/mc@\d/.test(text)) continue;
    let m;
    assertRe.lastIndex = 0;
    while ((m = assertRe.exec(text)) !== null) {
      const ver = `${m[1]}.${m[2]}.${m[3]}`;
      if (Number(m[1]) >= 2) continue; // mc@2.0.0+ are the rebrand's own forward tags
      if (!realMcTags.has(`mc@${ver}`)) offenders.push(`${rel}: "tag mc@${ver}" — no such tag (real tag is warpos@${ver})`);
    }
  }
  assert.deepStrictEqual(offenders, [], `codemod-falsified tag refs (restore to warpos@):\n${offenders.join("\n")}`);
});

test(`${FALSIFIER_ID} real-tree invariant: every warpos@<semver> and "formerly WarpOS" on the live surface is dispositioned`, () => {
  const root = H.REAL_ROOT;
  const { loadPartition } = require(path.join(root, "scripts", "open-source", "partition-loader.js"));
  const partition = loadPartition({ forceReload: true });
  const files = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\0")
    .filter(Boolean);
  const tagRe = new RegExp(`${H.SLUG}@\\d+\\.\\d+\\.\\d+`, "gi");
  const brandRe = new RegExp(`formerly ${H.SLUG[0].toUpperCase()}${H.SLUG.slice(1, 4)}OS`, "gi");
  const offenders = [];
  for (const rel of files) {
    const cls = partition.classifyPath(rel);
    if (!(cls && (cls.class === 1 || cls.class === 2) && !cls.writeProtected)) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    if (!tagRe.test(text) && !brandRe.test(text)) continue;
    const changelogHist = rel === "CHANGELOG.md" ? partition.historicalChangelogLines(text) : null;
    text.split(/\r?\n/).forEach((line, i) => {
      if (changelogHist && changelogHist.has(i + 1)) return;
      for (const re of [tagRe, brandRe]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) {
          const slugIdx = m.index + m[0].toLowerCase().indexOf(H.SLUG);
          if (!partition.dispositionAt(rel, line, slugIdx)) offenders.push(`${rel}:${i + 1} ${JSON.stringify(m[0])}`);
        }
      }
    });
  }
  assert.deepStrictEqual(offenders, [], `these historical literals are live-unallowed (pin/rule them):\n${offenders.join("\n")}`);
});
