#!/usr/bin/env node
"use strict";

/**
 * ORACLE (i) — CROSS-LAB TAG-REALITY JOIN. S-OS-06 r4 stage 2, lane G, item G1 (β verdict 8e5f3a02, row 474;
 * STOP-CONDITION Amendment 2). A MEASUREMENT instrument: it writes no warrant, restores nothing, dispositions nothing.
 *
 * Question: which oracle (i) candidates of the CURRENT lab (package.json#name) name a version that exists as a tag of
 * the LEGACY lab? Amendment 2's qualifying test is TAG REALITY, never the file's partition class, so the join runs over
 * every candidate regardless of the class of the file it sits in.
 *
 * It judges with oracle (i)'s OWN measurement (same grammar G, same population, same tag source, same R5 refusal) by
 * calling oracle-i-tag-claims.js#measure — never a copy of G. Join kinds, keyed on oracle (i)'s own version form:
 *   exact    full-semver / partial / over-long / suffix / v-prefixed: the EXACT version string is a legacy tag
 *            (consistent with oracle (i)'s own join, which is on the exact string)
 *   pattern  glob: the pattern expands to >=1 legacy tag. The expansion is cross-checked against oracle (i)'s own
 *            descriptive `coreResolves` over EVERY same-lab glob occurrence of the population; any disagreement REFUSES
 *   (none)   placeholder / interpolation / unparsed: uncheckable by form, not joinable — COUNTED, never dropped
 *
 * PROVENANCE (the measurement of β's hypothesis, which β named and explicitly did not assert): for each member, the
 * token is traced back line-by-line through history (git blame -> the introducing commit's -U0 hunk -> the pre-image
 * line) until the commit where this occurrence of the current-lab token first appears on the line. There:
 *   rewrite   the pre-image line carried the LEGACY-lab token of the same version in its place — the codemod shape
 *   authored  the pre-image carried neither — the current-lab token was WRITTEN, not rewritten
 *   unresolved the trace could not be completed (cap, missing hunk, token absent from the blamed line) — REFUSE-never-skip:
 *             printed and counted, never folded into either kind
 *
 * Self-contamination (G4): lab and version are stored APART in every emitted row; every excerpt renders the at-sign as
 * the four characters \x40; and both the printout and the members file are checked against oracle (i)'s own sighting
 * regex before they are written — a single lab-at sighting in either REFUSES the write.
 *
 * Usage: node runtime/S-OS-06/r4/oracles/cross-lab-join.js [--out <file>] [--members <json>] [--no-provenance]
 * Exit: 0 measured, join empty; 1 measured, join non-empty; 2 REFUSED.
 */

const fs = require("fs");
const path = require("path");
const L = require("./lib");
const O1 = require("./oracle-i-tag-claims");

const NAME = "cross-lab-join";
const TRACE_CAP = 400;
const AT = String.fromCharCode(64);
const EXACT_FORMS = new Set(["full-semver", "full-semver+suffix", "v-prefixed", "partial", "over-long"]);
const PATTERN_FORMS = new Set(["glob"]);

// ── pattern expansion (cross-checked against oracle (i)'s descriptive coreResolves; see assertExpansionAgrees) ──

/**
 * The SAME glob semantics oracle (i) applies descriptively (oracle-i-tag-claims.js#globToRe, not exported there):
 * `*` is any run, an `x`/`X` segment is one numeric segment, the match is anchored at the start and must end at the
 * end of the tag or at a `.`/`-` boundary. Replicated, not imported, so it is CROSS-CHECKED on the whole population.
 */
function globMatcher(version) {
  const src = "^" + version.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/[*]/g, ".*").replace(/(^|\.)[xX](?=\.|$)/g, "$1\\d+") + "(?:$|[.-])";
  const rx = new RegExp(src);
  return (t) => rx.test(t);
}

function expandAgainst(form, version, labVersions) {
  if (EXACT_FORMS.has(form)) return labVersions.includes(version) ? [version] : [];
  if (PATTERN_FORMS.has(form)) {
    const m = globMatcher(version);
    return labVersions.filter((t) => m(t));
  }
  return null; // uncheckable by form
}

