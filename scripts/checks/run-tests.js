#!/usr/bin/env node
"use strict";
/**
 * run-tests.js — the `npm test` runner (ED-434): the FULL test glob, minus a registered,
 * self-policing quarantine.
 *
 *   node scripts/checks/run-tests.js [--root <dir>] [--quarantine <file>]
 *
 * 1. Expands `scripts/** /*.test.js` + `tests/** /*.test.js` (no space; written apart only to keep
 *    this comment open) from what git sees under <root>: tracked files plus untracked-not-ignored
 *    files (`git ls-files --cached --others --exclude-standard`), so a gitignored local file never
 *    runs and a new test runs before its first commit. Deleted-on-disk tracked files are dropped.
 * 2. Subtracts the quarantine set read from <root>/tests/quarantine.json (or --quarantine).
 * 3. PRIMARY: `node --test <remaining files>` (in batches that fit the Windows command line).
 *    A failing batch's exit code is the runner's exit code.
 * 4. TEETH: every quarantined file runs ALONE (`node --test <file>`, sequentially, so no
 *    cross-file interference can keep a healed test looking red). The runner FAILS if any
 *    quarantined file PASSES (its disposition stopped being true — remove the entry) or if a
 *    listed file no longer exists on disk / is not a discovered test file.
 *
 * Fail-closed everywhere: a git error, a malformed quarantine artifact, zero files to run, a spawn
 * error, a timeout, a kill or a null exit code is a FAILURE, never a pass — for the primary run AND
 * for a quarantined file (a killed quarantined run is not an observation that it still fails).
 *
 * Exit: 0 = primary green AND every quarantine entry valid and still failing; otherwise non-zero
 * (the primary run's own exit code when the primary run failed, else 1).
 */
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");
const QUARANTINE_REL = "tests/quarantine.json";
const TEST_DIRS = ["scripts", "tests"];
const TEST_FILE_RE = /^(?:scripts|tests)\/(?:.+\/)?[^/]+\.test\.js$/;
const GLOB_META_RE = /[*?[\]{}]/; // node --test treats its file args as glob patterns
const REQUIRED_FIELDS = ["file", "firstFailingAssertion", "cause", "filedUnder", "expiry"];
const MAX_BATCH_CHARS = 12000; // well under the 32,767-char Windows CreateProcess limit
const PRIMARY_BATCH_TIMEOUT_MS = 30 * 60 * 1000;
const QUARANTINE_FILE_TIMEOUT_MS = 10 * 60 * 1000;
const CAPTURE_LIMIT = 8 * 1024 * 1024;
const GIT_LOCATOR_ENV = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_PREFIX", "GIT_OBJECT_DIRECTORY", "GIT_NAMESPACE"];

function usage(msg) {
  if (msg) process.stderr.write(`run-tests: ${msg}\n`);
  process.stderr.write("usage: node scripts/checks/run-tests.js [--root <dir>] [--quarantine <file>]\n");
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { root: DEFAULT_ROOT, quarantine: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root" || a === "--quarantine") {
      const v = argv[++i];
      if (!v) usage(`${a} needs a value`);
      opts[a.slice(2)] = path.resolve(v);
    } else if (a === "--help" || a === "-h") {
      usage();
    } else {
      usage(`unknown argument: ${a}`);
    }
  }
  if (!opts.quarantine) opts.quarantine = path.join(opts.root, ...QUARANTINE_REL.split("/"));
  return opts;
}

function childEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // children must not report into an enclosing test runner
  return env;
}

/** Test files git sees under root (tracked + untracked-not-ignored), existing on disk, sorted. */
function discoverTestFiles(root) {
  const env = childEnv();
  for (const k of GIT_LOCATOR_ENV) delete env[k];
  const r = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...TEST_DIRS], {
    cwd: root,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (r.error) throw new Error(`git ls-files could not run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git ls-files exited ${r.status}: ${String(r.stderr).trim()}`);
  const files = new Set();
  for (const rel of String(r.stdout).split("\0")) {
    if (!rel || !TEST_FILE_RE.test(rel)) continue;
    if (!fs.existsSync(path.join(root, ...rel.split("/")))) continue;
    files.add(rel);
  }
  return [...files].sort();
}

