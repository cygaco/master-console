#!/usr/bin/env node
"use strict";

/**
 * ORACLE (i) — nonexistent-tag claims, INVERTED PREDICATE. S-OS-06 r4 STAGE 1: a measurement instrument.
 *
 * β refused the enumerated form (a violation predicate that is itself a list of existence-asserting phrasings). So:
 *   1. NO context test. Every token matching grammar G whose version is not an existing tag of its lab is a CANDIDATE,
 *      and every candidate is a VIOLATION unless a per-occurrence warrant covers it. Unclassified = violation.
 *   2. G is wide: lab prefix matched case-insensitively; version admits full semver (+ pre-release/build suffix),
 *      v-prefixed, partial (1 or 2 numeric parts), glob (`*`, `x`), placeholder (`<semver>`, `X.Y.Z`) and template
 *      interpolation forms, plus a CATCH-ALL (unparsed) alternative so every `lab@` sighting is a G token; sightings are
 *      counted independently and must equal the token count or the oracle REFUSES (G cannot silently miss a sighting).
 *   3. Warrants are PER-OCCURRENCE: keyed (file, token, anchor) and each must bind EXACTLY ONE candidate occurrence —
 *      a glob/directory `file`, a warrant matching zero occurrences (stale), more than one (ambiguous), or an
 *      occurrence claimed twice all REFUSE. Stage 1 writes none; `--warrants <file>` reads a register when one exists.
 *   4. R5 fail-closed: if the local legacy-lab tag list is empty, a remote listing (`git ls-remote --tags`) is the
 *      second method; if that is empty/unavailable too the oracle REFUSES (a tag-less worktree cannot certify).
 *
 * Output frame (binding): the count of G tokens, G itself, N files scanned, M registered non-assertion warrants — the
 * oracle never prints a bare zero. Tokens are printed as `lab=… version=…` (never re-joined) so a committed printout
 * does not add G tokens to the next measurement.
 *
 * Usage: node runtime/S-OS-06/r4/oracles/oracle-i-tag-claims.js [--out <file>] [--detail <json>] [--warrants <json>] [--keep-regen]
 */

const fs = require("fs");
const path = require("path");
const L = require("./lib");
const { regenerateViews, formatRegen } = require("./regen-views");

const NAME = "oracle-i";
const PLACEHOLDER_WARRANT = /^(todo|tbd|fixme|n\/a|na|none|null|undefined|-+|\.+|\?+|x+)$/i;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── tag sources ─────────────────────────────────────────────────────────────

function parseTagList(names) {
  const byLab = {};
  const nonLab = [];
  for (const n of names) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*)@(.+)$/.exec(n);
    if (!m) {
      nonLab.push(n);
      continue;
    }
    const lab = m[1].toLowerCase();
    (byLab[lab] = byLab[lab] || []).push(m[2]);
  }
  return { byLab, nonLab };
}

function readTags(root, { remoteFn } = {}) {
  const legacyLab = L.SLUG;
  const local = L.git(root, ["tag", "-l"]);
  if (local.status !== 0) throw new L.OracleRefusal(`git tag -l failed: ${(local.stderr || "").trim()}`);
  const localNames = local.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const localParsed = parseTagList(localNames);
  const localLegacy = (localParsed.byLab[legacyLab] || []).length;
  const attempts = [`local git tag -l: ${localNames.length} tag(s), legacy-lab tags=${localLegacy}`];
  if (localLegacy > 0) return { method: "local", names: localNames, parsed: localParsed, attempts, legacyLab };

  // second method: remote listing
  const remotesRes = L.git(root, ["remote"]);
  const remotes = remotesRes.status === 0 ? remotesRes.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : [];
  remotes.sort((a, b) => (a === "origin" ? -1 : b === "origin" ? 1 : a < b ? -1 : 1));
  for (const remote of remotes) {
    const r = remoteFn ? remoteFn(remote) : L.git(root, ["ls-remote", "--tags", remote], { timeout: 30000 });
    if (r.status !== 0) {
      attempts.push(`git ls-remote --tags ${remote}: FAILED (${String(r.stderr || (r.error && r.error.message) || "").trim().slice(0, 120)})`);
      continue;
    }
    const names = [...new Set(r.stdout.split(/\r?\n/).map((l) => (/refs\/tags\/(\S+?)(?:\^\{\})?$/.exec(l.trim()) || [])[1]).filter(Boolean))];
    const parsed = parseTagList(names);
    const legacy = (parsed.byLab[legacyLab] || []).length;
    attempts.push(`git ls-remote --tags ${remote}: ${names.length} tag(s), legacy-lab tags=${legacy}`);
    if (legacy > 0) return { method: `remote:${remote}`, names, parsed, attempts, legacyLab };
  }
  throw new L.OracleRefusal(
    `R5 fail-closed: the legacy-lab release tags are absent locally AND by remote listing [${attempts.join("; ")}] — a tag-less worktree cannot certify tag claims`
  );
}