/** Same-lab agreement: for every glob occurrence in the population, expansion against ITS OWN lab must be non-empty iff oracle (i)'s coreResolves is true. */
function assertExpansionAgrees(r) {
  const disagreements = [];
  let checked = 0;
  for (const o of r.occurrences) {
    if (!PATTERN_FORMS.has(o.form) || o.coreResolves === null) continue;
    checked += 1;
    const mine = expandAgainst(o.form, o.version, r.tags.parsed.byLab[o.lab] || []).length > 0;
    if (mine !== o.coreResolves) disagreements.push(`${o.file}:${o.line}:${o.col0 + 1} lab=${o.lab} version=${JSON.stringify(o.version)} oracle-i=${o.coreResolves} join=${mine}`);
  }
  if (disagreements.length) {
    throw new L.OracleRefusal(`pattern expansion disagrees with oracle (i)'s own coreResolves on ${disagreements.length} occurrence(s): ${disagreements.slice(0, 5).join(" | ")}`);
  }
  return checked;
}

// ── excerpts (G4) ───────────────────────────────────────────────────────────

function escapeAt(s) {
  return String(s).split(AT).join("\\x40");
}

function excerpt(lineText, col0, width = 110) {
  const start = Math.max(0, col0 - width);
  const end = Math.min(lineText.length, col0 + width);
  return escapeAt(`${start > 0 ? "…" : ""}${lineText.slice(start, end)}${end < lineText.length ? "…" : ""}`);
}

function assertNoSightings(grammar, text, what) {
  const hits = String(text).match(grammar.sightingRe()) || [];
  if (hits.length) throw new L.OracleRefusal(`G4 self-contamination guard: ${what} would carry ${hits.length} lab-at sighting(s) — refusing to write it`);
}

// ── provenance trace ────────────────────────────────────────────────────────

function tokenPositions(grammar, lineText, lab, version) {
  const out = [];
  const re = grammar.tokenRe();
  let m;
  while ((m = re.exec(lineText)) !== null) if (m[1].toLowerCase() === lab && m[2] === version) out.push(m.index);
  return out;
}

function parseBlame(stdout) {
  const lines = stdout.split(/\r?\n/);
  const head = /^([0-9a-f]{40}) (\d+) (\d+)/.exec(lines[0] || "");
  if (!head) return null;
  const rec = { commit: head[1], origLine: Number(head[2]), finalLine: Number(head[3]), previous: null, filename: null, summary: "", boundary: false, authorTime: null };
  for (const l of lines.slice(1)) {
    if (l.startsWith("\t")) break;
    if (l.startsWith("previous ")) {
      const sp = l.slice(9);
      const i = sp.indexOf(" ");
      rec.previous = { commit: sp.slice(0, i), path: sp.slice(i + 1) };
    } else if (l.startsWith("filename ")) rec.filename = l.slice(9);
    else if (l.startsWith("summary ")) rec.summary = l.slice(8);
    else if (l === "boundary") rec.boundary = true;
    else if (l.startsWith("author-time ")) rec.authorTime = Number(l.slice(12));
  }
  return rec;
}

function parseHunks(diffText) {
  const hunks = [];
  let cur = null;
  for (const raw of diffText.split("\n")) {
    const l = raw.replace(/\r$/, "");
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l);
    if (h) {
      cur = { oldStart: Number(h[1]), oldLen: h[2] === undefined ? 1 : Number(h[2]), newStart: Number(h[3]), newLen: h[4] === undefined ? 1 : Number(h[4]), removed: [], added: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur) continue;
    if (l.startsWith("-") && !l.startsWith("---")) cur.removed.push(l.slice(1));
    else if (l.startsWith("+") && !l.startsWith("+++")) cur.added.push(l.slice(1));
  }
  return hunks;
}

