#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * scripts/checks/doc-ref-integrity.js — S-13b doc-reference-integrity enforcer.
 *
 * The opposite failure from duplicate-doc-drift: a high-read CANON doc cites a
 * repo-internal relative path (a clickable `[text](path)` link, or a backtick
 * `scripts/foo.js`-shaped prose ref) that points at NOTHING — the file moved or
 * was renamed and the citing prose drifted silently. Invisible until a human
 * clicks the dead link. This is the [[rename-cutover-covers-both-layers]] bug
 * class one layer up: the IMPERATIVE layer (scripts/paths/hooks) gets repointed
 * in a rename, but the PROSE layer that merely *names* the old path rots.
 *
 * Concrete trigger (S-13, 2026-06-08): after the ADR-0007 dept-tree cutover + the
 * S-7 role renames + the `.system`→`_system` de-dots, CLAUDE.md still pointed at
 * `scripts/checks/dispatch-contract.js` (moved to `scripts/dispatch/`) and AGENTS.md
 * still cited `.system.md` (→ `_system/agent-system.md`). Each rename wave "swept
 * the refs"; the recurrence IS the evidence a manual sweep doesn't hold — so the
 * structural answer is a named, self-detecting enforcer (every policy needs one).
 *
 * SCOPE (the high-read canon surface, not the whole repo — bounded to keep noise
 * low for the report-only ramp): root-level top-level `.md`, plus the `.md` under
 * the `.claude/agents`, `.claude/commands`, and `trackers` trees (recursive).
 * Frozen/per-run surfaces are excluded (runtime/, releases/, node_modules, .git,
 * worktrees) — their refs are either ephemeral or immutable-by-version.
 *
 * WHAT COUNTS AS A REF (deliberately narrow, to minimize false positives):
 *   1. Markdown links `[text](target)` whose target is a RELATIVE repo path
 *      (not http(s)://, #anchor, mailto:, tel:, or absolute `/…`); `#frag`/`?query`
 *      stripped before resolution.
 *   2. Backtick prose refs `` `…` `` containing a path ANCHORED to a known repo
 *      top-level dir (scripts/ .claude/ trackers/ framework/ _mc/ runtime/)
 *      AND ending in a file extension — e.g. `scripts/checks/dispatch-contract.js`
 *      even inside `` `scripts/checks/dispatch-contract.js validate` ``. A
 *      placeholder like `scripts/<name>.js` never matches (the `<` breaks the
 *      path-shape), so templates don't false-fire.
 *
 * A ref is RESOLVABLE if it exists (file OR dir) relative to the repo ROOT or
 * relative to the citing file's own directory (markdown links are dir-relative;
 * prose refs are usually root-relative — accept either).
 *
 * ALLOWLIST (doc-ref-integrity.allowlist.json) for legitimately-absent refs:
 *   - `pathPrefixes` — target prefixes that are ephemeral/by-design (e.g. runtime/).
 *   - `literals`     — exact targets that are design placeholders / illustrative.
 *   Plus a per-line `<!-- doc-ref-ignore -->` escape hatch in the doc itself.
 *
 * The flag/allow DECISION is isolated in the pure `evaluate({ refs, allowlist })`
 * (refs pre-annotated with `exists`) so the bite-test fires the broken-ref class —
 * and proves resolvable + allowlisted refs do NOT flag — on synthetic input with
 * no disk. Disk I/O (file walk, ref extraction, existence checks) lives in `run()`.
 *
 * REPORT-ONLY by default (ramp): findings printed, exit 0. Pass `--enforce` (or
 * MC_DOC_REF_INTEGRITY_ENFORCE=block) to make a broken-ref finding exit 1.
 * FAIL-CLOSED: a runner error (unreadable allowlist, walk failure) exits 2 — a
 * runner error is NEVER a pass (false-green-gauntlet lesson).
 *
 *   node scripts/checks/doc-ref-integrity.js [--json] [--enforce]
 *
 * Zero runtime deps.
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "doc-ref-integrity";
const ALLOWLIST_FILE = path.join(__dirname, "doc-ref-integrity.allowlist.json");

const norm = (p) => p.replace(/\\/g, "/");

