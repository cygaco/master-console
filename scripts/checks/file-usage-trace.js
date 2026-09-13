#!/usr/bin/env node
"use strict";

/**
 * file-usage-trace.js — PROVE which files consume a target file before you
 * delete/rename it (PLAN §10.2 / §17.2 step 5).
 *
 * The recurring MC bug class: a canonical file is deleted or renamed and a
 * referencing consumer is missed — the deletion-time scan once caught direct
 * refs in 9 files; a CLAUDE.md↔alpha.md mix-up is the same class. This tracer is
 * the safety prerequisite for the destructive tranche: given a target file it
 * finds EVERY consumer across the repo's .md/.json/.js/.yaml sources, by
 *   (a) full/relative path,
 *   (b) word-boundaried basename, or
 *   (c) a paths-registry key/token (e.g. paths.eventsFile) that resolves to it,
 * categorizes them into buckets, and flags whether each reference is a
 * paths.* TOKEN (rename-safe) or a hardcoded LITERAL (the rot risk).
 *
 * Search is done IN-CODE over a `git ls-files` corpus (the path-usage.js
 * pattern): gitignore handles node_modules/.git/runtime for free, and there is
 * no leading-dir/brace glob with a path arg — the §11 silent-false-negative
 * trap. framework/releases/** are frozen historical snapshots: COUNTED, never
 * listed. The target file and the paths-registry generated views are excluded
 * from the consumer set (they "reference" the target by definition).
 *
 * Read-only tracer, not a gate: exits 0 always on a successful trace. Exits
 * non-zero ONLY on its own internal error (fail-closed — a tracer that errors
 * must not read as "no consumers").
 *
 *   node scripts/checks/file-usage-trace.js <path-or-basename> [--json]
 *
 * Examples:
 *   node scripts/checks/file-usage-trace.js .claude/project/reference/agent-dispatch-guide.md
 *   node scripts/checks/file-usage-trace.js coverage-gate.js --json
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const NAME = "file-usage-trace";
const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const REGISTRY = path.join(ROOT, "framework", "paths.registry.json");

// Text source extensions we trace references in.
const TEXT_EXT = new Set([".md", ".json", ".js", ".yaml", ".yml", ".mjs", ".cjs", ".ts"]);

// Frozen historical snapshots: count them, never enumerate them (the spec).
const SNAPSHOT_PREFIX = "framework/releases/";

// The paths-registry generated views + source: these reference every key's path
// by construction, so they are not interesting "consumers" of any single target.
const REGISTRY_VIEWS = new Set([
  "framework/paths.registry.json",
  ".claude/paths.json",
  "scripts/hooks/lib/paths.generated.js",
  "scripts/path-lint.rules.generated.json",
  "schemas/paths.schema.json",
  "_requirements/03-architecture/PATH_KEYS.md",
]);

function toPosix(p) {
  return p.replace(/\\/g, "/");
}

// ── Corpus ──────────────────────────────────────────────────
// `git ls-files` gives the tracked set (gitignore already excludes
// node_modules/.git/runtime). We keep only TEXT_EXT files.
function listTrackedFiles() {
  const out = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out
    .split(/\r?\n/)
    .map((f) => f.trim())
    .filter(Boolean)
    .map(toPosix)
    .filter((f) => TEXT_EXT.has(path.extname(f).toLowerCase()));
}

// ── Registry resolution ─────────────────────────────────────
// Load the paths registry; return { byKey, keysForPath(relPosix) }.
function loadRegistry() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(REGISTRY, "utf8")).paths || {};
  } catch {
    raw = {};
  }
  const byKey = raw;
  // Map a target's relative path → the registry key(s) that resolve to it.
  // Match on exact path OR (for a key that is a dir) a path that lives under it.
  function keysForPath(relPosix) {
    const keys = [];
    for (const [key, entry] of Object.entries(byKey)) {
      if (!entry || entry.removedIn || !entry.path) continue;
      const kp = toPosix(entry.path).replace(/\/+$/, "");
      if (kp === relPosix) {
        keys.push({ key, kind: entry.kind, exact: true });
      } else if ((entry.kind === "dir" || !entry.kind) && relPosix === kp) {
        keys.push({ key, kind: entry.kind, exact: true });
      }
    }
    return keys;
  }
  return { byKey, keysForPath };
}

// ── Reference detection ─────────────────────────────────────
// Build the set of "search needles" for a target, each tagged token|literal.
//   - literal: the relative path, and the bare basename (word-boundaried)
//   - token:   any paths.<key> / PATHS.<key> / "<key>" that resolves to target
function buildNeedles(relPosix, registry) {
  const base = path.posix.basename(relPosix);
  const needles = [];

  // (a) full/relative path literal — the strongest, least-ambiguous literal.
  needles.push({ kind: "literal", how: "path", text: relPosix });

  // (b) basename literal — word-boundaried at search time to avoid substring noise.
  needles.push({ kind: "literal", how: "basename", text: base });

  // (c) paths-registry tokens that resolve to this target.
  for (const { key } of registry.keysForPath(relPosix)) {
    needles.push({ kind: "token", how: "paths-token", text: `paths.${key}` });
    needles.push({ kind: "token", how: "paths-token", text: `PATHS.${key}` });
    needles.push({ kind: "token", how: "registry-key", text: `"${key}"` });
    needles.push({ kind: "token", how: "registry-key", text: `'${key}'` });
  }
  return needles;
}

// Escape a string for use as a RegExp literal.
function reEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Does `body` reference `needle`? Path/token needles use plain substring; the
// basename needle is word-boundaried (so `state.js` does not match `gui-state.js`
// or `statement.js`). A leading boundary is "start or a non-path/word char".
function bodyReferences(body, needle) {
  if (needle.how === "basename") {
    // Boundary: not preceded by a word char, dot, slash, or dash (those would make
    // it a different filename/identifier); not followed by a word char or dot+ext.
    const re = new RegExp(`(?<![\\w./\\-])${reEscape(needle.text)}(?![\\w])`);
    return re.test(body);
  }
  return body.includes(needle.text);
}

// ── Categorization ──────────────────────────────────────────
function categorize(relPosix) {
  if (relPosix === "framework/paths.registry.json" || REGISTRY_VIEWS.has(relPosix)) return "paths-registry";
  if (relPosix.startsWith(".claude/agents/")) return "agent specs";
  if (/(^|\/)[^/]*manifest[^/]*\.json$/i.test(relPosix) || relPosix === "_mc/MANIFEST.json") return "manifests";
  if (relPosix.startsWith("scripts/") || relPosix.includes("/hooks/") || relPosix.startsWith(".claude/hooks/")) return "scripts/hooks";
  if (relPosix.endsWith(".md")) return "docs";
  return "other";
}

const BUCKET_ORDER = ["paths-registry", "scripts/hooks", "agent specs", "manifests", "docs", "other"];

// ── Trace ───────────────────────────────────────────────────
/**
 * Pure-ish core for the P5 test: given a target + a corpus (array of
 * {file, body}) + an optional registry resolver, return the structured trace.
 * `corpus` lets the test plant a sealed fixture tree without touching git.
 */