/** Load + validate the quarantine artifact. Throws on anything malformed (fail-closed). */
function loadQuarantine(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    throw new Error(`cannot read quarantine artifact ${file}: ${e.message}`);
  }
  let doc;
  try {
    doc = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw); // tolerate a UTF-8 BOM
  } catch (e) {
    throw new Error(`quarantine artifact ${file} is not valid JSON: ${e.message}`);
  }
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.entries)) {
    throw new Error(`quarantine artifact ${file} must be an object with an "entries" array`);
  }
  const problems = [];
  const seen = new Set();
  doc.entries.forEach((e, i) => {
    const at = `entries[${i}]`;
    if (!e || typeof e !== "object" || Array.isArray(e)) return problems.push(`${at} is not an object`);
    for (const f of REQUIRED_FIELDS) {
      if (typeof e[f] !== "string" || e[f].trim() === "") problems.push(`${at} (${e.file || "?"}) is missing a non-empty "${f}"`);
    }
    if (typeof e.file !== "string") return;
    if (!TEST_FILE_RE.test(e.file) || e.file.split("/").includes("..")) {
      problems.push(`${at} file "${e.file}" is not a repo-relative scripts/** or tests/** *.test.js path`);
    }
    if (seen.has(e.file)) problems.push(`${at} file "${e.file}" is quarantined more than once`);
    seen.add(e.file);
  });
  if (problems.length) throw new Error(`quarantine artifact ${file} is malformed:\n  - ${problems.join("\n  - ")}`);
  return doc.entries;
}

function batches(files) {
  const out = [];
  let cur = [];
  let len = 0;
  for (const f of files) {
    if (cur.length && len + f.length + 1 > MAX_BATCH_CHARS) {
      out.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(f);
    len += f.length + 1;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Run `node --test <files>` from root. Resolves { status, signal, error, output }.
 * status is a number only when the child really exited; anything else is not an observation.
 */
function runNodeTest(root, files, { tee, timeoutMs }) {
  return new Promise((resolve) => {
    let output = "";
    const capture = (chunk, stream) => {
      const s = chunk.toString("utf8");
      if (tee) stream.write(s);
      output += s;
      if (output.length > CAPTURE_LIMIT) output = output.slice(-CAPTURE_LIMIT);
    };
    let settled = false;
    let timedOut = false;
    const done = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ output, ...res });
    };
    let child;
    try {
      child = spawn(process.execPath, ["--test", ...files], { cwd: root, env: childEnv(), windowsHide: true });
    } catch (e) {
      return resolve({ status: null, signal: null, error: `spawn failed: ${e.message}`, output });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (c) => capture(c, process.stdout));
    child.stderr.on("data", (c) => capture(c, process.stderr));
    child.on("error", (e) => done({ status: null, signal: null, error: `spawn error: ${e.message}` }));
    child.on("close", (code, signal) => {
      if (timedOut) return done({ status: null, signal, error: `timed out after ${timeoutMs}ms` });
      if (typeof code !== "number") return done({ status: null, signal, error: `killed by ${signal || "unknown signal"} (no exit code)` });
      done({ status: code, signal: null, error: null });
    });
  });
}

