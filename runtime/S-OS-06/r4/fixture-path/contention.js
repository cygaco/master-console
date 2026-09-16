#!/usr/bin/env node
"use strict";
/**
 * Forced-contention harness for tests/regression/S-OS-06/migration.test.js (S-OS-06 r4 fixture-path).
 *
 *   node runtime/S-OS-06/r4/fixture-path/contention.js <label> [hold|concurrent|both]
 *
 * hold:       a HOLDER process is started with its CWD set to the shared path runtime/S-OS-06/fixture-product
 *             (a Windows process cwd is an open directory handle without FILE_SHARE_DELETE, so the directory can be
 *             neither removed nor replaced). With the holder alive, the test file is run once under the runner's
 *             pinned reporter. The holder is killed afterwards.
 * concurrent: N=4 simultaneous `node --test` loads of the same file, no holder.
 *
 * Writes <label>-<mode>.txt next to this script (exit codes, summary counters, EPERM lines, full TAP output).
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const FILE = "tests/regression/S-OS-06/migration.test.js";
const SHARED = path.join(ROOT, "runtime", "S-OS-06", "fixture-product");
const label = process.argv[2] || "run";
const mode = process.argv[3] || "both";

function runTest() {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, ["--test", "--test-reporter=tap", FILE], { cwd: ROOT, windowsHide: true });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("close", (code) => resolve({ code, out }));
  });
}

function summary(r) {
  const c = {};
  for (const m of r.out.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/gm)) c[m[1]] = Number(m[2]);
  const eperm = [...new Set(r.out.split(/\r?\n/).filter((l) => /EPERM|EBUSY|ENOENT|ENOTEMPTY/.test(l)).map((l) => l.trim()))];
  return { exit: r.code, counters: c, errnoLines: eperm.slice(0, 6) };
}

async function hold() {
  fs.mkdirSync(SHARED, { recursive: true });
  const holder = spawn(process.execPath, ["-e", "process.stdout.write('ready\\n'); setInterval(() => {}, 1e9)"], { cwd: SHARED, windowsHide: true });
  await new Promise((res) => holder.stdout.once("data", res));
  const r = await runTest();
  holder.kill();
  await new Promise((res) => holder.once("close", res));
  return { holderCwd: path.relative(ROOT, SHARED).split(path.sep).join("/"), ...summary(r), out: r.out };
}

async function concurrent() {
  const rs = await Promise.all([runTest(), runTest(), runTest(), runTest()]);
  return rs.map((r) => ({ ...summary(r), out: r.out }));
}

(async () => {
  const head = require("child_process").execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  const results = {};
  if (mode === "hold" || mode === "both") results.hold = await hold();
  if (mode === "concurrent" || mode === "both") results.concurrent = await concurrent();
  const brief = {
    label,
    head,
    node: process.version,
    hold: results.hold && { holderCwd: results.hold.holderCwd, exit: results.hold.exit, counters: results.hold.counters, errnoLines: results.hold.errnoLines },
    concurrent: results.concurrent && results.concurrent.map(({ out, ...s }) => s),
  };
  const body = [JSON.stringify(brief, null, 2), ""];
  if (results.hold) body.push("===== HOLD: full TAP output =====", results.hold.out);
  if (results.concurrent) results.concurrent.forEach((r, i) => body.push(`===== CONCURRENT #${i + 1}: full TAP output =====`, r.out));
  const outFile = path.join(__dirname, `${label}-${mode}.txt`);
  fs.writeFileSync(outFile, body.join("\n"));
  process.stdout.write(JSON.stringify(brief, null, 2) + `\nwritten: ${path.relative(ROOT, outFile)}\n`);
})();
