#!/usr/bin/env node
"use strict";
/**
 * scripts/bootstrap/phases/setup.js — the `setup` step of the step-driven
 * bootstrap:spinup pipeline (MC-PROMPT §1, §3, §4). DETERMINISTIC — no LLM.
 *
 * Folds the former `preflight` + `intent` phases into one deterministic step:
 *   create (when the target isn't a MC repo yet) + app scaffold (platform-aware,
 *   §3) + register + capture RAW intake into the INTENT/brief artifact ONLY
 *   (raw → intent is correct; canon synthesizes the substance) + the /scan:install
 *   preflight gate. Reuses portfolio:new's create()/scaffold() callables (§4) — no
 *   duplicated create/scaffold logic.
 *
 * Intake sources (deterministic — no interactive prompt when structured args are
 * supplied; never exit-3 dead-ends):
 *   • --clone <target>            → reuse scripts/portfolio/clone.js → clone doc.
 *   • --name/--what/--who/--where → write a deterministic founding brief.
 *   • --intent <file>             → accept an existing brief the caller wrote.
 *   • existing brief (G4.6)       → reuse a product's prior brief.
 *   • none of the above           → FAIL with a clear error (setup is deterministic;
 *                                   it does not run an LLM discussion).
 *
 * Phase-module contract:
 *   ctx = { repoRoot, product, intentFile, cloneTarget, outDir, research, where,
 *           name, what, who, dryRun, args, log }
 *   run(ctx) → { ok, status: "done"|"failed", message, data?, orchestration_prompt? }
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { scaffoldProductApp, createProductRepo } = require("../../portfolio/new-lib");

// §3 platform targets. v1 every target scaffolds the web/PWA baseline (native
// packaging is a follow-on epic + a /mc:flag); the target is RECORDED honestly.
const PLATFORMS = new Set(["android", "ios", "web", "desktop-pc", "desktop-mac"]);
const DEFAULT_PLATFORM = "web";
const NATIVE_PLATFORMS = new Set(["android", "ios", "desktop-pc", "desktop-mac"]);

function loadCloneEngine(repoRoot) {
  return require(path.join(repoRoot, "scripts", "portfolio", "clone.js"));
}

function briefsRootRel(repoRoot) {
  const fallback = "_docs/briefs";
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(repoRoot, "framework", "paths.registry.json"), "utf8"));
    const entries = reg.paths || reg;
    return (entries.briefsRoot && entries.briefsRoot.path) || fallback;
  } catch {
    return fallback;
  }
}

function deriveSlug(repoRoot, name) {
  if (!name) return null;
  try {
    return loadCloneEngine(repoRoot).deriveSlug({ slug: null, name: String(name), urlObj: null }) || null;
  } catch {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || null;
  }
}

function planClone(repoRoot, cloneTarget) {
  const engine = loadCloneEngine(repoRoot);
  const raw = String(cloneTarget).trim();
  let urlObj = null;
  if (/^https?:\/\//i.test(raw)) {
    try { urlObj = new URL(raw); } catch { urlObj = null; }
  }
  const isUrl = Boolean(urlObj);
  const slug = engine.deriveSlug({ slug: null, name: isUrl ? null : raw, urlObj });
  const cliFlag = isUrl ? "--url" : "--name";
  const outputDirRel = path.posix.join("_docs", "clones", slug);
  const docRel = path.posix.join(outputDirRel, `${slug}.clone.md`);
  return { slug, cliFlag, isUrl, outputDirRel, docRel };
}

function findExistingBrief(repoRoot, product) {
  const slug = deriveSlug(repoRoot, product);
  if (!slug) return null;
  const dirRel = path.posix.join(briefsRootRel(repoRoot), slug);
  const dirAbs = path.join(repoRoot, dirRel);
  if (!fs.existsSync(dirAbs)) return null;
  let docName = null;
  try {
    const files = fs.readdirSync(dirAbs);
    docName = files.find((f) => f === `${slug}.brief.md`) || files.find((f) => f.endsWith(".md")) || null;
  } catch { return null; }
  if (!docName) return null;
  return path.posix.join(dirRel, docName);
}

// Write a deterministic founding brief from the structured intake (raw → intent).
// Returns the repo-relative POSIX path. Idempotent: a 2nd run with the same slug
// rewrites the same path with the same content.
function stackFromCtx(ctx) {
  const s = (ctx && ctx.stack) || {};
  const args = (ctx && ctx.args) || {};
  return {
    framework: ctx.framework || args.framework || args.stackFramework || s.framework || "",
    database: ctx.database || args.database || args.stackDatabase || s.database || "",
    auth: ctx.auth || args.auth || args.stackAuth || s.auth || "",
    payments: ctx.payments || args.payments || args.stackPayments || s.payments || "",
    hosting: ctx.hosting || args.hosting || args.stackHosting || s.hosting || "",
    analytics: ctx.analytics || args.analytics || args.stackAnalytics || s.analytics || "",
  };
}

function stackLine(value, field) {
  return value && String(value).trim() ? String(value).trim() : `*needs input: ${field}*`;
}

function writeStructuredBrief(ctx, slug) {
  const rel = path.posix.join(briefsRootRel(ctx.repoRoot), slug, `${slug}.brief.md`);
  const abs = path.join(ctx.repoRoot, rel);
  const name = ctx.name || ctx.product || slug;
  const platform = resolvePlatform(ctx);
  const stack = stackFromCtx(ctx);
  const body = [
    `# ${name} — Founding brief`,
    "",
    "> RAW intake captured by the bootstrap:spinup `setup` step. This is the INTENT",
    "> artifact ONLY — the canon step synthesizes vision/JTBD/cohorts/golden-paths",
    "> from it. Raw user input never lands in canon.",
    "",
    `- **Slug:** ${slug}`,
    `- **Platform target:** ${platform}${NATIVE_PLATFORMS.has(platform) ? " (v1 ships the web/PWA baseline; native packaging is a follow-on)" : ""}`,
    "",
    "## Tech Stack",
    "",
    `- Framework: ${stackLine(stack.framework, "tech_stack_framework")}`,
    `- Database: ${stackLine(stack.database, "tech_stack_database")}`,
    `- Authentication: ${stackLine(stack.auth, "tech_stack_auth")}`,
    `- Payments: ${stackLine(stack.payments, "tech_stack_payments")}`,
    `- Hosting: ${stackLine(stack.hosting, "tech_stack_hosting")}`,
    `- Analytics: ${stackLine(stack.analytics, "tech_stack_analytics")}`,
    "",
    "## What (problem / JTBD — raw)",
    "",
    (ctx.what || "*needs input: what*").trim(),
    "",
    "## Who (target cohorts — raw)",
    "",
    (ctx.who || "*needs input: who*").trim(),
    "",
  ].join("\n");
  if (!ctx.dryRun) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf8");
  }
  return rel;
}

function resolvePlatform(ctx) {
  const w = (ctx.where || (ctx.args && ctx.args.where) || DEFAULT_PLATFORM).toLowerCase();
  return PLATFORMS.has(w) ? w : DEFAULT_PLATFORM;
}

// ── preflight install gate (injectable for tests via ctx.args._runCheck) ──────
function defaultRunCheck(repoRoot) {
  const script = path.join(repoRoot, "scripts", "check", "install.js");
  const r = spawnSync(process.execPath, [script, "--json"], { cwd: repoRoot, encoding: "utf8" });
  return { code: r.status == null ? 1 : r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

async function run(ctx) {
  const { repoRoot, dryRun, log } = ctx;

  // §3 validate --where up front (a bad target is a clear non-zero, never silent).
  const whereRaw = ctx.where || (ctx.args && ctx.args.where) || null;
  if (whereRaw && !PLATFORMS.has(String(whereRaw).toLowerCase())) {
    return {
      ok: false,
      status: "failed",
      message: `bad --where "${whereRaw}" (android|ios|web|desktop-pc|desktop-mac)`,
    };
  }
  const platform = resolvePlatform(ctx);

  // ── create (when the target isn't a MC repo yet) ─────────────────────
  // In-place is the common path (spinup runs inside an installed repo). When the
  // target doesn't exist / isn't installed AND a name/slug is given, create it via
  // the shared createProductRepo callable (§4) and continue against the new repo.
  let effectiveRoot = repoRoot;
  const installed = fs.existsSync(path.join(repoRoot, ".claude"));
  const createName = ctx.name || ctx.product || null;
  if (!fs.existsSync(repoRoot) || (!installed && createName)) {
    const slug = deriveSlug(repoRoot, createName);
    if (!slug) {
      return {
        ok: false,
        status: "failed",
        message: `setup needs a product --name to create a new repo at ${repoRoot} (or point --repo-root at an installed MC repo)`,
      };
    }
    if (dryRun) {
      log(`[dry-run] would create product repo "${slug}" via createProductRepo (platform ${platform})`);
    } else {
      log(`creating product repo "${slug}" (reusing portfolio:new create()/scaffold())...`);
      const r = createProductRepo({ slug, wantNoScaffold: false, log: (m) => log(m), errorLog: (m) => log(m) });
      if (!r.ok) return { ok: false, status: "failed", message: `create failed: ${r.error}` };
      effectiveRoot = r.repoPath;
    }
  } else {
    // ── in-place scaffold-if-missing (platform-aware §3; reuse §4 callable) ──
    const pkg = path.join(repoRoot, "package.json");
    if (!fs.existsSync(pkg)) {
      const slug = deriveSlug(repoRoot, ctx.product || path.basename(repoRoot)) || "app";
      if (dryRun) {
        log(`[dry-run] would scaffold web/PWA baseline (platform ${platform}) via scaffoldProductApp`);
      } else {
        const res = scaffoldProductApp({ repoRoot, slug, install: false, log: (m) => log(`  ${m}`) });
        if (res && res.ok && !res.alreadyPresent) {
          log(`app scaffold materialized (${(res.created || []).length} files; web/PWA baseline for platform "${platform}")`);
        }
      }
    }
    if (NATIVE_PLATFORMS.has(platform)) {
      log(`note: --where ${platform} recorded; v1 scaffolds the web/PWA baseline. Native packaging is a follow-on epic (see /mc:flag native-scaffold).`);
    }
  }

  // ── capture RAW intake → brief (intent artifact ONLY) ────────────────────
  let intentFile = null;
  let mode = null;

  if (ctx.cloneTarget) {
    let plan;
    try { plan = planClone(effectiveRoot, ctx.cloneTarget); }
    catch (e) { return { ok: false, status: "failed", message: `cannot plan clone for '${ctx.cloneTarget}': ${e.message}` }; }
    if (!plan.slug) {
      return { ok: false, status: "failed", message: `--clone '${ctx.cloneTarget}' produced an empty slug; pass a competitor name or http(s) URL` };
    }
    const cloneScript = path.join(effectiveRoot, "scripts", "portfolio", "clone.js");
    if (dryRun) {
      log(`[dry-run] would run clone.js ${plan.cliFlag} "${ctx.cloneTarget}" --slug ${plan.slug} → ${plan.docRel}`);
      intentFile = plan.docRel; mode = "clone";
    } else {
      log(`deriving intent from competitor '${ctx.cloneTarget}' (reusing clone.js)...`);
      const r = spawnSync(process.execPath, [cloneScript, plan.cliFlag, ctx.cloneTarget, "--slug", plan.slug],
        { cwd: effectiveRoot, stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
      if (r.error) return { ok: false, status: "failed", message: `clone.js failed to spawn: ${r.error.message}` };
      if (r.status !== 0) return { ok: false, status: "failed", message: `clone.js exited ${r.status} for '${ctx.cloneTarget}'` };
      const docAbs = path.join(effectiveRoot, plan.outputDirRel, `${plan.slug}.clone.md`);
      if (!fs.existsSync(docAbs)) return { ok: false, status: "failed", message: `clone.js exited 0 but expected doc is missing: ${plan.docRel}` };
      intentFile = plan.docRel; mode = "clone";
      log(`clone doc written → ${plan.docRel}`);
    }
  } else if (ctx.intentFile) {
    const abs = path.isAbsolute(ctx.intentFile) ? ctx.intentFile : path.join(effectiveRoot, ctx.intentFile);
    if (!fs.existsSync(abs) && !dryRun) {
      return { ok: false, status: "failed", message: `--intent file not found: ${ctx.intentFile} (write the brief first, or pass --name/--what/--who)` };
    }
    intentFile = ctx.intentFile; mode = "brief";
    log(`accepting product brief at ${ctx.intentFile}`);
  } else if (ctx.name || ctx.what || ctx.who) {
    const slug = deriveSlug(effectiveRoot, ctx.name || ctx.product || path.basename(effectiveRoot)) || "app";
    const briefCtx = Object.assign({}, ctx, { repoRoot: effectiveRoot });
    intentFile = writeStructuredBrief(briefCtx, slug); mode = "structured";
    log(`captured structured intake → ${intentFile} (raw → intent; canon synthesizes the substance)`);
  } else {
    const reused = findExistingBrief(effectiveRoot, ctx.product);
    if (reused) {
      intentFile = reused; mode = "brief-reuse";
      log(`reusing existing product brief at ${reused}`);
    } else {
      return {
        ok: false,
        status: "failed",
        message:
          "setup needs an intent source — pass --name/--what/--who (structured intake), or --clone <competitor>, or --intent <brief.md>. " +
          "setup is deterministic and never runs an interactive discussion.",
      };
    }
  }

  // ── preflight: refuse a gappy install before downstream steps ─────────────
  const runCheck = (ctx.args && ctx.args._runCheck) || defaultRunCheck;
  log("running /scan:install (incl. WG-4 sprint probe)...");
  const pf = runCheck(effectiveRoot);
  if (pf.code !== 0) {
    return {
      ok: false,
      status: "failed",
      message: `install incomplete or not a MC repo (/scan:install exit ${pf.code}) — refusing to proceed. Run /mc:setup (or fix the gaps) first.`,
      data: { exit: pf.code, intentFile, platform },
    };
  }

  return {
    ok: true,
    status: "done",
    message: `setup complete (intake mode=${mode}, platform=${platform}) → ${intentFile}`,
    data: { intentFile, platform, mode, repoRoot: effectiveRoot, slug: deriveSlug(effectiveRoot, ctx.product || ctx.name), stack: stackFromCtx(ctx) },
  };
}

module.exports = { name: "setup", run, defaultRunCheck, planClone, findExistingBrief, writeStructuredBrief, resolvePlatform, stackFromCtx, PLATFORMS, DEFAULT_PLATFORM, NATIVE_PLATFORMS };
