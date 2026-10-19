"use strict";

const fs = require("fs");
const path = require("path");

const DIRECT_INVOCATION_ROOT_GUESS = path.resolve(__dirname, "..", "..", "..", "..");

const DEFAULT_SCAN_ROOTS = ["scripts", ".claude"];
const TEXT_EXT = new Set([".js", ".json", ".md", ".ts", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "runtime", ".provider-tmp"]);

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      yield* walk(path.join(dir, ent.name));
    } else if (ent.isFile() && TEXT_EXT.has(path.extname(ent.name).toLowerCase())) {
      yield path.join(dir, ent.name);
    }
  }
}

function collectFiles(root, roots) {
  const files = [];
  for (const r of roots) {
    const abs = path.join(root, r);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      try {
        files.push({ path: path.relative(root, file), buf: fs.readFileSync(file) });
      } catch {
      }
    }
  }
  return files;
}

function loadOriginalEvaluate() {
  const bundleSibling = path.resolve(__dirname, "..", "..", "external", "scripts", "checks", "no-nul-bytes.js");
  if (fs.existsSync(bundleSibling)) return require(bundleSibling);
  return require(path.join(DIRECT_INVOCATION_ROOT_GUESS, "scripts", "checks", "no-nul-bytes.js"));
}

function run(ctx = {}) {
  const root = (ctx && ctx.root) || DIRECT_INVOCATION_ROOT_GUESS;
  const scanRoots = ctx && Array.isArray(ctx.scanRoots) && ctx.scanRoots.length ? ctx.scanRoots : DEFAULT_SCAN_ROOTS;

  let files;
  try {
    files = ctx && Array.isArray(ctx.files) ? ctx.files : collectFiles(root, scanRoots);
  } catch (e) {
    return { status: "fail", reason: "no-nul-bytes-scan-error", evidence: { error: String(e && e.message ? e.message : e) } };
  }

  let impl;
  try {
    impl = loadOriginalEvaluate();
  } catch (e) {
    return { status: "fail", reason: "no-nul-bytes-original-unavailable", evidence: { error: String(e && e.message ? e.message : e) } };
  }
  if (!impl || typeof impl.evaluate !== "function") {
    return { status: "fail", reason: "no-nul-bytes-original-missing-evaluate", evidence: {} };
  }

  let res;
  try {
    res = impl.evaluate({ files });
  } catch (e) {
    return { status: "fail", reason: "no-nul-bytes-evaluate-error", evidence: { error: String(e && e.message ? e.message : e) } };
  }

  if (res && res.ok) return { status: "pass", reason: "no-nul-bytes-clean", evidence: { scanned: files.length } };
  return { status: "fail", reason: "nul-byte-found", evidence: { offenders: (res && res.offenders) || [], scanned: files.length } };
}

module.exports = { name: "no-nul-bytes", run };
