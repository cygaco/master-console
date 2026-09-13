#!/usr/bin/env node
"use strict";

/**
 * scripts/checks/memory-integrity.js — READ-ONLY structural integrity detector
 * for file-based memory stores.
 *
 * Two file-based memory stores share ONE shape:
 *   (A) user auto-memory:  ~/.claude/projects/<slug>/memory/  (per-machine, absolute)
 *   (B) in-repo agent memory: .claude/agent-memory/<agent>/   (version-controlled)
 * Each store dir contains:
 *   - MEMORY.md — an INDEX, one line per memory: `- [Title](filename.md) — one-line hook`
 *   - per-fact `*.md` files with YAML frontmatter:
 *         ---
 *         name: <kebab-slug>
 *         description: <one-line>
 *         metadata:
 *           type: user | feedback | project | reference
 *         ---
 *         <body — may contain [[wikilinks]] that reference OTHER memories' name: slug>
 *
 * TWO IDENTIFIER SPACES (critical, never conflated here):
 *   - MEMORY.md index links target a FILENAME  (`file.md`).
 *   - body `[[wikilinks]]` reference a memory's `name:` SLUG (NOT the filename — e.g.
 *     file `feedback_add_sprint_mint_then_commit_atomic.md` has
 *     `name: add-sprint-mint-then-commit-atomic`).
 *
 * This enforcer NEVER writes/deletes anything — it only DETECTS structural drift.
 * (All mutation lives in the /memory:verify skill.) Modelled on the shape of
 * scripts/checks/doc-ref-integrity.js: a pure `evaluate({ stores })` core (no fs) +
 * a disk `run()` + report-only default + `--enforce` + `--json` + fail-closed.
 *
 * CLI:
 *   node scripts/checks/memory-integrity.js [--dir <path>] [--json] [--enforce] [--max-index-lines <n>]
 *
 * - Default scope (no --dir): every immediate subdir of `.claude/agent-memory/`
 *   that CONTAINS a MEMORY.md. If that root is ABSENT / has no store → SKIP
 *   gracefully (ok:true, skipped:true, exit 0) so a downstream /scan run does not RED.
 * - An EXPLICIT `--dir` that does not exist or has no MEMORY.md → FAIL-CLOSED (exit 2):
 *   the user named a specific dir that isn't a valid store.
 * - `--max-index-lines <n>`: MEMORY.md line-count warn threshold (default 200 — the
 *   user-memory truncation limit).
 *
 * FINDINGS (block under --enforce) — the COMPLETE set emitted by evaluate(); keep this list
 * reconciled against every `findings.push` site, not against one example:
 *   broken-index-pointer (high) · duplicate-name-slug (high)
 *   invalid-frontmatter (high, one per bad field: no block / name / description / metadata.type)
 *   malformed-index-line (medium) · orphan-memory-file (medium) · duplicate-index-entry (low)
 * WARNINGS (NEVER block, even under --enforce) — the COMPLETE set emitted by evaluate():
 *   dangling-wikilink · non-kebab-name · index-too-long
 *
 * Exit codes: runner error / bad explicit --dir → 2 ; report-only default → 0 (even
 * with findings) ; --enforce → 1 iff >=1 finding (warnings never cause exit 1).
 *
 * Zero runtime deps (frontmatter + MEMORY.md-index parsing hand-rolled).
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "memory-integrity";
const DEFAULT_MEMORY_ROOT = ".claude/agent-memory";
const DEFAULT_MAX_INDEX_LINES = 200;
const VALID_TYPES = new Set(["user", "feedback", "project", "reference"]);
// A memory name is a kebab-slug by convention (`add-sprint-mint-then-commit-atomic`).
// A non-kebab name still resolves, so a mismatch is a WARNING nudge, never a finding. (FIX-6.)
const KEBAB_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const norm = (p) => p.replace(/\\/g, "/");

// ── Parsers (pure string → structure; no fs) ────────────────────────────────

// MEMORY.md index line: `- [Title](target.md) — one-line hook`.
// The load-bearing capture is the (target) markdown-link filename; title/hook are
// tolerated-optional. The separator before the hook may be an em-dash or a hyphen.
// The target capture is LAZY (`.+?`) — NOT `[^)]+` — so a balanced-paren filename
// like `ghost(1).md` is captured WHOLE: the anchored `$` (+ the optional `— hook`
// group) forces the engine to backtrack to the ')' that leaves a valid remainder
// instead of stopping at the first inner ')' and SILENTLY OMITTING the whole line
// (that omission made a real entry look orphaned AND hid a broken pointer whose
// parens the check never reported → --enforce false green). Index lines are
// short / single-match / anchored, so this stays O(n). (gauntlet r2, FIX-2.)
// The hook separator REQUIRES surrounding whitespace (` — ` / ` - `) so a hyphen INSIDE the
// filename is not mistaken for the delimiter — otherwise `](ghost(1)-copy.md) — hook` parses
// target=`ghost(1` (the `-copy` hyphen read as the separator). (gauntlet r9, backend :82.)
const INDEX_LINE_RE = /^\s*[-*]\s*\[([^\]]*)\]\((.+?)\)(?:\s+[—-]\s+(.*))?\s*$/;
// A line that STARTS like an index entry (`- [..](`) but does NOT fully match the
// pattern above must be surfaced, not dropped — parseIndex records it as `malformed`
// so evaluate() can emit a `malformed-index-line` finding (defense-in-depth so
// nothing meant to be an index entry vanishes silently). (gauntlet r2, FIX-2.)
const INDEX_LINE_START_RE = /^\s*[-*]\s*\[[^\]]*\]\(/;

/**
 * Parse a MEMORY.md index. Returns { entries, lineCount, malformed }:
 *   entries   : [{ line, title, target, hook }] (only lines that match the index shape)
 *   lineCount : total NON-BLANK lines (for the truncation warn)
 *   malformed : [{ line, text }] (lines that LOOK like an index entry but do not parse)
 */
