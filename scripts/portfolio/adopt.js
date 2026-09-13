"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const RESERVED = new Set([
  "list", "register", "open", "new", "adopt", "status",
  "dispatch", "sync", "bootstrap", "clone", "ponder", "import",
]);

const MC_ROOT = path.resolve(__dirname, "../..");

// ── argv parsing ───────────────────────────────────────────
const args = process.argv.slice(2);
const targetPathIdx = args.indexOf("--target-path");
const skipNew = args.includes("--skip-new");
const targetPath = targetPathIdx !== -1 ? args[targetPathIdx + 1] : null;
// First positional arg (not a flag, and not the value-slot of --target-path) is the slug.
const slug = args.filter((a, i) => {
  if (a.startsWith("--")) return false;
  if (targetPathIdx !== -1 && i === targetPathIdx + 1) return false;
  return true;
})[0];

// ── validation ─────────────────────────────────────────────
if (!slug) {
  console.error("Usage (engine for /portfolio:new --from-brief): node adopt.js <slug>");
  process.exit(2);
}
if (!SLUG_RE.test(slug)) {
  console.error(`slug must match ^[a-z0-9][a-z0-9-]{0,63}$ (got: ${JSON.stringify(slug)})`);
  process.exit(2);
}
if (RESERVED.has(slug)) {
  console.error(`'${slug}' collides with a reserved skill name. Choose a different slug.`);
  process.exit(2);
}

// ── locate brief ───────────────────────────────────────────
const briefsRoot = path.resolve(MC_ROOT, "_docs/briefs");
const clonesRoot = path.resolve(MC_ROOT, "_docs/clones");
const briefPath = _locateBrief(slug, briefsRoot, clonesRoot);

if (!briefPath) {
  console.error(
    `Brief not found for '${slug}'.\n` +
    `  Tried: ${path.join(briefsRoot, slug)}\n` +
    `         ${path.join(clonesRoot, slug)}\n` +
    `Run /bootstrap:spinup ${slug} first, or /portfolio:new ${slug} to scaffold without a brief.`
  );
  process.exit(2);
}

const briefFiles = fs.readdirSync(briefPath);
if (briefFiles.length === 0) {
  console.error(`Brief directory '${briefPath}' is empty. Run /bootstrap:spinup ${slug} first.`);
  process.exit(2);
}

// ── scaffold via /portfolio:new (unless called from new.js itself) ──
let repoPath = targetPath;
if (!skipNew) {
  const newScript = path.resolve(__dirname, "new.js");
  const result = spawnSync(
    "node", [newScript, slug],
    { cwd: MC_ROOT, encoding: "utf8", timeout: 120_000, stdio: "inherit" }
  );
  if (result.status !== 0) {
    process.exit(result.status || 4);
  }
  repoPath = path.resolve(MC_ROOT, "..", slug);
}

if (!repoPath || !fs.existsSync(repoPath)) {
  console.error(`Target repo path does not exist: ${repoPath}`);
  process.exit(4);
}

// ── move brief files under _docs/<clones|briefs>/<slug>/ ────
// SP-20260525-018 (T-217): land adopted briefs under _docs/ instead of the
// repo root, so the product tree stays clean. Clone briefs → _docs/clones/,
// bootstrap briefs → _docs/briefs/, keyed by which source dir held them.
const briefKind = path.resolve(briefPath).startsWith(path.resolve(clonesRoot))
  ? "clones"
  : "briefs";
const destBase = path.join(repoPath, "_docs", briefKind, slug);
fs.mkdirSync(destBase, { recursive: true });
let filesMoved = 0;
const entries = fs.readdirSync(briefPath, { withFileTypes: true });
for (const entry of entries) {
  const src = path.join(briefPath, entry.name);
  const dest = path.join(destBase, entry.name);
  if (entry.isDirectory()) {
    _moveDir(src, dest);
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(src, dest);
  }
  filesMoved++;
}

// remove now-empty brief dir
try { fs.rmdirSync(briefPath); } catch { /* ignore if not empty */ }

// ── output (C-10) ──────────────────────────────────────────
console.log(`adopted: ${slug}`);
console.log(`  source brief: ${briefPath}`);
console.log(`  target repo:  ${repoPath}`);
console.log(`  files moved: ${filesMoved}`);
console.log(`  registered in ~/.mc/portfolio.json`);

// ── telemetry (TR-8) ───────────────────────────────────────
_emit("portfolio_adopt", {
  slug,
  source_brief_path: _pathOffset(briefPath),
  target_repo_path: _pathOffset(repoPath),
  files_moved_count: filesMoved,
});

// ── helpers ───────────────────────────────────────────────

function _locateBrief(slugVal, briefs, clones) {
  const inBriefs = path.join(briefs, slugVal);
  if (fs.existsSync(inBriefs)) return inBriefs;
  const inClones = path.join(clones, slugVal);
  if (fs.existsSync(inClones)) return inClones;
  return null;
}

function _moveDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      _moveDir(s, d);
    } else {
      fs.renameSync(s, d);
    }
  }
  try { fs.rmdirSync(src); } catch { /* ignore */ }
}

function _pathOffset(absPath) {
  const os = require("os");
  try { return path.relative(os.homedir(), absPath); } catch { return "<path>"; }
}

function _emit(type, payload) {
  try {
    const loggerPath = path.resolve(__dirname, "../hooks/lib/logger.js");
    const { log } = require(loggerPath);
    log("portfolio", { type, ...payload });
  } catch { /* fail-open */ }
}