// ── Compat-registered legacy-rename tolerance (S-OS-06 T5-E2d, α ruling) ─────────
// A canon doc's historical citation of a PRE-RENAME path (the legacy slug in the path) is allowed as "renamed" IFF
// the codemod's mc-renamed counterpart (rename-mc.js#renamePath) EXISTS on disk — reported as a visible
// allowed-renamed COUNT, never silently. The tolerance is a REGISTERED compat surface of the S-OS-06 partition
// (compatWindows, surface below) carrying its OWN expiry: once the tree version reaches that expiry — or the surface
// is not registered, or the partition/codemod cannot be loaded — the tolerance is OFF and every such citation is a
// broken ref again (fail CLOSED). A legacy-slug citation whose counterpart is absent is ALWAYS a broken ref.
const LEGACY_RENAME_SURFACE = "doc-ref-legacy-rename";
// The ONE legacy literal in this checker — registered in the partition as compat occurrence DATA (surface above).
const LEGACY_PATH_SLUG = "warpos";
const LEGACY_PATH_SLUG_RE = new RegExp(LEGACY_PATH_SLUG, "i");

/**
 * Decide the tolerance from the partition's compat register. Pure given its inputs:
 *   partition : a loaded partition API (partition-loader#loadPartition / #buildPartition), or null when unloadable
 *   version   : the tree version the window's expiry is read against (null / unparseable => expired, fail closed)
 *   isExpired : partition-loader#isCompatExpired
 * Returns { active, surface, expires, reason }.
 */
function resolveLegacyRename({ partition, version, isExpired, loadError } = {}) {
  const off = (expires, reason) => ({ active: false, surface: LEGACY_RENAME_SURFACE, expires, reason: `${reason} — tolerance OFF (fail closed)` });
  if (!partition) return off(null, `partition unavailable (${loadError || "not loaded"})`);
  const w = (partition.compatWindows || []).find((x) => x && x.surface === LEGACY_RENAME_SURFACE);
  if (!w) return off(null, `compat surface '${LEGACY_RENAME_SURFACE}' is not registered`);
  if (typeof isExpired !== "function") return off(w.expires || null, "no expiry clock supplied");
  const shown = version === null || version === undefined ? "<unknown>" : version;
  if (isExpired(w.expires, version)) return off(w.expires || null, `compat surface '${LEGACY_RENAME_SURFACE}' expired (expires ${w.expires}, tree ${shown})`);
  return { active: true, surface: LEGACY_RENAME_SURFACE, expires: w.expires, reason: `compat surface '${LEGACY_RENAME_SURFACE}' registered (expires ${w.expires}, tree ${shown})` };
}

/** The tolerance for the real tree. Any load failure => OFF with its reason (never an exception, never ON). */
function loadLegacyRename() {
  let loader;
  let renamePath;
  try {
    loader = require("../open-source/partition-loader");
    renamePath = require("../open-source/rename-mc").renamePath;
  } catch (e) {
    return { ...resolveLegacyRename({ partition: null, loadError: e.message }), renamePath: null };
  }
  if (typeof renamePath !== "function") {
    return { ...resolveLegacyRename({ partition: null, loadError: "the codemod exports no renamePath" }), renamePath: null };
  }
  let partition;
  try {
    partition = loader.loadPartition();
  } catch (e) {
    return { ...resolveLegacyRename({ partition: null, loadError: e.message }), renamePath };
  }
  const version = loader.readTreeVersion().version;
  return { ...resolveLegacyRename({ partition, version, isExpired: loader.isCompatExpired }), renamePath };
}

/**
 * Annotate a NON-resolving ref that carries the legacy slug with its mc-renamed counterpart and whether that
 * counterpart exists (existsFn(file, target) — refExists in run(), injectable for a synthetic test). A ref whose
 * path the codemod would not rename is left un-annotated: an ordinary broken ref.
 */
function annotateLegacyRename(r, renamePath, existsFn) {
  if (!r || r.exists || !r.target || typeof renamePath !== "function") return r;
  const target = norm(r.target);
  if (!LEGACY_PATH_SLUG_RE.test(target)) return r;
  const counterpart = renamePath(target);
  if (!counterpart || counterpart === target) return r;
  r.legacyCounterpart = counterpart;
  r.legacyCounterpartExists = Boolean(existsFn(r.file, counterpart));
  return r;
}