// ── grammar G ──────────────────────────────────────────────────────────────

function buildGrammar(labs) {
  const LAB = labs.map(escapeRe).join("|");
  const ID = "[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*";
  const NUMERIC = `v?\\d+(?:\\.(?:\\d+|[xX*]))*\\*?(?:-${ID})?(?:\\+${ID})?`;
  const END = "(?![A-Za-z0-9_*]|[.-][A-Za-z0-9_*])";
  const STRUCTURED = [
    `${NUMERIC}${END}`, // full / partial / glob-suffixed / v-prefixed / pre-release / build
    `\\*`, // bare glob
    `[xX](?:\\.[xXyYzZ*]){0,2}${END}`, // letter wildcard / placeholder (x, X.Y.Z, x.x)
    `<[A-Za-z][^>\\s]{0,30}>`, // angle placeholder (<semver>, <version>, <v<2.0.0>)
    `\\$\\{[^}\\s]{1,40}\\}`, // ${version}
    `\\$[A-Za-z_][A-Za-z0-9_]*`, // $VERSION
    `\\{\\{?\\s*[A-Za-z_][\\w.]*\\s*\\}\\}?`, // {version} / {{version}}
  ];
  // CATCH-ALL (unparsed): when no structured form matches, the version is the run of non-delimiter characters after `@`
  // (possibly EMPTY). Every `lab@` sighting is therefore a G token — nothing falls outside the grammar uncounted, and an
  // unparsed version is never an existing tag, so it is always a candidate (unclassified = violation).
  const CATCH_ALL = "[^\\s\"'`,;()\\[\\]{}<>|]*";
  const VERSION = [...STRUCTURED, CATCH_ALL].join("|");
  const source = `(?<![A-Za-z0-9_])(${LAB})@(${VERSION})`;
  return {
    source,
    tokenRe: () => new RegExp(source, "gi"),
    anchoredRe: new RegExp(`^(${LAB})@(${VERSION})$`, "i"),
    structuredVersionRe: new RegExp(`^(?:${STRUCTURED.join("|")})$`, "i"),
    sightingRe: () => new RegExp(`(?<![A-Za-z0-9_])(${LAB})@`, "gi"),
  };
}

/** G's source with its single literal at-sign rendered as the regex escape \x40 — the SAME regex, but not a G token itself. */
function displaySource(grammar) {
  const shown = grammar.source.replace(")@(", ")\\x40(");
  if (shown === grammar.source || /\)@\(/.test(shown)) throw new L.OracleRefusal("grammar display: could not render G without a literal lab-at sequence");
  // equivalence probe: the displayed regex and G must agree on sample tokens built from G's own first lab
  const labAlt = /^\(\?<!\[A-Za-z0-9_\]\)\(([^)]*)\)@\(/.exec(grammar.source);
  if (!labAlt) throw new L.OracleRefusal("grammar display: cannot read G's lab alternation for the equivalence probe");
  const lab = labAlt[1].split("|")[0].replace(/\\/g, "");
  const probe = ["1.2.3.", "<semver>", "0.14*", "", "1.2.3rc1", "${v}"].map((v) => `x ${lab}@${v} y`);
  const a = new RegExp(grammar.source, "gi");
  const b = new RegExp(shown, "gi");
  for (const p of probe) if (JSON.stringify(p.match(a)) !== JSON.stringify(p.match(b))) throw new L.OracleRefusal("grammar display is not equivalent to G");
  return shown;
}

