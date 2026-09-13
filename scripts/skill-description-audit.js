#!/usr/bin/env node

/**
 * skill-description-audit.js — Audit skill metadata for ranker quality.
 *
 * Per AC-7.1 / AC-7.2 / AC-7.3 (SP-20260513-003):
 *   - Walks paths.commands and inspects frontmatter on every *.md.
 *   - Emits runtime/notes/skill-description-audit.md with a per-skill verdict.
 *   - Verdicts: `ok` / `flag-tag-missing` / `flag-description-missing` /
 *               `flag-description-ambiguous`
 *   - Critical flags = description-missing or description-ambiguous.
 *   - Deterministic: same input ⇒ same output (sorted by slug; report header
 *     records mtimes but not run-time).
 *
 * Ambiguity heuristic (intentionally conservative — false-positives are
 * cheaper than false-negatives at ranker time):
 *   - Description text < 8 words
 *   - Description text >= 2 sentences with no leading short one-liner
 *   - Description text starts with a stop-pattern like "TODO" / "deprecated"
 *
 * Re-runnable. Exits 0 even if criticals are found — sprint workflow decides
 * what to do with the report. Use --strict to exit 1 on criticals.
 */

"use strict";
const mcEnv = require("./hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const fs = require("fs");
const path = require("path");

const PROJECT =
  process.env.CLAUDE_PROJECT_DIR ||
  mcEnv.readEnv("PROJECT_DIR") ||
  process.cwd();
const PATHS = JSON.parse(
  fs.readFileSync(path.join(PROJECT, ".claude", "paths.json"), "utf8"),
);
const COMMANDS_DIR = path.join(PROJECT, PATHS.commands || ".claude/commands");
const OUTPUT_DIR = path.join(PROJECT, "runtime", "notes");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "skill-description-audit.md");

// ── Frontmatter parser (same logic as generate-skill-catalog.js) ────

function parseFrontmatter(text) {
  if (!text.startsWith("---")) return {};
  const close = text.indexOf("\n---", 3);
  if (close === -1) return {};
  const block = text.slice(3, close).trim();
  const fm = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_-][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let value = m[2].trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    } else if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else if (value === "true") value = true;
    else if (value === "false") value = false;
    fm[key] = value;
  }
  return fm;
}

function walk(dir, rel = "") {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const r = path.posix.join(rel, e.name);
    if (e.isDirectory()) out.push(...walk(full, r));
    else if (e.isFile() && e.name.endsWith(".md")) out.push({ full, rel: r });
  }
  return out;
}

function slugFromRel(rel) {
  return rel.replace(/\.md$/i, "").replace(/\//g, ":");
}

// ── Verdict heuristics ──────────────────────────────────

const STOP_LEADERS = [
  /^TODO\b/i,
  /^DEPRECATED\b/i,
  /^STUB\b/i,
  /^placeholder\b/i,
];

function classify(description, tags) {
  const flags = [];
  if (!description || description.trim().length === 0) {
    flags.push("flag-description-missing");
  } else {
    const desc = description.trim();
    const wordCount = desc.split(/\s+/).filter(Boolean).length;
    const sentenceCount = desc.split(/[.!?]\s+/).filter(Boolean).length;
    const firstSentence = desc.split(/[.!?]/)[0] || "";
    const leadingWords = firstSentence.trim().split(/\s+/).length;
    const startsWithStop = STOP_LEADERS.some((rx) => rx.test(desc));

    if (wordCount < 8) flags.push("flag-description-ambiguous");
    else if (sentenceCount >= 2 && leadingWords < 5)
      flags.push("flag-description-ambiguous");
    else if (startsWithStop) flags.push("flag-description-ambiguous");
  }
  if (!tags || tags.length === 0) flags.push("flag-tag-missing");
  return flags.length === 0 ? ["ok"] : flags;
}

// ── Main ────────────────────────────────────────────────

function main() {
  const strict = process.argv.includes("--strict");
  const files = walk(COMMANDS_DIR);
  files.sort((a, b) => a.rel.localeCompare(b.rel));

  const rows = [];
  let criticals = 0;
  let tagOnly = 0;
  let ok = 0;

  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(f.full, "utf8");
    } catch {
      continue;
    }
    const fm = parseFrontmatter(text);
    const slug = slugFromRel(f.rel);
    const desc = (fm.description || "").trim();
    const tags = Array.isArray(fm.tags)
      ? fm.tags
      : typeof fm.tags === "string"
        ? fm.tags.split(/[\s,]+/).filter(Boolean)
        : [];
    // Treat namespace as an implicit tag for the "no tag" check; we still
    // surface explicit `tags:` field absence as `flag-tag-missing` per AC.
    const verdicts = classify(desc, fm.tags ? tags : []);
    rows.push({ slug, description: desc, tags, verdicts });
    if (
      verdicts.includes("flag-description-missing") ||
      verdicts.includes("flag-description-ambiguous")
    ) {
      criticals++;
    } else if (verdicts.includes("flag-tag-missing")) {
      tagOnly++;
    } else {
      ok++;
    }
  }

  // ── Render markdown ───────────────────────────────────

  const lines = [];
  lines.push("# Skill description audit");
  lines.push("");
  lines.push(
    "Generated by `scripts/skill-description-audit.js` (re-runnable; deterministic).",
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Scanned: ${rows.length}`);
  lines.push(`- ok: ${ok}`);
  lines.push(`- flag-tag-missing only: ${tagOnly}`);
  lines.push(`- critical (description-missing or -ambiguous): ${criticals}`);
  lines.push("");
  lines.push("## Per-skill verdicts");
  lines.push("");
  lines.push("| Slug | Verdict | Description (first 100 chars) |");
  lines.push("|---|---|---|");
  for (const r of rows) {
    const verdict = r.verdicts.join(" / ");
    const desc = r.description
      ? r.description.replace(/\|/g, "\\|").slice(0, 100)
      : "_(missing)_";
    lines.push(`| \`${r.slug}\` | ${verdict} | ${desc} |`);
  }
  lines.push("");
  if (criticals > 0) {
    lines.push("## Critical follow-ups");
    lines.push("");
    lines.push(
      "These skills MUST be fixed inline this sprint per AC-7.2 (zero criticals at sprint end).",
    );
    lines.push("");
    for (const r of rows) {
      if (
        r.verdicts.includes("flag-description-missing") ||
        r.verdicts.includes("flag-description-ambiguous")
      ) {
        lines.push(`- \`${r.slug}\` — ${r.verdicts.join(", ")}`);
      }
    }
    lines.push("");
  }

  try {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
  fs.writeFileSync(OUTPUT_FILE, lines.join("\n") + "\n", "utf8");
  console.log(
    `[skill-description-audit] wrote ${OUTPUT_FILE} — scanned=${rows.length} ok=${ok} tag-only=${tagOnly} critical=${criticals}`,
  );
  if (strict && criticals > 0) process.exit(1);
}

main();
