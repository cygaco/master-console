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
 *     file `feedback_example_rule.md` has
 *     `name: example-rule`).
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
const KEBAB_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const norm = (p) => p.replace(/\\/g, "/");

const INDEX_LINE_RE = /^\s*[-*]\s*\[([^\]]*)\]\((.+?)\)(?:\s+[—-]\s+(.*))?\s*$/;
const INDEX_LINE_START_RE = /^\s*[-*]\s*\[[^\]]*\]\(/;

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

function decodeScalar(raw) {
  if (raw == null) return null;
  let v = String(raw).trim();
  if (v === "") return null;
  const q = v[0];
  if ((q === '"' || q === "'") && v.length >= 2 && v[v.length - 1] === q) {
    v = v.slice(1, -1).trim();
    return v === "" ? null : v;
  }
  if (v[0] === "#") return null;
  v = v.replace(/\s#.*$/, "").trim();
  if (v === "") return null;
  if (/^[[{|>]/.test(v)) return null;
  if (/^(null|~)$/i.test(v)) return null;
  return v;
}

function isEmptyFieldValue(raw) {
  const v = String(raw == null ? "" : raw).trim();
  return v === "" || v[0] === "#";
}

function parseFrontmatter(text) {
  const out = { hasFrontmatter: false, name: null, description: null, type: null, body: "" };
  const stripped = String(text == null ? "" : text).replace(/^﻿/, "");
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
  let inMetadata = false;
  let metadataIndent = 0;
  let metadataChildIndent = -1;
  let metadataInvalid = false;
  const topLevelSeen = new Set();
  const topLevelDup = new Set();
  let metadataTypeSeen = false;
  for (const ln of fmLines) {
    if (ln.trim() === "") continue;
    const ind = indentOf(ln);
    const km = ln.match(/^[ \t]*([A-Za-z0-9_-]+):[ \t]*(.*)$/);

    if (inMetadata && ind <= metadataIndent) {
      inMetadata = false;
      metadataChildIndent = -1;
    }

    if (inMetadata) {
      const trimmed = ln.trim();
      if (trimmed.startsWith("#")) continue;
      if (metadataChildIndent === -1) metadataChildIndent = ind;
      if (trimmed.startsWith("-") || ind !== metadataChildIndent || !km) {
        metadataInvalid = true;
        continue;
      }
      const childVal = String(km[2] == null ? "" : km[2]).trim();
      if (/^[[{|>]/.test(childVal)) {
        metadataInvalid = true;
        continue;
      }
      if (km[1] === "type") {
        if (metadataTypeSeen) {
          metadataInvalid = true;
          continue;
        }
        metadataTypeSeen = true;
        out.type = decodeScalar(km[2]);
      }
      continue;
    }

    if (!km) continue;
    if (ind !== 0) continue;
    const key = km[1];
    const val = km[2];
    if (key === "metadata" || key === "name" || key === "description") {
      if (topLevelSeen.has(key)) topLevelDup.add(key);
      topLevelSeen.add(key);
    }
    if (key === "metadata") {
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
  if (topLevelDup.has("metadata")) metadataInvalid = true;
  if (topLevelDup.has("name")) out.name = null;
  if (topLevelDup.has("description")) out.description = null;
  if (metadataInvalid) out.type = null;
  return out;
}

function frontmatterProblems(fm) {
  const problems = [];
  const f = fm || {};
  if (!f.hasFrontmatter) {
    problems.push({
      field: "block",
      message:
        "has no YAML frontmatter block (expected a leading '---' … '---' block with name/description/metadata.type)",
    });
    return problems;
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

function extractWikilinks(body) {
  const out = [];
  const re = /\[\[([^[\]]+)\]\]/g;
  let m;
  while ((m = re.exec(String(body == null ? "" : body)))) {
    const slug = m[1].trim();
    if (slug) out.push(slug);
  }
  return out;
}

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

function readStore(absDir, relDir, maxIndexLines) {
  const memPath = path.join(absDir, "MEMORY.md");
  let indexText;
  try {
    indexText = fs.readFileSync(memPath, "utf8");
  } catch (e) {
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

function run(opts) {
  opts = opts || {};
  const notes = [];
  const maxIndexLines = opts.maxIndexLines || DEFAULT_MAX_INDEX_LINES;
  const explicitDirs = opts.dirs && opts.dirs.length ? opts.dirs : null;

  const stores = [];

  if (explicitDirs) {
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
    const memRootAbs = path.join(ROOT, DEFAULT_MEMORY_ROOT);
    let rootStat;
    try {
      rootStat = fs.statSync(memRootAbs);
    } catch (e) {
      if (e && e.code === "ENOENT") return skipResult(notes);
      throw e;
    }
    if (!rootStat.isDirectory()) {
      return {
        ok: false,
        fatal: true,
        problems: [`default memory root '${DEFAULT_MEMORY_ROOT}' exists but is not a directory`],
        notes,
      };
    }
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
