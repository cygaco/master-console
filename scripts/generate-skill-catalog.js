#!/usr/bin/env node

/**
 * generate-skill-catalog.js — Generate a compact JSON index of every
 * user-invocable slash command under paths.commands.
 *
 * Consumed by scripts/hooks/smart-context.js (skill-ranker responsibility).
 * Produces paths.skillCatalog atomically (temp-then-rename).
 *
 * Per IN-4 / IN-6 (SP-20260513-003):
 *   - Each entry: { id, slug, description, tags, location, namespace, user_invocable, mtime }
 *   - Size cap: CATALOG_MAX_ENTRIES (truncation by recency-then-alphabetical)
 *   - Excludes: any frontmatter `user-invocable: false`
 *   - Atomic write so a partial regen never breaks the ranker
 *
 * Usage:
 *   node scripts/generate-skill-catalog.js            # default — write paths.skillCatalog
 *   node scripts/generate-skill-catalog.js --json     # print JSON to stdout, no write
 *   node scripts/generate-skill-catalog.js --verbose  # log per-file decisions
 */

"use strict";
const mcEnv = require("./hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const fs = require("fs");
const path = require("path");

// ── Resolve project + paths ─────────────────────────────

const PROJECT =
  process.env.CLAUDE_PROJECT_DIR ||
  mcEnv.readEnv("PROJECT_DIR") ||
  process.cwd();

const PATHS_FILE = path.join(PROJECT, ".claude", "paths.json");

function loadPaths() {
  try {
    const raw = fs.readFileSync(PATHS_FILE, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    console.error(
      `[generate-skill-catalog] FATAL: cannot read paths.json: ${e.message}`,
    );
    process.exit(1);
  }
}

const PATHS = loadPaths();
const COMMANDS_DIR = path.join(PROJECT, PATHS.commands || ".claude/commands");
const CATALOG_PATH = path.join(
  PROJECT,
  PATHS.skillCatalog || ".claude/runtime/skill-catalog.json",
);

// ── Defaults ────────────────────────────────────────────

// Cap entries to keep ranker input cheap. At ~40 tokens/entry, 150 entries ≈ 6K tokens.
// Default 150 leaves headroom above the current 124-skill count.
const MAX_ENTRIES = parseInt(process.env.CATALOG_MAX_ENTRIES || "150", 10);
const MAX_DESCRIPTION = 280; // hard cap per entry to keep token budget predictable

// ── Frontmatter parser ──────────────────────────────────

/**
 * Parse YAML frontmatter from the head of a markdown file.
 * Supports simple `key: value` and one-line list `key: [a, b]` forms.
 * Returns { frontmatter, body } where frontmatter is a plain object.
 */
function parseFrontmatter(text) {
  if (!text.startsWith("---")) return { frontmatter: {}, body: text };
  const close = text.indexOf("\n---", 3);
  if (close === -1) return { frontmatter: {}, body: text };
  const block = text.slice(3, close).trim();
  const body = text.slice(close + 4).replace(/^\r?\n/, "");

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
    } else if (value === "true") {
      value = true;
    } else if (value === "false") {
      value = false;
    }
    fm[key] = value;
  }
  return { frontmatter: fm, body };
}

// ── Walk skill directory ────────────────────────────────

function walkSkills(dir, rel = "") {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const relPath = path.posix.join(rel, e.name);
    if (e.isDirectory()) {
      out.push(...walkSkills(full, relPath));
    } else if (e.isFile() && e.name.endsWith(".md")) {
      out.push({ full, rel: relPath });
    }
  }
  return out;
}

// ── Build a catalog entry ───────────────────────────────

