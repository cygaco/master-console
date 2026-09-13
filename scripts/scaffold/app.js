#!/usr/bin/env node
"use strict";

/**
 * scripts/scaffold/app.js (S0.3) — materialize the MC app scaffold
 * (Next.js App Router + Tailwind v4 + shadcn/ui + Radix + Lucide) into a target
 * product repo. This is the code path that makes "integrated but unused" UI
 * frameworks ACTUALLY land — the "kills vibe-coded" deliverable.
 *
 * Ships PINNED TEMPLATES (deterministic, offline) — NOT live `npx create-next-app`
 * / `shadcn init` (network + nondeterministic). `npm install` is the only network
 * step and is OPT-IN (default off) so the scaffold is fast + offline-safe; callers
 * print a "run npm install" next-step.
 *
 * Seams are injectable so the engine is unit-testable without a real install:
 *   scaffoldApp({ repoRoot, slug, install, runCmd, log })
 *
 *   node scripts/scaffold/app.js <repoRoot> [--slug <name>] [--install] [--force] [--json]
 *
 * Idempotent: existing files are PRESERVED (never overwritten) so it is safe to
 * run over a repo that /portfolio:new already seeded (README/.gitignore stay put).
 * A repo that already has package.json is treated as already-scaffolded unless
 * --force. The .gitignore managed block is ensured either way.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { readCanonicalStack } = require("../canon/tech-stack");
const { renderFoundersChecklist } = require("./founders-checklist");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Resolve the template dir via the paths registry (paths.appScaffoldTemplates),
// falling back to the documented default so an older clone still works.
function templatesDir() {
  const fallback = path.join(REPO_ROOT, "_mc", "templates", "app-scaffold");
  try {
    const reg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, ".claude", "paths.json"), "utf8"),
    );
    const rel = reg.appScaffoldTemplates;
    return rel ? path.join(REPO_ROOT, rel) : fallback;
  } catch {
    return fallback;
  }
}

// Managed block appended to .gitignore when absent — the Next/node entries a
// scaffolded app needs. Deliberately does NOT touch `.claude/` (the framework
// lives there in a MC product and must stay tracked).
const GITIGNORE_BLOCK = [
  "# --- MC app-scaffold (managed) ---",
  "/node_modules",
  "/.next/",
  "/out/",
  "/build",
  "next-env.d.ts",
  "*.tsbuildinfo",
  ".env*.local",
  "/test-results/",
  "/playwright-report/",
  "/blob-report/",
  ".DS_Store",
  "# --- end MC app-scaffold ---",
];

function defaultSlug(repoRoot) {
  const base = path.basename(path.resolve(repoRoot));
  const slug = base.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
  return slug || "app";
}

function templateContext(repoRoot, slug) {
  const declaredStack = readCanonicalStack(repoRoot);
  return {
    slug,
    foundersChecklist: renderFoundersChecklist({ declaredStack }),
  };
}

function renderTemplate(content, ctx) {
  return content
    .replace(/\{\{SLUG\}\}/g, ctx.slug)
    .replace(/\{\{FOUNDERS_CHECKLIST\}\}/g, ctx.foundersChecklist);
}

// Recursively materialize srcDir → destDir, stripping .tmpl and interpolating
// {{SLUG}}. Returns { created:[rel], skipped:[rel] }. Existing files preserved.
function materialize(srcDir, destDir, ctx, created, skipped) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destName = entry.name.endsWith(".tmpl")
      ? entry.name.slice(0, -5)
      : entry.name;
    const destPath = path.join(destDir, destName);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      materialize(srcPath, destPath, ctx, created, skipped);
    } else {
      const rel = path.relative(destDir, destPath);
      if (fs.existsSync(destPath)) {
        skipped.push(rel);
        continue;
      }
      let content = fs.readFileSync(srcPath, "utf8");
      content = renderTemplate(content, ctx);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, content, "utf8");
      created.push(rel);
    }
  }
}

// Ensure the managed .gitignore block exists (append if the marker is absent).
// Returns true if it modified the file.
function ensureGitignore(repoRoot) {
  const gi = path.join(repoRoot, ".gitignore");
  const marker = "MC app-scaffold (managed)";
  let body = "";
  try {
    body = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  } catch {
    body = "";
  }
  if (body.includes(marker)) return false;
  const sep = body && !body.endsWith("\n") ? "\n" : "";
  fs.writeFileSync(gi, body + sep + (body ? "\n" : "") + GITIGNORE_BLOCK.join("\n") + "\n", "utf8");
  return true;
}

function defaultRunCmd(cmd, args, cwd) {
  // WI-29 (Windows): `npm` is `npm.cmd` on win32, and spawnSync won't resolve a
  // `.cmd` shim without a shell — a bare spawnSync("npm", …) throws ENOENT, so
  // scaffold `--install` silently failed on Windows. Run through the shell on
  // win32 (resolves npm/npx/any .cmd); other platforms keep the direct spawn
  // (no shell — avoids the quoting surface). args here are fixed/internal.
  const win = process.platform === "win32";
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
    timeout: 600_000,
    shell: win,
  });
  return { code: r.status == null ? 1 : r.status, error: r.error ? r.error.message : null };
}

/**
 * scaffoldApp — the engine. Pure given injected seams.
 *
 * opts = {
 *   repoRoot: string,                 // target product repo (must exist)
 *   slug?: string,                    // package name; default = sanitized basename
 *   install?: boolean,                // run npm install (default false)
 *   force?: boolean,                  // re-materialize even if package.json exists
 *   runCmd?: (cmd, args, cwd) => ({ code, error }),  // injectable (npm install)
 *   srcDir?: string,                  // injectable template dir (tests)
 *   log?: (msg) => void,
 * }
 * returns { ok, repoRoot, slug, alreadyPresent, created:[], skipped:[],
 *           gitignoreUpdated, installed, installCode? }
 */
