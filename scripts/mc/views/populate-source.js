#!/usr/bin/env node
/**
 * scripts/mc/views/populate-source.js — populate a product's `_mc/`
 * framework SOURCE mirror so scripts/mc/views/regenerate.js does real work.
 *
 * SP-20260525-003 / _mc-zone source-mirror migration.
 *
 * THE MODEL (see regenerate.js docstring + Strategy line 17):
 *   A product holds framework SOURCE at `_mc/` (a mirror); `.claude/` is the
 *   COMPILED VIEW regenerated from it. `_mc/MANIFEST.json` maps dest-rel →
 *   {owner, source, ...}. For owner=framework view entries (commands, agents,
 *   reference, agent .system policy json), build.js — run with
 *   `--source-prefix _mc` in a product — sets `source` to the file's mirror
 *   under `_mc/` (e.g. `.claude/commands/foo.md` → `_mc/commands/foo.md`).
 *   regenerate.js then copies `_mc/<source>` → `<dest>` when they differ.
 *
 * Before this migration, /mc:setup copied framework files ONLY to the product
 * root + `.claude/`, and created NO `_mc/` — so the manifest's view entries
 * had no real source mirror and regenerate.js was inert in products. This
 * populates that mirror.
 *
 * WHAT IS MIRRORED (the regenerate.js working set — exactly the dest patterns
 * build.js assigns a `_mc/` source pointer to when sourcePrefix=_mc):
 *   - .claude/commands/**.md                          (framework-claude-command)
 *   - .claude/agents/**.md (except decision-policy.md) (framework-claude-agent)
 *   - .claude/project/reference/**                     (framework-claude-reference)
 *   - .claude/agents/**\/_system/*.json|*.schema.json  (framework-agent-system-data)
 *   - .claude/agents/_org|_principles|_evals/**        (framework-manager-data)
 *   - .claude/kernel/**                                (framework-kernel)
 *   - .claude/schemas/**                               (framework-claude-schemas)
 * plus _mc/settings/defaults.json (the layered-settings compiler source,
 * referenced by the generated-settings rule's compiled_from).
 * (INC-2.5 / ED-249: added kernel/schemas + the _org/_principles/_evals and
 * _system trees; corrected the pre-ADR-0007 `.system` → `_system` rename.
 * test-build.js section F enforces this list stays == build.js#buildRules.)
 *
 * Runtime files under .claude/agents/**\/_system/ (events.jsonl) are NOT
 * mirrored — build.js classifies them owner=runtime (no source pointer), and
 * regenerate.js never touches them.
 *
 * SOURCE OF TRUTH: the canonical MC clone (`mcRoot`). We mirror the
 * canonical file content — NOT the product's possibly-edited `.claude/` — so a
 * fresh `_mc/` always reflects the shipped framework. The authoritative
 * list of shipped view files is `.claude/framework-manifest.json#assets` in the
 * canonical clone (the same list /mc:setup installs from), filtered to the
 * working-set patterns. This guarantees the mirror EXACTLY matches what build.js
 * will point `source` at.
 *
 * IDEMPOTENT: a re-run is the migration path for existing products. We copy a
 * file only when the `_mc/` mirror is missing or differs from the canonical
 * source (content-addressed). Existing identical mirrors are left untouched.
 *
 * Usage (programmatic — how warp-setup.js calls it):
 *   const { populateSource } = require(".../views/populate-source.js");
 *   const r = populateSource({ targetRoot, mcRoot, shipManifest });
 *
 * Usage (CLI — for re-mirroring / debugging):
 *   node scripts/mc/views/populate-source.js \
 *     --target <product-root> [--mc <canonical-clone>] [--json] [--quiet]
 *
 * Exit codes:
 *   0  mirror populated / already current
 *   1  copy failure
 *   2  CLI/IO error (missing manifest, bad root)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CLAUDE_PREFIX = ".claude/";
const MC_PREFIX = "_mc/";

/**
 * Decide whether a shipped `.claude/<...>` dest is part of the regenerate
 * working set — i.e. whether build.js (sourcePrefix=_mc) would give it a
 * `_mc/` source pointer. Kept in lock-step with build.js#buildRules.
 *
 * Returns the dest-relative path (e.g. ".claude/commands/foo.md") if it should
 * be mirrored, or null otherwise.
 */
