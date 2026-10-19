#!/usr/bin/env node

"use strict";
const mcEnv = require("./hooks/lib/mc-env");
const { normalize } = require("./hooks/lib/skill-router-core");

const fs = require("fs");
const path = require("path");

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

const MAX_ENTRIES = parseInt(process.env.CATALOG_MAX_ENTRIES || "2000", 10);
const MAX_DESCRIPTION = 280;

function stripQuotes(s) {
  const t = String(s).trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function parseFrontmatter(text) {
  if (!text.startsWith("---")) return { frontmatter: {}, body: text };
  const close = text.indexOf("\n---", 3);
  if (close === -1) return { frontmatter: {}, body: text };
  const block = text.slice(3, close).trim();
  const body = text.slice(close + 4).replace(/^\r?\n/, "");

  const lines = block.split(/\r?\n/);
  const fm = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z_-][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1].trim();
    const valueTrimmed = m[2].trim();

    if (valueTrimmed === "") {
      const children = [];
      let j = i + 1;
      while (j < lines.length) {
        const childLine = lines[j];
        if (childLine.trim() === "") {
          j++;
          continue;
        }
        const indentMatch = childLine.match(/^(\s+)(.*)$/);
        if (!indentMatch) break;
        children.push(indentMatch[2]);
        j++;
      }
      if (children.length > 0 && children.every((c) => c.startsWith("- "))) {
        fm[key] = children.map((c) => stripQuotes(c.slice(2).trim()));
        i = j;
        continue;
      }
      if (
        children.length > 0 &&
        children.every((c) => /^[^:\s][^:]*:\s*.*$/.test(c))
      ) {
        const map = {};
        for (const c of children) {
          const cm = c.match(/^([^:]+):\s*(.*)$/);
          if (!cm) continue;
          map[cm[1].trim()] = stripQuotes(cm[2].trim());
        }
        fm[key] = map;
        i = j;
        continue;
      }
      fm[key] = "";
      i++;
      continue;
    }

    let value = valueTrimmed;
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => stripQuotes(s.trim()))
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
    i++;
  }
  return { frontmatter: fm, body };
}

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

const GLOBAL_FLAG_MAP = {
  fast: "--fast",
  quickly: "--fast",
  "the fast way": "--fast",
  minimum: "--fast",
  quick: "--fast",
  turbo: "--turbo",
  "speed mode": "--turbo",
  "full speed": "--turbo",
  "go fast": "--turbo",
  "fast mode": "--turbo",
  "read only": "--read-only",
  "just show me": "--read-only",
  "don't change anything": "--read-only",
  "look only": "--read-only",
  "dry run": "--dry-run",
  preview: "--dry-run",
  "don't apply": "--dry-run",
  "what would happen": "--dry-run",
  "apply it": "--apply",
  "for real": "--apply",
  "actually do it": "--apply",
  "write it": "--apply",
  deep: "--deep",
  thorough: "--deep",
  "full depth": "--deep",
  "the long version": "--deep",
  "as json": "--json",
  "raw json": "--json",
  status: "--status",
  "where are we with": "--status",
  "turn off": "--off",
  "switch off": "--off",
  disable: "--off",
  "don't push": "--no-push",
  "no push": "--no-push",
  "without pushing": "--no-push",
  "local only": "--no-push",
  "force it": "--force",
  override: "--force",
};

const ALIAS_RE = /^\[(?:deprecated )?alias\s*→\s*(\/[^\]\s]+)/;
const DOC_FLAG_RE = /`(--[a-z][a-z0-9-]*)`/g;
const VALID_ARGS_MODES = new Set(["none", "free-text", "topic"]);
const VALID_CONFIRM = new Set(["never", "always", "fuzzy-only"]);

function extractDocumentedFlags(body) {
  const set = new Set();
  let m;
  DOC_FLAG_RE.lastIndex = 0;
  while ((m = DOC_FLAG_RE.exec(body))) set.add(m[1]);
  return [...set];
}