/** Word-set similarity with every G token and every lab/slug spelling neutralised, so a rewritten line still aligns with its pre-image. */
function similarity(grammar, a, b) {
  const norm = (s) =>
    new Set(
      String(s)
        .replace(grammar.tokenRe(), " TOK ")
        .replace(new RegExp(`${L.SLUG}|warp|mc`, "gi"), " S ")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
    );
  const A = norm(a);
  const B = norm(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / (A.size + B.size - inter);
}

const CROSS_FILE_MIN_SIMILARITY = 0.6;

/**
 * When the line has no in-file pre-image (a new file, or a pure addition), look for it in the pre-images of every
 * OTHER file the same commit deleted, renamed or modified (a rename-with-edits falls below blame's rename threshold).
 * Only lines carrying the current-lab token (past the ordinal) or the legacy-lab token of the version qualify; the most
 * similar at or above CROSS_FILE_MIN_SIMILARITY wins. -> { pre, preRev, prePath, preLine, score } | null
 */
function crossFilePreimage(root, grammar, { commit, targetPath, targetText, lab, version, legacyLab, ordinal }) {
  const parent = L.git(root, ["rev-parse", "--verify", "--quiet", `${commit}^1`]);
  if (parent.status !== 0) return null;
  const preRev = parent.stdout.trim();
  const ns = L.git(root, ["diff", "--no-color", "--name-status", "-M", preRev, commit]);
  if (ns.status !== 0) return null;
  const changed = new Set();
  for (const row of ns.stdout.split(/\r?\n/).filter(Boolean)) {
    const cols = row.split("\t");
    const status = cols[0][0];
    if (!"DRMC".includes(status)) continue;
    if (status === "M" && cols[1] === targetPath) continue; // the in-file hunk was already examined
    changed.add(cols[1]);
  }
  if (!changed.size) return null;
  // one fixed-string, case-insensitive grep of the parent tree for either spelling of the token; exact G re-check below
  const g = L.git(root, ["grep", "-z", "-n", "-I", "-i", "-F", "--full-name", "-e", [lab, version].join(AT), "-e", [legacyLab, version].join(AT), preRev]);
  if (g.status !== 0 && g.status !== 1) return null;
  const NUL = String.fromCharCode(0);
  let best = null;
  for (const rec of g.stdout.split("\n").filter(Boolean)) {
    const parts = rec.split(NUL);
    if (parts.length < 3) continue;
    const pth = parts[0].slice(preRev.length + 1);
    if (!changed.has(pth)) continue;
    const l = parts.slice(2).join(NUL).replace(/\r$/, "");
    const qualifies = tokenPositions(grammar, l, lab, version).length > ordinal || tokenPositions(grammar, l, legacyLab, version).length > 0;
    if (!qualifies) continue;
    const score = similarity(grammar, l, targetText);
    if (score >= CROSS_FILE_MIN_SIMILARITY && (!best || score > best.score)) best = { pre: l, preRev, prePath: pth, preLine: Number(parts[1]), score };
  }
  return best;
}

/**
 * Trace one occurrence (ordinal k of the exact current-lab token on its line) back to the commit that introduced it.
 * -> { kind: rewrite|authored|unresolved, commit, summary, date, steps, alignment, preimage, legacyCountPre, legacyCountPost, reason }
 */
function traceOccurrence(root, grammar, { file, line, col0, lab, version, legacyLab }) {
  const shaRes = L.git(root, ["rev-parse", "HEAD"]);
  let rev = shaRes.stdout.trim();
  let p = file;
  let ln = line;
  let lineText = null;
  let ordinal = null;
  for (let step = 0; step < TRACE_CAP; step += 1) {
    const b = L.git(root, ["blame", "-M", "-C", "--porcelain", "-L", `${ln},${ln}`, rev, "--", p]);
    if (b.status !== 0) return { kind: "unresolved", steps: step, reason: `git blame ${rev.slice(0, 8)} ${p}:${ln} failed: ${(b.stderr || "").trim().slice(0, 160)}` };
    const rec = parseBlame(b.stdout);
    if (!rec) return { kind: "unresolved", steps: step, reason: `unparseable blame for ${p}:${ln}` };
    const date = rec.authorTime ? new Date(rec.authorTime * 1000).toISOString().slice(0, 10) : null;
    const blamedPath = rec.filename || p;
    // the blamed line as it stands in rec.commit
    const shown = L.git(root, ["show", `${rec.commit}:${blamedPath}`]);
    if (shown.status !== 0) return { kind: "unresolved", steps: step, commit: rec.commit, reason: `git show ${rec.commit.slice(0, 8)}:${blamedPath} failed` };
    const target = shown.stdout.split("\n")[rec.origLine - 1];
    if (target === undefined) return { kind: "unresolved", steps: step, commit: rec.commit, reason: `line ${rec.origLine} absent from ${blamedPath}@${rec.commit.slice(0, 8)}` };
    const targetText = target.replace(/\r$/, "");
    const posTarget = tokenPositions(grammar, targetText, lab, version);
    if (lineText === null) {
      lineText = targetText;
      ordinal = posTarget.indexOf(col0);
      if (ordinal < 0) return { kind: "unresolved", steps: step, commit: rec.commit, reason: `the measured token is not at col ${col0 + 1} of the blamed line (working-tree/HEAD drift?)` };
    }
    if (posTarget.length <= ordinal) return { kind: "unresolved", steps: step, commit: rec.commit, reason: `ordinal ${ordinal} of the token not present on the blamed line in ${rec.commit.slice(0, 8)}` };
    let pre = null;
    let preRev = null;
    let prePath = null;
    let preLine = null;
    let alignment;
    if (rec.previous) {
      const d = L.git(root, ["diff", "--no-color", "--no-ext-diff", "-U0", "-M", rec.previous.commit, rec.commit, "--", rec.previous.path, blamedPath]);
      if (d.status !== 0) return { kind: "unresolved", steps: step, commit: rec.commit, reason: `git diff failed: ${(d.stderr || "").trim().slice(0, 160)}` };
      const hunk = parseHunks(d.stdout).find((h) => h.newLen > 0 && rec.origLine >= h.newStart && rec.origLine < h.newStart + h.newLen);
      if (!hunk) return { kind: "unresolved", steps: step, commit: rec.commit, reason: `no -U0 hunk covers ${blamedPath}:${rec.origLine} in ${rec.commit.slice(0, 8)}` };
      const idx = rec.origLine - hunk.newStart;
      const carries = (r) => tokenPositions(grammar, r, lab, version).length > ordinal || tokenPositions(grammar, r, legacyLab, version).length > 0;
      if (hunk.removed.length === 0) alignment = "pure-addition";
      else if (hunk.removed.length === hunk.added.length && carries(hunk.removed[idx].replace(/\r$/, ""))) {
        alignment = "positional";
        pre = hunk.removed[idx].replace(/\r$/, "");
        preLine = hunk.oldStart + idx;
      } else {
        // unequal hunk, or the positional partner carries neither token: the most similar removed line that carries the
        // current-lab token (past the ordinal) or the legacy token of the version, at or above the similarity floor
        alignment = hunk.removed.length === hunk.added.length ? "positional-partner-carries-neither->content" : "content";
        let bestJ = -1;
        let bestScore = -1;
        hunk.removed.forEach((raw, j) => {
          const r = raw.replace(/\r$/, "");
          if (!carries(r)) return;
          const s = similarity(grammar, r, targetText);
          if (s >= CROSS_FILE_MIN_SIMILARITY && s > bestScore) {
            bestScore = s;
            bestJ = j;
          }
        });
        if (bestJ >= 0) {
          pre = hunk.removed[bestJ].replace(/\r$/, "");
          preLine = hunk.oldStart + bestJ;
          alignment += `(similarity ${bestScore.toFixed(2)})`;
        }
      }
      if (pre !== null) {
        preRev = rec.previous.commit;
        prePath = rec.previous.path;
      }
    } else alignment = "no-in-file-previous";
    if (pre === null) {
      const x = crossFilePreimage(root, grammar, { commit: rec.commit, targetPath: blamedPath, targetText, lab, version, legacyLab, ordinal });
      if (x) {
        ({ pre, preRev, prePath, preLine } = x);
        alignment = `${alignment}+cross-file(${x.prePath}, similarity ${x.score.toFixed(2)})`;
      }
    }
    const summary = rec.summary;
    if (pre !== null && tokenPositions(grammar, pre, lab, version).length > ordinal) {
      // the occurrence pre-existed this commit: keep walking
      rev = preRev;
      p = prePath;
      ln = preLine;
      continue;
    }
    const legacyPre = pre === null ? 0 : tokenPositions(grammar, pre, legacyLab, version).length;
    const legacyPost = tokenPositions(grammar, targetText, legacyLab, version).length;
    if (legacyPre > legacyPost) {
      return {
        kind: "rewrite",
        steps: step + 1,
        commit: rec.commit,
        summary,
        date,
        alignment,
        legacyCountPre: legacyPre,
        legacyCountPost: legacyPost,
        preimage: excerpt(pre, tokenPositions(grammar, pre, legacyLab, version)[0]),
        reason: "the legacy-lab token of this version LEFT the line in the commit where the current-lab token appeared on it",
      };
    }
    return {
      kind: "authored",
      steps: step + 1,
      commit: rec.commit,
      summary,
      date,
      alignment,
      legacyCountPre: legacyPre,
      legacyCountPost: legacyPost,
      preimage: pre === null ? null : excerpt(pre, 0, 160),
      reason:
        pre === null
          ? rec.previous
            ? "the line was added with the token already in it and no same-commit pre-image carries either token"
            : "the line first appears in this commit and no same-commit pre-image carries either token"
          : "the current-lab token appeared on the line while no legacy-lab token of this version left it",
    };
  }
  return { kind: "unresolved", steps: TRACE_CAP, reason: `trace cap ${TRACE_CAP} reached` };
}

// ── measurement ─────────────────────────────────────────────────────────────

function measureJoin({ root = L.REPO_ROOT, regenFn, remoteFn, provenance = true } = {}) {
  const opts = { root };
  if (regenFn) opts.regenFn = regenFn;
  if (remoteFn) opts.remoteFn = remoteFn;
  const r = O1.measure(opts);
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8").replace(/^\uFEFF/, ""));
  } catch (e) {
    throw new L.OracleRefusal(`package.json unreadable — the current lab cannot be named: ${e.message}`);
  }
  const currentLab = typeof pkg.name === "string" ? pkg.name.toLowerCase() : null;
  const legacyLab = r.tags.legacyLab;
  if (!currentLab || !r.labs.includes(currentLab)) throw new L.OracleRefusal(`current lab (package.json#name=${JSON.stringify(pkg.name)}) is not a lab of grammar G`);
  if (currentLab === legacyLab) throw new L.OracleRefusal("current lab equals the legacy lab — there is no cross-lab join to compute");
  const legacyVersions = r.tags.parsed.byLab[legacyLab] || [];
  if (!legacyVersions.length) throw new L.OracleRefusal("legacy-lab tag list is empty — R5 should already have refused");
  const expansionChecked = assertExpansionAgrees(r);

  const currentCands = r.candidates.filter((o) => o.lab === currentLab);
  const members = [];
  const notJoinable = {};
  const noHit = {};
  const unjoinable = [];
  for (const o of currentCands) {
    const matched = expandAgainst(o.form, o.version, legacyVersions);
    if (matched === null) {
      L.bump(notJoinable, o.form);
      unjoinable.push({ o });
      continue;
    }
    if (!matched.length) {
      L.bump(noHit, o.form);
      continue;
    }
    members.push({ o, kind: EXACT_FORMS.has(o.form) ? "exact" : "pattern", matched });
  }
  if (provenance) {
    // members, then (DESCRIPTIVE ONLY, never join members) the current-lab candidates whose form is uncheckable against a tag list
    for (const m of [...members, ...unjoinable]) {
      m.prov = traceOccurrence(root, r.grammar, { file: m.o.file, line: m.o.line, col0: m.o.col0, lab: currentLab, version: m.o.version, legacyLab });
    }
  }
  return { r, currentLab, legacyLab, legacyVersions, currentCands, members, notJoinable, noHit, unjoinable, expansionChecked, provenance };
}

