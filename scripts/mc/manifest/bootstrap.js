#!/usr/bin/env node
/**
 * scripts/mc/manifest/bootstrap.js — migrate an existing MC install
 * into the _mc/ source-of-truth architecture.
 *
 * SP-20260522-004 / T-20260523-193. Converts a pre-_mc install (any
 * installed product, or canonical-as-workspace) into the new layout: creates _mc/
 * at product root, copies framework-owned content from a source canonical
 * clone, generates an initial MANIFEST.json via build.js, rewrites
 * .claude/settings.json hook command paths from scripts/hooks/ to
 * _mc/hooks/, optionally regenerates .claude/commands + .claude/agents
 * views via regenerate.js, and runs validate.js --strict for a clean-state
 * attestation.
 *
 * Usage:
 *   node scripts/mc/manifest/bootstrap.js \
 *     [--root <dir>]              # default: cwd
 *     [--source <canonical-clone>] # default: discover (sibling, framework-installed.json#source)
 *     [--force]                   # overwrite existing _mc/ (default: refuse)
 *     [--dry-run]                 # print plan, write nothing
 *     [--json]                    # machine-readable summary
 *     [--skip-views]              # don't invoke regenerate.js
 *     [--skip-validate]           # don't invoke validate.js --strict
 *     [--help]
 *
 * Exit codes:
 *   0  bootstrap succeeded (or dry-run printed)
 *   1  refused: canonical mode / existing _mc without --force / unknown mode / no .claude/
 *   2  CLI parse error
 *   3  source-canonical-clone discovery failed
 *   4  copy failure
 *   5  manifest generation failure
 *   6  validate failure (only when --skip-validate omitted)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { isCanonicalDir } = require("../repo-role");

const FRAMEWORK_SUBDIRS = [
  "commands",
  "agents",
  "hooks",
  "schemas",
  "templates",
  "reference",
];

function parseArgs(argv) {
  const out = {
    root: process.cwd(),
    source: null,
    force: false,
    dryRun: false,
    json: false,
    skipViews: false,
    skipValidate: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--root") out.root = path.resolve(argv[++i]);
    else if (a === "--source") out.source = path.resolve(argv[++i]);
    else if (a === "--force") out.force = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--json") out.json = true;
    else if (a === "--skip-views") out.skipViews = true;
    else if (a === "--skip-validate") out.skipValidate = true;
    else {
      process.stderr.write(`bootstrap: unknown flag ${a}\n`);
      return null;
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(`
scripts/mc/manifest/bootstrap.js — migrate MC install to _mc/ architecture

Usage:
  node scripts/mc/manifest/bootstrap.js [flags]

Flags:
  --root <dir>           target directory to bootstrap (default: cwd)
  --source <dir>         explicit source canonical-clone (default: discover)
  --force                overwrite existing _mc/ (default: refuse)
  --dry-run              print plan, write nothing
  --json                 emit summary as JSON
  --skip-views           don't invoke views/regenerate.js
  --skip-validate        don't invoke manifest/validate.js --strict
  --help, -h             show this message

Exit codes: 0 ok, 1 refused, 2 cli, 3 no-source, 4 copy-fail, 5 manifest-fail, 6 validate-fail
`);
}

// ── Mode detection ───────────────────────────────────────────────────

function detectMode(root) {
  const hasWarpos = fs.existsSync(path.join(root, "_mc"));
  const hasFramework = fs.existsSync(path.join(root, "framework"));
  const hasScriptsHooks = fs.existsSync(path.join(root, "scripts", "hooks"));
  const hasClaude = fs.existsSync(path.join(root, ".claude"));
  const hasFrameworkInstalled = fs.existsSync(
    path.join(root, ".claude", "framework-installed.json"),
  );

  // Canonical: the shared resolver flags this dir as the MC canonical tree
  // (ED-009 single source — the env-immune isCanonicalDir, which subsumes the
  // _mc/MANIFEST.json marker) AND framework/ is present (the canonical SOURCE
  // clone, vs an already-migrated product that kept _mc/ but shed framework/).
  // Routing canonical detection through the resolver keeps bootstrap off an inline
  // role-derivation check (the recurring false-green class the ED-009 invariant ends).
  if (isCanonicalDir(root) && hasFramework) {
    return {
      mode: "canonical",
      reason:
        "repo-role canonical signal + framework/ both present (canonical clone)",
    };
  }
  // Product (already bootstrapped): has _mc/ but no framework/ — already migrated.
  if (hasWarpos && !hasFramework) {
    return {
      mode: "product-bootstrapped",
      reason: "_mc/ exists but no framework/ (already migrated)",
    };
  }
  // Product (pre-bootstrap): no _mc/ but has .claude/ + (scripts/hooks/ OR framework-installed.json).
  if (!hasWarpos && hasClaude && (hasScriptsHooks || hasFrameworkInstalled)) {
    return {
      mode: "product",
      reason:
        "no _mc/ + .claude/ present + " +
        (hasScriptsHooks
          ? "scripts/hooks/ present"
          : "framework-installed.json present"),
    };
  }
  // No .claude/ at all.
  if (!hasClaude) {
    return {
      mode: "no-claude",
      reason: "no .claude/ directory — run /warp:setup first",
    };
  }
  return {
    mode: "unknown",
    reason: `cannot detect mode (hasWarpos=${hasWarpos} hasFramework=${hasFramework} hasScriptsHooks=${hasScriptsHooks} hasFrameworkInstalled=${hasFrameworkInstalled})`,
  };
}

// ── Source canonical-clone discovery ─────────────────────────────────

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function discoverSource(root, explicit) {
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      return {
        ok: false,
        reason: `--source ${explicit} does not exist`,
      };
    }
    return { ok: true, source: explicit, via: "--source flag" };
  }
  // Try framework-installed.json#source
  const fi = readJsonSafe(
    path.join(root, ".claude", "framework-installed.json"),
  );
  if (fi && typeof fi.source === "string" && fs.existsSync(fi.source)) {
    return {
      ok: true,
      source: path.resolve(fi.source),
      via: "framework-installed.json#source",
    };
  }
  // Sibling-clone heuristic.
  const parent = path.dirname(root);
  const candidates = ["MC", "mc", "Warpos"];
  for (const c of candidates) {
    const cand = path.join(parent, c);
    if (
      fs.existsSync(cand) &&
      (fs.existsSync(path.join(cand, "framework")) ||
        fs.existsSync(path.join(cand, "_mc")))
    ) {
      return {
        ok: true,
        source: cand,
        via: `sibling-clone heuristic (${c})`,
      };
    }
  }
  return {
    ok: false,
    reason:
      "no --source flag, no framework-installed.json#source, no sibling clone found (tried ../MC, ../mc, ../Warpos)",
  };
}

// ── Source layout resolution ─────────────────────────────────────────

// Resolve where in the source to read each subdir from. Canonical sources
// have content under framework/; already-bootstrapped sources have content
// under _mc/. We prefer framework/ if both exist (canonical wins).
function resolveSourceLayout(source) {
  const hasFramework = fs.existsSync(path.join(source, "framework"));
  const hasWarpos = fs.existsSync(path.join(source, "_mc"));
  if (hasFramework) {
    return { ok: true, layout: "framework", base: path.join(source, "framework") };
  }
  if (hasWarpos) {
    return { ok: true, layout: "_mc", base: path.join(source, "_mc") };
  }
  return {
    ok: false,
    reason: `source ${source} has neither framework/ nor _mc/`,
  };
}

// Special-case hooks: canonical may store them under scripts/hooks/ instead
// of framework/hooks/. Resolve dynamically.
function resolveHooksSource(source, layoutBase) {
  const inLayout = path.join(layoutBase, "hooks");
  if (fs.existsSync(inLayout)) return inLayout;
  const scriptsHooks = path.join(source, "scripts", "hooks");
  if (fs.existsSync(scriptsHooks)) return scriptsHooks;
  return null;
}

// Special-case settings/defaults.json: optional file.
function resolveSettingsDefaultsSource(layoutBase) {
  const p = path.join(layoutBase, "settings", "defaults.json");
  return fs.existsSync(p) ? p : null;
}

// ── Safe copy ────────────────────────────────────────────────────────

function* walkFiles(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walkFiles(p);
    else if (ent.isFile()) yield p;
  }
}

function safeCopyDir(srcDir, dstDir, { force, dryRun }) {
  let copied = 0;
  let skipped = 0;
  if (!fs.existsSync(srcDir)) return { copied, skipped, missing: true };
  for (const srcFile of walkFiles(srcDir)) {
    const rel = path.relative(srcDir, srcFile);
    const dstFile = path.join(dstDir, rel);
    if (fs.existsSync(dstFile) && !force) {
      skipped++;
      continue;
    }
    if (!dryRun) {
      fs.mkdirSync(path.dirname(dstFile), { recursive: true });
      fs.copyFileSync(srcFile, dstFile);
    }
    copied++;
  }
  return { copied, skipped, missing: false };
}

function safeCopyFile(srcFile, dstFile, { force, dryRun }) {
  if (!fs.existsSync(srcFile)) return { copied: 0, skipped: 0, missing: true };
  if (fs.existsSync(dstFile) && !force) return { copied: 0, skipped: 1, missing: false };
  if (!dryRun) {
    fs.mkdirSync(path.dirname(dstFile), { recursive: true });
    fs.copyFileSync(srcFile, dstFile);
  }
  return { copied: 1, skipped: 0, missing: false };
}

// ── Settings.json hook-path rewriter ─────────────────────────────────

const HOOK_PATH_FROM = /(^|[\s"'])scripts\/hooks\//g;
const HOOK_PATH_FROM_WIN = /(^|[\s"'])scripts\\hooks\\/g;

function rewriteHookPathsInString(s) {
  if (typeof s !== "string") return { value: s, changed: 0 };
  let changed = 0;
  let out = s.replace(HOOK_PATH_FROM, (m, pre) => {
    changed++;
    return `${pre}_mc/hooks/`;
  });
  out = out.replace(HOOK_PATH_FROM_WIN, (m, pre) => {
    changed++;
    return `${pre}_mc\\hooks\\`;
  });
  return { value: out, changed };
}

function rewriteHooksBlock(hooks) {
  // Walk the hooks tree; rewrite any string value containing scripts/hooks/.
  let totalChanged = 0;
  function walk(node) {
    if (typeof node === "string") {
      const r = rewriteHookPathsInString(node);
      totalChanged += r.changed;
      return r.value;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v);
      return out;
    }
    return node;
  }
  const out = walk(hooks);
  return { value: out, changed: totalChanged };
}

function rewriteSettingsJson(settingsPath, { dryRun }) {
  if (!fs.existsSync(settingsPath)) {
    return { ok: false, reason: "settings.json not found", changed: 0 };
  }
  const original = fs.readFileSync(settingsPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(original);
  } catch (e) {
    return {
      ok: false,
      reason: `settings.json is invalid JSON: ${e.message}`,
      changed: 0,
    };
  }
  if (!parsed.hooks || typeof parsed.hooks !== "object") {
    return { ok: true, changed: 0, reason: "no hooks block to rewrite" };
  }
  const r = rewriteHooksBlock(parsed.hooks);
  parsed.hooks = r.value;
  if (r.changed === 0) return { ok: true, changed: 0, reason: "no scripts/hooks/ paths found in hooks block" };
  const updated = JSON.stringify(parsed, null, 2) + (original.endsWith("\n") ? "\n" : "");
  if (!dryRun) fs.writeFileSync(settingsPath, updated, "utf8");
  return { ok: true, changed: r.changed };
}

// ── Subprocess invokers ──────────────────────────────────────────────

function invokeNode(scriptPath, args, cwd) {
  const res = spawnSync(
    process.execPath,
    [scriptPath, ...args],
    { cwd, encoding: "utf8" },
  );
  return {
    status: res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    error: res.error ? res.error.message : null,
  };
}

function runBuildManifest(args, { sourceRoot, targetRoot, dryRun }) {
  // Prefer source's build.js (canonical-issued); fall back to target's own if missing.
  const sourceScript = path.join(
    sourceRoot,
    "scripts",
    "mc",
    "manifest",
    "build.js",
  );
  const targetScript = path.join(
    targetRoot,
    "scripts",
    "mc",
    "manifest",
    "build.js",
  );
  const script = fs.existsSync(sourceScript) ? sourceScript : targetScript;
  if (!fs.existsSync(script)) {
    return {
      status: 5,
      stdout: "",
      stderr: `build.js not found in source or target`,
      error: null,
    };
  }
  const allArgs = ["--root", targetRoot, "--source-prefix", "_mc", ...args];
  if (dryRun) allArgs.push("--dry-run");
  return invokeNode(script, allArgs, targetRoot);
}

function runRegenerateViews({ sourceRoot, targetRoot, dryRun }) {
  const sourceScript = path.join(
    sourceRoot,
    "scripts",
    "mc",
    "views",
    "regenerate.js",
  );
  const targetScript = path.join(
    targetRoot,
    "scripts",
    "mc",
    "views",
    "regenerate.js",
  );
  const script = fs.existsSync(sourceScript) ? sourceScript : targetScript;
  if (!fs.existsSync(script)) {
    return { status: -1, stdout: "", stderr: "regenerate.js not available", skipped: true };
  }
  const args = ["--root", targetRoot];
  if (dryRun) args.push("--check"); // dry-run via --check mode
  return invokeNode(script, args, targetRoot);
}

function runValidate({ sourceRoot, targetRoot }) {
  const sourceScript = path.join(
    sourceRoot,
    "scripts",
    "mc",
    "manifest",
    "validate.js",
  );
  const targetScript = path.join(
    targetRoot,
    "scripts",
    "mc",
    "manifest",
    "validate.js",
  );
  const script = fs.existsSync(sourceScript) ? sourceScript : targetScript;
  if (!fs.existsSync(script)) {
    return { status: -1, stdout: "", stderr: "validate.js not available", skipped: true };
  }
  return invokeNode(script, ["--root", targetRoot, "--strict"], targetRoot);
}

// ── Main ─────────────────────────────────────────────────────────────

function emitSummary(summary, opts) {
  if (opts.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    return;
  }
  const lines = [];
  lines.push(`bootstrap: mode=${summary.mode}`);
  lines.push(`  source: ${summary.source} (via ${summary.sourceVia})`);
  lines.push(`  target: ${summary.target}`);
  lines.push(`  files copied: ${summary.filesCopied}`);
  lines.push(`  files skipped (existed, no --force): ${summary.filesSkipped}`);
  lines.push(`  hook paths rewritten in settings.json: ${summary.hookPathsRewritten}`);
  if (summary.manifestGenerated) lines.push(`  manifest: generated`);
  if (summary.viewsRegenerated) lines.push(`  views: regenerated`);
  else if (summary.skipViews) lines.push(`  views: skipped (--skip-views)`);
  if (summary.validate)
    lines.push(`  validate: ${summary.validate.status === 0 ? "OK (--strict)" : "findings (see stderr)"}`);
  else if (summary.skipValidate) lines.push(`  validate: skipped (--skip-validate)`);
  if (summary.dryRun) lines.push(`  (dry-run — no files written)`);
  process.stdout.write(lines.join("\n") + "\n");
}

function main(argv) {
  const opts = parseArgs(argv);
  if (!opts) return 2;
  if (opts.help) {
    printHelp();
    return 0;
  }

  // Validate root.
  if (!fs.existsSync(opts.root)) {
    process.stderr.write(`bootstrap: --root ${opts.root} does not exist\n`);
    return 2;
  }

  // Detect mode.
  const detect = detectMode(opts.root);
  if (detect.mode === "canonical") {
    process.stderr.write(
      `bootstrap: refusing — canonical mode (${detect.reason}). bootstrap is for product migration only.\n`,
    );
    return 1;
  }
  if (detect.mode === "no-claude") {
    process.stderr.write(
      `bootstrap: refusing — ${detect.reason}.\n`,
    );
    return 1;
  }
  if (detect.mode === "unknown") {
    process.stderr.write(`bootstrap: refusing — ${detect.reason}.\n`);
    return 1;
  }
  if (detect.mode === "product-bootstrapped" && !opts.force) {
    process.stderr.write(
      `bootstrap: refusing — _mc/ already exists. Re-run with --force to re-bootstrap.\n`,
    );
    return 1;
  }
  // Partial state check: if _mc exists but lacks key subdirs (re-bootstrap case),
  // require --force.
  if (detect.mode === "product-bootstrapped" && opts.force) {
    // Allow re-bootstrap.
  }

  // Discover source.
  const src = discoverSource(opts.root, opts.source);
  if (!src.ok) {
    process.stderr.write(`bootstrap: ${src.reason}\n`);
    return 3;
  }

  // Resolve source layout.
  const layout = resolveSourceLayout(src.source);
  if (!layout.ok) {
    process.stderr.write(`bootstrap: ${layout.reason}\n`);
    return 3;
  }

  const summary = {
    mode: detect.mode,
    detectReason: detect.reason,
    source: src.source,
    sourceVia: src.via,
    sourceLayout: layout.layout,
    target: opts.root,
    filesCopied: 0,
    filesSkipped: 0,
    hookPathsRewritten: 0,
    manifestGenerated: false,
    viewsRegenerated: false,
    validate: null,
    skipViews: opts.skipViews,
    skipValidate: opts.skipValidate,
    dryRun: opts.dryRun,
    perSubdir: {},
  };

  // 5. Copy framework-owned content.
  for (const sub of FRAMEWORK_SUBDIRS) {
    let srcSubdir;
    if (sub === "hooks") {
      srcSubdir = resolveHooksSource(src.source, layout.base);
    } else {
      srcSubdir = path.join(layout.base, sub);
    }
    if (!srcSubdir || !fs.existsSync(srcSubdir)) {
      summary.perSubdir[sub] = { copied: 0, skipped: 0, missing: true };
      continue;
    }
    const dstSubdir = path.join(opts.root, "_mc", sub);
    const r = safeCopyDir(srcSubdir, dstSubdir, {
      force: opts.force,
      dryRun: opts.dryRun,
    });
    summary.perSubdir[sub] = r;
    summary.filesCopied += r.copied;
    summary.filesSkipped += r.skipped;
  }
  // settings/defaults.json (optional)
  const settingsDefaults = resolveSettingsDefaultsSource(layout.base);
  if (settingsDefaults) {
    const dst = path.join(opts.root, "_mc", "settings", "defaults.json");
    const r = safeCopyFile(settingsDefaults, dst, {
      force: opts.force,
      dryRun: opts.dryRun,
    });
    summary.perSubdir["settings/defaults.json"] = r;
    summary.filesCopied += r.copied;
    summary.filesSkipped += r.skipped;
  }

  // 6. Generate initial MANIFEST.json (skip on dry-run — build.js itself supports dry-run but cwd state matters).
  if (!opts.dryRun) {
    const build = runBuildManifest([], {
      sourceRoot: src.source,
      targetRoot: opts.root,
      dryRun: false,
    });
    if (build.status !== 0) {
      process.stderr.write(`bootstrap: manifest generation failed (exit ${build.status})\n`);
      process.stderr.write(build.stderr || build.stdout);
      return 5;
    }
    summary.manifestGenerated = true;
  }

  // 7. Rewrite .claude/settings.json hook paths.
  const settingsPath = path.join(opts.root, ".claude", "settings.json");
  const rw = rewriteSettingsJson(settingsPath, { dryRun: opts.dryRun });
  if (!rw.ok) {
    process.stderr.write(`bootstrap: settings.json rewrite failed — ${rw.reason}\n`);
    // Non-fatal — manifest still useful. Surface but continue.
  } else {
    summary.hookPathsRewritten = rw.changed;
  }

  // 8. Regenerate views (unless --skip-views).
  if (!opts.skipViews && !opts.dryRun) {
    const regen = runRegenerateViews({
      sourceRoot: src.source,
      targetRoot: opts.root,
      dryRun: false,
    });
    if (regen.skipped) {
      summary.viewsRegenerated = false;
    } else if (regen.status === 0) {
      summary.viewsRegenerated = true;
    } else {
      process.stderr.write(`bootstrap: views regenerate non-zero (exit ${regen.status}) — continuing\n`);
      process.stderr.write(regen.stderr || regen.stdout);
    }
  }

  // 9. Validate (unless --skip-validate).
  if (!opts.skipValidate && !opts.dryRun) {
    const val = runValidate({
      sourceRoot: src.source,
      targetRoot: opts.root,
    });
    summary.validate = { status: val.status, stdout: val.stdout, stderr: val.stderr };
    if (val.skipped) {
      // validate.js missing — surface but don't fail.
    } else if (val.status !== 0) {
      process.stderr.write(`bootstrap: validate --strict reported findings (exit ${val.status})\n`);
      if (val.stdout) process.stderr.write(val.stdout);
      if (val.stderr) process.stderr.write(val.stderr);
      emitSummary(summary, opts);
      return 6;
    }
  }

  emitSummary(summary, opts);
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = {
  parseArgs,
  detectMode,
  discoverSource,
  resolveSourceLayout,
  resolveHooksSource,
  resolveSettingsDefaultsSource,
  rewriteHookPathsInString,
  rewriteHooksBlock,
  rewriteSettingsJson,
  safeCopyDir,
  safeCopyFile,
  main,
};
