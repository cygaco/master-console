#!/usr/bin/env node
"use strict";

/**
 * scripts/epic/lib.js — shared, PURE helpers for the `/epic:*` backing logic
 * (S-LC-09, Wave 3 of E-LIFECYCLE-001). NO fs, NO cwd — every function here is
 * total + deterministic so the regression suite can bite-test it on synthetic
 * input. `scripts/epic/plan.js` and `scripts/epic/fold.js` are the thin
 * read-before-write CLIs that wrap these.
 *
 * Section parsing is single-sourced from the tracker validator
 * (`scripts/trackers/validate.js#splitSections`) so an epic file this suite
 * EMITS is parsed by the same code the validator uses to JUDGE it — no
 * second, drifting parser.
 */

const path = require("path");
// Single source of truth for markdown section splitting (the validator's parser).
const { splitSections } = require(path.join(__dirname, "..", "trackers", "validate.js"));

// ── Epic-file shape (matches trackers/templates/EPIC_TEMPLATE.md + the
//    E-LIFECYCLE-001 epic file the brief names as the OUTPUT TARGET) ──────────

// The 10 lead-block frontmatter bullets every epic file must carry.
const EPIC_FRONTMATTER_FIELDS = [
  "Epic label and number",
  "Title",
  "Owner",
  "Parent roadmap area",
  "Goal",
  "Background",
  "Scope",
  "Out of scope",
  "Current state",
  "Percent completion",
];

// The 14 H2 sections (in spec order) every epic file must carry, each non-empty.
const EPIC_H2_SECTIONS = [
  "Definition of Done",
  "Related definitions",
  "Related sprints",
  "Dependencies",
  "Blockers",
  "Risks",
  "Decisions",
  "Open questions",
  "Session log",
  "Change log",
  "Evidence log",
  "Verification log",
  "Current next action",
  "Completion record",
];

// ── Fold taxonomy — the 14 classifications (source prompt §G `/epic:fold`,
//    `_planning/ingest/mc-lifecycle.md` lines 970-984) ─────────────────────
const FOLD_CLASSES = [
  "clarification",
  "scope-addition",
  "scope-reduction",
  "acceptance-criterion",
  "constraint",
  "risk",
  "dependency",
  "sprint-candidate",
  "tracker-correction",
  "open-question",
  "user-preference",
  "enforcement-requirement",
  "blast-radius-finding",
  "compatibility-warning",
];

// Keyword cues for a best-effort classifier. The /epic:fold SKILL body does the
// real reasoning and passes `type` explicitly; this heuristic is the deterministic
// fallback when no `type` is supplied. Ordered most-specific → least so the first
// match wins. Each class still appears in FOLD_CLASSES even if it has no cue.
const FOLD_CUES = [
  ["scope-reduction", /\b(remove|drop|de-?scope|cut|no longer|descope|out of scope|reduce scope)\b/i],
  ["scope-addition", /\b(add|also build|new feature|additionally|include|extend to|new scope)\b/i],
  ["acceptance-criterion", /\b(acceptance criteri|must (?:pass|satisfy)|done when|definition of done|AC[: ]|proven by)\b/i],
  ["enforcement-requirement", /\b(enforce|enforcer|gate|guard|validator|must block|fail-closed)\b/i],
  ["blast-radius-finding", /\b(blast.?radius|breaks?\b|affects every|hot path|fires on every)\b/i],
  ["compatibility-warning", /\b(incompatib|conflicts with|backward[- ]compat|breaking change|version mismatch)\b/i],
  ["dependency", /\b(depends on|dependenc|requires (?:that|the)|blocked by|prerequisite)\b/i],
  ["constraint", /\b(constrain|must not|cannot|limit|budget|deadline|only allowed|restricted)\b/i],
  ["risk", /\b(risk|danger|might fail|could break|hazard|threat)\b/i],
  ["sprint-candidate", /\b(sprint|S-[A-Z]{2}-\d|new sprint|break into a sprint)\b/i],
  ["tracker-correction", /\b(tracker (?:is )?wrong|correct the tracker|drift|mis-?recorded|stale state|reconcile)\b/i],
  ["open-question", /\b(open question|unclear|undecided|tbd|to be decided|\?$)\b/i],
  ["user-preference", /\b(prefer|taste|i (?:want|like)|style|opinion|rather than)\b/i],
  ["clarification", /\b(clarif|to be clear|i mean|in other words|just to confirm|actually)\b/i],
];

/** kebab-case slugify for filenames (lowercased, alnum + single dashes). */
function slugify(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Epic IDs look like `E-LIFECYCLE-001` / `E-MC-READINESS-001` — `E-` + WORD- segments + a ≥2-digit number. */
function isValidEpicId(id) {
  return /^E-(?:[A-Z0-9]+-)*[0-9]{2,}$/.test(String(id || ""));
}

/** Stable epic ID from a filename (mirrors validate.js#epicIdFromFilename). */
function epicIdFromFilename(name) {
  const base = String(name || "").replace(/\.md$/i, "");
  const m = /^E-(?:[A-Za-z0-9]+-)*[0-9]{2,}/.exec(base);
  return m ? m[0] : "";
}

/** Heuristic fold classification; deterministic, total. Defaults to "clarification". */
function classifyFold(text) {
  const t = String(text == null ? "" : text);
  for (const [cls, re] of FOLD_CUES) {
    if (re.test(t)) return cls;
  }
  return "clarification";
}

/**
 * Verify a produced (or any) epic markdown carries the full required shape:
 * the H1 title, all 10 frontmatter bullets, and all 14 non-empty H2 sections.
 * PURE + total — returns { ok, missing[], blank[] }, never throws.
 *
 * This is the section-completeness contract the brief names as the acceptable
 * proof of a "validate-passing" epic file (the tracker validator lints
 * TRACKER.md, not an epic file body — so an epic file's own correctness IS its
 * section-completeness + a resolvable tracker linkage).
 */
function verifyEpicMarkdown(md) {
  const text = String(md == null ? "" : md);
  const missing = [];
  const blank = [];

  // H1 title line.
  if (!/^#\s+\S+/m.test(text)) missing.push("H1 title");

  // Lead-block frontmatter bullets `- **<Field>:**`.
  for (const field of EPIC_FRONTMATTER_FIELDS) {
    const re = new RegExp(`^\\s*-\\s*\\*\\*${escapeRe(field)}\\s*:\\*\\*`, "im");
    if (!re.test(text)) missing.push(`frontmatter: ${field}`);
  }

  // H2 sections, each present AND non-empty.
  const sections = splitSections(text, 2).filter((s) => s.level === 2);
  const byName = new Map(sections.map((s) => [s.headingText, s]));
  for (const name of EPIC_H2_SECTIONS) {
    const hit = sections.find((s) => s.headingText === name.toLowerCase());
    if (!hit) {
      missing.push(`section: ${name}`);
      continue;
    }
    if (!hit.body || !hit.body.trim()) blank.push(name);
  }
  void byName;

  return { ok: missing.length === 0 && blank.length === 0, missing, blank };
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  EPIC_FRONTMATTER_FIELDS,
  EPIC_H2_SECTIONS,
  FOLD_CLASSES,
  FOLD_CUES,
  slugify,
  isValidEpicId,
  epicIdFromFilename,
  classifyFold,
  verifyEpicMarkdown,
  escapeRe,
  splitSections,
};
