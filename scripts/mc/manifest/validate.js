#!/usr/bin/env node
/**
 * scripts/mc/manifest/validate.js — verify _mc/MANIFEST.json
 * matches on-disk reality.
 *
 * SP-20260522-001 / T-20260522-188 follow-up. Reads the manifest produced
 * by scripts/mc/manifest/build.js and walks the on-disk tree to
 * answer four questions:
 *
 *   1. Coverage         — Is every on-disk path enumerated?
 *                         Anything on disk but absent from the manifest is
 *                         flagged `unmanifested` (an install-time
 *                         coverage gap).
 *   2. Existence        — Is every manifest path actually on disk?
 *                         Anything in the manifest but missing on disk
 *                         is flagged `missing` (broken install).
 *   3. Framework drift  — For owner=framework entries with sha256, does
 *                         the on-disk file's sha256 still match?
 *                         Mismatch → flagged `drift`.
 *   4. User-modified    — For owner=framework entries where installedSha
 *                         is set and != current sha256, the user has
 *                         locally edited a managed file. Flagged
 *                         `user_modified` (not necessarily wrong; surfaces
 *                         what /mc:update would overwrite).
 *
 * Deferred to follow-up:
 *   - owner=generated re-compile + diff (depends on the compiler scripts
 *     existing — settings/compile.js + paths/build.js + manifest/build.js
 *     wired together).
 *   - owner=project seed-drift (depends on _mc/BASELINE/ existing
 *     with snapshot of seeded content).
 *
 * Usage:
 *   node scripts/mc/manifest/validate.js \
 *     [--manifest <path>]     # default: <root>/_mc/MANIFEST.json
 *     [--root <dir>]          # default: dirname of manifest's enclosing repo
 *     [--strict]              # exit 1 on ANY finding (default: only on missing)
 *     [--json]                # emit findings as JSON
 *
 * Exit codes:
 *   0  clean OR only soft findings (drift/user_modified/unmanifested) without --strict
 *   1  hard findings (missing files) OR any finding with --strict
 *   2  CLI parse error / manifest unreadable / unschematic
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
    strict: false,
    json: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--manifest") out.manifestPath = argv[++i];
    else if (a === "--root") out.root = path.resolve(argv[++i]);
    else if (a === "--strict") out.strict = true;
    else if (a === "--json") out.json = true;
  }
  return out;
}

function printHelp() {
  process.stdout.write(`
scripts/mc/manifest/validate.js — verify _mc/MANIFEST.json matches reality

Usage:
  node scripts/mc/manifest/validate.js [flags]

Flags:
  --manifest <path>   default: <root>/_mc/MANIFEST.json
  --root <dir>        default: derived from manifest location
  --strict            exit 1 on ANY finding (drift, user_modified, unmanifested)
  --json              emit findings as JSON
  --help, -h          show this message

Exit codes:
  0  clean — or soft findings only without --strict
  1  hard findings (missing files) — or any finding with --strict
  2  CLI/IO error
`);
}

function sha256OfFile(file) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

// Skip sets are shared with build.js via ./walk-skip so the validator and the
// builder can never disagree about what is not-shipped (BC-02 drift class).
const { WALK_SKIP_DIRS, WALK_SKIP_FILES } = require("./walk-skip");

function* walk(rootAbs) {
  const stack = [rootAbs];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (WALK_SKIP_DIRS.has(ent.name)) continue;
      if (WALK_SKIP_FILES.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (ent.isFile()) {
        yield full;
      }
    }
  }
}

function relPath(rootAbs, fullPath) {
  return path.relative(rootAbs, fullPath).split(path.sep).join("/");
}

// ── Validation ───────────────────────────────────────────────────────

function validate(opts) {
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
  if (!manifest.paths || typeof manifest.paths !== "object") {
    return {
      ok: false,
      code: 2,
      error: "manifest has no paths object",
    };
  }
  const root = opts.root || path.resolve(path.dirname(absManifestPath), "..");
  if (!fs.existsSync(root)) {
    return { ok: false, code: 2, error: `root not found: ${root}` };
  }

  // 1. Build the on-disk set
  const onDisk = new Set();
  for (const full of walk(root)) {
    const rel = relPath(root, full);
    if (!rel || rel.startsWith("..")) continue;
    onDisk.add(rel);
  }

  // 2. Walk manifest entries → missing + drift + user_modified
  const findings = {
    missing: [],
    unmanifested: [],
    drift: [],
    user_modified: [],
    schema_violation: [],
  };
  const ownerCounts = {
    framework: 0,
    generated: 0,
    project: 0,
    runtime: 0,
    other: 0,
  };
  for (const [rel, entry] of Object.entries(manifest.paths)) {
    if (entry.removedIn) continue; // tombstone — fine if absent
    const cls = entry.owner;
    if (cls in ownerCounts) ownerCounts[cls]++;
    else ownerCounts.other++;
    const exists = onDisk.has(rel);
    if (!exists) {
      // owner=runtime files are transient by definition — their absence is expected,
      // NOT a missing-framework-file finding. Without this, the gitignored
      // .claude/.session-* markers flap the validate gate (and via BC-02, the
      // regression_seed gate) as they appear/disappear across a session.
      if (cls !== "runtime") findings.missing.push({ path: rel, owner: cls });
      continue;
    }
    const full = path.join(root, rel);
    if (cls === "framework" && entry.sha256) {
      let current;
      try {
        current = sha256OfFile(full);
      } catch {
        continue;
      }
      if (current !== entry.sha256) {
        findings.drift.push({
          path: rel,
          owner: cls,
          manifest_sha: entry.sha256,
          current_sha: current,
        });
      }
      if (
        entry.installedSha &&
        entry.installedSha !== current &&
        entry.installedSha !== entry.sha256
      ) {
        findings.user_modified.push({
          path: rel,
          owner: cls,
          installed_sha: entry.installedSha,
          current_sha: current,
        });
      }
    }
  }

  // 3. Walk on-disk set → unmanifested
  for (const rel of onDisk) {
    if (!(rel in manifest.paths)) {
      findings.unmanifested.push(rel);
    }
  }

  // 4. Schema-shape checks per entry (cheap subset of the JSON Schema)
  for (const [rel, entry] of Object.entries(manifest.paths)) {
    const owner = entry.owner;
    if (!["framework", "generated", "project", "runtime"].includes(owner)) {
      findings.schema_violation.push({
        path: rel,
        reason: `invalid owner: ${owner}`,
      });
      continue;
    }
    if (owner === "framework") {
      if (entry.source === undefined) {
        findings.schema_violation.push({
          path: rel,
          reason: "framework entry missing `source`",
        });
      }
      if (!entry.sha256) {
        findings.schema_violation.push({
          path: rel,
          reason: "framework entry missing `sha256`",
        });
      }
    }
    if (owner === "generated" && !Array.isArray(entry.compiled_from)) {
      findings.schema_violation.push({
        path: rel,
        reason: "generated entry missing `compiled_from`",
      });
    }
    if (owner === "runtime") {
      if (entry.source !== undefined)
        findings.schema_violation.push({
          path: rel,
          reason: "runtime entry must not have `source`",
        });
      if (entry.seeded_from !== undefined)
        findings.schema_violation.push({
          path: rel,
          reason: "runtime entry must not have `seeded_from`",
        });
      if (entry.compiled_from !== undefined)
        findings.schema_violation.push({
          path: rel,
          reason: "runtime entry must not have `compiled_from`",
        });
    }
  }

  // 5. Decide ok / code
  const hardCount = findings.missing.length + findings.schema_violation.length;
  const softCount =
    findings.drift.length +
    findings.user_modified.length +
    findings.unmanifested.length;
  let code = 0;
  if (hardCount > 0) code = 1;
  else if (opts.strict && softCount > 0) code = 1;

  return {
    ok: code === 0,
    code,
    manifestPath: absManifestPath,
    root,
    manifestVersion: manifest.version,
    mcVersion: manifest.mcVersion,
    generatedAt: manifest.generatedAt,
    pathCount: Object.keys(manifest.paths).length,
    ownerCounts,
    findings,
    summary: {
      missing: findings.missing.length,
      unmanifested: findings.unmanifested.length,
      drift: findings.drift.length,
      user_modified: findings.user_modified.length,
      schema_violation: findings.schema_violation.length,
    },
  };
}

// ── CLI ──────────────────────────────────────────────────────────────

function formatHuman(r) {
  const lines = [];
  lines.push(`scripts/mc/manifest/validate.js — ${r.manifestPath}`);
  lines.push(
    `  root:           ${r.root}`,
  );
  lines.push(
    `  mcVersion:  ${r.mcVersion}    schema v${r.manifestVersion}`,
  );
  lines.push(
    `  generatedAt:    ${r.generatedAt}`,
  );
  lines.push(
    `  paths:          ${r.pathCount}  ` +
      `(framework=${r.ownerCounts.framework} ` +
      `generated=${r.ownerCounts.generated} ` +
      `project=${r.ownerCounts.project} ` +
      `runtime=${r.ownerCounts.runtime})`,
  );
  lines.push("");
  lines.push(`  findings:`);
  lines.push(`    missing:           ${r.summary.missing}`);
  lines.push(`    unmanifested:      ${r.summary.unmanifested}`);
  lines.push(`    drift:             ${r.summary.drift}`);
  lines.push(`    user_modified:     ${r.summary.user_modified}`);
  lines.push(`    schema_violation:  ${r.summary.schema_violation}`);
  if (r.findings.missing.length) {
    lines.push("");
    lines.push("  MISSING (in manifest but not on disk):");
    for (const m of r.findings.missing.slice(0, 10))
      lines.push(`    - ${m.path} [${m.owner}]`);
    if (r.findings.missing.length > 10)
      lines.push(`    ... and ${r.findings.missing.length - 10} more`);
  }
  if (r.findings.unmanifested.length) {
    lines.push("");
    lines.push("  UNMANIFESTED (on disk but not in manifest):");
    for (const p of r.findings.unmanifested.slice(0, 10))
      lines.push(`    - ${p}`);
    if (r.findings.unmanifested.length > 10)
      lines.push(
        `    ... and ${r.findings.unmanifested.length - 10} more`,
      );
  }
  if (r.findings.drift.length) {
    lines.push("");
    lines.push("  DRIFT (framework files whose sha256 changed):");
    for (const d of r.findings.drift.slice(0, 10))
      lines.push(
        `    - ${d.path}  ${d.manifest_sha.slice(0, 12)} → ${d.current_sha.slice(0, 12)}`,
      );
    if (r.findings.drift.length > 10)
      lines.push(`    ... and ${r.findings.drift.length - 10} more`);
  }
  if (r.findings.schema_violation.length) {
    lines.push("");
    lines.push("  SCHEMA VIOLATIONS:");
    for (const v of r.findings.schema_violation.slice(0, 10))
      lines.push(`    - ${v.path}: ${v.reason}`);
    if (r.findings.schema_violation.length > 10)
      lines.push(
        `    ... and ${r.findings.schema_violation.length - 10} more`,
      );
  }
  lines.push("");
  lines.push(
    `  result: ${r.ok ? "OK" : "FAIL"} (exit ${r.code})`,
  );
  return lines.join("\n") + "\n";
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printHelp();
    return 0;
  }
  const r = validate(opts);
  if (opts.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else if (!r.ok && r.code === 2) {
    process.stderr.write(`validate failed: ${r.error}\n`);
  } else {
    process.stdout.write(formatHuman(r));
  }
  return r.code || 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { validate, sha256OfFile };