function tallyLine(j) {
  const exact = j.members.filter((m) => m.kind === "exact").length;
  const pattern = j.members.length - exact;
  const nj = Object.values(j.notJoinable).reduce((a, b) => a + b, 0);
  const nh = Object.values(j.noHit).reduce((a, b) => a + b, 0);
  return (
    `  CROSS-LAB JOIN (tag reality, Amendment 2): current-lab(${j.currentLab}) candidates=${j.currentCands.length} joined against legacy-lab(${j.legacyLab}) tags=${j.legacyVersions.length} ` +
    `-> MEMBERS=${j.members.length} (exact=${exact}, pattern=${pattern}) + no legacy tag=${nh} + not joinable by form=${nj}  [sum=${j.members.length + nh + nj} holds=${j.members.length + nh + nj === j.currentCands.length}]`
  );
}

function format(j) {
  const r = j.r;
  const out = [];
  const o1 = O1.format(r).lines;
  // oracle (i)'s own frame, with the cross-lab tally inserted as its own line directly after the CANDIDATES line
  const at = o1.findIndex((l) => /^\s+CANDIDATES \(version absent from the tag list\):/.test(l));
  if (at < 0) throw new L.OracleRefusal("oracle (i) frame has no CANDIDATES line to anchor the cross-lab tally");
  out.push(...o1.slice(0, at + 1), tallyLine(j), ...o1.slice(at + 1));
  out.push("");
  out.push(`CROSS-LAB JOIN — members, provenance and the premise measurement (lane G, G1; MEASUREMENT ONLY: nothing restored, nothing warranted)`);
  out.push(`  measured head: ${r.head.sha} (${r.head.branch})`);
  out.push(`  join kinds: exact (forms ${[...EXACT_FORMS].join("/")}: exact version string is a legacy tag); pattern (forms ${[...PATTERN_FORMS].join("/")}: expands to >=1 legacy tag)`);
  out.push(`  pattern expansion cross-checked against oracle (i)'s own coreResolves on ${j.expansionChecked} same-lab glob occurrence(s): all agree (a disagreement REFUSES)`);
  out.push(`  current-lab candidates outside the join: no legacy tag {${L.sortedEntries(j.noHit).map(([k, v]) => `${k}=${v}`).join(", ")}}; not joinable by form {${L.sortedEntries(j.notJoinable).map(([k, v]) => `${k}=${v}`).join(", ")}}`);
  const by = (fn) => {
    const b = {};
    for (const m of j.members) L.bump(b, fn(m));
    return L.sortedEntries(b).map(([k, v]) => `${k}=${v}`).join("; ");
  };
  if (j.members.length) {
    out.push(`  members by (lab, version): ${by((m) => `lab=${j.currentLab} version=${m.o.version}`)}`);
    out.push(`  members by partition class: ${by((m) => m.o.cls)}`);
    out.push(`  members by version form: ${by((m) => m.o.form)}`);
    if (j.provenance) {
      out.push(`  PROVENANCE (β's hypothesis "a hit is a codemod falsification", MEASURED per member): ${by((m) => m.prov.kind)}`);
      out.push(`    by introducing commit: ${by((m) => `${m.prov.kind}@${(m.prov.commit || "none").slice(0, 8)}`)}`);
    } else out.push(`  PROVENANCE: not computed (--no-provenance)`);
  }
  out.push(`  members (file:line:col  kind  form  class  current lab/version -> legacy lab/version [legacy tags matched]  provenance):`);
  for (const m of j.members) {
    const pv = m.prov ? `${m.prov.kind}${m.prov.commit ? ` ${m.prov.commit.slice(0, 8)} ${m.prov.date || ""} "${escapeAt(m.prov.summary || "").slice(0, 90)}"` : ""}${m.prov.kind === "unresolved" ? ` (${escapeAt(m.prov.reason)})` : ""}` : "-";
    out.push(
      `    ${m.o.file}:${m.o.line}:${m.o.col0 + 1}  ${m.kind}  ${m.o.form}  ${m.o.cls}  lab=${j.currentLab} version=${m.o.version} -> lab=${j.legacyLab} version=${m.o.version}  [${m.matched.length === j.legacyVersions.length ? `all ${m.matched.length}` : m.matched.join(" ")}]  ${pv}`
    );
  }
  if (j.provenance && j.unjoinable.length) {
    const b = {};
    for (const u of j.unjoinable) L.bump(b, `${u.o.form}:${u.prov.kind}`);
    out.push(`  NOT JOINABLE BY FORM — provenance, DESCRIPTIVE ONLY (not join members; the same trace, keyed on the exact version string): ${L.sortedEntries(b).map(([k, v]) => `${k}=${v}`).join("; ")}`);
    for (const u of j.unjoinable) {
      const pv = `${u.prov.kind}${u.prov.commit ? ` ${u.prov.commit.slice(0, 8)} ${u.prov.date || ""}` : ""}${u.prov.kind === "unresolved" ? ` (${escapeAt(u.prov.reason)})` : ""}`;
      out.push(`    ${u.o.file}:${u.o.line}:${u.o.col0 + 1}  ${u.o.form}  ${u.o.cls}  lab=${j.currentLab} version=${escapeAt(u.o.version)}  ${pv}`);
    }
  }
  out.push(`  VERDICT: CROSS-LAB MEMBERS=${j.members.length} of ${j.currentCands.length} current-lab candidate(s) over N=${r.pop.terms.scanned} scanned files (population reconciliation above), ${r.occurrences.length} G token(s)`);
  return { lines: out, code: j.members.length === 0 ? 0 : 1 };
}