function trace({ target, corpus, registry, snapshotPrefix = SNAPSHOT_PREFIX }) {
  const relPosix = toPosix(target);
  const reg = registry || { keysForPath: () => [] };
  const needles = buildNeedles(relPosix, reg);

  const consumers = [];
  let snapshotCount = 0;

  for (const { file, body } of corpus) {
    const f = toPosix(file);
    if (f === relPosix) continue; // never list the target itself
    if (REGISTRY_VIEWS.has(f)) continue; // registry views are not real consumers
    if (typeof body !== "string" || !body) continue;

    // Which needles hit?
    const hits = needles.filter((n) => bodyReferences(body, n));
    if (hits.length === 0) continue;

    if (f.startsWith(snapshotPrefix)) {
      // Frozen snapshot: count, don't list.
      snapshotCount++;
      continue;
    }

    const viaToken = hits.some((h) => h.kind === "token");
    const viaLiteral = hits.some((h) => h.kind === "literal");
    consumers.push({
      file: f,
      bucket: categorize(f),
      via: [...new Set(hits.map((h) => h.how))],
      reference: viaToken && !viaLiteral ? "token" : viaLiteral && !viaToken ? "literal" : "both",
    });
  }

  // Group by bucket in stable order.
  const buckets = {};
  for (const b of BUCKET_ORDER) buckets[b] = [];
  for (const c of consumers.sort((a, b) => a.file.localeCompare(b.file))) {
    (buckets[c.bucket] || (buckets[c.bucket] = [])).push(c);
  }

  const literalConsumers = consumers.filter((c) => c.reference !== "token");
  const resolvedKeys = reg.keysForPath ? reg.keysForPath(relPosix).map((k) => k.key) : [];

  return {
    target: relPosix,
    resolvedKeys, // paths-registry keys that resolve to the target (empty = no token aliasing)
    totalConsumers: consumers.length,
    literalConsumerCount: literalConsumers.length, // the rot risk: refs that won't follow a registry rename
    snapshotCount, // framework/releases/** matches (counted, not listed)
    buckets,
    consumers,
  };
}

