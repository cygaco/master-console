#!/usr/bin/env node
"use strict";

/**
 * S-OS-06 r4 lane G — G4 RESTORE + G5 HAND-OFF, computed from the committed join measurement record
 * (runtime/S-OS-06/r4/cross-lab-join.members.json, measured at 73b36112, recorded at 56139ca3). It does NOT re-measure
 * the join: it reads the record, proves the record still addresses the bytes it measured, and acts per OCCURRENCE.
 *
 *   rewrite   (provenance: the codemod rewrote the legacy token into this one)  -> RESTORE the lab, per occurrence
 *   authored  (provenance: the current-lab token was written after the rename)  -> NOT restored; handed to lane K
 *   unresolved                                                                  -> REFUSE (never folded into either)
 *
 * A restore replaces ONLY the lab characters of the one token at (file, line, col): the version, the rest of the line and
 * the rest of the file are untouched. Every restore is verified before the write (the token at that column is exactly
 * current-lab + at + version, lower-case, and the version is a real legacy tag) and re-verified after it.
 *
 * HELD (named, evidenced, never silently dropped): a rewrite member whose per-occurrence restore breaks the function of
 * the file it sits in. Each held entry binds EXACTLY one rewrite row or the script REFUSES.
 *
 * G4 (self-contamination): lab and version stored apart; every excerpt renders the at-sign as \x40; both artifacts are
 * checked against oracle (i)'s sighting regex before they are written.
 *
 * Usage: node runtime/S-OS-06/r4/oracles/join-restore.js [--apply] [--members <json>]
 *          [--restored-out <json>] [--authored-out <json>]
 * Without --apply: verifies and prints the plan, writes nothing. Exit 0 ok; 2 REFUSED.
 */

const fs = require("fs");
const path = require("path");
const L = require("./lib");
const O1 = require("./oracle-i-tag-claims");
const J = require("./cross-lab-join");

const NAME = "join-restore";
const AT = String.fromCharCode(64);
const R4 = path.join(L.REPO_ROOT, "runtime", "S-OS-06", "r4");

/**
 * Rewrite members whose per-occurrence restore breaks the file's own function. Keyed (file, line, col, version).
 * Evidence is the reproduction a reader can re-run; the script does not re-run it.
 */
const HELD = [
  {
    file: "scripts/mc/test-upgrade-current-to-new.js",
    line: 1262,
    col: 61,
    version: "0.17.0",
    reason:
      "the token is the fake `git tag -l` stdout inside selfTest()'s F1 positive control; tagExists() (lines 120 and 132) builds and compares the tag through an INTERPOLATION template the same codemod commit 7021ff55 rewrote to the current lab, so restoring this one occurrence alone makes the control compare the legacy lab against a current-lab template and FAIL. Restoring it together with lines 120/132 would restore two interpolation-slice occurrences, whose treatment (beta 8e5f3a02: warrantable with the ceiling printed) is NOT restoration, and would make tagExists wrong for every tag minted from 2.0.0 on. Contradictory -> held, escalated, not guessed.",
    evidence: [
      "on 56139ca3: selfTest (node scripts/mc/test-upgrade-current-to-new.js --self-test) pass=42 fail=0 overall=PASS",
      "same tree with ONLY this occurrence's lab restored (working tree, reverted, never committed): pass=41 fail=1 overall=FAIL; [FAIL] F1: tagExists positive control — a CLEAN exit-0 matching result returns true",
      "LIVE DEFECT the interpolation ceiling hides: on 56139ca3 require('./scripts/mc/test-upgrade-current-to-new.js').tagExists returns false for 0.17.0 and 1.2.0 although the legacy-lab tags of both versions exist (git tag -l lists the 1.2.0 one) — the codemod's template rewrite made every shipped release read as untagged to resolveVersions()",
    ],
    routeTo: "alpha / backend-lead (live code decision: a lab-aware tag lookup, legacy lab below 2.0.0 and current lab from 2.0.0); lane K for the property-A reading of the stub",
  },
];