function membersDoc(j) {
  return {
    $question:
      "Which oracle (i) candidates of the CURRENT lab name a version that exists as a LEGACY-lab tag (the Amendment 2 cross-lab tag-reality join), and — per member — did the codemod rewrite a legacy token into this one, or was the current-lab token written? Lab and version are stored APART; excerpts render the at-sign as \\x40.",
    measuredHead: j.r.head.sha,
    currentLab: j.currentLab,
    legacyLab: j.legacyLab,
    legacyTagVersions: [...j.legacyVersions].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    filesScanned: j.r.pop.terms.scanned,
    tokensMatchingG: j.r.occurrences.length,
    candidates: j.r.candidates.length,
    currentLabCandidates: j.currentCands.length,
    outsideJoin: { noLegacyTag: j.noHit, notJoinableByForm: j.notJoinable },
    members: j.members.length,
    provenanceComputed: j.provenance,
    rows: j.members.map((m) => ({
      file: m.o.file,
      line: m.o.line,
      col: m.o.col0 + 1,
      joinKind: m.kind,
      form: m.o.form,
      partitionClass: m.o.cls,
      oldToken: { lab: j.currentLab, version: m.o.version },
      tagRealityRestoreTo: { lab: j.legacyLab, version: m.o.version },
      legacyTagsMatched: m.matched,
      provenance: m.prov || null,
      lineExcerpt: excerpt(m.o.lineText, m.o.col0),
    })),
    unjoinableRowsDescriptiveOnly: (j.unjoinable || []).map((u) => ({
      file: u.o.file,
      line: u.o.line,
      col: u.o.col0 + 1,
      form: u.o.form,
      partitionClass: u.o.cls,
      token: { lab: j.currentLab, version: escapeAt(u.o.version) },
      provenance: u.prov || null,
      lineExcerpt: excerpt(u.o.lineText, u.o.col0),
    })),
  };
}

if (require.main === module) {
  L.runCli(NAME, (args, lines) => {
    const j = measureJoin({ provenance: !args.includes("--no-provenance") });
    const f = format(j);
    const text = f.lines.join("\n");
    assertNoSightings(j.r.grammar, text, "the printout");
    lines.push(...f.lines);
    const mi = args.indexOf("--members");
    if (mi >= 0) {
      const file = path.resolve(args[mi + 1]);
      const body = JSON.stringify(membersDoc(j), null, 1);
      assertNoSightings(j.r.grammar, body, "the members file");
      L.writeOut(file, [body]);
      lines.push(`  members file (lab/version stored apart, excerpts at-sign-escaped, sighting-checked before write): ${L.toPosix(path.relative(L.REPO_ROOT, file))}`);
    }
    return { code: f.code };
  });
}

module.exports = { measureJoin, format, membersDoc, tallyLine, traceOccurrence, expandAgainst, globMatcher, escapeAt, assertNoSightings };
