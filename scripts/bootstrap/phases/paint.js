#!/usr/bin/env node
"use strict";
/**
 * scripts/bootstrap/phases/paint.js — the `paint` step of the step-driven
 * bootstrap:spinup pipeline (MC-PROMPT §1; renamed from the former `onscreen`
 * phase). Execute Epic-1's first sprint until the core loop SERVES, gated by a
 * verify-before-claim serve check.
 *
 * Two parts, deliberately split so the gate is unit-testable in isolation:
 *
 *   • verifyServe(opts)  (DETERMINISTIC, PURE, INJECTABLE): the core deliverable.
 *     `pass` is TRUE only if ALL hold: (build clean OR no buildCmd) AND a dev
 *     server returns HTTP 200 on localhost AND (entry module transforms OR none).
 *     A non-200 forces pass:false EVEN when the build succeeded ("builds != serves").
 *
 *   • run(ctx)  (LLM-ORCHESTRATED): executing Epic-1's first sprint until it serves
 *     is product-side work a node driver can't do, so run() returns
 *     needs_orchestration with an orchestration_prompt. There is NO `--auto`
 *     self-complete path (§2 anti-degrade — a bare-scaffold "serve" is a degraded
 *     first paint that bypasses the real sprint synthesis). The consumer contract
 *     (fulfill the prompt → re-invoke with --resume) is the only completion path.
 *
 * Scaffold-if-missing (S0.3) is preserved as an idempotent safety net even though
 * the `setup` step is the primary scaffolder — you cannot get on screen without an
 * app to serve.
 *
 * Phase-module contract (see scripts/bootstrap/spinup-orchestrate.js):
 *   ctx = { repoRoot, product, intentFile, cloneTarget, outDir, research,
 *           dryRun, args, log }
 *   run(ctx) → { ok, status: "done"|"needs_orchestration"|"failed",
 *                message, data?, orchestration_prompt? }
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// ── Real runner seam (replaced in tests via opts.runCmd) ─────────────────────
function defaultRunCmd(cmd, cwd) {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: "utf8", windowsHide: true });
  if (r.error) return { code: r.status == null ? 1 : r.status, stdout: r.stdout || "", stderr: r.error.message };
  return { code: r.status == null ? 1 : r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

// ── Real probe seam (replaced in tests via opts.httpGet) ─────────────────────
// Never rejects — a refused/timeout/DNS error resolves to status 0 ("not serving").
// A pre-existing live node process counts for NOTHING: only a real status from THIS
// URL does.
function defaultHttpGet(url) {
  return new Promise((resolve) => {
    let mod;
    try {
      const target = new URL(url);
      mod = target.protocol === "https:" ? https : http;
    } catch {
      resolve({ status: 0 });
      return;
    }
    let settled = false;
    const done = (status) => { if (!settled) { settled = true; resolve({ status }); } };
    const req = mod.get(url, { timeout: 5000 }, (res) => {
      const status = res.statusCode || 0;
      res.resume();
      done(status);
    });
    req.on("error", () => done(0));
    req.on("timeout", () => { req.destroy(); done(0); });
  });
}

/**
 * verifyServe — the verify-before-claim serve gate. Pure + injectable.
 * returns { pass, checks: { build, http200, entryTransforms }, reasons[] }
 */
