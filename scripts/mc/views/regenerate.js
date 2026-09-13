#!/usr/bin/env node
/**
 * scripts/mc/views/regenerate.js — rebuild .claude/ views from
 * _mc/ sources.
 *
 * SP-20260522-001 / T-20260522-188 follow-up. Closes the generated-view
 * discipline contract:
 *
 *   _mc/commands/<X>.md   →  .claude/commands/<X>.md   (byte-identical)
 *   _mc/agents/<X>.md     →  .claude/agents/<X>.md
 *   _mc/<other>           →  .claude/<other> (when manifest says so)
 *
 * Reads _mc/MANIFEST.json. For every owner=framework entry whose
 * source pointer != path (i.e., source lives elsewhere on disk), copy
 * source → path byte-identically. Entries where source == path are
 * skipped (self-referential — canonical-side, source IS the file).
 *
 * Reasoning for the self-reference no-op:
 *   - In canonical MC, `.claude/commands/foo.md` IS the source-of-
 *     truth; there's no separate `_mc/commands/foo.md` mirror in
 *     this repo. The manifest's source pointer is self-referential.
 *   - In an installed product, the framework source has been copied
 *     into `_mc/` by /mc:setup, so source != path and the
 *     regenerator does real work.
 *
 * Modes:
 *   default              Read-write. Copies source → path when content differs.
 *   --check              Read-only. Reports what WOULD change. Exits 1 if
 *                        any view is stale. This is the mode wired into
 *                        the upcoming `/scan:framework-views-fresh` gate.
 *
 * Usage:
 *   node scripts/mc/views/regenerate.js \
 *     [--manifest <path>]   # default: <root>/_mc/MANIFEST.json
 *     [--root <dir>]        # default: derived from manifest location
 *     [--check]             # read-only, exit 1 if stale
 *     [--json]              # emit summary as JSON
 *     [--quiet]             # suppress per-file lines
 *
 * Exit codes:
 *   0  clean — or all writes succeeded
 *   1  --check mode: at least one view is stale
 *      OR copy failure
 *   2  CLI parse error / manifest unreadable
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SCHEMA_ID = "mc/manifest/v1";

function parseArgs(argv) {
  const out = {
    manifestPath: null,
    root: null,
    check: false,
    json: false,
    quiet: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--manifest") out.manifestPath = argv[++i];
    else if (a === "--root") out.root = path.resolve(argv[++i]);
    else if (a === "--check") out.check = true;
    else if (a === "--json") out.json = true;
    else if (a === "--quiet") out.quiet = true;
  }
  return out;
}

function printHelp() {
  process.stdout.write(`
scripts/mc/views/regenerate.js — rebuild .claude/ views from _mc/ sources

Usage:
  node scripts/mc/views/regenerate.js [flags]

Flags:
  --manifest <path>   default: <root>/_mc/MANIFEST.json
  --root <dir>        default: derived from manifest location
  --check             read-only; exit 1 if any view is stale
  --json              emit summary as JSON
  --quiet             suppress per-file lines
  --help, -h          show this message

Exit codes:
  0  clean / all writes succeeded
  1  --check stale, or copy failure
  2  CLI/IO error
`);
}

function sha256OfFile(file) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

function sha256OfBuffer(buf) {
  const h = crypto.createHash("sha256");
  h.update(buf);
  return h.digest("hex");
}

// ── Regenerate ───────────────────────────────────────────────────────

function regenerate(opts) {
  const cwd = process.cwd();
  const manifestPath =
    opts.manifestPath ||
    path.join(opts.root || cwd, "_mc", "MANIFEST.json");
  const absManifestPath = path.resolve(manifestPath);
  if (!fs.existsSync(absManifestPath)) {
    return {
      ok: false,
      code: 2,
      error: `manifest not found at ${absManifestPath}`,
    };
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(absManifestPath, "utf8"));
  } catch (err) {
    return { ok: false, code: 2, error: `manifest parse: ${err.message}` };
  }
  if (manifest.$schema !== SCHEMA_ID) {
    return {
      ok: false,
      code: 2,
      error: `unexpected schema ${manifest.$schema}; expected ${SCHEMA_ID}`,
    };
  }
  if (!manifest.paths) {
    return { ok: false, code: 2, error: "manifest has no paths" };
  }
  const root = opts.root || path.resolve(path.dirname(absManifestPath), "..");
  if (!fs.existsSync(root)) {
    return { ok: false, code: 2, error: `root not found: ${root}` };
  }

  const actions = {
    copied: [],
    unchanged: [],
    skipped_self_reference: [],
    skipped_source_missing: [],
    skipped_non_framework: 0,
    failed: [],
    would_copy: [], // --check mode
  };

  for (const [rel, entry] of Object.entries(manifest.paths)) {
    if (entry.owner !== "framework") {
      actions.skipped_non_framework++;
      continue;
    }
    if (entry.removedIn) continue;
    if (!entry.source) {
      actions.skipped_self_reference.push(rel);
      continue;
    }
    if (entry.source === rel) {
      // self-reference: source is the file itself
      actions.skipped_self_reference.push(rel);
      continue;
    }
    const sourceAbs = path.resolve(root, entry.source);
    const destAbs = path.resolve(root, rel);
    if (!fs.existsSync(sourceAbs)) {
      actions.skipped_source_missing.push({
        path: rel,
        source: entry.source,
      });
      continue;
    }
    let sourceBuf;
    try {
      sourceBuf = fs.readFileSync(sourceAbs);
    } catch (err) {
      actions.failed.push({
        path: rel,
        reason: `read source failed: ${err.message}`,
      });
      continue;
    }
    const sourceSha = sha256OfBuffer(sourceBuf);
    let destSha = null;
    if (fs.existsSync(destAbs)) {
      try {
        destSha = sha256OfFile(destAbs);
      } catch {
        /* keep null */
      }
    }
    if (destSha === sourceSha) {
      actions.unchanged.push(rel);
      continue;
    }
    if (opts.check) {
      actions.would_copy.push({
        path: rel,
        source: entry.source,
        source_sha: sourceSha,
        dest_sha: destSha,
      });
      continue;
    }
    try {
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.writeFileSync(destAbs, sourceBuf);
      actions.copied.push(rel);
    } catch (err) {
      actions.failed.push({
        path: rel,
        reason: `write failed: ${err.message}`,
      });
    }
  }

  let code = 0;
  if (actions.failed.length > 0) code = 1;
  if (opts.check && actions.would_copy.length > 0) code = 1;

  return {
    ok: code === 0,
    code,
    mode: opts.check ? "check" : "apply",
    manifestPath: absManifestPath,
    root,
    summary: {
      copied: actions.copied.length,
      unchanged: actions.unchanged.length,
      skipped_self_reference: actions.skipped_self_reference.length,
      skipped_source_missing: actions.skipped_source_missing.length,
      skipped_non_framework: actions.skipped_non_framework,
      failed: actions.failed.length,
      would_copy: actions.would_copy.length,
    },
    actions,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────

function formatHuman(r) {
  const lines = [];
  lines.push(`scripts/mc/views/regenerate.js — ${r.mode} mode`);
  lines.push(`  manifest: ${r.manifestPath}`);
  lines.push(`  root:     ${r.root}`);
  lines.push("");
  lines.push("  summary:");
  if (r.mode === "check") {
    lines.push(`    would_copy:              ${r.summary.would_copy}`);
  } else {
    lines.push(`    copied:                  ${r.summary.copied}`);
  }
  lines.push(`    unchanged:               ${r.summary.unchanged}`);
  lines.push(
    `    skipped_self_reference:  ${r.summary.skipped_self_reference}  (canonical-side; source IS the file)`,
  );
  lines.push(
    `    skipped_source_missing:  ${r.summary.skipped_source_missing}  (manifest claims a source that does not exist)`,
  );
  lines.push(
    `    skipped_non_framework:   ${r.summary.skipped_non_framework}  (only owner=framework regenerates)`,
  );
  lines.push(`    failed:                  ${r.summary.failed}`);
  if (r.actions.failed.length) {
    lines.push("");
    lines.push("  FAILURES:");
    for (const f of r.actions.failed.slice(0, 10))
      lines.push(`    - ${f.path}: ${f.reason}`);
    if (r.actions.failed.length > 10)
      lines.push(`    ... and ${r.actions.failed.length - 10} more`);
  }
  if (r.actions.skipped_source_missing.length) {
    lines.push("");
    lines.push(
      `  SOURCE-MISSING (manifest declares a source not present on disk):`,
    );
    for (const s of r.actions.skipped_source_missing.slice(0, 10))
      lines.push(`    - ${s.path}  source=${s.source}`);
    if (r.actions.skipped_source_missing.length > 10)
      lines.push(
        `    ... and ${r.actions.skipped_source_missing.length - 10} more`,
      );
  }
  if (r.mode === "check" && r.actions.would_copy.length) {
    lines.push("");
    lines.push("  WOULD COPY (run without --check to apply):");
    for (const c of r.actions.would_copy.slice(0, 10))
      lines.push(
        `    - ${c.path}  ${c.dest_sha ? c.dest_sha.slice(0, 12) : "MISSING"} → ${c.source_sha.slice(0, 12)}`,
      );
    if (r.actions.would_copy.length > 10)
      lines.push(
        `    ... and ${r.actions.would_copy.length - 10} more`,
      );
  }
  lines.push("");
  lines.push(`  result: ${r.ok ? "OK" : "FAIL"} (exit ${r.code})`);
  return lines.join("\n") + "\n";
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printHelp();
    return 0;
  }
  const r = regenerate(opts);
  if (opts.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else if (!r.ok && r.code === 2) {
    process.stderr.write(`regenerate failed: ${r.error}\n`);
  } else if (!opts.quiet) {
    process.stdout.write(formatHuman(r));
  }
  return r.code || 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { regenerate };