function versionForm(v, grammar) {
  if (grammar && !grammar.structuredVersionRe.test(v)) return v === "" ? "unparsed(empty)" : "unparsed";
  if (/^v/i.test(v) && /^v\d/i.test(v)) return "v-prefixed";
  if (/^\d/.test(v)) {
    if (/[*xX]/.test(v.replace(/[-+].*$/, ""))) return "glob";
    const core = v.replace(/[-+].*$/, "");
    const parts = core.split(".").length;
    if (parts === 3) return /[-+]/.test(v) ? "full-semver+suffix" : "full-semver";
    return parts < 3 ? "partial" : "over-long";
  }
  if (v === "*" || /^[xX]$/.test(v)) return "glob";
  if (/^[xX]\./.test(v)) return "placeholder";
  if (v.startsWith("<")) return "placeholder";
  return "interpolation";
}

function globToRe(v) {
  return new RegExp("^" + v.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/[*]/g, ".*").replace(/(^|\.)[xX](?=\.|$)/g, "$1\\d+") + "(?:$|[.-])");
}

/** Descriptive only (NOT an exemption): does the token's version resolve to at least one existing tag of its lab? */
function coreResolves(form, version, labVersions) {
  const set = new Set(labVersions);
  switch (form) {
    case "full-semver+suffix":
      return set.has(version.replace(/[-+].*$/, ""));
    case "v-prefixed":
      return set.has(version.slice(1));
    case "partial":
      return labVersions.some((t) => t === version || t.startsWith(version + "."));
    case "glob": {
      const re = globToRe(version === "*" ? "*" : version);
      return labVersions.some((t) => re.test(t));
    }
    default:
      return null;
  }
}

// ── per-occurrence warrants ────────────────────────────────────────────────

function loadWarrants(file, { trackedSet, grammar }) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    throw new L.OracleRefusal(`--warrants ${file} unreadable (${e.code || e.message}) — a named register that cannot be read is not an empty register`);
  }
  let j;
  try {
    j = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (e) {
    throw new L.OracleRefusal(`--warrants ${file} is not valid JSON: ${e.message}`);
  }
  if (!j || typeof j.$question !== "string" || !Array.isArray(j.warrants)) {
    throw new L.OracleRefusal(`--warrants ${file} must be an object with a $question string and a warrants[] array`);
  }
  const problems = [];
  j.warrants.forEach((w, i) => {
    const at = `warrants[${i}]`;
    if (!w || typeof w !== "object") return problems.push(`${at}: not an object`);
    if (typeof w.file !== "string" || !w.file) problems.push(`${at}: file must be a non-empty exact path`);
    else {
      if (/[*?[\]{}]/.test(w.file)) problems.push(`${at}: file '${w.file}' is a glob — a warrant binds ONE occurrence, never a file set`);
      if (w.file.endsWith("/") || !trackedSet.has(w.file)) problems.push(`${at}: file '${w.file}' is not a tracked FILE (a directory or untracked path cannot key an occurrence)`);
    }
    if (typeof w.token !== "string" || !grammar.anchoredRe.test(w.token)) problems.push(`${at}: token must be exactly one grammar-G token`);
    if (typeof w.anchor !== "string" || !w.anchor || (typeof w.token === "string" && !w.anchor.includes(w.token))) {
      problems.push(`${at}: anchor must be a non-empty line substring that contains the token`);
    }
    if (Object.prototype.hasOwnProperty.call(w, "line")) problems.push(`${at}: carries a bare line number — keyed on (file, token, anchor) only`);
    if (typeof w.warrant !== "string" || !w.warrant.trim() || /[\r\n]/.test(w.warrant) || PLACEHOLDER_WARRANT.test(w.warrant.trim())) {
      problems.push(`${at}: warrant must be ONE non-placeholder line`);
    }
  });
  if (problems.length) throw new L.OracleRefusal(`--warrants ${file} invalid: ${problems.slice(0, 10).join(" | ")}`);
  return { path: file, warrants: j.warrants };
}