// Known repo top-level dirs that anchor a backtick prose path-ref. A backtick span
// that doesn't START at one of these isn't a deliberate repo-file citation.
const REPO_ANCHORS = ["scripts", ".claude", "trackers", "framework", "_mc", "runtime"];
// Path-shape inside a backtick span, anchored to a repo dir + ending in an extension.
// The `(?<![\w./-])` lookbehind keeps the anchor word-boundaried so a SUBSTRING match
// doesn't fire — e.g. "tests/tran`scripts`/x.md" must NOT yield "scripts/x.md".
const BACKTICK_PATH_RE = new RegExp(
  "(?<![\\w./-])(?:" + REPO_ANCHORS.map((a) => a.replace(/[.]/g, "\\.")).join("|") + ")\\/[\\w./-]+\\.\\w+",
  "g",
);
// Markdown link: [text](target). Target captured; trailing title (" ...") tolerated.
const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
// Per-line escape hatch. Matches the bare form AND a `<!-- doc-ref-ignore: reason -->`
// form (a reason is encouraged) — keyed on the token, not the exact closing.
const IGNORE_MARK = "doc-ref-ignore";
const IGNORE_RE = /<!--\s*doc-ref-ignore/;

// Directories whose .md we never scan (ephemeral, frozen, vendored, or VCS).
const EXCLUDED_DIR_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "worktrees",
  "releases", // framework/releases + _mc/releases — frozen per-version capsules
]);
function isExcludedFile(rel) {
  const segs = norm(rel).split("/");
  if (segs.includes("runtime")) return true; // runtime/** is per-run scratch
  return segs.some((s) => EXCLUDED_DIR_SEGMENTS.has(s));
}

// A target we should NOT try to resolve as a repo path.
function isExternalOrAnchor(t) {
  return (
    !t ||
    /^[a-z][a-z0-9+.-]*:/i.test(t) || // scheme: http: https: mailto: tel: vscode: …
    t.startsWith("#") || // pure in-doc anchor
    t.startsWith("/") || // site-absolute, not a repo-relative ref
    t.includes("<") || // <placeholder> anywhere (../sprints/<sprint-file>.md)
    t.includes(">") ||
    t.includes("*") || // glob, not a concrete file
    t.includes("{") || // {brace,expansion}
    /\bfoo\.(js|md|ts|json)$/.test(t) || // conventional example placeholder (`scripts/foo.js`)
    t.startsWith("path/to/") // conventional example path
  );
}

