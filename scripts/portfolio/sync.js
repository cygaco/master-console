"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const { load } = require("./registry");

const UPDATE_TIMEOUT_MS = 300000;

function emitTrace(payload) {
  try {
    const loggerPath = path.resolve(__dirname, "..", "hooks", "lib", "logger.js");
    const { log } = require(loggerPath);
    log("portfolio", payload);
  } catch {
  }
}

function pad(s, n) {
  const x = String(s == null ? "" : s);
  if (x.length >= n) return x.slice(0, n);
  return x + " ".repeat(n - x.length);
}

function detectMcVersion(repoPath) {
  try {
    const fi = path.join(repoPath, ".claude", "framework-installed.json");
    const data = JSON.parse(fs.readFileSync(fi, "utf8"));
    return data.installedVersion || null;
  } catch {
    return null;
  }
}

function readMcVersion(mcCloneRoot) {
  try {
    const vf = path.join(mcCloneRoot, "version.json");
    const data = JSON.parse(fs.readFileSync(vf, "utf8"));
    return data.version || null;
  } catch {
    return null;
  }
}

function buildUpdateArgs(updateScript, productRepoPath, mcCloneRoot, options) {
  const o = options || {};
  const args = [
    updateScript,
    "--to", String(o.toVersion),
    "--source", mcCloneRoot,
    "--target", productRepoPath,
  ];
  args.push(o.dryRun ? "--dry-run" : "--apply");
  if (o.confirmDeletes) args.push("--confirm-deletes");
  return args;
}

function runUpdate(productRepoPath, mcCloneRoot, options) {
  return new Promise((resolve) => {
    const o = options || {};
    const updateScript = path.join(mcCloneRoot, "scripts", "mc", "update.js");
    if (!fs.existsSync(updateScript)) {
      return resolve({
        ok: false,
        status: "update-script-missing",
        stderr: "scripts/mc/update.js not found at " + updateScript,
      });
    }
    if (!o.toVersion) {
      return resolve({
        ok: false,
        status: "missing-to-version",
        stderr: "runUpdate requires options.toVersion (the capsule version to update to)",
      });
    }
    const args = buildUpdateArgs(updateScript, productRepoPath, mcCloneRoot, o);
    let child;
    let settled = false;
    const settle = (r) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    try {
      child = spawn("node", args, {
        cwd: productRepoPath,
        env: process.env,
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

function locateMcCloneRoot() {
  return path.resolve(__dirname, "..", "..");
}

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

  const mcCloneRoot = locateMcCloneRoot();
  const toVersion = (opts && opts.toVersion) || readMcVersion(mcCloneRoot);
  if (!toVersion) {
    stderr.write(
      "portfolio:sync: cannot resolve a target version — the MC clone has no readable " +
        "version.json#version. Pass --to <version>.\n",
    );
    emitTrace({
      type: "portfolio_sync",
      phase: "end",
      success_count: 0,
      failure_count: 0,
      error: "no-target-version",
    });
    return { exitCode: 2, results: [] };
  }
  const confirmDeletes = !!(opts && opts.confirmDeletes);
  const results = [];

  for (const product of products) {
    const fromVersion = detectMcVersion(product.repo_path) || "?";

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
      let dr;
      try {
        dr = await runUpdate(product.repo_path, mcCloneRoot, {
          toVersion,
          dryRun: true,
          confirmDeletes,
        });
      } catch (err) {
        dr = { ok: false, status: "internal-error", stderr: err.message };
      }
      const r = {
        slug: product.slug,
        ok: !!dr.ok,
        status: dr.ok ? "dry-run" : dr.status,
        fromVersion,
        toVersion,
      };
      stdout.write(
        `${dr.ok ? "(dry-run) ok" : "(dry-run) FAILED (" + dr.status + ")"}` +
          ` (mc ${fromVersion} → ${toVersion})\n`,
      );
      if (!dr.ok && dr.stderr) {
        for (const line of dr.stderr.split(/\r?\n/)) {
          if (line.trim()) stderr.write("  " + line + "\n");
        }
      }
      emitTrace({
        type: "portfolio_sync",
        phase: "per_product",
        slug: product.slug,
        from_version: fromVersion,
        to_version: toVersion,
        status: r.status,
      });
      results.push(r);
      continue;
    }

    let updateR;
    try {
      updateR = await runUpdate(product.repo_path, mcCloneRoot, {
        toVersion,
        dryRun: false,
        confirmDeletes,
      });
    } catch (err) {
      updateR = { ok: false, status: "internal-error", stderr: err.message };
    }
    const resultVersion = updateR.ok ? detectMcVersion(product.repo_path) || toVersion : fromVersion;
    const r = {
      slug: product.slug,
      ok: !!updateR.ok,
      status: updateR.status,
      fromVersion,
      toVersion: resultVersion,
    };
    stdout.write(
      `${updateR.ok ? "ok" : "FAILED (" + updateR.status + ")"} (mc ${fromVersion} → ${resultVersion})\n`,
    );
    if (!updateR.ok && updateR.stderr) {
      for (const line of updateR.stderr.split(/\r?\n/)) {
        if (line.trim()) stderr.write("  " + line + "\n");
      }
    }
    emitTrace({
      type: "portfolio_sync",
      phase: "per_product",
      slug: product.slug,
      from_version: fromVersion,
      to_version: resultVersion,
      status: updateR.status,
    });
    results.push(r);
  }

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
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const confirmDeletes = argv.includes("--confirm-deletes");
  const toIdx = argv.indexOf("--to");
  const toVersion = toIdx !== -1 ? argv[toIdx + 1] : null;
  const r = await syncRegistry({ dryRun, toVersion, confirmDeletes });
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
  buildUpdateArgs,
  readMcVersion,
  detectMcVersion,
  locateMcCloneRoot,
};