function scaffoldApp(opts) {
  const o = opts || {};
  const repoRoot = o.repoRoot;
  if (!repoRoot || !fs.existsSync(repoRoot)) {
    return { ok: false, error: `repoRoot does not exist: ${repoRoot}` };
  }
  // Self-protect: never materialize into the MC framework repo itself (the dir
  // that OWNS the scaffold templates). Scaffolding into canonical would litter the
  // framework root with a product app and break the shipping manifest. Target a
  // product repo, never canonical.
  if (path.resolve(repoRoot) === REPO_ROOT) {
    return { ok: false, error: "refusing to scaffold into the MC repo root itself — target a product repo, not canonical" };
  }
  const slug = o.slug || defaultSlug(repoRoot);
  const srcDir = o.srcDir || templatesDir();
  const runCmd = typeof o.runCmd === "function" ? o.runCmd : defaultRunCmd;
  const log = typeof o.log === "function" ? o.log : () => {};

  if (!fs.existsSync(srcDir)) {
    return { ok: false, error: `scaffold templates not found: ${srcDir}` };
  }

  const pkgExists = fs.existsSync(path.join(repoRoot, "package.json"));
  const alreadyPresent = pkgExists && !o.force;

  const created = [];
  const skipped = [];
  if (!alreadyPresent) {
    materialize(srcDir, repoRoot, templateContext(repoRoot, slug), created, skipped);
    log(`scaffold: ${created.length} file(s) created, ${skipped.length} preserved`);
  } else {
    log("scaffold: package.json present — already scaffolded (use --force to re-materialize)");
  }

  const gitignoreUpdated = ensureGitignore(repoRoot);

  let installed = false;
  let installCode;
  if (o.install) {
    log("scaffold: running npm install (network)...");
    const r = runCmd("npm", ["install"], repoRoot);
    installCode = r.code;
    installed = r.code === 0;
    if (!installed) log(`scaffold: npm install exited ${r.code}${r.error ? ` (${r.error})` : ""}`);
  }

  return {
    ok: true,
    repoRoot,
    slug,
    alreadyPresent,
    created,
    skipped,
    gitignoreUpdated,
    installed,
    installCode,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : null;
  };
  // First non-flag positional is the target repoRoot (skip the --slug value slot).
  const positional = argv.filter((a, i) => {
    if (a.startsWith("--")) return false;
    const slugIdx = argv.indexOf("--slug");
    if (slugIdx !== -1 && i === slugIdx + 1) return false;
    return true;
  });
  const target = positional[0];
  if (!target) {
    process.stderr.write("Usage: node scripts/scaffold/app.js <repoRoot> [--slug <name>] [--install] [--force] [--json]\n");
    process.exit(2);
  }
  const result = scaffoldApp({
    repoRoot: path.resolve(target),
    slug: flag("--slug") || undefined,
    install: argv.includes("--install"),
    force: argv.includes("--force"),
    log: (m) => process.stdout.write(m + "\n"),
  });
  if (json) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.ok) {
    process.stderr.write(`scaffold failed: ${result.error}\n`);
    process.exit(1);
  }
  if (!result.alreadyPresent && !result.installed) {
    process.stdout.write(`\nNext: cd "${result.repoRoot}" && npm install && npm run dev\n`);
  }
  process.exit(0);
}

module.exports = { scaffoldApp, ensureGitignore, defaultSlug, templatesDir, GITIGNORE_BLOCK };
