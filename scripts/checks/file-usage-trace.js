#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const NAME = "file-usage-trace";
const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const REGISTRY = path.join(ROOT, "framework", "paths.registry.json");

const TEXT_EXT = new Set([".md", ".json", ".js", ".yaml", ".yml", ".mjs", ".cjs", ".ts"]);

const SNAPSHOT_PREFIX = "framework/releases/";

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

function listTrackedFiles() {
  const out = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out
    .split(/\r?\n/)
    .map((f) => f.trim())
    .filter(Boolean)
    .map(toPosix)
    .filter((f) => TEXT_EXT.has(path.extname(f).toLowerCase()));
}

function loadRegistry() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(REGISTRY, "utf8")).paths || {};
  } catch {
    raw = {};
  }
  const byKey = raw;
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

function buildNeedles(relPosix, registry) {
  const base = path.posix.basename(relPosix);
  const needles = [];

  needles.push({ kind: "literal", how: "path", text: relPosix });

  needles.push({ kind: "literal", how: "basename", text: base });

  for (const { key } of registry.keysForPath(relPosix)) {
    needles.push({ kind: "token", how: "paths-token", text: `paths.${key}` });
    needles.push({ kind: "token", how: "paths-token", text: `PATHS.${key}` });
    needles.push({ kind: "token", how: "registry-key", text: `"${key}"` });
    needles.push({ kind: "token", how: "registry-key", text: `'${key}'` });
  }
  return needles;
}

function reEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function bodyReferences(body, needle) {
  if (needle.how === "basename") {
    const re = new RegExp(`(?<![\\w./\\-])${reEscape(needle.text)}(?![\\w])`);
    return re.test(body);
  }
  return body.includes(needle.text);
}

function categorize(relPosix) {
  if (relPosix === "framework/paths.registry.json" || REGISTRY_VIEWS.has(relPosix)) return "paths-registry";
  if (relPosix.startsWith(".claude/agents/")) return "agent specs";
  if (/(^|\/)[^/]*manifest[^/]*\.json$/i.test(relPosix) || relPosix === "_mc/MANIFEST.json") return "manifests";
  if (relPosix.startsWith("scripts/") || relPosix.includes("/hooks/") || relPosix.startsWith(".claude/hooks/")) return "scripts/hooks";
  if (relPosix.endsWith(".md")) return "docs";
  return "other";
}

const BUCKET_ORDER = ["paths-registry", "scripts/hooks", "agent specs", "manifests", "docs", "other"];

function trace({ target, corpus, registry, snapshotPrefix = SNAPSHOT_PREFIX }) {
  const relPosix = toPosix(target);
  const reg = registry || { keysForPath: () => [] };
  const needles = buildNeedles(relPosix, reg);

  const consumers = [];
  let snapshotCount = 0;

  for (const { file, body } of corpus) {
    const f = toPosix(file);
    if (f === relPosix) continue;
    if (REGISTRY_VIEWS.has(f)) continue;
    if (typeof body !== "string" || !body) continue;

    const hits = needles.filter((n) => bodyReferences(body, n));
    if (hits.length === 0) continue;

    if (f.startsWith(snapshotPrefix)) {
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

  const buckets = {};
  for (const b of BUCKET_ORDER) buckets[b] = [];
  for (const c of consumers.sort((a, b) => a.file.localeCompare(b.file))) {
    (buckets[c.bucket] || (buckets[c.bucket] = [])).push(c);
  }

  const literalConsumers = consumers.filter((c) => c.reference !== "token");
  const resolvedKeys = reg.keysForPath ? reg.keysForPath(relPosix).map((k) => k.key) : [];

  return {
    target: relPosix,
    resolvedKeys,
    totalConsumers: consumers.length,
    literalConsumerCount: literalConsumers.length,
    snapshotCount,
    buckets,
    consumers,
  };
}

function run(target) {
  const files = listTrackedFiles();
  const corpus = [];
  for (const f of files) {
    try {
      corpus.push({ file: f, body: fs.readFileSync(path.join(ROOT, f), "utf8") });
    } catch {
    }
  }
  return trace({ target, corpus, registry: loadRegistry() });
}

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
    process.exit(2);
  }

  let res;
  try {
    let resolved = target;
    if (!toPosix(target).includes("/")) {
      const matches = listTrackedFiles().filter((f) => path.posix.basename(f) === toPosix(target));
      if (matches.length === 1) {
        resolved = matches[0];
      } else if (matches.length > 1) {
        if (!jsonOut) process.stderr.write(`[${NAME}] note: '${target}' matches ${matches.length} tracked files; tracing by basename.\n`);
      }
    }
    res = run(resolved);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    if (jsonOut) console.log(JSON.stringify({ check: NAME, ok: false, error: msg }));
    else process.stderr.write(`[${NAME}] runner error: ${msg}\n`);
    process.exit(2);
  }

  if (jsonOut) console.log(JSON.stringify({ check: NAME, ok: true, ...res }, null, 2));
  else printHuman(res);
  process.exit(0);
}