function warrantCovers(w, occ) {
  if (w.file !== occ.file || w.token !== occ.token) return false;
  let from = 0;
  let i;
  while ((i = occ.lineText.indexOf(w.anchor, from)) !== -1) {
    let j = w.anchor.indexOf(w.token);
    while (j !== -1) {
      if (i + j === occ.col0) return true;
      j = w.anchor.indexOf(w.token, j + 1);
    }
    from = i + 1;
  }
  return false;
}

/** Bind each warrant to EXACTLY one occurrence of the whole G-token population. -> Map(occIndex -> warrant). REFUSES otherwise. */
function bindWarrants(register, occurrences) {
  const bound = new Map();
  const problems = [];
  register.warrants.forEach((w, wi) => {
    const hits = [];
    occurrences.forEach((o, oi) => {
      if (warrantCovers(w, o)) hits.push(oi);
    });
    if (hits.length === 0) problems.push(`warrants[${wi}] (${w.file}) binds NO occurrence — stale`);
    else if (hits.length > 1) problems.push(`warrants[${wi}] (${w.file}) binds ${hits.length} occurrences — ambiguous; a warrant keys ONE occurrence`);
    else if (!occurrences[hits[0]].candidate) problems.push(`warrants[${wi}] (${w.file}) binds an occurrence whose tag EXISTS — it warrants nothing (stale)`);
    else if (bound.has(hits[0])) problems.push(`warrants[${wi}] (${w.file}) binds an occurrence already bound by another warrant — no occurrence holds two`);
    else bound.set(hits[0], w);
  });
  if (problems.length) throw new L.OracleRefusal(`warrant register ${register.path}: ${problems.slice(0, 10).join(" | ")}`);
  return bound;
}

// ── measurement ────────────────────────────────────────────────────────────