function slugFromRel(relPath) {
  // ".claude/commands/scan/patterns.md" → "scan:patterns"
  // (relPath is already relative to COMMANDS_DIR)
  return relPath.replace(/\.md$/i, "").replace(/\//g, ":");
}

function namespaceFromSlug(slug) {
  const idx = slug.indexOf(":");
  return idx > 0 ? slug.slice(0, idx) : slug;
}

function entryFromFile(file) {
  let text;
  try {
    text = fs.readFileSync(file.full, "utf8");
  } catch {
    return null;
  }
  const { frontmatter } = parseFrontmatter(text);
  const slug = slugFromRel(file.rel);
  const namespace = namespaceFromSlug(slug);
  let description = (frontmatter.description || "").trim();
  if (description.length > MAX_DESCRIPTION) {
    description = description.slice(0, MAX_DESCRIPTION - 1) + "…";
  }
  // tags = explicit `tags:` field if present, else inferred from namespace alone
  let tags = [];
  if (Array.isArray(frontmatter.tags)) {
    tags = frontmatter.tags.map(String);
  } else if (typeof frontmatter.tags === "string") {
    tags = frontmatter.tags.split(/[\s,]+/).filter(Boolean);
  }
  if (tags.length === 0 && namespace) tags = [namespace];

  // user_invocable defaults to true unless explicitly false (Claude Code default).
  const userInvocable = frontmatter["user-invocable"] !== false;

  let mtime = 0;
  try {
    mtime = fs.statSync(file.full).mtimeMs;
  } catch {
    /* keep 0 */
  }

  return {
    id: `skill:${slug}`,
    slug,
    description,
    tags,
    location: path.posix.join(
      (PATHS.commands || ".claude/commands").replace(/\\/g, "/"),
      file.rel,
    ),
    namespace,
    user_invocable: userInvocable,
    mtime,
  };
}

// ── Truncation policy: recency, then alphabetical ───────

function truncate(entries, max) {
  if (entries.length <= max) return { entries, truncated: 0 };
  // Sort by mtime DESC (newest first), tie-break alphabetical
  const sorted = [...entries].sort((a, b) => {
    if (b.mtime !== a.mtime) return b.mtime - a.mtime;
    return a.slug.localeCompare(b.slug);
  });
  const kept = sorted.slice(0, max);
  // Re-sort kept entries alphabetically for stable output
  kept.sort((a, b) => a.slug.localeCompare(b.slug));
  return { entries: kept, truncated: entries.length - max };
}

// ── Atomic write ────────────────────────────────────────

function atomicWrite(dest, content) {
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
  } catch {
    /* ignore */
  }
  const tmp = dest + ".tmp." + process.pid + "." + Date.now();
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, dest);
}

// ── Main ────────────────────────────────────────────────

function main() {
  const args = new Set(process.argv.slice(2));
  const verbose = args.has("--verbose");
  const dryRun = args.has("--json");

  if (!fs.existsSync(COMMANDS_DIR)) {
    console.error(
      `[generate-skill-catalog] commands dir missing: ${COMMANDS_DIR}`,
    );
    process.exit(1);
  }

  const files = walkSkills(COMMANDS_DIR);
  if (verbose) {
    console.error(
      `[generate-skill-catalog] found ${files.length} markdown files`,
    );
  }

  const all = [];
  let skippedNoInvocable = 0;
  let skippedNoDescription = 0;
  for (const file of files) {
    const entry = entryFromFile(file);
    if (!entry) continue;
    if (!entry.user_invocable) {
      skippedNoInvocable++;
      if (verbose) console.error(`  skip (not user-invocable): ${entry.slug}`);
      continue;
    }
    if (!entry.description) {
      // Keep but flag — ranker will still see slug+tags. Audit (T-050) will surface.
      skippedNoDescription++;
      if (verbose) console.error(`  warn (no description): ${entry.slug}`);
    }
    all.push(entry);
  }

  // Stable alphabetical order for output (truncate may re-sort)
  all.sort((a, b) => a.slug.localeCompare(b.slug));

  const { entries, truncated } = truncate(all, MAX_ENTRIES);

  const catalog = {
    schema: "mc/skill-catalog/v1",
    generated_at: new Date().toISOString(),
    source: PATHS.commands || ".claude/commands",
    count: entries.length,
    total_scanned: all.length,
    truncated,
    skipped_not_invocable: skippedNoInvocable,
    skipped_no_description: skippedNoDescription,
    entries,
  };

  const json = JSON.stringify(catalog, null, 2);

  if (dryRun) {
    process.stdout.write(json + "\n");
    return;
  }

  atomicWrite(CATALOG_PATH, json + "\n");

  console.log(
    `[generate-skill-catalog] wrote ${entries.length} entries to ${CATALOG_PATH}` +
      (truncated ? ` (truncated ${truncated})` : "") +
      (skippedNoInvocable
        ? ` (skipped ${skippedNoInvocable} non-invocable)`
        : "") +
      (skippedNoDescription
        ? ` (${skippedNoDescription} missing description)`
        : ""),
  );
}

main();
