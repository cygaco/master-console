#!/usr/bin/env node
/**
 * scripts/panel/roadmap.js — READ-ONLY "what's next" roadmap board generator.
 *
 * Renders a static markdown board (a regenerated artifact, like the maps)
 * assembled from FOUR live, human-authored sources, at-a-glance:
 *   1. ROADMAP.md  — `### Prioritized order` -> the "Ranked do-next:" #1..#N list,
 *                    plus the presence of a `## Sprint Pickup Queue` heading.
 *   2. TRACKER.md  — `## Current Highest-Priority Next Action` -> the single bolded
 *                    **NEXT ACTION ...** line.
 *   3. .claude/project/sprint/active-sprints.yaml — in-flight sprints (id + status).
 *   4. Open-gaps    — .claude/project/memory/enforcement-debt.jsonl (open ids/policies)
 *                     + .claude/project/memory/recurring-issues.jsonl (open issues).
 *
 * CONTRACT — fail-SOFT + strictly READ-ONLY (beta-4 binding correction, AC-R4a/b/c):
 *   - Each source is parsed inside its OWN try/catch. ANY error (missing file,
 *     renamed heading, broken YAML, malformed JSON) degrades that ONE section to a
 *     "_(section unavailable: <reason>)_" placeholder; the REST of the board still
 *     renders. The generator NEVER throws and NEVER blocks.
 *   - It performs NO write/append/rename to ANY source file. The only output is its
 *     own stdout (and, with --json, a machine summary on stdout). Exit 0 ALWAYS —
 *     a degraded section is a board state, not an error.
 *
 * Injectable source root (for tests + alt checkouts): --root <dir> or the
 * MC_ROADMAP_ROOT env var override the default repo root (resolved from this
 * module's own __dirname, mirroring scripts/mc/repo-role.js). This lets a test
 * feed FIXTURES without touching the real repo files (read-only proof).
 *
 * CLI:
 *   node scripts/panel/roadmap.js            # render the markdown board to stdout
 *   node scripts/panel/roadmap.js --json     # machine summary {nextAction,ranked,...}
 *   node scripts/panel/roadmap.js --root DIR  # read sources from DIR instead of repo root
 *
 * Exit 0 always (read-only board).
 */

"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const fs = require("fs");
const path = require("path");

// Default repo root resolved from this module's location (scripts/panel/../.. =
// project root). Mirrors scripts/mc/repo-role.js — no paths.X dependency.
const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");

// A NUL byte, built so no literal control byte ever lives in THIS source file.
const NUL = String.fromCharCode(0);

// The placeholder a degraded section renders. AC-R4c keys on "section unavailable".
function unavailable(reason) {
  return `_(section unavailable: ${reason || "unknown"})_`;
}

// ── Arg / root resolution ────────────────────────────────────────────────────

function resolveRoot(argv) {
  // --root <dir> wins; then MC_ROADMAP_ROOT; then the module-derived default.
  const i = argv.indexOf("--root");
  if (i !== -1 && argv[i + 1]) {
    return path.resolve(argv[i + 1]);
  }
  const env = (mcEnv.readEnv("ROADMAP_ROOT") || "").trim();
  if (env) {
    return path.resolve(env);
  }
  return DEFAULT_ROOT;
}

// ── Source 1: ROADMAP.md ─────────────────────────────────────────────────────
/**
 * parseRoadmap(root) -> { ranked: [{n,text}], hasPickupQueue: boolean, error?: string }
 *
 * Extracts the "Ranked do-next:" numbered list under `### Prioritized order`, and
 * records whether a `## Sprint Pickup Queue` heading is present. Fail-soft: any
 * problem returns { error } and the caller renders the placeholder.
 */
function parseRoadmap(root) {
  try {
    const file = path.join(root, "ROADMAP.md");
    const text = fs.readFileSync(file, "utf8");

    const hasPickupQueue = /^##\s+Sprint Pickup Queue\s*$/m.test(text);

    // Find the "Ranked do-next:" marker (bolded), then collect the numbered list
    // that follows until the first blank line that breaks the list / a new heading.
    const lines = text.split(/\r?\n/);
    let markerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\*\*Ranked do-next:\*\*\s*$/.test(lines[i].trim())) {
        markerIdx = i;
        break;
      }
    }
    if (markerIdx === -1) {
      // The ranked list is the load-bearing content — its absence is a degrade.
      throw new Error("`Ranked do-next:` marker not found (renamed/removed section)");
    }

    const ranked = [];
    for (let i = markerIdx + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const m = /^(\d+)\.\s+(.*)$/.exec(trimmed);
      if (m) {
        // Compress the entry to its leading clause for an at-a-glance board:
        // first **bolded** phrase if present, else up to the first em-dash/period.
        ranked.push({ n: Number(m[1]), text: summarizeRankedItem(m[2]) });
        continue;
      }
      if (trimmed === "") {
        // Blank line: stop once we have collected at least one item.
        if (ranked.length > 0) break;
        continue;
      }
      // A non-numbered, non-blank line after items terminates the list.
      if (ranked.length > 0) break;
    }

    if (ranked.length === 0) {
      throw new Error("`Ranked do-next:` present but no numbered items parsed");
    }
    return { ranked, hasPickupQueue };
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
}