/**
 * Rewrite members whose restore is VERIFIED but which an ENFORCING gate on THIS branch refuses to commit, because the gate
 * still carries the form-keyed RULE the computed-glob rule replaces (lane J, not landed here). Keyed (file, line, col,
 * version). Never bypassed; applied on the tree where the computed rule has landed (re-measure there — lines move).
 */
const GATE_DEFERRED = ["TRACKER.md:521:130", "TRACKER.md:561:105", "TRACKER.md:639:928", "TRACKER.md:698:573", "TRACKER.md:1064:524"].map((k) => {
  const [file, line, col] = k.split(":");
  return {
    file,
    line: Number(line),
    col: Number(col),
    version: "0.14*",
    gate: "scripts/hooks/framework-purity-guard.js -> scripts/checks/framework-purity.js --staged (legacy_slug ENFORCING at package.json 2.0.0)",
    reason:
      "the restored numeric-prefix listing glob is live-unallowed under this branch's EVIDENCE_TAG_RE (full semver, <semver>, bare glob, regex source — no numeric-prefix glob arm; the interim pin d5c74318 is not on this branch). Lane J's computed rule closes it by expansion; bypassing the guard is not an option.",
    evidence: "commit attempt on 56139ca3 with all 21 restorations staged: purity guard REFUSED, legacy_slug=5, LEGACY_SLUG: TRACKER.md [5 live-unallowed]; the other 16 restorations are not flagged",
  };
});

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    throw new L.OracleRefusal(`${L.toPosix(path.relative(L.REPO_ROOT, file))} unreadable or not JSON: ${e.message}`);
  }
}

function excerpt(lineText, col0, width = 110) {
  const start = Math.max(0, col0 - width);
  const end = Math.min(lineText.length, col0 + width);
  return J.escapeAt(`${start > 0 ? "…" : ""}${lineText.slice(start, end)}${end < lineText.length ? "…" : ""}`);
}

function splitFile(text) {
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const body = bom ? text.slice(1) : text;
  const crlf = (body.match(/\r\n/g) || []).length;
  const lf = (body.match(/\n/g) || []).length;
  if (crlf && crlf !== lf) throw new L.OracleRefusal("mixed line endings — refusing a line-addressed rewrite");
  const eol = crlf ? "\r\n" : "\n";
  return { bom, eol, lines: body.split(eol) };
}

/** The token starting at col0 on lineText, per grammar G; null if none starts there. */
function tokenAt(grammar, lineText, col0) {
  const re = grammar.tokenRe();
  let m;
  while ((m = re.exec(lineText)) !== null) {
    if (m.index === col0) return { labText: m[1], version: m[2], length: m[0].length };
    if (m.index > col0) break;
  }
  return null;
}