function computeAliasOf(description) {
  const m = ALIAS_RE.exec(String(description || ""));
  return m ? m[1].replace(/^\//, "") : null;
}

function computeSlugTokens(slug) {
  return normalize(slug.replace(/:/g, " ")).tokens;
}

function normalizeSaysList(raw) {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

const IRREVERSIBLE_WORDS = [
  "push", "remote", "land", "deploy", "release", "delete", "uninstall",
  "authoriz", "purchase", "turbo", "force",
];
const WIDENING_WORDS = ["authoriz", "turbo"];
const CONFIRM_RANK = { never: 0, "fuzzy-only": 1, always: 2 };
function slugConfirmFloor(slug) {
  const toks = String(slug || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!isIrreversible(slug)) return "never";
  const widening = toks.some((t) => WIDENING_WORDS.some((w) => t.startsWith(w)));
  const nonWidening = toks.some(
    (t) => IRREVERSIBLE_WORDS.some((w) => t.startsWith(w)) && !WIDENING_WORDS.some((w) => t.startsWith(w)),
  );
  return widening && !nonWidening ? "fuzzy-only" : "always";
}
function raiseConfirm(declared, slug) {
  const floor = slugConfirmFloor(slug);
  return CONFIRM_RANK[floor] > CONFIRM_RANK[declared] ? floor : declared;
}
function isIrreversible(text) {
  const toks = String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return toks.some((t) => IRREVERSIBLE_WORDS.some((w) => t.startsWith(w)));
}

function computeConfirmFlags(entries) {
  const routable = (entries || []).filter((e) => e && e.alias_of == null && e.user_invocable !== false);
  const raised = routable.filter((e) => e.confirm && e.confirm !== "never");
  const raisedPhrases = new Set();
  for (const e of raised) {
    for (const p of e.says_norm || []) raisedPhrases.add(p.join(" "));
    if (Array.isArray(e.slug_tokens) && e.slug_tokens.length) raisedPhrases.add(e.slug_tokens.join(" "));
    const tail = String(e.slug || "").split(":").pop();
    if (tail) raisedPhrases.add(normalize(tail).tokens.join(" "));
  }
  const out = new Set();
  const consider = (spoken, flagValue) => {
    const value = String(flagValue);
    if (isIrreversible(value)) out.add(value);
    if (!raisedPhrases.size) return;
    const key = normalize(String(spoken)).tokens.join(" ");
    if (key && raisedPhrases.has(key)) out.add(value);
  };
  for (const e of routable) {
    for (const [spoken, value] of Object.entries(e.flags || {})) consider(spoken, value);
  }
  return [...out].sort();
}

function filterFlags(rawMap, documentedFlags) {
  const docSet = new Set(documentedFlags || []);
  const out = {};
  if (!rawMap || typeof rawMap !== "object") return out;
  for (const [spoken, flagStr] of Object.entries(rawMap)) {
    const leading = String(flagStr).trim().split(/\s+/)[0];
    if (docSet.has(leading)) out[spoken] = flagStr;
  }
  return out;
}

function slugFromRel(relPath) {
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
  const { frontmatter, body } = parseFrontmatter(text);
  const slug = slugFromRel(file.rel);
  const namespace = namespaceFromSlug(slug);
  let description = (frontmatter.description || "").trim();
  if (description.length > MAX_DESCRIPTION) {
    description = description.slice(0, MAX_DESCRIPTION - 1) + "…";
  }
  let tags = [];
  if (Array.isArray(frontmatter.tags)) {
    tags = frontmatter.tags.map(String);
  } else if (typeof frontmatter.tags === "string") {
    tags = frontmatter.tags.split(/[\s,]+/).filter(Boolean);
  }
  if (tags.length === 0 && namespace) tags = [namespace];

  const userInvocable = frontmatter["user-invocable"] !== false;

  let mtime = 0;
  try {
    mtime = fs.statSync(file.full).mtimeMs;
  } catch {
  }

  const aliasOf = computeAliasOf(description);

  let says = [];
  let saysNorm = [];
  let slugTokens = [];
  let flags = {};
  let documentedFlags = [];
  let argsMode = "none";
  let confirm = "never";

  if (!aliasOf) {
    says = normalizeSaysList(frontmatter.says);
    saysNorm = says.map((p) => normalize(p).tokens);
    slugTokens = computeSlugTokens(slug);
    documentedFlags = extractDocumentedFlags(body);
    const localFlags =
      frontmatter["says-flags"] && typeof frontmatter["says-flags"] === "object"
        ? frontmatter["says-flags"]
        : {};
    const merged = { ...GLOBAL_FLAG_MAP, ...localFlags };
    flags = filterFlags(merged, documentedFlags);
    const rawArgsMode = String(frontmatter["says-args"] || "none").trim();
    argsMode = VALID_ARGS_MODES.has(rawArgsMode) ? rawArgsMode : "none";
    const rawConfirm = String(frontmatter["says-confirm"] || "never").trim();
    confirm = VALID_CONFIRM.has(rawConfirm) ? rawConfirm : "never";
    confirm = raiseConfirm(confirm, slug);
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
    says,
    says_norm: saysNorm,
    slug_tokens: slugTokens,
    flags,
    documented_flags: documentedFlags,
    args_mode: argsMode,
    confirm,
    alias_of: aliasOf,
  };
}

function truncate(entries, max) {
  if (entries.length <= max) return { entries, truncated: 0 };
  const sorted = [...entries].sort((a, b) => {
    if (b.mtime !== a.mtime) return b.mtime - a.mtime;
    return a.slug.localeCompare(b.slug);
  });
  const kept = sorted.slice(0, max);
  kept.sort((a, b) => a.slug.localeCompare(b.slug));
  return { entries: kept, truncated: entries.length - max };
}

function regenLockPathArg() {
  const found = process.argv.slice(2).find((a) => a.startsWith("--regen-lock="));
  return found ? found.slice("--regen-lock=".length) : null;
}

function writeRegenCompletion(lockPath, ok, exitCode) {
  if (!lockPath) return;
  try {
    fs.writeFileSync(
      lockPath,
      JSON.stringify(
        ok
          ? { status: "ok", exitCode: 0, completedAt: Date.now() }
          : { status: "failed", exitCode, failedAt: Date.now() },
      ),
      "utf8",
    );
  } catch {
  }
}

function atomicWrite(dest, content) {
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
  } catch {
  }
  const tmp = dest + ".tmp." + process.pid + "." + Date.now();
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, dest);
}