async function verifyServe(opts) {
  const o = opts || {};
  const buildCmd = o.buildCmd || null;
  const serveUrl = o.serveUrl || null;
  const entryModule = o.entryModule || null;
  const cwd = o.cwd || process.cwd();
  const runCmd = typeof o.runCmd === "function" ? o.runCmd : defaultRunCmd;
  const httpGet = typeof o.httpGet === "function" ? o.httpGet : defaultHttpGet;

  const checks = { build: null, http200: false, entryTransforms: null };
  const reasons = [];

  if (buildCmd) {
    let r;
    try { r = runCmd(buildCmd, cwd); } catch (e) { r = { code: 1, stdout: "", stderr: e.message }; }
    checks.build = r && r.code === 0;
    reasons.push(checks.build ? `build OK ('${buildCmd}' exit 0)` : `build FAILED ('${buildCmd}' exit ${r ? r.code : "?"})`);
  } else {
    reasons.push("build check skipped (no buildCmd)");
  }

  if (serveUrl) {
    let probe;
    try { probe = await httpGet(serveUrl); }
    catch (e) { probe = { status: 0 }; reasons.push(`serve probe threw: ${e.message}`); }
    const status = probe && typeof probe.status === "number" ? probe.status : 0;
    checks.http200 = status === 200;
    reasons.push(checks.http200 ? `serve OK (HTTP 200 from ${serveUrl})` : `serve FAILED (HTTP ${status || "no-response"} from ${serveUrl}; builds != serves)`);
  } else {
    checks.http200 = false;
    reasons.push("serve FAILED (no serveUrl to probe; cannot confirm on-screen)");
  }

  if (entryModule) {
    const transformCmd = `node --check "${entryModule}"`;
    let r;
    try { r = runCmd(transformCmd, cwd); } catch (e) { r = { code: 1, stdout: "", stderr: e.message }; }
    checks.entryTransforms = r && r.code === 0;
    reasons.push(checks.entryTransforms ? `entry transforms OK (${entryModule})` : `entry transform FAILED (${entryModule}, exit ${r ? r.code : "?"})`);
  } else {
    reasons.push("entry transform check skipped (no entryModule)");
  }

  const buildOk = checks.build === null || checks.build === true;
  const entryOk = checks.entryTransforms === null || checks.entryTransforms === true;
  const pass = Boolean(buildOk && checks.http200 && entryOk);
  return { pass, checks, reasons };
}

async function run(ctx) {
  const { product, log, repoRoot, dryRun } = ctx;

  // Scaffold-if-missing safety net (idempotent; setup is the primary scaffolder).
  let scaffoldNote = "";
  if (!dryRun && repoRoot) {
    try {
      const pkgPath = path.join(repoRoot, "package.json");
      if (!fs.existsSync(pkgPath)) {
        const { scaffoldApp } = require("../../scaffold/app");
        const slug = String(product || path.basename(repoRoot) || "app")
          .toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
        const res = scaffoldApp({ repoRoot, slug, install: false, log: log || (() => {}) });
        if (res && res.ok && !res.alreadyPresent) {
          scaffoldNote = ` — app scaffold materialized (${res.created.length} files; run npm install before serving)`;
          if (log) log(`paint: app scaffold materialized (${res.created.length} files)`);
        }
      }
    } catch (e) {
      if (log) log(`paint: app scaffold skipped (non-fatal): ${e.message}`);
    }
  }

  // Targeting Epic-1's first sprint (AC-5.1) and actually running it until it
  // serves is product-side, LLM-orchestrated work — a node process can't do it.
  // We hand the orchestrator a prompt and the gate to verify with. There is NO
  // --auto self-complete path (§2 anti-degrade).
  if (log) {
    log(product
      ? `paint target: Epic-1 first sprint for '${product}' (product-side execution)`
      : "paint target: Epic-1 first sprint (product-side execution)");
  }

  return {
    ok: false,
    status: "needs_orchestration",
    message: "paint execution is product-side" + scaffoldNote,
    orchestration_prompt:
      "Execute Epic-1's first sprint product-side. The MC app scaffold " +
      "(Next.js App Router + Tailwind v4 + shadcn/ui) is in place — run `npm install`, " +
      "then build features on the primitives in src/components/ui (never hand-roll raw " +
      "elements). Gate completion with verifyServe (build clean + HTTP 200 + entry " +
      "transforms). Do not claim success on build alone.",
    data: { firstAction: "Epic-1 S1: bring the first usable screen up locally from the generated scaffold." },
  };
}

module.exports = { name: "paint", verifyServe, run };