/** Last reported value of each node:test summary counter (spec "ℹ pass 3" or tap "# pass 3"). */
function counts(output) {
  const c = {};
  const re = /^(?:ℹ|#) (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/gm;
  let m;
  while ((m = re.exec(output))) c[m[1]] = Number(m[2]);
  return c;
}

/** First line that looks like a failure, for a one-line quarantine status. */
function firstFailureLine(output) {
  const line = String(output)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /(^|\s)(not ok|FAIL|✖)\b|Error\b|AssertionError/.test(l));
  return line ? line.slice(0, 240) : "(no failure line captured)";
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const log = (s) => process.stdout.write(`${s}\n`);

  let discovered;
  let entries;
  try {
    discovered = discoverTestFiles(opts.root);
    entries = loadQuarantine(opts.quarantine);
  } catch (e) {
    log(`run-tests: FAIL — ${e.message}`);
    return 1;
  }
  const bad = discovered.filter((f) => GLOB_META_RE.test(f));
  if (bad.length) {
    log(`run-tests: FAIL — test file path(s) contain glob metacharacters and cannot be passed literally to node --test: ${bad.join(", ")}`);
    return 1;
  }

  const discoveredSet = new Set(discovered);
  const quarantined = new Set(entries.map((e) => e.file));
  const primaryFiles = discovered.filter((f) => !quarantined.has(f));
  const violations = [];

  // ---- PRIMARY ----
  let primaryExit = 0;
  const primaryCounts = { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
  const primaryBatches = batches(primaryFiles);
  if (primaryFiles.length === 0) {
    log("run-tests: FAIL — zero non-quarantined test files to run (nothing run is not a pass)");
    primaryExit = 1;
  }
  for (let i = 0; i < primaryBatches.length; i++) {
    const b = primaryBatches[i];
    log(`run-tests: primary batch ${i + 1}/${primaryBatches.length} — node --test ${b.length} file(s)`);
    const r = await runNodeTest(opts.root, b, { tee: true, timeoutMs: PRIMARY_BATCH_TIMEOUT_MS });
    const c = counts(r.output);
    for (const k of Object.keys(primaryCounts)) primaryCounts[k] += c[k] || 0;
    if (r.status === null) {
      log(`run-tests: primary batch ${i + 1} did not exit with a code (${r.error}) — FAILURE`);
      if (primaryExit === 0) primaryExit = 1;
    } else if (r.status !== 0 && primaryExit === 0) {
      primaryExit = r.status;
    }
  }

  // ---- QUARANTINE TEETH ----
  let stillFailing = 0;
  let unexpectedlyPassed = 0;
  let missing = 0;
  let unobserved = 0;
  for (const e of entries) {
    const abs = path.join(opts.root, ...e.file.split("/"));
    if (!fs.existsSync(abs)) {
      missing++;
      violations.push(`MISSING: quarantined file ${e.file} no longer exists on disk — remove its entry from the quarantine`);
      continue;
    }
    if (!discoveredSet.has(e.file)) {
      missing++;
      violations.push(`NOT DISCOVERED: quarantined file ${e.file} exists but is not a discovered test file (gitignored?) — the quarantine cannot subtract it`);
      continue;
    }
    const r = await runNodeTest(opts.root, [e.file], { tee: false, timeoutMs: QUARANTINE_FILE_TIMEOUT_MS });
    if (r.status === null) {
      unobserved++;
      violations.push(`UNOBSERVED: quarantined file ${e.file} did not exit with a code (${r.error}) — not an observation that it still fails`);
    } else if (r.status === 0) {
      unexpectedlyPassed++;
      violations.push(`UNEXPECTEDLY PASSED: quarantined file ${e.file} now passes (exit 0) — its disposition is no longer true; remove its entry from the quarantine`);
    } else {
      stillFailing++;
      log(`run-tests: quarantine ${e.file} still fails (exit ${r.status}) [${e.cause}; ${e.filedUnder}; expiry ${e.expiry}] — ${firstFailureLine(r.output)}`);
    }
  }
  for (const v of violations) log(`run-tests: QUARANTINE VIOLATION — ${v}`);

  const quarantineOk = violations.length === 0;
  const ok = primaryExit === 0 && quarantineOk;
  log(
    `run-tests: ${ok ? "PASS" : "FAIL"} — primary: ${primaryFiles.length} file(s) in ${primaryBatches.length} batch(es), exit ${primaryExit} ` +
      `(tests ${primaryCounts.tests}, pass ${primaryCounts.pass}, fail ${primaryCounts.fail}, cancelled ${primaryCounts.cancelled}, skipped ${primaryCounts.skipped}, todo ${primaryCounts.todo}) · ` +
      `quarantine: ${entries.length} entr${entries.length === 1 ? "y" : "ies"}, ${stillFailing} still failing, ${unexpectedlyPassed} unexpectedly passed, ${missing} missing/undiscovered, ${unobserved} unobserved`
  );
  if (primaryExit !== 0) return primaryExit;
  return quarantineOk ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    process.stdout.write(`run-tests: FAIL — runner crashed: ${e && e.stack ? e.stack : e}\n`);
    process.exitCode = 1;
  }
);