function parseIndex(text) {
  const entries = [];
  const malformed = [];
  let lineCount = 0;
  const lines = String(text == null ? "" : text).split(/\r?\n/);
  lines.forEach((ln, i) => {
    if (ln.trim() === "") return;
    lineCount++;
    const m = ln.match(INDEX_LINE_RE);
    if (m) {
      entries.push({
        line: i + 1,
        title: (m[1] || "").trim(),
        target: (m[2] || "").trim(),
        hook: (m[3] || "").trim(),
      });
    } else if (INDEX_LINE_START_RE.test(ln)) {
      malformed.push({ line: i + 1, text: ln.trim() });
    }
  });
  return { entries, lineCount, malformed };
}

/**
 * Decode ONE YAML scalar value to the string it actually denotes, or null if the
 * field is ABSENT / not a simple scalar. A memory frontmatter value is a simple
 * scalar by contract — this bounds the parse (no yaml dep) and closes both a
 * false-fail (quoted `type: "feedback"` was rejected as `"feedback"`) and a
 * fail-open (`name: ""` / `description: null` passed as non-empty). (gauntlet r2, FIX-3.)
 *   - a value opening with a flow/block indicator (`[` `{` `|` `>`) is unsupported
 *     compound YAML → treat as ABSENT (leave the field null so invalid-frontmatter fires);
 *   - strip ONE layer of matching surrounding quotes (`"…"` or `'…'`), then trim —
 *     quoted content is a literal string (so `"feedback"` → feedback, `""`/`''` → absent);
 *   - an UNQUOTED value that BEGINS with `#` is a whole-line comment → ABSENT (null);
 *   - an UNQUOTED `null` or `~`, or an empty-after-decode value → ABSENT (null).
 */
