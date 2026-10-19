#!/usr/bin/env node
"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function defaultRunCmd(cmd, cwd) {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: "utf8", windowsHide: true });
  if (r.error) return { code: r.status == null ? 1 : r.status, stdout: r.stdout || "", stderr: r.error.message };
  return { code: r.status == null ? 1 : r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

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