function main(args, out) {
  const apply = args.includes("--apply");
  const opt = (flag, def) => (args.indexOf(flag) >= 0 ? path.resolve(args[args.indexOf(flag) + 1]) : def);
  const membersPath = opt("--members", path.join(R4, "cross-lab-join.members.json"));
  const restoredOut = opt("--restored-out", path.join(R4, "join-restored.json"));
  const authoredOut = opt("--authored-out", path.join(R4, "join-authored-for-K.json"));

  const head = L.measuredHead(L.REPO_ROOT); // refuses a dirty tracked tree
  const doc = readJson(membersPath);
  const { currentLab, legacyLab, measuredHead } = doc;
  if (!currentLab || !legacyLab || currentLab === legacyLab) throw new L.OracleRefusal("members record does not name two distinct labs");
  if (!Array.isArray(doc.rows) || doc.rows.length !== doc.members) throw new L.OracleRefusal(`members record: rows ${doc.rows && doc.rows.length} != members ${doc.members}`);

  // the record must address THESE bytes: its measured head is an ancestor, and no member file changed since
  const anc = L.git(L.REPO_ROOT, ["merge-base", "--is-ancestor", measuredHead, head.sha]);
  if (anc.status !== 0) throw new L.OracleRefusal(`members record measured ${measuredHead.slice(0, 8)}, which is not an ancestor of HEAD ${head.sha.slice(0, 8)}`);
  const memberFiles = [...new Set(doc.rows.map((r) => r.file))];
  const drift = L.git(L.REPO_ROOT, ["diff", "--name-only", measuredHead, head.sha, "--", ...memberFiles]);
  if (drift.status !== 0) throw new L.OracleRefusal(`git diff failed: ${(drift.stderr || "").trim()}`);
  const drifted = drift.stdout.split(/\r?\n/).filter(Boolean);
  if (drifted.length) throw new L.OracleRefusal(`member file(s) changed since the measured head ${measuredHead.slice(0, 8)}: ${drifted.join(", ")} — the (line, col) addresses are stale`);

  const byKind = {};
  for (const r of doc.rows) L.bump(byKind, (r.provenance && r.provenance.kind) || "none");
  if (byKind.unresolved || byKind.none) throw new L.OracleRefusal(`provenance unresolved/absent on ${(byKind.unresolved || 0) + (byKind.none || 0)} member(s) — REFUSE-never-skip`);
  const rewrite = doc.rows.filter((r) => r.provenance.kind === "rewrite");
  const authored = doc.rows.filter((r) => r.provenance.kind === "authored");
  if (rewrite.length + authored.length !== doc.rows.length) throw new L.OracleRefusal(`provenance kinds do not partition the members: ${JSON.stringify(byKind)}`);

  const legacyTags = new Set(doc.legacyTagVersions);
  const grammar = O1.buildGrammar([legacyLab, currentLab].sort((a, b) => b.length - a.length));

  // bind every HELD entry to exactly one rewrite row
  const heldIdx = new Map();
  for (const h of HELD) {
    const hits = rewrite.map((r, i) => [r, i]).filter(([r]) => r.file === h.file && r.line === h.line && r.col === h.col && r.oldToken.version === h.version);
    if (hits.length !== 1) throw new L.OracleRefusal(`HELD entry ${h.file}:${h.line}:${h.col} binds ${hits.length} rewrite row(s), not exactly one`);
    heldIdx.set(hits[0][1], h);
  }

  const deferredIdx = new Map();
  for (const d of GATE_DEFERRED) {
    const hits = rewrite.map((r, i) => [r, i]).filter(([r]) => r.file === d.file && r.line === d.line && r.col === d.col && r.oldToken.version === d.version);
    if (hits.length !== 1 || heldIdx.has(hits[0][1])) throw new L.OracleRefusal(`GATE_DEFERRED entry ${d.file}:${d.line}:${d.col} binds ${hits.length} rewrite row(s) (or a HELD one), not exactly one`);
    deferredIdx.set(hits[0][1], d);
  }

  // the ONE computed-glob implementation (lane J's): every glob rewrite member must read RESTORE as found and
  // COMPUTED-SATISFIED once restored, or the restore does not rest on computation and the script refuses
  const { resolveGlobRule } = require("./glob-rule");
  const globRule = resolveGlobRule(L.REPO_ROOT);
  const tagList = globRule.impl.readTagList({ root: L.REPO_ROOT });
  if (!tagList.ok) throw new L.OracleRefusal(`tag list unreadable for the computed-glob rule: ${tagList.reason}`);
  const globVerdict = new Map();
  rewrite.forEach((r, i) => {
    if (r.joinKind !== "pattern") return;
    const asFound = globRule.impl.computeTagGlob({ lab: currentLab, pattern: r.oldToken.version, tags: tagList, currentLab, legacyLab });
    const restored = globRule.impl.computeTagGlob({ lab: legacyLab, pattern: r.oldToken.version, tags: tagList, currentLab, legacyLab });
    if (asFound.treatment !== "restore" || restored.treatment !== "computed-satisfied") {
      throw new L.OracleRefusal(`${r.file}:${r.line}:${r.col}: computed-glob rule reads as-found=${asFound.treatment}, restored=${restored.treatment} (expected restore / computed-satisfied)`);
    }
    globVerdict.set(i, { asFound: { lab: currentLab, pattern: r.oldToken.version, treatment: asFound.treatment, legacyMembers: asFound.legacyMembers }, restored: { lab: legacyLab, pattern: r.oldToken.version, treatment: restored.treatment, members: restored.members } });
  });

  // plan + verify every restore against the bytes on disk
  const plan = [];
  const deferred = [];
  const fileCache = new Map();
  const load = (rel) => {
    if (!fileCache.has(rel)) fileCache.set(rel, splitFile(fs.readFileSync(path.join(L.REPO_ROOT, rel), "utf8")));
    return fileCache.get(rel);
  };
  rewrite.forEach((r, i) => {
    if (heldIdx.has(i)) return;
    const f = load(r.file);
    const lineText = f.lines[r.line - 1];
    if (lineText === undefined) throw new L.OracleRefusal(`${r.file}:${r.line} does not exist`);
    const col0 = r.col - 1;
    const t = tokenAt(grammar, lineText, col0);
    if (!t || t.labText !== currentLab || t.version !== r.oldToken.version) {
      throw new L.OracleRefusal(`${r.file}:${r.line}:${r.col}: expected the lower-case current-lab token of version ${JSON.stringify(r.oldToken.version)} at this column, found ${t ? `lab=${t.labText} version=${JSON.stringify(t.version)}` : "no G token"}`);
    }
    if (r.oldToken.lab !== currentLab || r.tagRealityRestoreTo.lab !== legacyLab || r.tagRealityRestoreTo.version !== r.oldToken.version) {
      throw new L.OracleRefusal(`${r.file}:${r.line}:${r.col}: record's restore target is not (legacy lab, same version)`);
    }
    const tagsOk = r.joinKind === "exact" ? legacyTags.has(r.oldToken.version) : r.legacyTagsMatched.length > 0 && r.legacyTagsMatched.every((v) => legacyTags.has(v));
    if (!tagsOk) throw new L.OracleRefusal(`${r.file}:${r.line}:${r.col}: the legacy tag reality the restore rests on does not hold`);
    const pre = r.provenance.preimage || "";
    if (!pre.includes(`${legacyLab}\\x40${r.oldToken.version}`)) throw new L.OracleRefusal(`${r.file}:${r.line}:${r.col}: pre-image does not carry the lower-case legacy token of this version`);
    if (deferredIdx.has(i)) deferred.push({ r, i, d: deferredIdx.get(i), lineBefore: lineText });
    else plan.push({ r, i, col0, lineBefore: lineText });
  });

  // apply per line, right-to-left so earlier columns keep their addresses
  const byLine = new Map();
  for (const p of plan) {
    const k = `${p.r.file} ${p.r.line}`;
    if (!byLine.has(k)) byLine.set(k, []);
    byLine.get(k).push(p);
  }
  const touched = new Set();
  for (const ps of byLine.values()) {
    ps.sort((a, b) => b.col0 - a.col0);
    const f = load(ps[0].r.file);
    let text = f.lines[ps[0].r.line - 1];
    for (const p of ps) text = text.slice(0, p.col0) + legacyLab + text.slice(p.col0 + currentLab.length);
    f.lines[ps[0].r.line - 1] = text;
    for (const p of ps) p.lineAfter = text;
    touched.add(ps[0].r.file);
  }

  // re-verify the planned bytes: each restored token now reads legacy lab + same version at its column (columns to the
  // right of an earlier restore on the same line shift by the lab-length delta)
  const delta = legacyLab.length - currentLab.length;
  for (const p of plan) {
    const shift = byLine.get(`${p.r.file} ${p.r.line}`).filter((q) => q.col0 < p.col0).length * delta;
    const t = tokenAt(grammar, p.lineAfter, p.col0 + shift);
    if (!t || t.labText !== legacyLab || t.version !== p.r.oldToken.version) throw new L.OracleRefusal(`post-verify failed at ${p.r.file}:${p.r.line}:${p.r.col}`);
    p.newCol = p.col0 + shift + 1;
  }

  const restoredDoc = {
    $question:
      "Which cross-lab join members did the codemod falsify (provenance = rewrite), and — per occurrence — what was restored? Lab and version are stored apart; excerpts render the at-sign as \\x40.",
    joinRecord: L.toPosix(path.relative(L.REPO_ROOT, membersPath)),
    joinMeasuredHead: measuredHead,
    appliedOnHead: head.sha,
    currentLab,
    legacyLab,
    counts: { members: doc.rows.length, rewrite: rewrite.length, authored: authored.length, restored: plan.length, gateDeferred: deferred.length, held: heldIdx.size },
    countsNote:
      "rewrite and authored travel together: the codemod-falsification hypothesis holds for the rewrite members only; the authored members were hand-written after the rename and are NOT restorations (handed to lane K). rewrite = restored + gateDeferred + held.",
    computedGlobRule: globRule.source,
    computedGlobTagSource: tagList.method,
    restored: plan.map((p) => ({
      file: p.r.file,
      line: p.r.line,
      col: p.r.col,
      colAfter: p.newCol,
      joinKind: p.r.joinKind,
      form: p.r.form,
      partitionClass: p.r.partitionClass,
      oldToken: { lab: currentLab, version: p.r.oldToken.version },
      newToken: { lab: legacyLab, version: p.r.oldToken.version },
      legacyTagsMatched: p.r.legacyTagsMatched,
      provenance: { commit: p.r.provenance.commit, summary: p.r.provenance.summary, date: p.r.provenance.date, alignment: p.r.provenance.alignment },
      preimage: p.r.provenance.preimage,
      lineBefore: excerpt(p.lineBefore, p.col0),
      lineAfter: excerpt(p.lineAfter, p.newCol - 1),
      restoredLineEqualsPreimageExcerpt: excerpt(p.lineAfter, p.newCol - 1) === p.r.provenance.preimage,
      computedGlob: globVerdict.get(p.i) || null,
    })),
    gateDeferred: deferred.map((q) => ({
      file: q.r.file,
      line: q.r.line,
      col: q.r.col,
      joinKind: q.r.joinKind,
      form: q.r.form,
      partitionClass: q.r.partitionClass,
      oldToken: { lab: currentLab, version: q.r.oldToken.version },
      newToken: { lab: legacyLab, version: q.r.oldToken.version },
      legacyTagsMatched: q.r.legacyTagsMatched,
      provenance: { commit: q.r.provenance.commit, summary: q.r.provenance.summary, date: q.r.provenance.date, alignment: q.r.provenance.alignment },
      preimage: q.r.provenance.preimage,
      lineAsFound: excerpt(q.lineBefore, q.r.col - 1),
      computedGlob: globVerdict.get(q.i) || null,
      status: "VERIFIED restore, NOT applied on this branch",
      gate: q.d.gate,
      reason: J.escapeAt(q.d.reason),
      evidence: J.escapeAt(q.d.evidence),
    })),
    held: [...heldIdx.entries()].map(([i, h]) => ({
      file: rewrite[i].file,
      line: rewrite[i].line,
      col: rewrite[i].col,
      form: rewrite[i].form,
      partitionClass: rewrite[i].partitionClass,
      token: { lab: currentLab, version: rewrite[i].oldToken.version },
      wouldRestoreTo: { lab: legacyLab, version: rewrite[i].oldToken.version },
      provenance: rewrite[i].provenance,
      lineExcerpt: rewrite[i].lineExcerpt,
      reason: J.escapeAt(h.reason),
      evidence: h.evidence.map(J.escapeAt),
      routeTo: h.routeTo,
    })),
  };

  const authoredDoc = {
    $question:
      "Which cross-lab join members carry the current-lab token because an author WROTE it after the rename (provenance = authored), for lane K to adjudicate per file under section 1 (property A: instrument — the literal is the subject; property B: record)? Nothing here is restored, warranted or dispositioned by lane G. Lab and version stored apart; excerpts render the at-sign as \\x40.",
    joinRecord: L.toPosix(path.relative(L.REPO_ROOT, membersPath)),
    joinMeasuredHead: measuredHead,
    writtenOnHead: head.sha,
    currentLab,
    legacyLab,
    counts: { members: doc.rows.length, authored: authored.length, rewrite: rewrite.length },
    countsNote: "authored and rewrite travel together; never report the members as restorations.",
    byFile: Object.fromEntries(L.sortedEntries(authored.reduce((o, r) => (L.bump(o, r.file), o), {}))),
    authored: authored.map((r) => ({
      file: r.file,
      line: r.line,
      col: r.col,
      joinKind: r.joinKind,
      form: r.form,
      partitionClass: r.partitionClass,
      token: r.oldToken,
      legacyTagsMatched: r.legacyTagsMatched,
      provenance: r.provenance,
      lineExcerpt: r.lineExcerpt,
    })),
    referredRewriteHeld: {
      note: "NOT authored and NOT counted above: a rewrite-provenance member lane G held because its per-occurrence restore breaks the file's function (see join-restored.json#held). Referred for the property-A reading only; the live-code decision routes to alpha.",
      rows: restoredDoc.held.map((h) => ({ file: h.file, line: h.line, col: h.col, token: h.token, provenanceKind: h.provenance.kind, reason: h.reason })),
    },
  };

  const restoredBody = JSON.stringify(restoredDoc, null, 1);
  const authoredBody = JSON.stringify(authoredDoc, null, 1);
  J.assertNoSightings(grammar, restoredBody, "join-restored.json");
  J.assertNoSightings(grammar, authoredBody, "join-authored-for-K.json");

  out.push(`${NAME}: join record ${L.toPosix(path.relative(L.REPO_ROOT, membersPath))} measured ${measuredHead.slice(0, 8)}; HEAD ${head.sha} (${head.branch}); member files unchanged since the measured head`);
  out.push(`  members=${doc.rows.length}: rewrite=${rewrite.length} authored=${authored.length} (unresolved=0)`);
  out.push(`  computed-glob rule: ${globRule.source}; tag source ${tagList.method}`);
  out.push(`  RESTORE ${plan.length} occurrence(s) in ${touched.size} file(s); GATE-DEFERRED ${deferred.length}; HELD ${heldIdx.size}; authored ${authored.length} -> lane K`);
  for (const p of plan) out.push(`    ${p.r.file}:${p.r.line}:${p.r.col}  ${p.r.form}  lab=${currentLab} version=${p.r.oldToken.version} -> lab=${legacyLab} version=${p.r.oldToken.version}${globVerdict.has(p.i) ? `  [computed: as-found ${globVerdict.get(p.i).asFound.treatment}, restored ${globVerdict.get(p.i).restored.treatment} members=${globVerdict.get(p.i).restored.members.length}]` : ""}`);
  for (const q of deferred) out.push(`    GATE-DEFERRED ${q.r.file}:${q.r.line}:${q.r.col}  ${q.r.form}  lab=${currentLab} version=${q.r.oldToken.version} -> lab=${legacyLab} version=${q.r.oldToken.version}  [computed: as-found ${globVerdict.get(q.i).asFound.treatment}, restored ${globVerdict.get(q.i).restored.treatment} members=${globVerdict.get(q.i).restored.members.join(" ")}]`);
  for (const h of restoredDoc.held) out.push(`    HELD ${h.file}:${h.line}:${h.col}  lab=${currentLab} version=${h.token.version}  (${h.reason.slice(0, 140)}…)`);
  if (!apply) {
    out.push(`  --apply not given: nothing written`);
    return { code: 0 };
  }
  for (const rel of touched) {
    const f = fileCache.get(rel);
    fs.writeFileSync(path.join(L.REPO_ROOT, rel), f.bom + f.lines.join(f.eol), "utf8");
  }
  L.writeOut(restoredOut, [restoredBody]);
  L.writeOut(authoredOut, [authoredBody]);
  out.push(`  written: ${touched.size} file(s); ${L.toPosix(path.relative(L.REPO_ROOT, restoredOut))}; ${L.toPosix(path.relative(L.REPO_ROOT, authoredOut))}`);
  return { code: 0 };
}

if (require.main === module) L.runCli(NAME, main);

module.exports = { HELD, tokenAt, splitFile };
