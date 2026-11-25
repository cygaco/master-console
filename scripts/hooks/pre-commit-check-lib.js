#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const path = require("path");
const checkLib = require("../dispatch/check-lib");
const { TRANSPORT_SKIP_ALLOWED } = require("../dispatch/transport-skip-allowlist");

const SCAN_ROOTS = new Set(["scripts", ".claude"]);
const TEXT_EXT = new Set([".js", ".json", ".md", ".ts", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "runtime", ".provider-tmp"]);
const GIT_MAX_BUFFER = 1024 * 1024 * 1024;

function isScannable(relPath) {
  const segs = relPath.split("/");
  if (segs.length < 2 || !SCAN_ROOTS.has(segs[0])) return false;
  if (segs.slice(0, -1).some((s) => SKIP_DIRS.has(s))) return false;
  return TEXT_EXT.has(path.extname(relPath).toLowerCase());
}

function git(root, args, input) {
  return execFileSync("git", args, {
    cwd: root,
    input,
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

function collectStagedFiles(root) {
  const staged = new Set(
    git(root, ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMRT"])
      .toString("utf8")
      .split("\0")
      .filter((p) => p && isScannable(p)),
  );
  if (staged.size === 0) return [];

  const entries = [];
  for (const rec of git(root, ["ls-files", "-s", "-z", "--full-name"]).toString("utf8").split("\0")) {
    const tab = rec.indexOf("\t");
    if (tab < 0) continue;
    const [mode, blob] = rec.slice(0, tab).split(" ");
    const p = rec.slice(tab + 1);
    if (staged.has(p) && (mode === "100644" || mode === "100755")) entries.push({ path: p, blob });
  }
  if (entries.length === 0) return [];

  const out = git(root, ["cat-file", "--batch"], entries.map((e) => e.blob).join("\n") + "\n");
  const files = [];
  let pos = 0;
  for (const e of entries) {
    const nl = out.indexOf(0x0a, pos);
    if (nl < 0) throw new Error(`git cat-file --batch: truncated output at ${e.path}`);
    const header = out.slice(pos, nl).toString("utf8").split(" ");
    if (header[0] !== e.blob || header[1] !== "blob") {
      throw new Error(`git cat-file --batch: unexpected header for ${e.path}: ${header.join(" ")}`);
    }
    const size = Number(header[2]);
    const start = nl + 1;
    if (!Number.isInteger(size) || start + size > out.length) {
      throw new Error(`git cat-file --batch: bad size for ${e.path}`);
    }
    files.push({ path: e.path, buf: Buffer.from(out.subarray(start, start + size)) });
    pos = start + size + 1;
  }
  return files;
}

function reduceBlockingReasons(results, requiredSet) {
  return results
    .filter(
      (r) =>
        r.status === "fail" ||
        r.status === "timeout" ||
        (r.status === "skipped" &&
          requiredSet.has(r.name) &&
          !(
            Object.prototype.hasOwnProperty.call(TRANSPORT_SKIP_ALLOWED, r.name) &&
            r.reason === TRANSPORT_SKIP_ALLOWED[r.name]
          )),
    )
    .map((r) => ({ name: r.name, status: r.status, reason: r.reason }));
}

function runCheckLibSuite(ctx = {}) {
  const suite = checkLib.runSuite(checkLib.CHECK_NAMES.slice(), ctx);
  const requiredSet = new Set(checkLib.REQUIRED_CHECKS);
  const blockingReasons = reduceBlockingReasons(suite.results, requiredSet);
  if (suite.missing.length) {
    blockingReasons.push({ name: suite.missing.join(","), status: "missing", reason: "check-registry-drift" });
  }
  return { ...suite, blocked: blockingReasons.length > 0, blockingReasons };
}

function computeExitCode(opts = {}) {
  const runFn = typeof opts.runCheckLibSuiteFn === "function" ? opts.runCheckLibSuiteFn : runCheckLibSuite;
  const root = opts.root || process.cwd();
  let result;
  try {
    result = runFn({ root, files: collectStagedFiles(root) });
  } catch (e) {
    process.stderr.write(`pre-commit-check-lib: RUNNER ERROR (distinct non-zero exit 2 — NEVER a silent pass): ${e && e.message ? e.message : e}\n`);
    return 2;
  }
  if (result.blocked) {
    process.stderr.write(
      "pre-commit-check-lib: local check-lib feedback found issue(s) — NON-AUTHORITATIVE (bypassable via " +
        "--no-verify; the real gate is trusted-controller.js's out-of-tree pinned run, Seam E):\n",
    );
    for (const r of result.blockingReasons) {
      process.stderr.write(`  - ${r.name}: ${r.status}${r.reason ? ` (${r.reason})` : ""}\n`);
    }
    return 1;
  }
  process.stdout.write("pre-commit-check-lib: OK (non-authoritative local signal only)\n");
  return 0;
}

function main() {
  return computeExitCode();
}

if (require.main === module) process.exit(main());

module.exports = { runCheckLibSuite, main, computeExitCode, reduceBlockingReasons };