function measure({ root = L.REPO_ROOT, warrantsPath = null, keepRegen = false, remoteFn, regenFn = regenerateViews } = {}) {
  const head = L.measuredHead(root);
  const loader = L.loadLoader(root);
  const codemod = L.loadCodemod(root);
  const partition = loader.loadPartition({ forceReload: true });
  const tracked = L.listTracked(root);
  const trackedSet = new Set(tracked);

  const tags = readTags(root, { remoteFn });
  let pkgName = null;
  try {
    pkgName = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8").replace(/^\uFEFF/, "")).name;
  } catch {
    pkgName = null;
  }
  const labSources = {};
  for (const lab of Object.keys(tags.parsed.byLab)) labSources[lab] = "tag namespace";
  if (typeof pkgName === "string" && /^[a-z][a-z0-9-]*$/i.test(pkgName)) {
    const k = pkgName.toLowerCase();
    labSources[k] = labSources[k] ? `${labSources[k]} + package.json#name` : "package.json#name (the tree's own release-tag lab)";
  }
  if (!labSources[tags.legacyLab]) labSources[tags.legacyLab] = "R5 legacy lab (no tags)";
  const labs = Object.keys(labSources).sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  const grammar = buildGrammar(labs);

  const treeVersion = loader.readTreeVersion(root);
  if (!treeVersion.version) throw new L.OracleRefusal(`tree version unreadable: ${treeVersion.reason}`);
  const regen = regenFn({ root, sha: head.sha, partition, trackedFiles: tracked, version: treeVersion.version, keep: keepRegen });

  const pop = L.newPopulation("oracle (i) — every tracked file");
  pop.rules.scanned = "text file read and scanned for grammar-G tokens — ALL classes (a tag claim is a claim wherever it sits); generated views read from REGENERATED bytes";
  pop.rules.binary = L.RULE_TEXT.binary;
  pop.rules.unreadable = L.RULE_TEXT.unreadable;
  pop.rules.oversized = L.RULE_TEXT.oversized;
  pop.rules.generated = "NONE excluded by (i): generated views are scanned against regenerated bytes — counted under scanned{generated-view(regenerated)}";
  pop.rules["write-protected"] = "NONE excluded by (i): write protection governs rewriting, not whether a sentence claims a tag — counted under scanned{write-protected:*}";

  const occurrences = [];
  let sightings = 0;
  const outsideSamples = {};
  let outside = 0;
  const unclassified = [];

  for (const rel of tracked) {
    pop.eligible += 1;
    const cls = L.classify(partition, loader, rel);
    if (!cls) unclassified.push(rel);
    const isView = partition.isGeneratedView(rel);
    const override = isView ? regen.views.get(rel) : undefined;
    if (isView && override === undefined) throw new L.OracleRefusal(`generated view ${rel} has no regenerated bytes — refusing to scan stale bytes`);
    const r = L.readForScan(path.join(root, rel), codemod, override);
    if (r.status !== "text") {
      L.popAdd(pop, r.status, cls ? `class-${cls.class}:${cls.kind}` : "unclassified");
      if (r.status === "unreadable") pop.unreadableFiles.push(rel);
      if (r.status === "oversized") pop.oversizedFiles.push(rel);
      continue;
    }
    L.popAdd(
      pop,
      "scanned",
      isView ? "generated-view(regenerated)" : !cls ? "unclassified" : cls.class !== 1 || cls.writeProtected ? `write-protected:class-${cls.class}` : "class-1-live"
    );
    const content = r.content;
    if (!content.includes("@")) continue;
    const lines = content.split(/\r?\n/);
    lines.forEach((lineText, idx) => {
      if (!lineText.includes("@")) return;
      const tokenStarts = new Set();
      const tre = grammar.tokenRe();
      let m;
      while ((m = tre.exec(lineText)) !== null) {
        tokenStarts.add(m.index);
        const lab = m[1].toLowerCase();
        const version = m[2];
        const labVersions = tags.parsed.byLab[lab] || [];
        const exists = labVersions.includes(version);
        const form = versionForm(version, grammar);
        const major = /^v?(\d+)/i.exec(version);
        occurrences.push({
          file: rel,
          line: idx + 1,
          col0: m.index,
          token: m[0],
          lab,
          labCaseCanonical: m[1] === lab,
          version,
          form,
          exists,
          candidate: !exists,
          coreResolves: exists ? true : coreResolves(form, version, labVersions),
          majorRange: major ? (Number(major[1]) < 2 ? "<2" : ">=2") : "n/a",
          cls: cls ? `class-${cls.class}${cls.class === 1 && !cls.writeProtected && !isView ? "-live" : ""}` : "unclassified",
          lineText,
        });
      }
      const sre = grammar.sightingRe();
      while ((m = sre.exec(lineText)) !== null) {
        sightings += 1;
        if (!tokenStarts.has(m.index)) {
          outside += 1;
          const after = lineText.slice(m.index + m[0].length, m.index + m[0].length + 14).replace(/\s.*$/, "");
          const key = `lab=${m[1].toLowerCase()} next=${JSON.stringify(after)}`;
          L.bump(outsideSamples, key);
        }
      }
    });
  }
  if (unclassified.length) throw new L.OracleRefusal(`${unclassified.length} tracked path(s) are UNCLASSIFIED (first: ${unclassified.slice(0, 5).join(", ")})`);
  L.assertPopulation(pop);
  if (outside !== 0 || sightings !== occurrences.length) {
    throw new L.OracleRefusal(
      `grammar coverage defect: ${sightings} lab@ sighting(s) but ${occurrences.length} G token(s), ${outside} outside G (${JSON.stringify(outsideSamples).slice(0, 300)}) — the catch-all must make every sighting a token`
    );
  }
  occurrences.forEach((o, i) => {
    o.index = i;
  });

  const register = warrantsPath ? loadWarrants(warrantsPath, { trackedSet, grammar }) : null;
  const bound = register ? bindWarrants(register, occurrences) : new Map();

  const candidates = occurrences.filter((o) => o.candidate);
  const violations = candidates.filter((o) => !bound.has(o.index));
  return { head, tags, labs, labSources, grammar, regen, pop, occurrences, candidates, violations, bound, register, sightings, outside, outsideSamples, warrantsPath };
}

