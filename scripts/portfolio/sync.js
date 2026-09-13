"use strict";

/**
 * scripts/portfolio/sync.js — /portfolio:sync (T-20260521-175).
 *
 * Portfolio-wide /mc:update. Iterates registry SEQUENTIALLY (Plan Contract
 * non-blocking decision — avoids gh rate-limit risk), runs MC
 * scripts/mc/update.js inside each registered product's repo_path, and
 * emits an aggregate summary at the end.
 *
 * Sources of truth:
 *   - Granular story:        requirements/SP-20260521-001/granular-stories.md S-8
 *   - Acceptance criteria:   requirements/SP-20260521-001/acceptance-criteria.md AC-8.1, 8.2
 *   - Copy:                  requirements/SP-20260521-001/copy.md C-13
 *   - Telemetry:             requirements/SP-20260521-001/trace.md TR-11
 *
 * No fail-fast (AC-8.2): a single product's update failure is captured and
 * sync continues with siblings. Exit code is non-zero only if at least one
 * product failed, but every product is attempted.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const { load } = require("./registry");

const UPDATE_TIMEOUT_MS = 300000; // 5 min per product; /mc:update may pull tarballs

function emitTrace(payload) {
  try {
    const loggerPath = path.resolve(__dirname, "..", "hooks", "lib", "logger.js");
    const { log } = require(loggerPath);
    log("portfolio", payload);
  } catch {
    // fail-open
  }
}

function pad(s, n) {
  const x = String(s == null ? "" : s);
  if (x.length >= n) return x.slice(0, n);
  return x + " ".repeat(n - x.length);
}

function detectWarposVersion(repoPath) {
  try {
    const fi = path.join(repoPath, ".claude", "framework-installed.json");
    const data = JSON.parse(fs.readFileSync(fi, "utf8"));
    return data.installedVersion || null;
  } catch {
    return null;
  }
}

// ── runUpdate: spawn scripts/mc/update.js against one product ──
function runUpdate(productRepoPath, mcCloneRoot) {
  return new Promise((resolve) => {
    const updateScript = path.join(mcCloneRoot, "scripts", "mc", "update.js");
    if (!fs.existsSync(updateScript)) {
      return resolve({
        ok: false,
        status: "update-script-missing",
        stderr: "scripts/mc/update.js not found at " + updateScript,
      });
    }
    let child;
    let settled = false;
    const settle = (r) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    try {
      // The standard contract is to spawn update.js IN the product's repo —
      // it resolves its own paths relative to CLAUDE_PROJECT_DIR / cwd.
      const childEnv = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: productRepoPath });
      child = spawn("node", [updateScript], {
        cwd: productRepoPath,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
    } catch (err) {
      return settle({ ok: false, status: "spawn-error", stderr: err.message });
    }
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const tid = setTimeout(() => {
      try { child.kill(); } catch {}
      settle({ ok: false, status: "timeout", stdout: stdout.trim(), stderr: stderr.trim() });
    }, UPDATE_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(tid);
      settle({ ok: false, status: "spawn-error", stderr: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(tid);
      settle({
        ok: code === 0,
        status: code === 0 ? "ok" : "exit-" + code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
      });
    });
  });
}

function locateWarposCloneRoot() {
  // sync.js lives at scripts/portfolio/sync.js inside the MC canonical
  // clone. Two levels up is the clone root.
  return path.resolve(__dirname, "..", "..");
}

/**
 * syncRegistry — programmatic entry point.
 * @param {object} [opts]
 * @param {Writable} [opts.stdout]
 * @param {Writable} [opts.stderr]
 * @param {boolean}  [opts.dryRun] — list what would run, do not spawn
 * @returns {Promise<{exitCode:number, results:object[]}>}
 */