function isFrameworkViewDest(dest) {
  if (!dest || !dest.startsWith(CLAUDE_PREFIX)) return null;
  // commands: any .md
  if (dest.startsWith(".claude/commands/") && dest.endsWith(".md")) return dest;
  // reference: anything under project/reference/
  if (dest.startsWith(".claude/project/reference/")) return dest;
  // MC 1.0 kernel (build.js framework-kernel rule): the Top-Level Runtime
  // Contract + JSON companions + conformance fixtures under .claude/kernel/.
  // Framework view mirrored to _mc/kernel/ in products (paths.kernel).
  if (dest.startsWith(".claude/kernel/")) return dest;
  // MC 1.0 machine-readable schemas (build.js framework-claude-schemas rule):
  // .claude/schemas/ mirrored to _mc/schemas/ in products.
  if (dest.startsWith(".claude/schemas/")) return dest;
  // agents .md (decision-policy.md is owner=project — seeded, not a view).
  // ADR-0007 renamed .system → _system; the carve-out must match the REAL
  // (underscore) path or decision-policy.md gets wrongly pulled into the mirror.
  if (
    dest.startsWith(".claude/agents/") &&
    dest.endsWith(".md") &&
    !dest.includes("/_system/policy/decision-policy.md")
  ) {
    return dest;
  }
  // agent _system json / schema.json (NOT events.jsonl — those are runtime).
  // build.js framework-agent-system-data rule. ADR-0007 renamed .system →
  // _system; the pre-cutover dot form matched nothing here, leaving the
  // _system policy/schema data files un-mirrored (INC-2.5 / ED-249 sweep).
  if (
    dest.startsWith(".claude/agents/") &&
    dest.includes("/_system/") &&
    (dest.endsWith(".json") || dest.endsWith(".schema.json"))
  ) {
    return dest;
  }
  // org-governance machine-readable data under _org/_principles/_evals
  // (build.js framework-manager-data rule, ADR-0007) — the .json data files not
  // caught by the agents-.md case above. Framework view; mirrored to _mc/.
  if (/^\.claude\/agents\/_(org|principles|evals)\//.test(dest)) return dest;
  return null;
}

/**
 * Translate a `.claude/<rel>` dest into its `_mc/<rel>` mirror path —
 * the exact transform build.js applies (rel.replace(/^\.claude\//, "")).
 */
function destToMirrorRel(dest) {
  return MC_PREFIX + dest.slice(CLAUDE_PREFIX.length);
}

function sha256OfFile(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function sha256OfBuffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Copy `srcAbs` → `destAbs` only when the destination is missing or differs.
 * Returns "copied" | "unchanged" | "missing_source".
 */
function copyIfChanged(srcAbs, destAbs) {
  if (!fs.existsSync(srcAbs)) return "missing_source";
  const srcBuf = fs.readFileSync(srcAbs);
  if (fs.existsSync(destAbs)) {
    try {
      if (sha256OfFile(destAbs) === sha256OfBuffer(srcBuf)) return "unchanged";
    } catch {
      /* fall through to write */
    }
  }
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.writeFileSync(destAbs, srcBuf);
  return "copied";
}

/**
 * populateSource — core entry. Mirrors the framework view source into the
 * product's `_mc/`.
 *
 * @param {object}  opts
 * @param {string}  opts.targetRoot    product root (where `_mc/` is written)
 * @param {string}  opts.mcRoot    canonical MC clone (source of truth)
 * @param {object} [opts.shipManifest] pre-parsed framework-manifest; read from
 *                                     mcRoot/.claude/framework-manifest.json
 *                                     when omitted
 * @returns {{ok, code, copied, unchanged, missingSource, failed, mirroredCount, error?}}
 */
function populateSource(opts) {
  const targetRoot = path.resolve(opts.targetRoot);
  const mcRoot = path.resolve(opts.mcRoot);

  if (!fs.existsSync(targetRoot) || !fs.statSync(targetRoot).isDirectory()) {
    return { ok: false, code: 2, error: `target not a directory: ${targetRoot}` };
  }
  if (!fs.existsSync(mcRoot) || !fs.statSync(mcRoot).isDirectory()) {
    return { ok: false, code: 2, error: `mc root not a directory: ${mcRoot}` };
  }

  let shipManifest = opts.shipManifest;
  if (!shipManifest) {
    const mp = path.join(mcRoot, ".claude", "framework-manifest.json");
    try {
      shipManifest = JSON.parse(fs.readFileSync(mp, "utf8"));
    } catch (e) {
      return { ok: false, code: 2, error: `cannot read framework-manifest: ${e.message}` };
    }
  }

  const result = {
    ok: true,
    code: 0,
    copied: [],
    unchanged: [],
    missingSource: [],
    failed: [],
  };

  // Build the mirror plan from the ship-manifest assets, filtered to the
  // regenerate working set. Source = canonical clone's `<entry.src>` (which,
  // for .claude assets, equals the dest path in canonical). Dest = product's
  // `_mc/<dest minus .claude/>`.
  const seenMirror = new Set();
  for (const entries of Object.values(shipManifest.assets || {})) {
    for (const entry of entries) {
      const dest = entry.dest;
      if (!isFrameworkViewDest(dest)) continue;
      const mirrorRel = destToMirrorRel(dest);
      if (seenMirror.has(mirrorRel)) continue;
      seenMirror.add(mirrorRel);
      // Canonical source: prefer the manifest's `src` (path inside the clone);
      // it equals the dest for .claude assets but stay faithful to the manifest.
      const srcAbs = path.join(mcRoot, entry.src || dest);
      const destAbs = path.join(targetRoot, mirrorRel);
      try {
        const verdict = copyIfChanged(srcAbs, destAbs);
        if (verdict === "copied") result.copied.push(mirrorRel);
        else if (verdict === "unchanged") result.unchanged.push(mirrorRel);
        else result.missingSource.push({ mirror: mirrorRel, src: entry.src || dest });
      } catch (err) {
        result.failed.push({ mirror: mirrorRel, reason: err.message });
      }
    }
  }

  // Also mirror the layered-settings compiler source. It is NOT a regenerate
  // copy target (owner=generated), but build.js references it in
  // compiled_from, and warp-setup.js's settings-compile path activates when
  // it is present. Source it directly from the canonical `_mc/settings/`.
  const settingsRel = "_mc/settings/defaults.json";
  const settingsSrc = path.join(mcRoot, settingsRel);
  if (fs.existsSync(settingsSrc)) {
    const settingsDest = path.join(targetRoot, settingsRel);
    try {
      const verdict = copyIfChanged(settingsSrc, settingsDest);
      if (verdict === "copied") result.copied.push(settingsRel);
      else if (verdict === "unchanged") result.unchanged.push(settingsRel);
    } catch (err) {
      result.failed.push({ mirror: settingsRel, reason: err.message });
    }
  }

  result.mirroredCount = result.copied.length + result.unchanged.length;
  if (result.failed.length > 0) {
    result.ok = false;
    result.code = 1;
  }
  return result;
}

// ── CLI ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { target: null, mc: null, json: false, quiet: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--target") out.target = argv[++i];
    else if (a === "--mc") out.mc = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--quiet") out.quiet = true;
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help || !opts.target) {
    process.stdout.write(
      `scripts/mc/views/populate-source.js — mirror framework source into a product's _mc/\n\n` +
        `Usage:\n  node scripts/mc/views/populate-source.js --target <product-root> [--mc <clone>] [--json] [--quiet]\n\n` +
        `--mc defaults to the clone this script lives in.\n`,
    );
    return opts.help ? 0 : 2;
  }
  const mcRoot = opts.mc || path.resolve(__dirname, "..", "..", "..");
  const r = populateSource({ targetRoot: opts.target, mcRoot });
  if (opts.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else if (!r.ok && r.code === 2) {
    process.stderr.write(`populate-source failed: ${r.error}\n`);
  } else if (!opts.quiet) {
    process.stdout.write(
      `populate-source: ${r.copied.length} copied, ${r.unchanged.length} unchanged, ` +
        `${r.missingSource.length} missing-source, ${r.failed.length} failed ` +
        `(mirror total: ${r.mirroredCount})\n`,
    );
    if (r.failed.length) {
      for (const f of r.failed.slice(0, 10)) {
        process.stderr.write(`  FAIL ${f.mirror}: ${f.reason}\n`);
      }
    }
  }
  return r.code || 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  populateSource,
  isFrameworkViewDest,
  destToMirrorRel,
};
