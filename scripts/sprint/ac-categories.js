#!/usr/bin/env node
"use strict";

const AC_CATEGORIES = Object.freeze([
  "correct mode selection",
  "correct mode switching",
  "correct team teardown",
  "correct team creation",
  "correct team verification",
  "correct lifecycle-hook firing",
  "correct hook ordering",
  "correct agent dispatch",
  "correct sprint/epic binding",
  "correct tracker linkage",
  "correct planning-artifact persistence",
  "correct provider readiness",
  "correct safety gates",
  "correct test strategy",
  "correct fixture/holdout coverage",
  "correct review requirements",
  "correct completion proof",
  "correct user-approval points",
  "correct learning/persistence capture",
  "correct blast-radius analysis",
]);

const CATEGORY_SECTION_HEADING =
  "Enforcement-criteria coverage — 20 categories";

const CHECKLIST_MARKER_OPEN = "<!-- ac-categories:checklist (auto) -->";
const CHECKLIST_MARKER_CLOSE = "<!-- /ac-categories:checklist -->";

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripCategoryChecklist(md) {
  if (md == null) return md;
  const re = new RegExp(
    `\\n*${escapeRegExp(CHECKLIST_MARKER_OPEN)}[\\s\\S]*?${escapeRegExp(
      CHECKLIST_MARKER_CLOSE,
    )}[ \\t]*\\n?`,
    "g",
  );
  return String(md).replace(re, "\n").replace(/\n{3,}/g, "\n\n");
}

function categoryChecklistMarkdown(opts = {}) {
  const level = Number.isInteger(opts.headingLevel) ? opts.headingLevel : 3;
  const hashes = "#".repeat(Math.min(Math.max(level, 1), 6));
  const stub = opts.proofPlaceholder || "TODO";
  const rows = AC_CATEGORIES.map(
    (cat) => `- [ ] **${cat}** — proof: ${stub}`,
  ).join("\n");
  return `${CHECKLIST_MARKER_OPEN}
${hashes} ${CATEGORY_SECTION_HEADING}

Every category below needs AC + a **proof** — a planted fixture that must fail, a
real record (run_id + elapsed/bytes), a green/blocked exit code, or a captured
event sequence (proof standard). Replace each \`proof: ${stub}\` with the
real proof; a bare \`proof: ${stub}\` stub is "named but unproven" and is FLAGGED
(report-only) by \`/scan:ac-coverage --categories\`. Single source for this list:
\`scripts/sprint/ac-categories.js\` (${AC_CATEGORIES.length} categories).

${rows}
${CHECKLIST_MARKER_CLOSE}`;
}

module.exports = {
  AC_CATEGORIES,
  CATEGORY_SECTION_HEADING,
  CHECKLIST_MARKER_OPEN,
  CHECKLIST_MARKER_CLOSE,
  categoryChecklistMarkdown,
  stripCategoryChecklist,
};

if (require.main === module && process.argv.includes("--selftest")) {
  const assert = require("assert");
  assert.strictEqual(AC_CATEGORIES.length, 20, "must be exactly 20 categories");
  assert.strictEqual(
    new Set(AC_CATEGORIES).size,
    20,
    "no duplicate categories",
  );
  const md = categoryChecklistMarkdown();
  for (const cat of AC_CATEGORIES) {
    assert.ok(md.includes(`**${cat}**`), `checklist names "${cat}"`);
  }
  assert.strictEqual(md, categoryChecklistMarkdown(), "render is deterministic");
  assert.ok(md.includes(CHECKLIST_MARKER_OPEN), "checklist carries the OPEN marker");
  assert.ok(md.includes(CHECKLIST_MARKER_CLOSE), "checklist carries the CLOSE marker");
  const stripped = stripCategoryChecklist(`before\n\n${md}\n\nafter`);
  assert.ok(!stripped.includes(CHECKLIST_MARKER_OPEN), "strip removes the checklist block");
  assert.ok(
    stripped.includes("before") && stripped.includes("after"),
    "strip preserves surrounding text",
  );
  assert.strictEqual(
    stripCategoryChecklist(`x\n\n${md}\n\n${md}\n\ny`).match(/<!-- ac-categories:checklist/g),
    null,
    "strip removes EVERY marker block (dedup-before-render)",
  );
  process.stdout.write(
    `ac-categories selftest: ${AC_CATEGORIES.length} categories, checklist renders all, deterministic, marker-wrapped + strippable — OK\n`,
  );
  process.exit(0);
}