// Strip a #fragment / ?query from a link target before resolution.
function stripFragment(t) {
  return t.replace(/[#?].*$/, "");
}

// ── Pure flag/allow core (no fs) ─────────────────────────────────────────────
/**
 * Decide which refs are BROKEN-and-unallowed (findings) vs resolvable or allowed.
 *
 *   refs : [{ file, line, target, exists }]   (file = repo-relative; exists =
 *          pre-computed on disk by run(); a synthetic test passes it directly)
 *   allowlist : { pathPrefixes: [...], literals: [...] }
 *   legacyRename : { active, surface, expires, reason } (resolveLegacyRename) — refs annotated by
 *          annotateLegacyRename carry legacyCounterpart/legacyCounterpartExists; absent => tolerance OFF
 *
 * Returns { findings, allowed, allowedRenamed }.
 */
function evaluate({ refs, allowlist, legacyRename }) {
  const findings = [];
  const allowed = [];
  let allowedRenamed = 0;
  const tolerance = legacyRename || { active: false, reason: "no legacy-rename tolerance supplied — tolerance OFF (fail closed)" };
  const prefixes = (allowlist && allowlist.pathPrefixes) || [];
  const literals = new Set((allowlist && allowlist.literals) || []);
  for (const r of refs || []) {
    if (!r || !r.target) continue;
    if (r.exists) continue; // resolves — nothing to report
    const target = norm(r.target);
    // A markdown link is DIR-RELATIVE (`../../_planning/x.md` cited from trackers/epics/).
    // Match allowlist prefixes against the raw target AND its repo-relative resolution
    // from the citing file, so a relative spelling of an allowlisted path (gitignored /
    // per-machine, dead-tree) cannot bypass the allowlist. Only `./`/`../` targets get
    // the second candidate — a root-anchored target already IS repo-relative.
    const candidates = [target];
    if (r.file && /^\.\.?\//.test(target)) {
      candidates.push(norm(path.posix.normalize(path.posix.join(path.posix.dirname(norm(r.file)), target))));
    }
    const allowedByPrefix = prefixes.find((p) => candidates.some((c) => c.startsWith(p)));
    // Literals match the same candidates as prefixes: a dir-relative spelling of an allowlisted literal is that literal.
    if (candidates.some((c) => literals.has(c))) {
      allowed.push({ ...r, allowedBy: "literal-allowlist" });
      continue;
    }
    if (allowedByPrefix) {
      allowed.push({ ...r, allowedBy: `prefix-allowlist (${allowedByPrefix})` });
      continue;
    }
    // Compat-registered legacy-rename tolerance: ONLY a counterpart that exists, ONLY while the window is unexpired.
    if (r.legacyCounterpart && r.legacyCounterpartExists && tolerance.active) {
      allowed.push({ ...r, renamed: true, allowedBy: `compat-renamed (${tolerance.surface}, expires ${tolerance.expires}) -> ${r.legacyCounterpart}` });
      allowedRenamed += 1;
      continue;
    }
    let legacyNote = "";
    if (r.legacyCounterpart && !r.legacyCounterpartExists) {
      legacyNote = ` It carries the legacy slug, but its mc-renamed counterpart '${r.legacyCounterpart}' does not exist either — a pre-rename citation is allowed-renamed ONLY when that counterpart is on disk.`;
    } else if (r.legacyCounterpart) {
      legacyNote = ` Its mc-renamed counterpart '${r.legacyCounterpart}' exists, but the legacy-rename tolerance is OFF: ${tolerance.reason}.`;
    }
    findings.push({
      severity: "high",
      check: NAME,
      kind: "broken-doc-ref",
      file: r.file,
      line: r.line,
      target: r.target,
      message: `${r.file}:${r.line} cites '${r.target}' which does not resolve on disk (relative to repo root or the doc's dir). The path likely moved/renamed and this prose drifted. Repoint it, or — if the ref is legitimately absent (ephemeral/design/illustrative) — add it to doc-ref-integrity.allowlist.json or mark the line with ${IGNORE_MARK}.${legacyNote}`,
    });
  }
  return { findings, allowed, allowedRenamed };
}

// ── Disk: file walk + ref extraction + existence ─────────────────────────────

/** Recursively collect .md files under a start dir (repo-relative), honoring excludes. */
function collectMd(absStart, relStart, out) {
  let entries;
  try {
    entries = fs.readdirSync(absStart, { withFileTypes: true });
  } catch {
    return; // unreadable dir — skip (not fatal; a missing scope root is fine)
  }
  for (const e of entries) {
    const rel = relStart ? `${relStart}/${e.name}` : e.name;
    if (isExcludedFile(rel)) continue;
    const abs = path.join(absStart, e.name);
    if (e.isDirectory()) {
      collectMd(abs, rel, out);
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      out.push(norm(rel));
    }
  }
}

/** The bounded canon scan surface. */
function scanFiles() {
  const out = [];
  // Root-level *.md only (not recursive — the recursive roots are listed below).
  let rootEntries = [];
  try {
    rootEntries = fs.readdirSync(ROOT, { withFileTypes: true });
  } catch {
    /* handled by caller as empty */
  }
  for (const e of rootEntries) {
    if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(e.name);
  }
  for (const dir of [".claude/agents", ".claude/commands", "trackers"]) {
    collectMd(path.join(ROOT, dir), dir, out);
  }
  return [...new Set(out)].sort();
}

/** Extract candidate refs from one doc's text. Returns [{ file, line, target }]. */
function extractRefs(relFile, text) {
  const refs = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((ln, i) => {
    if (IGNORE_RE.test(ln)) return; // per-line escape hatch (bare or `: reason` form)
    const lineNo = i + 1;
    const seen = new Set();
    const push = (target) => {
      const key = target;
      if (seen.has(key)) return;
      seen.add(key);
      refs.push({ file: relFile, line: lineNo, target });
    };
    // 1) markdown links
    let m;
    MD_LINK_RE.lastIndex = 0;
    while ((m = MD_LINK_RE.exec(ln))) {
      const raw = stripFragment(m[1].trim());
      if (isExternalOrAnchor(raw)) continue;
      push(raw);
    }
    // 2) backtick prose path-refs (anchored to a repo dir + extension)
    const bt = ln.match(/`[^`]+`/g) || [];
    for (const span of bt) {
      const inner = span.slice(1, -1);
      BACKTICK_PATH_RE.lastIndex = 0;
      let pm;
      while ((pm = BACKTICK_PATH_RE.exec(inner))) {
        if (isExternalOrAnchor(pm[0])) continue; // drop foo.*/path-to/<placeholder> examples
        push(pm[0]);
      }
    }
  });
  return refs;
}

/** Resolve a ref: exists (file OR dir) relative to ROOT or to the doc's own dir. */
function refExists(relFile, target) {
  const t = stripFragment(target);
  const candidates = [
    path.join(ROOT, t),
    path.join(ROOT, path.dirname(relFile), t),
  ];
  return candidates.some((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_FILE)) return { pathPrefixes: [], literals: [] };
  const raw = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, "utf8").replace(/^﻿/, ""));
  return {
    pathPrefixes: Array.isArray(raw.pathPrefixes) ? raw.pathPrefixes.map(norm) : [],
    literals: Array.isArray(raw.literals) ? raw.literals.map(norm) : [],
  };
}

function run() {
  const notes = [];
  let allowlist;
  try {
    allowlist = loadAllowlist();
  } catch (e) {
    return { ok: false, fatal: true, problems: [`allowlist unreadable: ${e.message}`], notes };
  }
  let files;
  try {
    files = scanFiles();
  } catch (e) {
    return { ok: false, fatal: true, problems: [`canon scan failed: ${e.message}`], notes };
  }
  const legacy = loadLegacyRename();
  const refs = [];
  for (const rel of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    } catch {
      continue; // a file vanished mid-scan — skip, not fatal
    }
    for (const r of extractRefs(rel, text)) {
      r.exists = refExists(r.file, r.target);
      annotateLegacyRename(r, legacy.renamePath, refExists);
      refs.push(r);
    }
  }

  const legacyRename = { active: legacy.active, surface: legacy.surface, expires: legacy.expires, reason: legacy.reason };
  const { findings, allowed, allowedRenamed } = evaluate({ refs, allowlist, legacyRename });

  notes.push(
    `${files.length} canon doc(s) · ${refs.length} repo-path ref(s) · ${findings.length} broken · ${allowed.length - allowedRenamed} allowed-absent · ${allowedRenamed} allowed-renamed`,
  );
  notes.push(`legacy-rename tolerance ${legacyRename.active ? "ON" : "OFF"}: ${legacyRename.reason}`);
  const problems = findings.map((f) => f.message);
  return { ok: findings.length === 0, fatal: false, problems, notes, findings, allowed, allowedRenamed, legacyRename };
}

function main() {
  const asJson = process.argv.includes("--json");
  const enforce =
    process.argv.includes("--enforce") || mcEnv.readEnv("DOC_REF_INTEGRITY_ENFORCE") === "block";
  let res;
  try {
    res = run();
  } catch (e) {
    const msg = String((e && e.message) || e);
    process.stdout.write(
      (asJson
        ? JSON.stringify({ ok: false, check: NAME, error: msg })
        : `ERROR  [${NAME}] runner error (fail-closed): ${msg}`) + "\n",
    );
    process.exit(2);
  }
  const mode = enforce ? "blocking" : "report-only";
  if (asJson) {
    process.stdout.write(JSON.stringify({ mode, ...res }, null, 2) + "\n");
    process.exit(res.fatal ? 2 : enforce && !res.ok ? 1 : 0);
  }
  if (res.fatal) {
    process.stderr.write(`ERROR  [${NAME}] ${res.problems.join(" · ")}\n`);
    process.exit(2);
  }
  if (res.ok) {
    process.stdout.write(`PASS [${NAME}] ${res.notes.join(" · ")}\n`);
    process.exit(0);
  }
  const label = enforce ? "FAIL" : "WARN";
  process.stderr.write(`${label} [${NAME}] (${mode}) ${res.findings.length} broken doc ref(s):\n`);
  for (const f of res.findings) process.stderr.write(`  - ${f.message}\n`);
  if (res.notes.length) process.stderr.write(`  (${res.notes.join(" · ")})\n`);
  process.exit(enforce ? 1 : 0);
}

if (require.main === module) main();

module.exports = {
  evaluate,
  extractRefs,
  refExists,
  scanFiles,
  loadAllowlist,
  isExternalOrAnchor,
  resolveLegacyRename,
  loadLegacyRename,
  annotateLegacyRename,
  run,
  ALLOWLIST_FILE,
  REPO_ANCHORS,
  LEGACY_RENAME_SURFACE,
};
