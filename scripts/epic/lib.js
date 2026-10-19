#!/usr/bin/env node
"use strict";

const path = require("path");
const { splitSections } = require(path.join(__dirname, "..", "trackers", "validate.js"));

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

function slugify(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function isValidEpicId(id) {
  return /^E-(?:[A-Z0-9]+-)*[0-9]{2,}$/.test(String(id || ""));
}

function epicIdFromFilename(name) {
  const base = String(name || "").replace(/\.md$/i, "");
  const m = /^E-(?:[A-Za-z0-9]+-)*[0-9]{2,}/.exec(base);
  return m ? m[0] : "";
}

function classifyFold(text) {
  const t = String(text == null ? "" : text);
  for (const [cls, re] of FOLD_CUES) {
    if (re.test(t)) return cls;
  }
  return "clarification";
}

function verifyEpicMarkdown(md) {
  const text = String(md == null ? "" : md);
  const missing = [];
  const blank = [];

  if (!/^#\s+\S+/m.test(text)) missing.push("H1 title");

  for (const field of EPIC_FRONTMATTER_FIELDS) {
    const re = new RegExp(`^\\s*-\\s*\\*\\*${escapeRe(field)}\\s*:\\*\\*`, "im");
    if (!re.test(text)) missing.push(`frontmatter: ${field}`);
  }

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