function format(r) {
  const out = [];
  const T = r.occurrences.length;
  const C = r.candidates.length;
  const M = r.bound.size;
  const V = r.violations.length;
  out.push(`ORACLE (i) — nonexistent-tag claims, INVERTED PREDICATE: no context test; every grammar-G token whose version is not an existing tag of its lab is a candidate, and every unwarranted candidate is a VIOLATION (S-OS-06 r4 STAGE 1, measurement only)`);
  out.push(`  measured head: ${r.head.sha} (${r.head.branch}); tracked tree clean`);
  out.push(`  TAG SOURCE: method=${r.tags.method}; ${r.tags.attempts.join("; ")}`);
  for (const [lab, versions] of Object.entries(r.tags.parsed.byLab)) {
    out.push(`    lab ${lab}: ${versions.length} tag(s), versions: ${[...versions].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(" ")}`);
  }
  out.push(`    tags outside the lab@version form (not joinable by G): ${r.tags.parsed.nonLab.length ? r.tags.parsed.nonLab.join(", ") : "(none)"}`);
  out.push(`  R5 fail-closed: legacy-lab tags present by method ${r.tags.method} -> certify-capable (an empty list on both methods REFUSES)`);
  out.push(`  LABS L (case-insensitive): ${r.labs.map((l) => `${l} [${r.labSources[l]}]`).join("; ")}`);
  out.push(`  GRAMMAR G (flags gi; printed with the at-sign as the equivalent regex escape \\x40 so this printout adds no G token to a later run): ${displaySource(r.grammar)}`);
  out.push(`    version forms admitted: full semver, +pre-release/+build suffix, v-prefixed, partial (1-2 numeric parts), glob (* / x), placeholder (<…>, X.Y.Z), interpolation (\${…}, $VAR, {…}), UNPARSED catch-all (the non-delimiter run after @, possibly empty — never a tag, always a candidate)`);
  out.push(`    join: candidate iff the EXACT version string is not a tag of that lab (lab compared lower-case); no context test of any kind`);
  out.push(...formatRegen(r.regen));
  out.push(...L.formatPopulation(r.pop));
  out.push(`  N FILES SCANNED: ${r.pop.terms.scanned} (of eligible ${r.pop.eligible})`);
  out.push(
    `  LAB@ SIGHTINGS (independent count of (?<![A-Za-z0-9_])(L)@): ${r.sightings} == G tokens ${r.occurrences.length} + outside G ${r.outside}  [coverage holds=${r.outside === 0 && r.sightings === r.occurrences.length}]`
  );
  out.push(`  TOKENS MATCHING G: ${T}`);
  out.push(`    version is an existing tag of its lab (not candidates): ${T - C}`);
  out.push(`    CANDIDATES (version absent from the tag list): ${C}`);
  out.push(`  M REGISTERED NON-ASSERTION WARRANTS: ${M} ${r.register ? `(register ${r.register.path}: ${r.register.warrants.length} entr${r.register.warrants.length === 1 ? "y" : "ies"}, each bound to exactly one occurrence)` : "(no register supplied — stage 1 writes none)"}`);
  out.push(`  VIOLATIONS = candidates ${C} − warranted ${M} = ${V}`);
  const breakdown = (label, keyFn, list) => {
    const b = {};
    for (const o of list) L.bump(b, keyFn(o));
    out.push(`    by ${label}: ${L.sortedEntries(b).map(([k, v]) => `${k}=${v}`).join("; ")}`);
  };
  out.push(`  DESCRIPTIVE BREAKDOWN OF VIOLATIONS (NOT exemptions — every row below is counted in VIOLATIONS):`);
  if (V) {
    breakdown("lab", (o) => o.lab, r.violations);
    breakdown("lab case", (o) => (o.labCaseCanonical ? "lower-case" : "non-lower-case"), r.violations);
    breakdown("version form", (o) => o.form, r.violations);
    breakdown("major range", (o) => o.majorRange, r.violations);
    breakdown("lab x range", (o) => `${o.lab}:${o.majorRange}`, r.violations);
    breakdown("resolves to >=1 existing tag of its lab (suffix/v/partial/glob core)", (o) => String(o.coreResolves), r.violations);
    breakdown("partition class of file", (o) => o.cls, r.violations);
    const byFile = {};
    for (const o of r.violations) L.bump(byFile, o.file);
    const files = L.sortedEntries(byFile);
    out.push(`    distinct files carrying violations: ${files.length}`);
    for (const [k, v] of files.slice(0, 40)) out.push(`      ${String(v).padStart(6)}  ${k}`);
    const byVer = {};
    for (const o of r.violations) L.bump(byVer, `lab=${o.lab} version=${o.version}`);
    out.push(`    top (lab, version) pairs:`);
    for (const [k, v] of L.sortedEntries(byVer).slice(0, 40)) out.push(`      ${String(v).padStart(6)}  ${k}`);
  } else {
    out.push(`    (no violations under G over the N scanned files with M warrants)`);
  }
  out.push(
    `  VERDICT: VIOLATIONS=${V} — frame: ${T} token(s) matching grammar G (above) over N=${r.pop.terms.scanned} scanned files, ${C} candidate(s), M=${M} registered non-assertion warrant(s)`
  );
  return { lines: out, code: V === 0 ? 0 : 1 };
}