// ── Live run (reads git + disk) ─────────────────────────────
function run(target) {
  const files = listTrackedFiles();
  const corpus = [];
  for (const f of files) {
    try {
      corpus.push({ file: f, body: fs.readFileSync(path.join(ROOT, f), "utf8") });
    } catch {
      /* unreadable — skip */
    }
  }
  return trace({ target, corpus, registry: loadRegistry() });
}

// ── Reporting ───────────────────────────────────────────────
function printHuman(res) {
  const lines = [];
  lines.push(`[${NAME}] ${res.target}`);
  if (res.resolvedKeys.length) {
    lines.push(`  paths-registry key(s) resolving here: ${res.resolvedKeys.map((k) => `paths.${k}`).join(", ")}`);
  } else {
    lines.push(`  paths-registry: NOT aliased by any key (all references are hardcoded literals — full rot risk)`);
  }
  lines.push(
    `  ${res.totalConsumers} consumer(s)` +
      (res.literalConsumerCount ? `, ${res.literalConsumerCount} via hardcoded LITERAL (rot risk)` : "") +
      (res.snapshotCount ? `  ·  +${res.snapshotCount} frozen release-snapshot match(es) (not listed)` : ""),
  );
  for (const bucket of BUCKET_ORDER) {
    const items = res.buckets[bucket] || [];
    if (!items.length) continue;
    lines.push(`  ${bucket} (${items.length}):`);
    for (const c of items) {
      const tag = c.reference === "token" ? "token  " : c.reference === "literal" ? "LITERAL" : "both   ";
      lines.push(`    ${tag}  ${c.file}  [${c.via.join(",")}]`);
    }
  }
  if (res.totalConsumers === 0) {
    lines.push(`  No live consumers found — safe to delete/rename (snapshots aside).`);
  }
  process.stdout.write(lines.join("\n") + "\n");
}

module.exports = { trace, categorize, buildNeedles, bodyReferences, loadRegistry, BUCKET_ORDER };

if (require.main === module) {
  const args = process.argv.slice(2);
  const jsonOut = args.includes("--json");
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) {
    process.stderr.write(`usage: node scripts/checks/${NAME}.js <path-or-basename> [--json]\n`);
    process.exit(2); // fail-closed: no target is an internal/usage error, not "no consumers"
  }

  let res;
  try {
    let resolved = target;
    // If the user passed a bare basename, resolve it to a tracked path when unique.
    if (!toPosix(target).includes("/")) {
      const matches = listTrackedFiles().filter((f) => path.posix.basename(f) === toPosix(target));
      if (matches.length === 1) {
        resolved = matches[0];
      } else if (matches.length > 1) {
        // Ambiguous basename — trace the basename itself (still finds refs), but warn.
        if (!jsonOut) process.stderr.write(`[${NAME}] note: '${target}' matches ${matches.length} tracked files; tracing by basename.\n`);
      }
    }
    res = run(resolved);
  } catch (e) {
    // Fail-closed: a tracer that errors must NOT read as "no consumers".
    const msg = e && e.message ? e.message : String(e);
    if (jsonOut) console.log(JSON.stringify({ check: NAME, ok: false, error: msg }));
    else process.stderr.write(`[${NAME}] runner error: ${msg}\n`);
    process.exit(2);
  }

  if (jsonOut) console.log(JSON.stringify({ check: NAME, ok: true, ...res }, null, 2));
  else printHuman(res);
  process.exit(0); // read-only tracer: always 0 on a successful trace
}