function checkStale() {
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  } catch {
    return { stale: true, reason: "catalog missing or unparsable" };
  }
  const generatedAt = Date.parse(catalog.generated_at || "");
  if (!Number.isFinite(generatedAt)) {
    return { stale: true, reason: "catalog has no valid generated_at" };
  }
  const files = walkSkills(COMMANDS_DIR);
  for (const f of files) {
    let mtime;
    try {
      mtime = fs.statSync(f.full).mtimeMs;
    } catch {
      continue;
    }
    if (mtime > generatedAt) {
      return { stale: true, reason: `${f.rel} mtime newer than catalog` };
    }
  }
  return { stale: false };
}

function build({ verbose } = {}) {
  if (!fs.existsSync(COMMANDS_DIR)) {
    throw new Error(`commands dir missing: ${COMMANDS_DIR}`);
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
      skippedNoDescription++;
      if (verbose) console.error(`  warn (no description): ${entry.slug}`);
    }
    all.push(entry);
  }

  all.sort((a, b) => a.slug.localeCompare(b.slug));

  const { entries, truncated } = truncate(all, MAX_ENTRIES);

  return {
    schema: "mc/skill-catalog/v2",
    generated_at: new Date().toISOString(),
    source: PATHS.commands || ".claude/commands",
    count: entries.length,
    total_scanned: all.length,
    truncated,
    skipped_not_invocable: skippedNoInvocable,
    skipped_no_description: skippedNoDescription,
    confirm_flags: computeConfirmFlags(all),
    entries,
  };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const verbose = args.has("--verbose");
  const dryRun = args.has("--json");
  const checkMode = args.has("--check");
  const lockPath = regenLockPathArg();

  if (checkMode) {
    const result = checkStale();
    if (result.stale) {
      console.error(`[generate-skill-catalog] STALE — ${result.reason}`);
      process.exit(1);
    }
    console.log("[generate-skill-catalog] catalog is fresh");
    return;
  }

  let catalog;
  try {
    catalog = build({ verbose });
  } catch (e) {
    console.error(`[generate-skill-catalog] ${e.message}`);
    writeRegenCompletion(lockPath, false, 1);
    process.exit(1);
    return;
  }

  const json = JSON.stringify(catalog, null, 2);

  if (dryRun) {
    process.stdout.write(json + "\n");
    writeRegenCompletion(lockPath, true, 0);
    return;
  }

  try {
    atomicWrite(CATALOG_PATH, json + "\n");
  } catch (e) {
    console.error(`[generate-skill-catalog] write failed: ${e.message}`);
    writeRegenCompletion(lockPath, false, 1);
    process.exit(1);
    return;
  }

  writeRegenCompletion(lockPath, true, 0);

  console.log(
    `[generate-skill-catalog] wrote ${catalog.entries.length} entries to ${CATALOG_PATH}` +
      (catalog.truncated ? ` (truncated ${catalog.truncated})` : "") +
      (catalog.skipped_not_invocable
        ? ` (skipped ${catalog.skipped_not_invocable} non-invocable)`
        : "") +
      (catalog.skipped_no_description
        ? ` (${catalog.skipped_no_description} missing description)`
        : ""),
  );
}

if (require.main === module) main();

module.exports = {
  parseFrontmatter,
  walkSkills,
  entryFromFile,
  truncate,
  build,
  checkStale,
  computeAliasOf,
  computeSlugTokens,
  computeConfirmFlags,
  isIrreversible,
  slugConfirmFloor,
  IRREVERSIBLE_WORDS,
  extractDocumentedFlags,
  filterFlags,
  normalizeSaysList,
  GLOBAL_FLAG_MAP,
  MAX_ENTRIES,
  regenLockPathArg,
  writeRegenCompletion,
};