function writeDetail(r, file) {
  const rows = r.candidates.map((o) => ({
    file: o.file,
    line: o.line,
    col: o.col0 + 1,
    lab: o.lab,
    labCaseCanonical: o.labCaseCanonical,
    version: o.version,
    form: o.form,
    majorRange: o.majorRange,
    coreResolves: o.coreResolves,
    partitionClass: o.cls,
    warranted: r.bound.has(o.index),
  }));
  L.writeOut(file, [
    JSON.stringify(
      {
        $question: "Which grammar-G tokens (oracle (i), inverted predicate) name a version that is not an existing tag of their lab? Tokens are stored as separate lab + version fields, never re-joined.",
        measuredHead: r.head.sha,
        grammar: displaySource(r.grammar),
        filesScanned: r.pop.terms.scanned,
        tokensMatchingG: r.occurrences.length,
        candidates: r.candidates.length,
        warranted: r.bound.size,
        violations: r.violations.length,
        rows,
      },
      null,
      1
    ),
  ]);
}

if (require.main === module) {
  L.runCli(NAME, (args, lines) => {
    const wi = args.indexOf("--warrants");
    const di = args.indexOf("--detail");
    const r = measure({ warrantsPath: wi >= 0 ? path.resolve(args[wi + 1]) : null, keepRegen: args.includes("--keep-regen") });
    const f = format(r);
    lines.push(...f.lines);
    if (di >= 0) {
      writeDetail(r, path.resolve(args[di + 1]));
      lines.push(`  detail (every candidate, lab/version stored apart): ${L.toPosix(path.relative(L.REPO_ROOT, path.resolve(args[di + 1])))}`);
    }
    return { code: f.code };
  });
}

module.exports = { measure, format, buildGrammar, parseTagList, readTags, versionForm, bindWarrants, warrantCovers, loadWarrants };