async function syncRegistry(opts) {
  const stdout = (opts && opts.stdout) || process.stdout;
  const stderr = (opts && opts.stderr) || process.stderr;
  const dryRun = !!(opts && opts.dryRun);

  let doc;
  try {
    doc = load();
  } catch (err) {
    stderr.write((err.message || "registry load failed") + "\n");
    return { exitCode: 2, results: [] };
  }
  const products = Object.values(doc.products || {});
  if (products.length === 0) {
    stdout.write("No products registered. Use /portfolio:register first.\n");
    emitTrace({ type: "portfolio_sync", phase: "start", product_count: 0 });
    emitTrace({ type: "portfolio_sync", phase: "end", success_count: 0, failure_count: 0 });
    return { exitCode: 0, results: [] };
  }

  emitTrace({ type: "portfolio_sync", phase: "start", product_count: products.length });

  const mcCloneRoot = locateWarposCloneRoot();
  const results = [];

  // SEQUENTIAL — avoids gh rate-limit risk per Plan Contract decision.
  for (const product of products) {
    const fromVersion = detectWarposVersion(product.repo_path) || "?";

    // C-13 per-product banner. The "<result>" placeholder is filled after the
    // update runs; print the prefix now so the operator sees progress.
    stdout.write(`syncing ${product.slug}... `);

    if (!product.repo_path || !fs.existsSync(product.repo_path)) {
      const r = {
        slug: product.slug,
        ok: false,
        status: "repo-not-found",
        fromVersion,
        toVersion: fromVersion,
      };
      stdout.write(`SKIP (repo not found at ${product.repo_path || "<missing>"})\n`);
      emitTrace({
        type: "portfolio_sync",
        phase: "per_product",
        slug: product.slug,
        from_version: fromVersion,
        to_version: fromVersion,
        status: r.status,
      });
      results.push(r);
      continue;
    }

    if (dryRun) {
      const r = {
        slug: product.slug,
        ok: true,
        status: "dry-run",
        fromVersion,
        toVersion: fromVersion,
      };
      stdout.write(`(dry-run) would update from ${fromVersion}\n`);
      emitTrace({
        type: "portfolio_sync",
        phase: "per_product",
        slug: product.slug,
        from_version: fromVersion,
        to_version: fromVersion,
        status: "dry-run",
      });
      results.push(r);
      continue;
    }

    let updateR;
    try {
      updateR = await runUpdate(product.repo_path, mcCloneRoot);
    } catch (err) {
      // No-fail-fast: catch ANY error so siblings are still attempted.
      updateR = { ok: false, status: "internal-error", stderr: err.message };
    }
    const toVersion = updateR.ok ? detectWarposVersion(product.repo_path) || fromVersion : fromVersion;
    const r = {
      slug: product.slug,
      ok: !!updateR.ok,
      status: updateR.status,
      fromVersion,
      toVersion,
    };
    // C-13 per-product line completion.
    stdout.write(
      `${updateR.ok ? "ok" : "FAILED (" + updateR.status + ")"} (mc ${fromVersion} → ${toVersion})\n`,
    );
    if (!updateR.ok && updateR.stderr) {
      // Print stderr indented so operator can diagnose without re-running.
      for (const line of updateR.stderr.split(/\r?\n/)) {
        if (line.trim()) stderr.write("  " + line + "\n");
      }
    }
    emitTrace({
      type: "portfolio_sync",
      phase: "per_product",
      slug: product.slug,
      from_version: fromVersion,
      to_version: toVersion,
      status: updateR.status,
    });
    results.push(r);
  }

  // Final summary table.
  const successCount = results.filter(r => r.ok).length;
  const failureCount = results.length - successCount;

  stdout.write("\nsummary\n");
  const header = pad("SLUG", 18) + " " + pad("FROM", 8) + " " + pad("TO", 8) + " RESULT";
  stdout.write(header + "\n");
  stdout.write("-".repeat(header.length) + "\n");
  for (const r of results) {
    stdout.write(
      pad(r.slug, 18) + " " + pad(r.fromVersion, 8) + " " + pad(r.toVersion, 8) + " " +
      (r.ok ? "ok" : "FAILED (" + r.status + ")") + "\n",
    );
  }
  stdout.write(`\n${successCount} ok / ${failureCount} failed\n`);

  emitTrace({
    type: "portfolio_sync",
    phase: "end",
    success_count: successCount,
    failure_count: failureCount,
  });

  return {
    exitCode: failureCount === 0 ? 0 : 1,
    results,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const r = await syncRegistry({ dryRun });
  process.exit(r.exitCode);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write("portfolio:sync crashed: " + (err.message || err) + "\n");
    process.exit(2);
  });
}

module.exports = {
  syncRegistry,
  runUpdate,
  detectWarposVersion,
  locateWarposCloneRoot,
};
