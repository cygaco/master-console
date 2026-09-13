#!/usr/bin/env node
/**
 * scripts/mc/settings/compile.js — compile .claude/settings.json
 * deterministically from a defaults layer and a per-project override
 * layer.
 *
 * SP-20260522-001 architecture-core. The three-layer model:
 *
 *   Layer 1: <defaults>        (framework default settings for this
 *                               MC version; e.g. _mc/settings/
 *                               defaults.json in installed products or
 *                               framework/settings/defaults.json in
 *                               canonical)
 *   Layer 2: settings.local    (per-project overrides — operator edits
 *                               THIS file directly)
 *   Layer 3: settings.json     (GENERATED effective state — do not
 *                               edit; regenerated on every compile)
 *
 * Merge semantics:
 *
 *   1. Top-level keys: shallow merge; local wins on conflicts.
 *   2. `env`: object merge; local wins per key.
 *   3. `permissions`: object merge; for allow/deny/ask sub-arrays,
 *      union + dedupe.
 *   4. `hooks`: structured merge. Each event key (Stop, Edit, Bash,
 *      etc.) is an array of { matcher, hooks: [...] } objects. We
 *      group by matcher, union the hooks arrays, dedupe by command
 *      string. FAIL LOUD on the same (event, matcher, command) tuple
 *      appearing in both layers with different additional fields
 *      (e.g. one with `timeout: 30` and one with `timeout: 60`).
 *   5. Unknown top-level keys: pass through (local wins).
 *
 * Failure modes are surfaced explicitly, not silently:
 *   - Defaults file missing             → exit 2
 *   - Defaults file parse error         → exit 2
 *   - Local file parse error (if exists) → exit 2
 *   - Hook command conflict             → exit 1, list both
 *   - Permission conflict (allow ↔ deny on same string) → exit 1
 *
 * Usage:
 *   node scripts/mc/settings/compile.js \
 *     [--defaults <path>]   # default: _mc/settings/defaults.json
 *     [--local <path>]      # default: .claude/settings.local.json
 *     [--out <path>]        # default: .claude/settings.json
 *     [--root <dir>]        # default: cwd; used to resolve relative paths
 *     [--check]             # read-only; exit 1 if out is stale
 *     [--json]              # emit summary as JSON
 *     [--dry-run]           # print compiled output to stdout, no write
 *
 * Exit codes:
 *   0  compiled successfully (or up-to-date in --check)
 *   1  conflict detected OR --check stale
 *   2  CLI parse error / missing required input / parse failure
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const COMPILER_VERSION = "mc/settings-compiler/v1";

function parseArgs(argv) {
  const out = {
    defaultsPath: null,
    localPath: null,
    outPath: null,
    root: process.cwd(),
    check: false,
    json: false,
    dryRun: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--defaults") out.defaultsPath = argv[++i];
    else if (a === "--local") out.localPath = argv[++i];
    else if (a === "--out") out.outPath = argv[++i];
    else if (a === "--root") out.root = path.resolve(argv[++i]);
    else if (a === "--check") out.check = true;
    else if (a === "--json") out.json = true;
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

function printHelp() {
  process.stdout.write(`
scripts/mc/settings/compile.js — three-layer settings compiler

Usage:
  node scripts/mc/settings/compile.js [flags]

Flags:
  --defaults <path>   default: <root>/_mc/settings/defaults.json
  --local <path>      default: <root>/.claude/settings.local.json
  --out <path>        default: <root>/.claude/settings.json
  --root <dir>        default: cwd; resolves default paths above
  --check             read-only; exit 1 if .claude/settings.json is stale
  --json              emit summary as JSON
  --dry-run           print compiled output to stdout, no write
  --help, -h          show this message

Exit codes:
  0  compiled / up-to-date
  1  conflict OR --check stale
  2  CLI/IO error
`);
}

function sha256Buf(buf) {
  const h = crypto.createHash("sha256");
  h.update(buf);
  return h.digest("hex");
}

function readJsonFile(file) {
  const raw = fs.readFileSync(file, "utf8");
  return JSON.parse(raw);
}

// ── Merge primitives ─────────────────────────────────────────────────

function isPlainObject(x) {
  return (
    x !== null &&
    typeof x === "object" &&
    !Array.isArray(x) &&
    Object.getPrototypeOf(x) === Object.prototype
  );
}

// Object-level merge: local keys overlay defaults' keys; values
// replaced wholesale unless both sides are plain objects (then we
// recurse).
function mergeObjects(defaults, local) {
  if (!isPlainObject(defaults)) return local !== undefined ? local : defaults;
  if (!isPlainObject(local)) return defaults;
  const out = {};
  const keys = new Set([...Object.keys(defaults), ...Object.keys(local)]);
  for (const k of keys) {
    if (k in local && k in defaults) {
      if (isPlainObject(defaults[k]) && isPlainObject(local[k])) {
        out[k] = mergeObjects(defaults[k], local[k]);
      } else {
        out[k] = local[k];
      }
    } else if (k in local) {
      out[k] = local[k];
    } else {
      out[k] = defaults[k];
    }
  }
  return out;
}

// Union + dedupe permissions arrays (allow/deny/ask).
function mergePermissionsBuckets(defaults = {}, local = {}) {
  const out = {};
  const buckets = new Set([
    ...Object.keys(defaults),
    ...Object.keys(local),
  ]);
  for (const bucket of buckets) {
    const d = Array.isArray(defaults[bucket]) ? defaults[bucket] : [];
    const l = Array.isArray(local[bucket]) ? local[bucket] : [];
    const seen = new Set();
    const merged = [];
    for (const item of [...d, ...l]) {
      const key = typeof item === "string" ? item : JSON.stringify(item);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    out[bucket] = merged;
  }
  return out;
}

// Detect permission conflicts: same string appearing in allow AND deny
// (or any other contradictory buckets). Returns array of conflict
// descriptions; empty if clean.
function detectPermissionConflicts(merged) {
  const conflicts = [];
  const allow = new Set(merged.allow || []);
  const deny = new Set(merged.deny || []);
  for (const a of allow) {
    if (deny.has(a)) {
      conflicts.push({
        kind: "allow_vs_deny",
        value: a,
      });
    }
  }
  return conflicts;
}

// Merge hooks block. Structure:
//   hooks: {
//     SessionStart: [
//       { matcher: "*", hooks: [{ type:"command", command:"...", timeout:30 }, ...] },
//       ...
//     ],
//     ...
//   }
// We group by matcher within each event, then dedupe by command string.
function mergeHooks(defaults = {}, local = {}) {
  const merged = {};
  const conflicts = [];
  const events = new Set([
    ...Object.keys(defaults),
    ...Object.keys(local),
  ]);
  for (const event of events) {
    const dEntries = Array.isArray(defaults[event]) ? defaults[event] : [];
    const lEntries = Array.isArray(local[event]) ? local[event] : [];
    // group by matcher
    const byMatcher = new Map();
    for (const entry of [...dEntries, ...lEntries]) {
      if (!entry || typeof entry !== "object") continue;
      const matcher = entry.matcher || "*";
      if (!byMatcher.has(matcher)) byMatcher.set(matcher, []);
      const arr = Array.isArray(entry.hooks) ? entry.hooks : [];
      byMatcher.get(matcher).push(...arr);
    }
    const eventOut = [];
    for (const [matcher, allHooks] of byMatcher) {
      // dedupe by command, but flag conflicts where same command has
      // different additional fields.
      const byCommand = new Map();
      for (const h of allHooks) {
        if (!h || typeof h !== "object") continue;
        const cmd = h.command || "";
        if (byCommand.has(cmd)) {
          const prev = byCommand.get(cmd);
          // Compare other fields (timeout, type, etc.)
          const prevKeys = Object.keys(prev).filter((k) => k !== "command");
          const newKeys = Object.keys(h).filter((k) => k !== "command");
          const sameKeys =
            prevKeys.length === newKeys.length &&
            prevKeys.every(
              (k) => JSON.stringify(prev[k]) === JSON.stringify(h[k]),
            );
          if (!sameKeys) {
            conflicts.push({
              kind: "hook_command_conflict",
              event,
              matcher,
              command: cmd,
              defaults_entry: prev,
              local_entry: h,
            });
          }
        } else {
          byCommand.set(cmd, h);
        }
      }
      eventOut.push({
        matcher,
        hooks: Array.from(byCommand.values()),
      });
    }
    merged[event] = eventOut;
  }
  return { merged, conflicts };
}

// ── Main compile ─────────────────────────────────────────────────────

function compile(opts) {
  const root = path.resolve(opts.root || process.cwd());
  const defaultsPath = path.resolve(
    opts.defaultsPath || path.join(root, "_mc", "settings", "defaults.json"),
  );
  const localPath = path.resolve(
    opts.localPath || path.join(root, ".claude", "settings.local.json"),
  );
  const outPath = path.resolve(
    opts.outPath || path.join(root, ".claude", "settings.json"),
  );

  if (!fs.existsSync(defaultsPath)) {
    return {
      ok: false,
      code: 2,
      error: `defaults not found at ${defaultsPath}`,
    };
  }
  let defaults;
  try {
    defaults = readJsonFile(defaultsPath);
  } catch (err) {
    return {
      ok: false,
      code: 2,
      error: `defaults parse: ${err.message}`,
    };
  }

  let local = {};
  if (fs.existsSync(localPath)) {
    try {
      local = readJsonFile(localPath);
    } catch (err) {
      return {
        ok: false,
        code: 2,
        error: `local parse: ${err.message}`,
      };
    }
  }

  // Compile
  // 1. Start with a top-level merge (env + arbitrary keys handled).
  const topMerged = mergeObjects(defaults, local);
  // 2. Permissions: union + conflict detection.
  const mergedPermissions = mergePermissionsBuckets(
    defaults.permissions,
    local.permissions,
  );
  const permConflicts = detectPermissionConflicts(mergedPermissions);
  // 3. Hooks: matcher-grouped merge with conflict detection.
  const { merged: mergedHooks, conflicts: hookConflicts } = mergeHooks(
    defaults.hooks,
    local.hooks,
  );
  // 4. Assemble final output.
  const compiled = { ...topMerged };
  compiled.permissions = mergedPermissions;
  compiled.hooks = mergedHooks;
  // Annotate provenance (operator can grep `compiledBy` to confirm
  // the file is regen-managed; the upcoming MANIFEST.json#paths
  // declares it owner=generated explicitly).
  compiled._compiledBy = COMPILER_VERSION;
  compiled._compiledAt = new Date().toISOString();
  compiled._defaultsSha = sha256Buf(fs.readFileSync(defaultsPath));
  if (fs.existsSync(localPath)) {
    compiled._localSha = sha256Buf(fs.readFileSync(localPath));
  } else {
    compiled._localSha = null;
  }

  const conflicts = [...permConflicts, ...hookConflicts];
  if (conflicts.length > 0) {
    return {
      ok: false,
      code: 1,
      error: `${conflicts.length} conflict(s) detected`,
      conflicts,
      defaultsPath,
      localPath: fs.existsSync(localPath) ? localPath : null,
    };
  }

  // Write or check
  const serialized = JSON.stringify(compiled, null, 2) + "\n";

  if (opts.dryRun) {
    return {
      ok: true,
      code: 0,
      mode: "dry-run",
      defaultsPath,
      localPath: fs.existsSync(localPath) ? localPath : null,
      outPath,
      compiledSha: sha256Buf(Buffer.from(serialized)),
      compiledPreview: serialized.slice(0, 2000),
    };
  }

  if (opts.check) {
    if (!fs.existsSync(outPath)) {
      return {
        ok: false,
        code: 1,
        mode: "check",
        stale: true,
        reason: "out file does not exist",
        defaultsPath,
        localPath: fs.existsSync(localPath) ? localPath : null,
        outPath,
      };
    }
    // Strip the volatile `_compiledAt` field from both sides before
    // comparing — the timestamp legitimately changes per run and
    // shouldn't trigger a stale verdict.
    const stripVolatile = (text) => {
      try {
        const obj = JSON.parse(text);
        delete obj._compiledAt;
        return JSON.stringify(obj, null, 2) + "\n";
      } catch {
        return text;
      }
    };
    const onDiskStripped = stripVolatile(fs.readFileSync(outPath, "utf8"));
    const compiledStripped = stripVolatile(serialized);
    const onDiskSha = sha256Buf(Buffer.from(onDiskStripped));
    const compiledSha = sha256Buf(Buffer.from(compiledStripped));
    return {
      ok: onDiskSha === compiledSha,
      code: onDiskSha === compiledSha ? 0 : 1,
      mode: "check",
      stale: onDiskSha !== compiledSha,
      onDiskSha,
      compiledSha,
      defaultsPath,
      localPath: fs.existsSync(localPath) ? localPath : null,
      outPath,
    };
  }

  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, serialized);
  } catch (err) {
    return {
      ok: false,
      code: 2,
      error: `write failed: ${err.message}`,
      outPath,
    };
  }

  return {
    ok: true,
    code: 0,
    mode: "apply",
    defaultsPath,
    localPath: fs.existsSync(localPath) ? localPath : null,
    outPath,
    compiledSha: sha256Buf(Buffer.from(serialized)),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────

function formatHuman(r) {
  if (!r.ok && r.code === 2) return `compile failed: ${r.error}\n`;
  if (!r.ok && r.conflicts) {
    const lines = ["compile FAILED — conflicts detected"];
    for (const c of r.conflicts.slice(0, 10)) {
      if (c.kind === "allow_vs_deny") {
        lines.push(`  - allow_vs_deny: "${c.value}" in both`);
      } else if (c.kind === "hook_command_conflict") {
        lines.push(
          `  - hook_command_conflict: event=${c.event} matcher=${c.matcher} command="${(c.command || "").slice(0, 40)}"`,
        );
      }
    }
    if (r.conflicts.length > 10)
      lines.push(`  ... and ${r.conflicts.length - 10} more`);
    return lines.join("\n") + "\n";
  }
  if (r.mode === "check") {
    return r.stale
      ? `compile --check: STALE (${r.outPath} sha=${r.onDiskSha ? r.onDiskSha.slice(0, 12) : "MISSING"} compiled sha=${r.compiledSha ? r.compiledSha.slice(0, 12) : "?"})\n`
      : `compile --check: OK\n`;
  }
  if (r.mode === "dry-run") {
    return `compile dry-run OK → ${r.outPath} (would write sha=${r.compiledSha.slice(0, 12)})\n`;
  }
  return `compile OK → ${r.outPath} (sha=${r.compiledSha.slice(0, 12)})\n`;
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printHelp();
    return 0;
  }
  const r = compile(opts);
  if (opts.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else if (!r.ok && r.code === 2) {
    process.stderr.write(formatHuman(r));
  } else {
    process.stdout.write(formatHuman(r));
  }
  return r.code;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  compile,
  mergeObjects,
  mergePermissionsBuckets,
  detectPermissionConflicts,
  mergeHooks,
};