// Reduce a long ranked-item line to a short at-a-glance label.
function summarizeRankedItem(s) {
  const bold = /\*\*(.+?)\*\*/.exec(s);
  if (bold && bold[1].trim()) return bold[1].trim();
  // else first segment up to an em-dash / en-dash / period.
  const seg = s.split(/\s+[—–-]\s+|\.\s/)[0];
  return (seg || s).trim();
}

// ── Source 2: TRACKER.md ─────────────────────────────────────────────────────
/**
 * parseTracker(root) -> { nextAction: string, error?: string }
 *
 * Extracts the single bolded **NEXT ACTION ...** span from the
 * `## Current Highest-Priority Next Action` section. Fail-soft.
 */
function parseTracker(root) {
  try {
    const file = path.join(root, "TRACKER.md");
    const text = fs.readFileSync(file, "utf8");

    const headIdx = text.search(/^##\s+Current Highest-Priority Next Action\s*$/m);
    if (headIdx === -1) {
      throw new Error("`## Current Highest-Priority Next Action` heading not found");
    }
    // Scope to that section: from just AFTER the heading line, until the next
    // `#`/`##` heading. We advance past the heading's own newline first, otherwise
    // the heading itself re-matches at offset 0 and the section collapses to empty.
    const afterHead = text.slice(headIdx);
    const nlIdx = afterHead.indexOf("\n");
    const body = nlIdx === -1 ? "" : afterHead.slice(nlIdx + 1);
    const nextHead = body.search(/^#{1,2}\s+\S/m);
    const section = nextHead === -1 ? body : body.slice(0, nextHead);

    // Pull the bolded **NEXT ACTION ...** span. Allow it mid-paragraph; capture up
    // to the closing `**`. Non-greedy so we stop at the first close.
    const m = /\*\*\s*(NEXT ACTION[\s\S]*?)\*\*/.exec(section);
    if (!m || !m[1].trim()) {
      throw new Error("no bolded **NEXT ACTION ...** line in the section");
    }
    // Normalize whitespace to a single legible line.
    const nextAction = m[1].replace(/\s+/g, " ").trim();
    return { nextAction };
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
}

// ── Source 3: active-sprints.yaml ────────────────────────────────────────────
/**
 * parseActiveSprints(root) -> { sprints: [{id,status}], primary?, error?, absent? }
 *
 * Minimal, dependency-free YAML reading: we only need `primary:` and the list of
 * `- id:` / `status:` rows under `sprints:`. Tolerates an absent/empty file (->
 * empty list, NOT an error — an empty queue is a valid cold-start board state).
 * A present-but-broken file degrades to the placeholder.
 */
function parseActiveSprints(root) {
  try {
    const file = path.join(root, ".claude", "project", "sprint", "active-sprints.yaml");
    if (!fs.existsSync(file)) {
      // A MISSING source file degrades to "section unavailable" (AC-R4c) — it is
      // DISTINCT from a present-but-empty file (which is a valid empty state).
      throw new Error("active-sprints.yaml not found");
    }
    const text = fs.readFileSync(file, "utf8");
    if (!text.trim()) {
      // Present-but-empty = valid cold-start empty state (NOT a malformation).
      return { sprints: [], primary: null, empty: true };
    }

    // Guard against a corrupt/binary blob masquerading as YAML: a real NUL byte
    // (NUL is built via fromCharCode so no control byte ever lives in this source).
    if (text.indexOf(NUL) !== -1) {
      throw new Error("file contains NUL bytes (corrupt)");
    }

    // Structural corruption guard (B5): textually-invalid YAML must degrade to
    // "section unavailable", NOT be silently normalized to an empty/partial list.
    // We detect the common corruption shapes a line-regex scanner would otherwise
    // accept — unterminated flow collections ("sprints: [") and unterminated
    // quoted scalars ("primary: [unterminated / primary: 'oops). Prefer real
    // detection over normalizing corruption away.
    assertYamlNotCorrupt(text);

    const lines = text.split(/\r?\n/);
    let primary = null;
    const sprints = [];
    let cur = null;
    let inSprints = false;

    for (const raw of lines) {
      const line = raw.replace(/\t/g, "  ");
      const pm = /^primary:\s*(.+?)\s*$/.exec(line);
      if (pm && primary === null) {
        primary = stripYamlScalar(pm[1]);
        continue;
      }
      if (/^sprints:\s*$/.test(line)) {
        inSprints = true;
        continue;
      }
      if (!inSprints) continue;

      // New list item: "  - id: <id>"
      const idm = /^\s*-\s*id:\s*(.+?)\s*$/.exec(line);
      if (idm) {
        if (cur) sprints.push(cur);
        cur = { id: stripYamlScalar(idm[1]), status: null };
        continue;
      }
      if (cur) {
        const sm = /^\s*status:\s*(.+?)\s*$/.exec(line);
        if (sm) cur.status = stripYamlScalar(sm[1]);
      }
    }
    if (cur) sprints.push(cur);

    return { sprints, primary };
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
}

function stripYamlScalar(s) {
  let v = (s || "").trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v;
}

/**
 * assertYamlNotCorrupt(text) — throw on textually-invalid YAML the line scanner
 * would otherwise accept. This is a lightweight structural validator (no YAML
 * dep): it catches the corruption shapes that matter for fail-soft —
 *   - unbalanced flow brackets/braces across the document ("sprints: [" with no
 *     matching "]", or a stray "]"/"}"), and
 *   - an unterminated single/double-quoted scalar value on a `key:` line
 *     ("primary: 'oops" / 'primary: "oops').
 * Quote/bracket characters INSIDE a properly-quoted scalar are ignored so normal
 * titles (e.g. `title: "a [b] c"`) never false-trip. Throws Error on corruption;
 * returns silently when the structure is well-balanced.
 */
function assertYamlNotCorrupt(text) {
  let brackets = 0; // [] depth
  let braces = 0; // {} depth
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    let inS = false; // inside '...'
    let inD = false; // inside "..."
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inS) {
        if (c === "'") inS = false;
        continue;
      }
      if (inD) {
        if (c === "\\") {
          i++; // skip escaped char
          continue;
        }
        if (c === '"') inD = false;
        continue;
      }
      // OUTSIDE quotes: a '#' starts a comment to end-of-line. Crucially this is
      // quote-AWARE — a '#' INSIDE a quoted scalar (e.g. title: "guard #1") is NOT
      // a comment, so it never falsely truncates a quoted value (that bug made the
      // real active-sprints.yaml read as an unterminated scalar).
      if (c === "#") break;
      if (c === "'") inS = true;
      else if (c === '"') inD = true;
      else if (c === "[") brackets++;
      else if (c === "]") brackets--;
      else if (c === "{") braces++;
      else if (c === "}") braces--;
    }
    // A quote left open at end-of-line is an unterminated scalar → corrupt.
    if (inS || inD) {
      throw new Error("malformed YAML: unterminated quoted scalar");
    }
    if (brackets < 0 || braces < 0) {
      throw new Error("malformed YAML: unbalanced flow collection (stray close)");
    }
  }
  if (brackets !== 0 || braces !== 0) {
    throw new Error("malformed YAML: unterminated flow collection (unclosed '[' or '{')");
  }
}

// In-flight = not a terminal status. Terminal statuses are excluded from the
// "In flight" board section so the board shows live work, not the full history.
const TERMINAL_STATUSES = new Set([
  "retrospected",
  "closed",
  "released",
  "done",
  "complete",
  "completed",
  "archived",
  "abandoned",
  "cancelled",
  "canceled",
]);

function inFlight(sprints) {
  return sprints.filter(
    (s) => s && s.status && !TERMINAL_STATUSES.has(String(s.status).toLowerCase()),
  );
}

// Actively-EXECUTING statuses — the small set the operator actually wants to see
// at a glance ("what's moving now"). A long-stale `planning` row is in-flight but
// NOT actively-executing, so it is summarized, not listed (operator polish #3).
const ACTIVE_STATUSES = new Set([
  "in_progress",
  "in-progress",
  "inprogress",
  "active",
  "executing",
  "building",
  "build",
  "gauntlet",
  "review",
  "reviewing",
  "releasing",
  "release",
  "design",
  "designing",
]);

function isActivelyExecuting(s) {
  return !!(s && s.status && ACTIVE_STATUSES.has(String(s.status).toLowerCase()));
}

function isStalePlanning(s) {
  return !!(s && s.status && String(s.status).toLowerCase() === "planning");
}

// ── Source 4: open gaps / blockers ───────────────────────────────────────────
/**
 * parseGaps(root) -> { debt: {count,items}, issues: {count,items}, error?: string }
 *
 * Reads open enforcement-debt + open recurring-issues. Each register is tolerated
 * absent (-> count 0). A present-but-unreadable register degrades the whole gaps
 * section to the placeholder (fail-soft, never throws past the caller).
 */
function parseGaps(root) {
  try {
    const debtFile = path.join(root, ".claude", "project", "memory", "enforcement-debt.jsonl");
    const issuesFile = path.join(root, ".claude", "project", "memory", "recurring-issues.jsonl");

    // A MISSING register FILE degrades the gaps section to "section unavailable"
    // (AC-R4c) — DISTINCT from a present-but-empty register (→ count 0, an empty
    // state). If BOTH registers are absent there is nothing to report on at all.
    const debtAbsent = !fs.existsSync(debtFile);
    const issuesAbsent = !fs.existsSync(issuesFile);
    if (debtAbsent && issuesAbsent) {
      throw new Error("open-gaps registers not found (enforcement-debt + recurring-issues absent)");
    }
    if (debtAbsent) {
      throw new Error("open-gaps register not found: enforcement-debt.jsonl");
    }
    if (issuesAbsent) {
      throw new Error("open-gaps register not found: recurring-issues.jsonl");
    }

    const debt = readJsonlOpen(debtFile, (o) => ({ id: o.id, label: o.policy || o.note || "" }));
    const issues = readJsonlOpen(issuesFile, (o) => ({ id: o.id, label: o.title || o.policy || "" }));
    return { debt, issues };
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
}

/**
 * readJsonlOpen(file, pick) -> { count, items, absent }
 *
 * Reads a JSONL register and returns entries whose status === "open". Tolerates an
 * absent file (count 0, absent:true). Per-line parse errors are SKIPPED (a single
 * malformed line must not blank the whole register). A wholesale read error throws
 * to the parseGaps try/catch.
 */
function readJsonlOpen(file, pick) {
  if (!fs.existsSync(file)) {
    return { count: 0, items: [], absent: true };
  }
  const text = fs.readFileSync(file, "utf8");
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let o;
    try {
      o = JSON.parse(t.replace(/^﻿/, ""));
    } catch {
      continue; // skip one bad line, keep the rest
    }
    if (o && o.status === "open") {
      items.push(pick(o));
    }
  }
  return { count: items.length, items, absent: false };
}

// ── Source 5: epics — trackers/epics/*.md ────────────────────────────────────
/**
 * parseEpics(root) -> { epics: [{id,title,state,percent,childSprints[]} | {id,parseError}],
 *                       error?: string, absent?: boolean }
 *
 * Walks `trackers/epics/*.md` and extracts, per epic file:
 *   - id       ← the **Epic label and number:** line (falls back to the filename stem)
 *   - title    ← the **Title:** line (falls back to the first `# ` heading text)
 *   - state    ← the `**Current state:**` line value
 *   - percent  ← the leading number on the `**Percent completion:**` line (null if
 *                unparseable — NEVER a throw)
 *   - childSprints ← the bolded ids in the `## Related sprints` list
 *
 * Fail-soft, two tiers (AC-R1a / β-4):
 *   - PER-EPIC try/catch: a single malformed/renamed epic file degrades ONLY that
 *     epic — it is marked `{ id, parseError }` (kept, not silently vanished) so the
 *     other epics still render. ONE bad file NEVER blanks the area.
 *   - The whole-area error (-> caller adds "epics" to sectionsUnavailable[]) fires
 *     ONLY when the `trackers/epics/` directory itself is unreadable/absent.
 *   - A present-but-empty directory is a valid empty state (epics: [], NOT an error).
 */
function parseEpics(root) {
  try {
    const dir = path.join(root, "trackers", "epics");
    if (!fs.existsSync(dir)) {
      // A MISSING epics directory degrades the whole area to "section unavailable"
      // (distinct from a present-but-empty directory, which is a valid empty state).
      throw new Error("trackers/epics/ not found");
    }
    // readdirSync is a READ-ONLY fs verb (the v1 read-only source scan allows it).
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (e) {
      // An unreadable directory (e.g. EACCES / a file where a dir is expected) is a
      // whole-area degrade — re-thrown to the outer try/catch.
      throw new Error(`trackers/epics/ unreadable: ${e && e.message ? e.message : e}`);
    }
    const files = names
      .filter((n) => /\.md$/i.test(n))
      .sort();

    const epics = [];
    for (const name of files) {
      const file = path.join(dir, name);
      try {
        epics.push(parseOneEpic(file, name));
      } catch (e) {
        // PER-EPIC degrade: ONE bad file is marked, never blanks the area.
        epics.push({
          id: epicIdFromFilename(name),
          parseError: e && e.message ? e.message : String(e),
        });
      }
    }
    return { epics };
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
}

// Derive a stable id from an epic filename stem (e.g.
// "E-PRODUCT-FOUNDATION-001-product-foundation-seams.md" -> "E-PRODUCT-FOUNDATION-001").
function epicIdFromFilename(name) {
  const stem = String(name || "").replace(/\.md$/i, "");
  const m = /^(E-[A-Z0-9-]*?-\d+)\b/.exec(stem);
  return m ? m[1] : stem;
}

// Parse ONE epic file into { id, title, state, percent, childSprints[] }. Throws on
// a genuinely unreadable/malformed file so the caller marks just that epic.
function parseOneEpic(file, name) {
  const text = fs.readFileSync(file, "utf8");
  // A corrupt binary blob is a per-epic malformation.
  if (text.indexOf(NUL) !== -1) {
    throw new Error("epic file contains NUL bytes (corrupt)");
  }
  const lines = text.split(/\r?\n/);

  // id ← `**Epic label and number:**`, else the filename stem.
  const idLine = matchBoldField(lines, "Epic label and number");
  const id = (idLine && idLine.trim()) || epicIdFromFilename(name);

  // title ← `**Title:**`, else the first `# ` heading text, else the id.
  let title = matchBoldField(lines, "Title");
  if (!title) {
    for (const ln of lines) {
      const h = /^#\s+(.*\S)\s*$/.exec(ln);
      if (h) {
        title = h[1].trim();
        break;
      }
    }
  }
  title = (title && title.trim()) || id;

  // state ← `**Current state:**` (load-bearing — its absence is a per-epic error).
  const state = matchBoldField(lines, "Current state");
  if (!state || !state.trim()) {
    throw new Error("no `**Current state:**` line (renamed/removed)");
  }
  // Some epics' `**Current state:**` line runs on into a narrative paragraph; the
  // displayable/colorable STATE is just the leading token (e.g. "Active — EXECUTION
  // session 3 …" -> "Active"). Cut at the first narrative separator (spaced em/en-dash
  // or spaced hyphen, sentence-end, or newline) and cap length, so the epic card shows a
  // tidy status label AND the status-group→color mapping matches a known state keyword.
  const stateLabel = epicStateLabel(state);

  // percent ← leading number on `**Percent completion:**`. NEVER throws: an
  // unparseable/absent value degrades to null (evidence-over-invention).
  const percent = parsePercent(matchBoldField(lines, "Percent completion"));

  const childSprints = parseRelatedSprints(lines);

  return { id: id.trim(), title, state: stateLabel, percent, childSprints };
}

// epicStateLabel(raw) -> the leading status token of a `**Current state:**` value.
// Epic state lines sometimes run on into a paragraph; the label is the part before the
// first narrative separator (spaced em/en-dash or hyphen, sentence-end, or newline),
// length-capped. Pure + total: a short token passes through unchanged.
function epicStateLabel(raw) {
  let s = String(raw || "").trim();
  const cut = s.search(/\s[—–-]\s|\.\s|\n/);
  if (cut !== -1) s = s.slice(0, cut).trim();
  if (s.length > 60) s = s.slice(0, 57).trimEnd() + "…";
  return s;
}

/**
 * matchBoldField(lines, label) -> string | null
 * Finds a `- **<label>:** <value>` (or `**<label>:** <value>`) line and returns
 * the trimmed value. Tolerant of a leading list bullet and surrounding whitespace.
 */
function matchBoldField(lines, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*(?:[-*]\\s*)?\\*\\*\\s*${esc}\\s*:\\*\\*\\s*(.*)$`, "i");
  for (const ln of lines) {
    const m = re.exec(ln);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * parsePercent(value) -> number | null
 * Extracts the FIRST number from a percent-completion value (e.g. "~99% — …" -> 99,
 * "0% — …" -> 0, "100%" -> 100). Returns null when no number is present — never
 * throws, never invents a value.
 */
function parsePercent(value) {
  if (value == null) return null;
  const m = /(\d+(?:\.\d+)?)/.exec(String(value));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * parseRelatedSprints(lines) -> [id, …]
 * Collects the sprint ids listed under the `## Related sprints` heading. Each row is
 * a list item whose id is the FIRST bolded token (e.g. `- **S-PF-01** — …`); rows
 * with a plain leading token (e.g. `- SP-20260512-001 — …`) are also tolerated. A
 * "None currently recorded." placeholder yields an empty list. Stops at the next
 * `##`/`#` heading. Never throws (an absent section is just an empty list).
 */
function parseRelatedSprints(lines) {
  let i = 0;
  for (; i < lines.length; i++) {
    if (/^##\s+Related sprints\s*$/i.test(lines[i].trim())) break;
  }
  if (i >= lines.length) return [];

  const ids = [];
  for (let j = i + 1; j < lines.length; j++) {
    const ln = lines[j];
    if (/^#{1,2}\s+\S/.test(ln)) break; // next heading terminates the section
    const trimmed = ln.trim();
    if (!trimmed) continue;
    if (/^[-*]\s+/.test(trimmed)) {
      const body = trimmed.replace(/^[-*]\s+/, "");
      // Prefer the first **bolded** token; else the first whitespace-delimited token.
      const bold = /^\*\*\s*([^*]+?)\s*\*\*/.exec(body);
      const tokenSrc = bold ? bold[1] : body.split(/\s+/)[0];
      const id = (tokenSrc || "").trim();
      if (id && !/^none\b/i.test(id)) ids.push(id);
    }
  }
  return ids;
}

// ── Source 6: per-sprint ticket breakdown — sprints/<id>/current.yaml ─────────
/**
 * parseSprintBreakdown(root, sprintIds) -> { byId: { <id>: <breakdown> } }
 *
 * For each in-flight sprint id, read `.claude/project/sprint/sprints/<id>/current.yaml`
 * and derive the ticket breakdown from its `tickets:` state-column map:
 *   { id, byState: { done[], in_progress[], in_review[], blocked[], … },
 *     counts: { <state>: n, … }, total }
 *
 * Fail-soft PER SPRINT (AC-R1b / β-4): a missing/unparseable record degrades to
 *   { id, breakdownUnavailable: true, reason }
 * for THAT one sprint — it never throws and never blanks the other sprints. There
 * is no whole-area error: an empty id list simply yields an empty map.
 */
function parseSprintBreakdown(root, sprintIds) {
  const byId = {};
  const ids = Array.isArray(sprintIds) ? sprintIds : [];
  for (const id of ids) {
    if (!id) continue;
    try {
      const file = path.join(
        root,
        ".claude",
        "project",
        "sprint",
        "sprints",
        id,
        "current.yaml",
      );
      if (!fs.existsSync(file)) {
        byId[id] = { id, breakdownUnavailable: true, reason: "current.yaml not found" };
        continue;
      }
      const text = fs.readFileSync(file, "utf8");
      if (text.indexOf(NUL) !== -1) {
        byId[id] = { id, breakdownUnavailable: true, reason: "current.yaml contains NUL bytes (corrupt)" };
        continue;
      }
      byId[id] = parseTicketsMap(id, text);
    } catch (e) {
      byId[id] = {
        id,
        breakdownUnavailable: true,
        reason: e && e.message ? e.message : String(e),
      };
    }
  }
  return { byId };
}

/**
 * parseTicketsMap(id, text) -> { id, byState, counts, total }
 * Minimal dependency-free reader of the `tickets:` block in a current.yaml: each
 * state key (`done:`/`in_progress:`/…) maps to either an inline `[]` (empty) or a
 * following indented `- <ticket>` list. Throws (caught per-sprint) on a structurally
 * corrupt YAML the line scanner would otherwise mis-read.
 */
function parseTicketsMap(id, text) {
  // Reuse the structural guard so a corrupt record degrades that sprint, rather
  // than silently parsing to an empty breakdown.
  assertYamlNotCorrupt(text);

  const lines = text.split(/\r?\n/);
  // Locate the top-level `tickets:` key (no leading indent).
  let start = -1;
  let ticketsIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)tickets:\s*$/.exec(lines[i]);
    if (m) {
      start = i;
      ticketsIndent = m[1].length;
      break;
    }
  }
  if (start === -1) {
    throw new Error("no `tickets:` block in current.yaml");
  }

  const byState = {};
  let curState = null;
  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const indent = raw.length - raw.replace(/^\s+/, "").length;
    // A sibling/parent key at or below `tickets:` indent ends the block.
    if (indent <= ticketsIndent && /^\s*\S/.test(raw)) break;

    // A `  <state>:` key (optionally with an inline `[]`).
    const keyM = /^\s*([A-Za-z_][\w-]*):\s*(\[\s*\])?\s*$/.exec(raw);
    if (keyM && indent === ticketsIndent + 2) {
      curState = keyM[1];
      byState[curState] = [];
      continue;
    }
    // A `    - <ticket>` list item belongs to the current state column.
    const itemM = /^\s*-\s*(.+?)\s*$/.exec(raw);
    if (itemM && curState && indent > ticketsIndent + 2) {
      byState[curState].push(stripYamlScalar(itemM[1]));
      continue;
    }
  }

  const counts = {};
  let total = 0;
  for (const k of Object.keys(byState)) {
    counts[k] = byState[k].length;
    total += byState[k].length;
  }
  return { id, byState, counts, total };
}

// ── Board assembly ───────────────────────────────────────────────────────────

function buildBoard(root) {
  const active = parseActiveSprints(root);
  // The set of in-flight sprint ids the v1 board already computes — sprintBreakdown
  // keys on exactly this set (AC-R1b), so the two areas stay consistent.
  const inFlightIds = active.error ? [] : inFlight(active.sprints).map((s) => s.id);
  return {
    root,
    generatedAt: new Date().toISOString(),
    roadmap: parseRoadmap(root),
    tracker: parseTracker(root),
    active,
    gaps: parseGaps(root),
    epics: parseEpics(root),
    sprintBreakdown: parseSprintBreakdown(root, inFlightIds),
  };
}

function renderMarkdown(b) {
  const out = [];
  out.push("# What's next — roadmap board");
  out.push("");
  out.push("_Read-only, regenerated at a glance from the live sources. Not editable here._");
  out.push("");

  // ── NEXT ACTION ────────────────────────────────────────────────────────────
  out.push("## NEXT ACTION");
  if (b.tracker.error) {
    out.push(unavailable(b.tracker.error));
  } else {
    // Strip a leading "NEXT ACTION (parenthetical) =" / "NEXT ACTION:" prefix for
    // a clean headline; fall back to the raw span if stripping empties it.
    const headline =
      b.tracker.nextAction
        .replace(/^NEXT ACTION\b\s*(\([^)]*\))?\s*[:=]?\s*/i, "")
        .replace(/^the\s+/i, "")
        .trim() || b.tracker.nextAction;
    out.push(`> **${headline}**`);
    out.push("");
    out.push("_(source: TRACKER.md -> Current Highest-Priority Next Action)_");
  }
  out.push("");

  // ── Ranked next (Prioritized) ───────────────────────────────────────────────
  out.push("## Ranked next (Prioritized)");
  if (b.roadmap.error) {
    out.push(unavailable(b.roadmap.error));
  } else {
    for (const r of b.roadmap.ranked) {
      out.push(`${r.n}. ${r.text}`);
    }
    out.push("");
    const pq = b.roadmap.hasPickupQueue
      ? "Sprint Pickup Queue: present"
      : "Sprint Pickup Queue: not found";
    out.push(`_(source: ROADMAP.md -> Prioritized order · ${pq})_`);
  }
  out.push("");

  // ── In flight ───────────────────────────────────────────────────────────────
  out.push("## In flight");
  if (b.active.error) {
    out.push(unavailable(b.active.error));
  } else {
    const live = inFlight(b.active.sprints);
    if (live.length === 0) {
      out.push("_None in flight._");
    } else {
      // The operator opens this to see "what's MOVING now", not 40 stale rows.
      // Show: the primary (current focus) first, then the truly-actively-executing
      // sprints up to a small cap, then a one-line summary of everything else
      // (with how many of those are stale `planning`).
      const primaryRow = b.active.primary
        ? live.find((s) => s.id === b.active.primary)
        : null;
      if (primaryRow) {
        out.push(`- \`${primaryRow.id}\` — **${primaryRow.status}** (primary)`);
      }
      const rest = live.filter((s) => !primaryRow || s.id !== primaryRow.id);
      const active = rest.filter(isActivelyExecuting);
      const CAP = 8;
      for (const s of active.slice(0, CAP)) {
        out.push(`- \`${s.id}\` — **${s.status}**`);
      }
      const shown = active.slice(0, CAP).length;
      const remaining = rest.length - shown; // everything in-flight not yet listed
      if (remaining > 0) {
        const stale = rest.filter(isStalePlanning).length;
        const staleNote = stale > 0 ? ` (${stale} stale planning)` : "";
        out.push(`- …and ${remaining} more in-flight${staleNote}`);
      }
    }
    out.push("");
    out.push("_(source: .claude/project/sprint/active-sprints.yaml)_");
  }
  out.push("");

  // ── Open gaps / blockers ────────────────────────────────────────────────────
  out.push("## Open gaps / blockers");
  if (b.gaps.error) {
    out.push(unavailable(b.gaps.error));
  } else {
    const { debt, issues } = b.gaps;
    out.push(`- Enforcement debt (open): **${debt.count}**`);
    for (const d of debt.items.slice(0, 8)) {
      out.push(`  - \`${d.id || "?"}\` — ${truncate(d.label, 90)}`);
    }
    if (debt.count > 8) out.push(`  - …and ${debt.count - 8} more`);
    out.push(`- Recurring issues (open): **${issues.count}**`);
    for (const it of issues.items.slice(0, 8)) {
      out.push(`  - \`${it.id || "?"}\` — ${truncate(it.label, 90)}`);
    }
    if (issues.count > 8) out.push(`  - …and ${issues.count - 8} more`);
    out.push("");
    out.push("_(source: enforcement-debt.jsonl + recurring-issues.jsonl)_");
  }
  out.push("");

  return out.join("\n");
}

function truncate(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function toJsonSummary(b) {
  return {
    generatedAt: b.generatedAt,
    root: b.root,
    nextAction: b.tracker.error ? null : b.tracker.nextAction,
    nextActionAvailable: !b.tracker.error,
    ranked: b.roadmap.error ? [] : b.roadmap.ranked,
    rankedAvailable: !b.roadmap.error,
    hasPickupQueue: b.roadmap.error ? null : !!b.roadmap.hasPickupQueue,
    inFlight: b.active.error ? [] : inFlight(b.active.sprints),
    inFlightAvailable: !b.active.error,
    activelyExecuting: b.active.error
      ? []
      : inFlight(b.active.sprints).filter(isActivelyExecuting),
    stalePlanningCount: b.active.error
      ? 0
      : inFlight(b.active.sprints).filter(isStalePlanning).length,
    primary: b.active.error ? null : b.active.primary || null,
    gaps: b.gaps.error
      ? null
      : {
          enforcementDebtOpen: b.gaps.debt.count,
          recurringIssuesOpen: b.gaps.issues.count,
        },
    gapsAvailable: !b.gaps.error,
    // ── NEW area: epics (AC-R1a) ──────────────────────────────────────────────
    // A whole-area error -> []; otherwise the per-epic array (which may itself carry
    // {parseError} markers for individually-bad files, never blanking the area).
    epics: b.epics.error ? [] : b.epics.epics,
    epicsAvailable: !b.epics.error,
    // ── NEW area: sprintBreakdown (AC-R1b) ────────────────────────────────────
    // Per-in-flight-sprint ticket breakdown map (each entry may be a healthy
    // breakdown or a {breakdownUnavailable} marker for that one sprint).
    sprintBreakdown: b.sprintBreakdown.byId,
    sectionsUnavailable: [
      b.tracker.error ? "nextAction" : null,
      b.roadmap.error ? "ranked" : null,
      b.active.error ? "inFlight" : null,
      b.gaps.error ? "gaps" : null,
      // "epics" is added ONLY when the whole trackers/epics/ area is
      // unreadable/absent — a single bad epic file does NOT add it (AC-R1a).
      b.epics.error ? "epics" : null,
    ].filter(Boolean),
  };
}

// ── Public API + CLI ─────────────────────────────────────────────────────────

/**
 * generate(opts?) -> { markdown, summary, board }
 * Pure, side-effect-free assembly — no writes. opts.root overrides the source root.
 */
function generate(opts) {
  const root = opts && opts.root ? path.resolve(opts.root) : DEFAULT_ROOT;
  const board = buildBoard(root);
  return {
    markdown: renderMarkdown(board),
    summary: toJsonSummary(board),
    board,
  };
}

function main(argv) {
  const root = resolveRoot(argv);
  const asJson = argv.includes("--json");
  // Whole-run guard: even an unforeseen assembly bug must not crash the board.
  let result;
  try {
    const board = buildBoard(root);
    result = asJson
      ? JSON.stringify(toJsonSummary(board), null, 2)
      : renderMarkdown(board);
  } catch (e) {
    // Last-resort fail-soft: a legible degraded board, still exit 0.
    const msg = String(e && e.message ? e.message : e);
    result = asJson
      ? JSON.stringify({ error: msg, sectionsUnavailable: ["all"] }, null, 2)
      : `# What's next — roadmap board\n\n${unavailable(msg)}\n`;
  }
  process.stdout.write(result + "\n");
  process.exit(0); // read-only board: always 0
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  generate,
  buildBoard,
  renderMarkdown,
  toJsonSummary,
  parseRoadmap,
  parseTracker,
  parseActiveSprints,
  parseGaps,
  parseEpics,
  parseSprintBreakdown,
  inFlight,
  isActivelyExecuting,
  isStalePlanning,
  assertYamlNotCorrupt,
  unavailable,
  DEFAULT_ROOT,
};
