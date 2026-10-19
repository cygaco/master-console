#!/usr/bin/env node
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

const GATES = [
  { name: "privacy", args: ["scripts/check/privacy.js"], extraArgs: ["--no-name-check"] },
  { name: "framework-purity", args: ["scripts/checks/framework-purity.js", "--full"] },
  { name: "tracked-transients", args: ["scripts/checks/mc-tracked-transients.js"] },
  { name: "leak-denylist", args: ["scripts/checks/leak-denylist.js"] },
  { name: "readme-drift", args: ["scripts/checks/readme-drift.js"] },
];

function runGates(gates, { cwd = ROOT, quiet = false } = {}) {
  const results = [];
  for (const g of gates) {
    const spawnArgs = g.args.concat(g.extraArgs || []);
    if (!quiet) process.stdout.write(`\n=== leak-gate: ${g.name} — node ${spawnArgs.join(" ")}\n`);
    const r = spawnSync(process.execPath, spawnArgs, {
      cwd,
      stdio: quiet ? "pipe" : "inherit",
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
    });
    const code = r.status === null ? 2 : r.status;
    results.push({ name: g.name, code });
    if (!quiet) process.stdout.write(`=== leak-gate: ${g.name} → exit ${code}\n`);
  }
  return results;
}

function summarize(results) {
  const red = results.filter((r) => r.code !== 0);
  const errored = results.some((r) => r.code >= 2);
  return { ok: red.length === 0, code: red.length === 0 ? 0 : errored ? 2 : 1, red };
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const pick = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : String(argv[i + 1] || "").split(",").filter(Boolean);
  };
  const skip = pick("--skip") || [];
  const only = pick("--only");
  const known = new Set(GATES.map((g) => g.name));
  for (const n of [...skip, ...(only || [])]) {
    if (!known.has(n)) {
      process.stderr.write(`unknown gate: ${n} (known: ${[...known].join(", ")})\n`);
      return 2;
    }
  }
  const gates = GATES.filter((g) => !skip.includes(g.name) && (!only || only.includes(g.name)));
  const results = runGates(gates, { quiet: json });
  const s = summarize(results);
  if (json) {
    process.stdout.write(JSON.stringify({ ok: s.ok, results }, null, 2) + "\n");
  } else {
    process.stdout.write("\n=== leak-gate summary\n");
    for (const r of results) process.stdout.write(`  ${r.code === 0 ? "OK  " : "FAIL"}  ${r.name}  (exit ${r.code})\n`);
    process.stdout.write(`=== leak-gate: ${s.ok ? "GREEN" : "RED"} (exit ${s.code})\n`);
  }
  return s.code;
}

if (require.main === module) process.exit(main());

module.exports = { GATES, runGates, summarize };
