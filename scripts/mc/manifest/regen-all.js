#!/usr/bin/env node
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const GENERATORS = [
  { name: "framework-manifest", args: ["scripts/generate-framework-manifest.js"] },
  { name: "installed-snapshot", args: ["scripts/mc/snapshot-installed.js"] },
  { name: "mc-manifest", args: ["scripts/mc/manifest/build.js"] },
];

const CHECKS = [
  { name: "framework-manifest --check", args: ["scripts/generate-framework-manifest.js", "--check"] },
  { name: "installed-snapshot --check", args: ["scripts/mc/snapshot-installed.js", "--check"] },
  { name: "mc-manifest-honesty", args: ["scripts/checks/mc-manifest-honesty.js"] },
  { name: "mc-manifest validate --strict", args: ["scripts/mc/manifest/validate.js", "--strict"] },
];

function defaultRun(args, root) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
  const r = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: r.error ? 1 : r.status, output: `${r.stdout || ""}${r.stderr || ""}${r.error ? r.error.message : ""}` };
}

function tail(text, n) {
  return String(text || "").trimEnd().split(/\r?\n/).slice(-n).map((l) => `      ${l}`).join("\n");
}

function runAll({ root, run = defaultRun, log = (line) => process.stdout.write(`${line}\n`) } = {}) {
  const results = [];
  const step = (kind, s) => {
    const r = run(s.args, root);
    const ok = r.status === 0;
    results.push({ kind, name: s.name, ok, status: r.status });
    log(`${ok ? "GREEN" : "RED  "} ${kind} ${s.name}${ok ? "" : ` (exit ${r.status})`}`);
    if (!ok && r.output) log(tail(r.output, 8));
    return ok;
  };
  for (const g of GENERATORS) {
    if (!step("generate", g)) {
      log("stopped: a generator is red, so the later steps would read stale output");
      return { ok: false, results };
    }
  }
  for (const c of CHECKS) step("check", c);
  const ok = results.every((r) => r.ok);
  log(ok ? "manifests: all green" : "manifests: RED");
  return { ok, results };
}

if (require.main === module) {
  const root = path.resolve(__dirname, "..", "..", "..");
  process.exit(runAll({ root }).ok ? 0 : 1);
}

module.exports = { runAll, GENERATORS, CHECKS };
