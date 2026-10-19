"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const { load } = require("./registry");

const PER_PRODUCT_TIMEOUT_MS = 120000;

function emitTrace(payload) {
  try {
    const { log } = require(path.resolve(__dirname, "..", "hooks", "lib", "logger.js"));
    log("portfolio", payload);
  } catch {
  }
}

function pad(s, n) {
  const x = String(s == null ? "" : s);
  return x.length >= n ? x.slice(0, n) : x + " ".repeat(n - x.length);
}

function bumpScriptPath() {
  return path.resolve(__dirname, "..", "dispatch", "bump-model.js");
}

function parseCounts(stdout) {
  if (/no live references found/.test(stdout)) return { files: 0, hits: 0 };
  const m = stdout.match(/(\d+)\s+id\/label reference\(s\) across (\d+) file\(s\)/);
  if (m) return { hits: Number(m[1]), files: Number(m[2]) };
  return { files: null, hits: null };
}

function runBump(repoPath, { from, to, apply }) {
  return new Promise((resolve) => {
    const script = bumpScriptPath();
    if (!fs.existsSync(script)) {
      return resolve({ ok: false, status: "engine-missing", stderr: script + " not found" });
    }
    const argv = [script, "--root", repoPath, "--from", from, "--to", to];
    if (apply) argv.push("--apply");

    let child, settled = false;
    const settle = (r) => { if (!settled) { settled = true; resolve(r); } };
    try {
      child = spawn("node", argv, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    } catch (err) {
      return settle({ ok: false, status: "spawn-error", stderr: err.message });
    }
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const tid = setTimeout(() => {
      try { child.kill(); } catch {}
      settle({ ok: false, status: "timeout", stdout: stdout.trim(), stderr: stderr.trim() });
    }, PER_PRODUCT_TIMEOUT_MS);
    child.on("error", (err) => { clearTimeout(tid); settle({ ok: false, status: "spawn-error", stderr: err.message }); });
    child.on("close", (code) => {
      clearTimeout(tid);
      const counts = parseCounts(stdout);
      settle({
        ok: code === 0,
        status: code === 0 ? "ok" : "exit-" + code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        counts,
      });
    });
  });
}

async function bumpRegistry(opts) {
  const stdout = (opts && opts.stdout) || process.stdout;
  const stderr = (opts && opts.stderr) || process.stderr;
  const from = (opts && opts.from) || "claude-opus-4-7";
  const to = (opts && opts.to) || "claude-opus-4-8";
  const apply = !!(opts && opts.apply);

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
    return { exitCode: 0, results: [] };
  }

  const mode = apply ? "APPLY" : "DRY-RUN";
  stdout.write(`portfolio model bump: ${from} → ${to}  [${mode}]\n`);
  stdout.write(`${products.length} product(s), running concurrently...\n\n`);
  emitTrace({ type: "portfolio_bump_models", phase: "start", product_count: products.length, from, to, apply });

  const results = await Promise.all(products.map(async (product) => {
    if (!product.repo_path || !fs.existsSync(product.repo_path)) {
      return { slug: product.slug, ok: false, status: "repo-not-found", counts: { files: null, hits: null } };
    }
    let r;
    try {
      r = await runBump(product.repo_path, { from, to, apply });
    } catch (err) {
      r = { ok: false, status: "internal-error", stderr: err.message, counts: { files: null, hits: null } };
    }
    return { slug: product.slug, ...r };
  }));

  const header = pad("SLUG", 18) + " " + pad("FILES", 6) + " " + pad("REFS", 6) + " RESULT";
  stdout.write(header + "\n" + "-".repeat(header.length) + "\n");
  for (const r of results) {
    const files = r.counts && r.counts.files != null ? r.counts.files : "?";
    const hits = r.counts && r.counts.hits != null ? r.counts.hits : "?";
    stdout.write(
      pad(r.slug, 18) + " " + pad(files, 6) + " " + pad(hits, 6) + " " +
      (r.ok ? (apply ? "bumped" : "would bump") : "FAILED (" + r.status + ")") + "\n",
    );
    if (!r.ok && r.stderr) {
      for (const line of String(r.stderr).split(/\r?\n/)) if (line.trim()) stderr.write("  " + line + "\n");
    }
    emitTrace({ type: "portfolio_bump_models", phase: "per_product", slug: r.slug, status: r.status, files: r.counts && r.counts.files, hits: r.counts && r.counts.hits });
  }

  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  stdout.write(`\n${ok} ok / ${failed} failed${apply ? "" : "  (dry-run — re-run with --apply to write)"}\n`);
  emitTrace({ type: "portfolio_bump_models", phase: "end", success_count: ok, failure_count: failed });

  return { exitCode: failed === 0 ? 0 : 1, results };
}

function parseArgs(argv) {
  const o = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") o.apply = true;
    else if (argv[i] === "--from") o.from = argv[++i];
    else if (argv[i] === "--to") o.to = argv[++i];
  }
  return o;
}

async function main() {
  const r = await bumpRegistry(parseArgs(process.argv.slice(2)));
  process.exit(r.exitCode);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write("portfolio:bump-models crashed: " + (err.message || err) + "\n");
    process.exit(2);
  });
}

module.exports = { bumpRegistry, runBump, parseCounts };