function decodeScalar(raw) {
  if (raw == null) return null;
  let v = String(raw).trim();
  if (v === "") return null;
  // Quoted scalar: strip ONE layer of matching quotes; content is a LITERAL string — an inline
  // '#' or the word null INSIDE quotes is part of the value, not a comment/null.
  const q = v[0];
  if ((q === '"' || q === "'") && v.length >= 2 && v[v.length - 1] === q) {
    v = v.slice(1, -1).trim();
    return v === "" ? null : v; // quoted-empty → absent; else a literal string
  }
  // UNQUOTED, LEADING '#': the whole value is a YAML comment, so the field carries NO value —
  // ABSENT, exactly like an empty value. This is a SEPARATE O(1) index check, NOT a relaxation
  // of the `\s#` strip below: the strip REQUIRES a preceding whitespace, so in `name: # comment`
  // the '#' sits at index 0 of the already-trimmed value and was never stripped — the literal
  // '# comment' returned as a valid name, and invalid-frontmatter never fired for the missing
  // field. Widening `\s#` to `\s*#` would close it but REINTRODUCE the O(n^2) ReDoS that r7/r9
  // removed, so the boundary case is handled here instead. Quoted values never reach this line,
  // so `name: "# not a comment"` stays a real literal value. (gauntlet r10 :149.)
  if (v[0] === "#") return null;
  // UNQUOTED: strip a YAML-style inline comment (a '#' preceded by whitespace, to EOL), then
  // re-trim. Use a SINGLE `\s` (not `\s+`) — `\s+#` before a mismatchable `#` backtracks O(n^2)
  // on a long internal-whitespace scalar (a ReDoS, same class removed from extractWikilinks); a
  // single boundary char is enough and the trailing trim() clears the rest of the run. O(n).
  // (gauntlet r9 backend :140 + r7 self-regression ReDoS.)
  v = v.replace(/\s#.*$/, "").trim();
  if (v === "") return null;
  if (/^[[{|>]/.test(v)) return null; // unsupported compound/block YAML → invalid
  if (/^(null|~)$/i.test(v)) return null; // unquoted YAML null sentinels, ANY case (null/Null/NULL/~)
  return v;
}

/**
 * Does a `key:` line carry NO value on the same line? True for an empty remainder and for a
 * remainder that is ENTIRELY a comment (`# …`) — a comment denotes no value, matching
 * decodeScalar's leading-'#' rule. Anything else (a scalar, a null sentinel, a flow collection)
 * IS a same-line value.
 *
 * NOT interchangeable with `decodeScalar(v) === null`: decodeScalar also returns null for
 * `null` / `~` / `[…]`, which ARE same-line values and must not be read as an absent one. This
 * is the discriminator `metadata:` needs to decide mapping-parent vs. scalar. O(1)/O(n), no
 * backtracking. (gauntlet r10 :229.)
 */
function isEmptyFieldValue(raw) {
  const v = String(raw == null ? "" : raw).trim();
  return v === "" || v[0] === "#";
}

/**
 * Hand-rolled minimal frontmatter parser. Reads the leading `---`…`---` block,
 * top-level `key: value`, and the nested `metadata:` → `type:`. No yaml dep.
 * name/description/type are run through decodeScalar (FIX-3) so validation and the
 * duplicate-name-slug comparison see DECODED scalars, not raw yaml text.
 * Returns { hasFrontmatter, name, description, type, body }.
 */
function parseFrontmatter(text) {
  const out = { hasFrontmatter: false, name: null, description: null, type: null, body: "" };
  const stripped = String(text == null ? "" : text).replace(/^﻿/, "");
  // FIX-7: a canonical EMPTY frontmatter block (`---` immediately followed by a
  // closing `---`, zero body lines) is hasFrontmatter:true with all fields null —
  // NOT no-frontmatter — so evaluate() still emits the missing-field diagnostics.
  // The main regex below requires a newline before the closing `---`, so it would
  // misclassify a zero-line block; catch it first.
  const empty = stripped.match(/^---[ \t]*\r?\n---[ \t]*(?:\r?\n|$)/);
  if (empty) {
    out.hasFrontmatter = true;
    out.body = stripped.slice(empty[0].length);
    return out;
  }
  const m = stripped.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) {
    out.body = stripped;
    return out;
  }
  out.hasFrontmatter = true;
  out.body = stripped.slice(m[0].length);
  const fmLines = m[1].split(/\r?\n/);
  const indentOf = (s) => (String(s).match(/^[ \t]*/)[0] || "").length;
  // Indentation-aware: `type` counts ONLY as a DIRECT child of a top-level `metadata:`
  // key — never a grandchild. Otherwise `metadata:\n  other:\n    type: x` would set
  // metadata.type from a nested `type` (a false green). name/description are read ONLY
  // at the top level (indent 0), so a nested `name:`/`description:` cannot shadow them.
  // (gauntlet r2, backend lane :130.)
  let inMetadata = false;
  let metadataIndent = 0;
  let metadataChildIndent = -1; // indent of metadata's DIRECT children (first line inside fixes it)
  let metadataInvalid = false; // any NON-flat-mapping structure under metadata → type untrustworthy
  // DUPLICATE load-bearing keys are AMBIGUOUS, not last-wins. A file carrying two top-level
  // `metadata:` blocks (or two `type:` children) declares no single trustworthy type, and quietly
  // keeping the last one picks a winner the author never wrote — the record then reads as validly
  // typed. Fail CLOSED: a repeat marks the field ABSENT so invalid-frontmatter fires on it.
  // (gauntlet r11 HIGH-2 — the shape that reached `type: feedback` through a duplicated block.)
  const topLevelSeen = new Set();
  const topLevelDup = new Set();
  let metadataTypeSeen = false;
  for (const ln of fmLines) {
    if (ln.trim() === "") continue;
    const ind = indentOf(ln);
    const km = ln.match(/^[ \t]*([A-Za-z0-9_-]+):[ \t]*(.*)$/);

    // A dedent to/above metadata's own level ends the metadata block.
    if (inMetadata && ind <= metadataIndent) {
      inMetadata = false;
      metadataChildIndent = -1;
    }

    if (inMetadata) {
      const trimmed = ln.trim();
      if (trimmed.startsWith("#")) continue; // a YAML comment line — ignore, not a structure
      // metadata must be a FLAT MAPPING of `key: scalar` at ONE child indent. A sequence item
      // (`- ...`), a DEEPER (nested) line, or a non-`key:` line means metadata is NOT a simple
      // {type: ...} mapping — so `type` cannot be trusted (a `type` nested inside a sequence/
      // sub-mapping must NOT satisfy metadata.type). (gauntlet r2 :130 nested-mapping + r9 :196
      // sequence-nested — closed at the mechanism: reject the whole non-flat block.)
      if (metadataChildIndent === -1) metadataChildIndent = ind; // first line inside fixes the child indent
      // ANY inconsistent child indent (deeper = nesting, OR shallower-but-still-inside), a sequence
      // item, or a non-`key:` line means metadata isn't a flat mapping → type untrustworthy.
      if (trimmed.startsWith("-") || ind !== metadataChildIndent || !km) {
        metadataInvalid = true;
        continue;
      }
      // EVERY direct child must be a SIMPLE SCALAR — not just `type`. A value opening with a YAML
      // flow/block indicator (`[` `{` `|` `>`) is a collection or a block scalar, so the block is
      // not a flat `key: scalar` mapping and `type` is no more trustworthy than it is under a
      // nested line. The old loop only ever LOOKED at `type:` and ignored every other child, so
      // `metadata:\n  type: feedback\n  tags: []` parsed as validly typed. Checking the child
      // shape (rather than enumerating known keys) closes the whole class, not this one key.
      // (gauntlet r11 HIGH-2.)
      const childVal = String(km[2] == null ? "" : km[2]).trim();
      if (/^[[{|>]/.test(childVal)) {
        metadataInvalid = true;
        continue;
      }
      if (km[1] === "type") {
        if (metadataTypeSeen) {
          metadataInvalid = true; // a repeated `type:` — ambiguous, no trustworthy value
          continue;
        }
        metadataTypeSeen = true;
        out.type = decodeScalar(km[2]);
      }
      continue; // stay inside metadata until a dedent
    }

    if (!km) continue; // outside metadata, only simple `key:` lines are fields we read
    if (ind !== 0) continue; // top-level keys only; a nested `name:`/`description:` can't shadow
    const key = km[1];
    const val = km[2];
    // Record repeats of the three load-bearing top-level keys BEFORE reading the value, so the
    // tail below can null the ambiguous field out regardless of which occurrence won. (r11 HIGH-2.)
    if (key === "metadata" || key === "name" || key === "description") {
      if (topLevelSeen.has(key)) topLevelDup.add(key);
      topLevelSeen.add(key);
    }
    if (key === "metadata") {
      // `metadata:` opens a MAPPING PARENT only when it carries NO same-line value. A
      // `metadata: <scalar>` is by definition not a flat mapping, so it must NOT open a block:
      // otherwise a later indented `type:` populated out.type off a key that never was a mapping
      // (a false green — the record read as validly typed). A same-line value instead marks the
      // block invalid, so the existing `if (metadataInvalid) out.type = null` tail fires and the
      // record reports invalid frontmatter. `metadata: # note` is EMPTY (the comment carries no
      // value, per decodeScalar's leading-'#' rule) and still opens the block. (gauntlet r10 :229.)
      if (isEmptyFieldValue(val)) {
        inMetadata = true;
        metadataIndent = ind;
        metadataChildIndent = -1;
      } else {
        metadataInvalid = true;
      }
    } else if (key === "name") out.name = decodeScalar(val);
    else if (key === "description") out.description = decodeScalar(val);
  }
  // A DUPLICATED top-level key leaves the field ambiguous → treat it as ABSENT (fail-closed), so
  // evaluate()/frontmatterProblems report the missing field instead of silently taking last-wins.
  if (topLevelDup.has("metadata")) metadataInvalid = true;
  if (topLevelDup.has("name")) out.name = null;
  if (topLevelDup.has("description")) out.description = null;
  if (metadataInvalid) out.type = null; // a malformed (non-flat) metadata block → no trustworthy type
  return out;
}

/**
 * frontmatterProblems(fm) — THE SINGLE SOURCE OF TRUTH for "are these frontmatter fields
 * structurally valid for a memory file". Takes anything carrying the four parsed fields:
 * a parseFrontmatter() result, or a store file record from readStore(). Returns [] when valid,
 * else a list of { field, message } where `message` is a SUBJECT-LESS clause the caller prefixes
 * with whatever it is talking about (`<dir>/<file> …` / `newBody …`).
 *
 * WHY THIS EXISTS (gauntlet r11 HIGH-2): memory-apply's `validateNewBody` used to MIRROR these
 * rules in its own code, with a comment claiming the mirror and evaluate() "cannot disagree". A
 * mirrored reimplementation is exactly the thing that drifts — and it did: parser shapes that
 * produced a trusted `type` sailed through the pre-check. Both the PRE-check (memory-apply, before
 * anything is written) and the POST-check (evaluate, over the store on disk) now CALL this one
 * function, so there is no second copy left to drift out of step. Do not re-inline these rules.
 */
function frontmatterProblems(fm) {
  const problems = [];
  const f = fm || {};
  if (!f.hasFrontmatter) {
    problems.push({
      field: "block",
      message:
        "has no YAML frontmatter block (expected a leading '---' … '---' block with name/description/metadata.type)",
    });
    return problems; // no fields to check without a block
  }
  if (!f.name || !String(f.name).trim()) {
    problems.push({ field: "name", message: "frontmatter is missing a non-empty 'name' field" });
  }
  if (!f.description || !String(f.description).trim()) {
    problems.push({ field: "description", message: "frontmatter is missing a non-empty 'description' field" });
  }
  if (!f.type || !VALID_TYPES.has(String(f.type).trim())) {
    problems.push({
      field: "metadata.type",
      message: `frontmatter 'metadata.type' is absent or not one of {${[...VALID_TYPES].join(", ")}} (got '${f.type == null ? "" : f.type}')`,
    });
  }
  return problems;
}

/** Extract `[[wikilinks]]` (name-slug references) from a body. */
function extractWikilinks(body) {
  const out = [];
  // Inner class EXCLUDES '[' so a run of unclosed '[[' cannot make one match span
  // multiple openers — that spanning is what makes /\[\[([^\]]+)\]\]/g backtrack O(n^2)
  // on adversarial body content (memory bodies are untrusted input). This form is O(n)
  // and still extracts real [[slugs]]. (security gauntlet r1, ReDoS finding.)
  const re = /\[\[([^[\]]+)\]\]/g;
  let m;
  while ((m = re.exec(String(body == null ? "" : body)))) {
    const slug = m[1].trim();
    if (slug) out.push(slug);
  }
  return out;
}

// ── Pure structural core (no fs) ─────────────────────────────────────────────
/**
 * evaluate({ stores }) — decide structural findings + warnings from parsed stores.
 *
 * Each store =
 *   { dir, maxIndexLines, indexEntries:[{line,title,target,hook}], indexLineCount,
 *     files:[{ file, hasFrontmatter, name, description, type, wikilinks:[...] }] }
 *
 * Returns { findings, warnings }; each entry =
 *   { severity, check:"memory-integrity", kind, dir, file?, line?, message }.
 */
function evaluate({ stores }) {
  const findings = [];
  const warnings = [];
  for (const store of stores || []) {
    if (!store) continue;
    const dir = store.dir;
    const maxIndexLines = store.maxIndexLines || DEFAULT_MAX_INDEX_LINES;
    const indexEntries = store.indexEntries || [];
    const indexMalformed = store.indexMalformed || [];
    const files = store.files || [];

    const fileNames = new Set(files.map((f) => f.file));

    // 0) malformed-index-line (medium): a line that LOOKS like an index entry but
    // does not parse — it would be silently dropped from the index. Surfaced so
    // nothing meant to be an entry is lost. (gauntlet r2, FIX-2 defense-in-depth.)
    for (const ml of indexMalformed) {
      if (!ml) continue;
      findings.push({
        severity: "medium",
        check: NAME,
        kind: "malformed-index-line",
        dir,
        line: ml.line,
        message: `${dir}/MEMORY.md:${ml.line} looks like an index entry ('${ml.text}') but does not parse as '- [Title](target.md) — hook' — it would be silently dropped from the index. Fix the line shape.`,
      });
    }

    // 1) broken-index-pointer (high): index target not present as a file in the store.
    for (const e of indexEntries) {
      if (!e || !e.target) continue;
      if (!fileNames.has(e.target)) {
        findings.push({
          severity: "high",
          check: NAME,
          kind: "broken-index-pointer",
          dir,
          line: e.line,
          message: `${dir}/MEMORY.md:${e.line} index entry points at '${e.target}' but no such file exists in the store. The file was renamed/deleted and the index drifted — repoint or remove the index line.`,
        });
      }
    }

    // 3) duplicate-index-entry (low): two+ entries targeting the SAME filename.
    const targetSeen = new Map();
    for (const e of indexEntries) {
      if (!e || !e.target) continue;
      targetSeen.set(e.target, (targetSeen.get(e.target) || 0) + 1);
    }
    for (const [target, count] of targetSeen) {
      if (count > 1) {
        findings.push({
          severity: "low",
          check: NAME,
          kind: "duplicate-index-entry",
          dir,
          message: `${dir}/MEMORY.md has ${count} index entries all pointing at '${target}' — collapse the duplicates to one.`,
        });
      }
    }

    // 2) orphan-memory-file (medium): a per-fact *.md referenced by NO index entry.
    const referenced = new Set(indexEntries.map((e) => e && e.target).filter(Boolean));
    for (const f of files) {
      if (!referenced.has(f.file)) {
        findings.push({
          severity: "medium",
          check: NAME,
          kind: "orphan-memory-file",
          dir,
          file: f.file,
          message: `${dir}/${f.file} exists but is not referenced by any MEMORY.md index entry — it is invisible to context loading. Add an index line or remove the file.`,
        });
      }
    }

    // 4) invalid-frontmatter (high, one finding per problem, message names the field).
    // Routed through frontmatterProblems — the SAME function memory-apply's newBody pre-check
    // calls — so the pre-check and this post-check cannot disagree about one file. (r11 HIGH-2.)
    for (const f of files) {
      for (const p of frontmatterProblems(f)) {
        findings.push({
          severity: "high",
          check: NAME,
          kind: "invalid-frontmatter",
          dir,
          file: f.file,
          message: `${dir}/${f.file} ${p.message}.`,
        });
      }
    }

    // 5) duplicate-name-slug (high): two+ per-fact files sharing the same name: slug.
    const slugToFiles = new Map();
    for (const f of files) {
      const n = f.name && String(f.name).trim();
      if (!n) continue;
      if (!slugToFiles.has(n)) slugToFiles.set(n, []);
      slugToFiles.get(n).push(f.file);
    }
    for (const [slug, list] of slugToFiles) {
      if (list.length > 1) {
        findings.push({
          severity: "high",
          check: NAME,
          kind: "duplicate-name-slug",
          dir,
          message: `${dir}: ${list.length} files share the same name-slug '${slug}' (${list.join(", ")}) — a slug must be unique so [[wikilinks]] resolve to one memory.`,
        });
      }
    }

    // 5b) non-kebab-name (WARNING — never blocks): a present name that is not a
    // kebab-slug. It still resolves, so this is a convention nudge, not a finding. (FIX-6.)
    for (const f of files) {
      const n = f.name && String(f.name).trim();
      if (n && !KEBAB_NAME_RE.test(n)) {
        warnings.push({
          severity: "warning",
          check: NAME,
          kind: "non-kebab-name",
          dir,
          file: f.file,
          message: `${dir}/${f.file} name '${n}' is not a kebab-slug (expected ^[a-z0-9]+(-[a-z0-9]+)*$) — it still resolves, this is a convention nudge, not a blocker.`,
        });
      }
    }

    // 6) dangling-wikilink (WARNING — allowed by doctrine, NEVER a finding).
    const slugSet = new Set(
      files.map((f) => f.name && String(f.name).trim()).filter(Boolean),
    );
    for (const f of files) {
      for (const wl of f.wikilinks || []) {
        if (!slugSet.has(wl)) {
          warnings.push({
            severity: "warning",
            check: NAME,
            kind: "dangling-wikilink",
            dir,
            file: f.file,
            message: `${dir}/${f.file} references [[${wl}]] which matches no memory's name-slug (allowed as a "worth writing later" pointer — not an error).`,
          });
        }
      }
    }

    // 7) index-too-long (WARNING): entries beyond the truncation limit drop silently.
    if (store.indexLineCount > maxIndexLines) {
      warnings.push({
        severity: "warning",
        check: NAME,
        kind: "index-too-long",
        dir,
        message: `${dir}/MEMORY.md has ${store.indexLineCount} non-blank lines (> ${maxIndexLines}); entries past the limit are silently dropped from context — prune or split.`,
      });
    }
  }
  return { findings, warnings };
}

// ── Disk layer ───────────────────────────────────────────────────────────────

/** Read + parse one memory store dir. Returns a store object, or null if no MEMORY.md. */
function readStore(absDir, relDir, maxIndexLines) {
  const memPath = path.join(absDir, "MEMORY.md");
  let indexText;
  try {
    indexText = fs.readFileSync(memPath, "utf8");
  } catch (e) {
    // ONLY a genuinely-absent MEMORY.md means "not a store" (skip). Any OTHER error
    // (EACCES/EISDIR/corruption) must PROPAGATE so main() fail-closes (exit 2) rather
    // than silently dropping a store that exists but is unreadable — a mild fail-open in
    // default scope otherwise. (security gauntlet r1, ENOENT-conflation finding.)
    if (e && e.code === "ENOENT") return null;
    throw e;
  }
  const { entries, lineCount, malformed } = parseIndex(indexText);
  const files = [];
  const dirents = fs.readdirSync(absDir, { withFileTypes: true });
  for (const e of dirents) {
    if (!e.isFile()) continue;
    if (e.name === "MEMORY.md") continue;
    if (!e.name.toLowerCase().endsWith(".md")) continue;
    const text = fs.readFileSync(path.join(absDir, e.name), "utf8");
    const fm = parseFrontmatter(text);
    files.push({
      file: e.name,
      hasFrontmatter: fm.hasFrontmatter,
      name: fm.name,
      description: fm.description,
      type: fm.type,
      wikilinks: extractWikilinks(fm.body),
    });
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  return {
    dir: relDir,
    maxIndexLines,
    indexEntries: entries,
    indexMalformed: malformed,
    indexLineCount: lineCount,
    files,
  };
}

/**
 * run(opts) — resolve stores on disk, evaluate, return a result envelope.
 *   opts = { dirs?:[<path>], maxIndexLines?:<n> }
 * Return shapes:
 *   fatal  → { ok:false, fatal:true, problems:[...], notes }
 *   skip   → { ok:true, skipped:true, findings:[], warnings:[], notes, storeCount:0 }
 *   normal → { ok, fatal:false, skipped:false, findings, warnings, notes, storeCount }
 */
function run(opts) {
  opts = opts || {};
  const notes = [];
  const maxIndexLines = opts.maxIndexLines || DEFAULT_MAX_INDEX_LINES;
  const explicitDirs = opts.dirs && opts.dirs.length ? opts.dirs : null;

  const stores = [];

  if (explicitDirs) {
    // EXPLICIT --dir: a named dir that is missing / not a store is FAIL-CLOSED.
    for (const d of explicitDirs) {
      const absDir = path.isAbsolute(d) ? d : path.join(ROOT, d);
      let stat;
      try {
        stat = fs.statSync(absDir);
      } catch {
        return {
          ok: false,
          fatal: true,
          problems: [`--dir '${d}' does not exist`],
          notes,
        };
      }
      if (!stat.isDirectory()) {
        return {
          ok: false,
          fatal: true,
          problems: [`--dir '${d}' is not a directory`],
          notes,
        };
      }
      const store = readStore(absDir, norm(d), maxIndexLines);
      if (!store) {
        return {
          ok: false,
          fatal: true,
          problems: [`--dir '${d}' has no MEMORY.md (not a memory store)`],
          notes,
        };
      }
      stores.push(store);
    }
  } else {
    // DEFAULT scope: every immediate subdir of .claude/agent-memory/ with a MEMORY.md.
    // SKIP-on-absent (a MC-only surface must not RED a downstream /scan).
    const memRootAbs = path.join(ROOT, DEFAULT_MEMORY_ROOT);
    let rootStat;
    try {
      rootStat = fs.statSync(memRootAbs);
    } catch (e) {
      // ONLY a genuinely-absent root means "no store here" (skip). Any OTHER error
      // (EACCES/EISDIR/IO) must PROPAGATE so main() fail-closes (exit 2) rather than
      // skipping OPEN under --enforce — the SAME class fixed in readStore's readFileSync.
      // (gauntlet r2, FIX-1.)
      if (e && e.code === "ENOENT") return skipResult(notes);
      throw e;
    }
    // Root EXISTS but is NOT a directory (a file/device where the agent-memory dir belongs) is a
    // corrupt/unexpected state, NOT "absent" — fail-closed, never skip-OPEN under --enforce.
    // (gauntlet r8, qa lane :539 — the exists-but-not-a-dir sibling of the root-stat class.)
    if (!rootStat.isDirectory()) {
      return {
        ok: false,
        fatal: true,
        problems: [`default memory root '${DEFAULT_MEMORY_ROOT}' exists but is not a directory`],
        notes,
      };
    }
    // A readdir error here must likewise NOT be swallowed as skip — let it propagate
    // to main() → exit 2 (fail-closed). (gauntlet r2, FIX-1.)
    const subdirs = fs.readdirSync(memRootAbs, { withFileTypes: true });
    for (const sd of subdirs) {
      if (!sd.isDirectory()) continue;
      const absDir = path.join(memRootAbs, sd.name);
      const store = readStore(
        absDir,
        norm(`${DEFAULT_MEMORY_ROOT}/${sd.name}`),
        maxIndexLines,
      );
      if (store) stores.push(store);
    }
    if (stores.length === 0) return skipResult(notes);
  }

  const { findings, warnings } = evaluate({ stores });
  notes.push(
    `${stores.length} store(s) · ${findings.length} finding(s) · ${warnings.length} warning(s)`,
  );
  return {
    ok: findings.length === 0,
    fatal: false,
    skipped: false,
    findings,
    warnings,
    notes,
    storeCount: stores.length,
  };
}

function skipResult(notes) {
  return {
    ok: true,
    skipped: true,
    fatal: false,
    findings: [],
    warnings: [],
    notes: [...notes, "no memory stores found under .claude/agent-memory/"],
    storeCount: 0,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { dirs: [], json: false, enforce: false, maxIndexLines: DEFAULT_MAX_INDEX_LINES };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--enforce") opts.enforce = true;
    else if (a === "--dir") opts.dirs.push(argv[++i]);
    else if (a === "--max-index-lines") {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0) opts.maxIndexLines = n;
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  let res;
  try {
    res = run({ dirs: opts.dirs, maxIndexLines: opts.maxIndexLines });
  } catch (e) {
    const msg = String((e && e.message) || e);
    process.stdout.write(
      (opts.json
        ? JSON.stringify({ mode: opts.enforce ? "blocking" : "report-only", ok: false, check: NAME, fatal: true, error: msg })
        : `ERROR  [${NAME}] runner error (fail-closed): ${msg}`) + "\n",
    );
    process.exit(2);
  }

  const mode = opts.enforce ? "blocking" : "report-only";

  if (opts.json) {
    const payload = {
      mode,
      ok: !!res.ok,
      skipped: !!res.skipped,
      findings: res.findings || [],
      warnings: res.warnings || [],
      notes: res.notes || [],
      storeCount: res.storeCount || 0,
    };
    if (res.fatal) {
      payload.fatal = true;
      payload.error = (res.problems || []).join("; ");
    }
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    process.exit(res.fatal ? 2 : opts.enforce && !res.ok ? 1 : 0);
  }

  if (res.fatal) {
    process.stderr.write(`ERROR  [${NAME}] (fail-closed) ${(res.problems || []).join(" · ")}\n`);
    process.exit(2);
  }

  if (res.skipped) {
    process.stdout.write(`SKIP [${NAME}] ${res.notes.join(" · ")}\n`);
    process.exit(0);
  }

  const findings = res.findings || [];
  const warnings = res.warnings || [];

  if (res.ok && warnings.length === 0) {
    process.stdout.write(`PASS [${NAME}] ${res.notes.join(" · ")}\n`);
    process.exit(0);
  }

  const label = findings.length === 0 ? "PASS" : opts.enforce ? "FAIL" : "WARN";
  process.stderr.write(
    `${label} [${NAME}] (${mode}) ${findings.length} finding(s), ${warnings.length} warning(s):\n`,
  );
  for (const f of findings) process.stderr.write(`  - [${f.severity}] ${f.kind}: ${f.message}\n`);
  for (const w of warnings) process.stderr.write(`  ~ [warning] ${w.kind}: ${w.message}\n`);
  if (res.notes.length) process.stderr.write(`  (${res.notes.join(" · ")})\n`);
  // warnings NEVER cause exit 1; only findings under --enforce do.
  process.exit(opts.enforce && findings.length > 0 ? 1 : 0);
}

if (require.main === module) main();

module.exports = {
  evaluate,
  run,
  parseIndex,
  parseFrontmatter,
  frontmatterProblems,
  decodeScalar,
  isEmptyFieldValue,
  extractWikilinks,
  readStore,
  NAME,
  DEFAULT_MEMORY_ROOT,
  DEFAULT_MAX_INDEX_LINES,
  VALID_TYPES,
};
