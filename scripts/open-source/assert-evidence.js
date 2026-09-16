#!/usr/bin/env node
"use strict";
/**
 * assert-evidence — the S-OS-03 SHA-preservation assertion (E-OPEN-SOURCE-001, gate G2).
 *
 * Proves, on ANY clone (the working repo, the rewrite dry-run clone, a fresh public clone after the
 * force-push), that the prior-art evidence is byte-identical to the anchor:
 *
 *   1. the four headline commits + the tag commit + the one GitHub-signed commit exist, are commits,
 *      and (for the signed one) still carry their gpgsig header;
 *   2. tag warpos@0.1.4 still resolves to de9ba8eb;
 *   3. every one of those objects is an ancestor of the ref under test (default: HEAD);
 *   4. optionally (--strings <file>): each rule's left side is absent from EVERY history surface — diffs incl.
 *      merges, commit/tag messages, author/committer/tagger identity, ref names (history-surface.js, step 4 below);
 *      literals come from a gitignored file, only SHA-256 digests + the searched population are printed;
 *   5. optionally (--digests): print the digest table alone (for the committed rewrite record).
 *
 * Exit 0 OK · 1 any failed assertion · 2 history sweep REFUSED (population not whole) or bad usage. node + git only.
 *
 *   node scripts/open-source/assert-evidence.js [--repo <path>] [--ref <rev>] [--strings <rules>] [--digests]
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const flag = (name) => args.includes(name);

const REPO = path.resolve(opt("--repo", path.resolve(__dirname, "..", "..")));
const REF = opt("--ref", "HEAD");
const RULES = opt("--strings", null);

// The evidence set. Full SHAs so a prefix collision can never pass.
const EVIDENCE = {
  "cd37d410947f2fd4e003d4b89518c81af29896fd": "headline — 2026-04-12",
  "29908188c107c15eb7c848db542d0472afde7ec4": "headline — 2026-04-16",
  "bb06646d63f69a8779cd8b1b8a02ecd828c6b748": "headline — 2026-04-16",
  "38d771bf17ac80cd1134561d59eab79a7ea9588a": "headline — 2026-04-18",
  "de9ba8ebdfd286a4fbf50113b379fce2f3c99899": "tag warpos@0.1.4 commit — 2026-05-01",
};
const SIGNED = "db6292e2"; // 2026-04-18 'Update README.md', GitHub web-signed; ancestor of the tag commit
const TAG = "warpos@0.1.4";
const TAG_TARGET = "de9ba8ebdfd286a4fbf50113b379fce2f3c99899";

const git = (...a) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : "  FAIL"} ${msg}`); if (!cond) failures++; };

function readRules(file) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => l.split("==>")[0]);
}
const digest = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

if (flag("--digests")) {
  if (!RULES) { console.error("--digests needs --strings <rules-file>"); process.exit(2); }
  console.log("rule | sha256(literal) | length");
  readRules(RULES).forEach((s, i) => console.log(`${String(i + 1).padStart(2)} | ${digest(s)} | ${s.length}`));
  process.exit(0);
}

console.log(`assert-evidence — repo ${REPO} — ref ${REF}`);

// 1. objects exist and are commits
for (const [sha, label] of Object.entries(EVIDENCE)) {
  let type = "";
  try { type = git("cat-file", "-t", sha); } catch { type = "(missing)"; }
  ok(type === "commit", `${sha.slice(0, 8)} exists as a commit (${label}) — got ${type}`);
}
// signed commit keeps its signature
let signedFull = "", hasSig = false;
try {
  signedFull = git("rev-parse", `${SIGNED}^{commit}`);
  hasSig = /^gpgsig /m.test(git("cat-file", "commit", signedFull));
} catch { /* missing */ }
ok(signedFull.startsWith(SIGNED), `signed commit ${SIGNED} exists`);
ok(hasSig, `signed commit ${SIGNED} still carries its gpgsig header (a re-imported commit would have lost it)`);

// 2. tag resolves to the same commit
let tagTarget = "";
try { tagTarget = git("rev-parse", `${TAG}^{commit}`); } catch { tagTarget = "(missing)"; }
ok(tagTarget === TAG_TARGET, `tag ${TAG} → ${tagTarget.slice(0, 8)} (expected ${TAG_TARGET.slice(0, 8)})`);

// 3. ancestry of the ref under test
for (const sha of [...Object.keys(EVIDENCE), signedFull].filter(Boolean)) {
  let anc = false;
  try { execFileSync("git", ["-C", REPO, "merge-base", "--is-ancestor", sha, REF], { stdio: "ignore" }); anc = true; } catch { anc = false; }
  ok(anc, `${sha.slice(0, 8)} is an ancestor of ${REF}`);
}

// 4. removed strings are gone from EVERY history surface, not only from diffs (S-OS-06 r4, lane D).
//    The S-OS-03 form of this step was `git log --all -S<literal> -i` alone: blind to commit messages,
//    author/committer identity, tag objects, ref names and merge-introduced content — the exact gap a
//    purged literal survived in under a green sweep. history-surface.js owns the population and the
//    surfaces; THIS step reads its result and gates the exit code on it: a hit on any surface is a
//    failed assertion, a refusal (population not whole) is exit 2, and a run without --strings makes no
//    history claim at all. The rule literals and their matcher (fixed string, -i) are unchanged.
const { sweepHistory, formatPopulation, formatTallies } = require("./history-surface");
let refused = null;
let sweepSummary = "history sweep NOT RUN (no --strings) — this result makes no history-clean claim";
if (RULES) {
  let rules = null;
  try { rules = readRules(RULES); } catch (e) { refused = `rules file unreadable: ${e.message}`; }
  if (rules) {
    console.log(`history sweep: ${rules.length} literal(s) from ${path.basename(RULES)} (digests only)`);
    const sweep = sweepHistory(REPO, rules);
    if (sweep.population) for (const line of formatPopulation(sweep.population)) console.log(line);
    if (sweep.refused) {
      refused = sweep.refused;
    } else {
      for (const r of sweep.results) ok(r.clean, `sha256 ${r.digest.slice(0, 16)}… (len ${r.length}) — ${formatTallies(r)}`);
      const p = sweep.population;
      const dirty = sweep.results.filter((r) => !r.clean).length;
      sweepSummary = `history sweep: ${dirty} of ${sweep.results.length} literal(s) with hits over ${p.refs.total} refs · ${p.objects.commit} commits · ${p.objects.tag} tag objects · ${p.objects.total} reachable objects (surfaces searched and NOT searched as declared above)`;
    }
  }
  if (refused) {
    console.log(`  REFUSED history sweep — ${refused}`);
    sweepSummary = "history sweep REFUSED — no history-clean claim is made";
  }
}

if (refused) console.log(`\nRESULT: REFUSED — ${sweepSummary}${failures ? ` (and ${failures} failed assertion(s))` : ""}`);
else if (failures) console.log(`\nRESULT: FAIL (${failures} assertion(s)) — ${sweepSummary}`);
else console.log(`\nRESULT: OK — evidence byte-identical to the anchor; ${sweepSummary}`);
process.exit(refused ? 2 : failures ? 1 : 0);
