#!/usr/bin/env node
"use strict";

/**
 * record-trust-exit.js — the S-OS-06 design->build EXIT enforcer (record-trust Req4).
 *
 * A blocking checklist. Every item prints exactly one line — `PASS [n id] <detail>` or
 * `FAIL [n id] <reason>` — and the process exits 0 ONLY if every item passes:
 *
 *   1 fixtures   every falsify-*.test.js under tests/regression/S-OS-06/ runs (`node --test`)
 *                and passes. The REQUIRED falsifiers (F1..F6, F8, F9) are identified by the
 *                `const FALSIFIER_ID = "..."` each fixture declares (never by file name; F9 is the
 *                genuine-refused-rename falsifier behind item 4's refusedRenames==0 assertion); a
 *                missing required id is a hard FAIL. Fail-open shapes are FAILs too: a fixture
 *                that is skipped / todo / cancelled, that passes zero tests, whose TAP summary
 *                is unparseable, or that never reaches an exit code (timeout / killed).
 *   2 guard      the partition single-loader guard: no executable file names the partition
 *                artifact outside partition-loader.js (partition-loader.js#findUnroutedReaders,
 *                the same check tests/regression/S-OS-06/partition-single-loader.test.js
 *                asserts), and the codemod + both gates require the loader.
 *   3 deny-list  the partition artifact exists, loads through the loader, and carries its
 *                `$question` header. Its path comes from the loader (DENYLIST_PATH) — this file
 *                never names the artifact (the un-routed-reader guard applies to it as well).
 *   4 dry-run    `node scripts/open-source/rename-mc.js --dry-run` exits 0 AND its output shows
 *                unclassified=0 AND unpinned-unrewritten-underived=0 (a missing counter line is
 *                a FAIL, never a zero), AND the derived rule holds: the set of files carrying
 *                `derived` rows in the committed occurrence ledger this run just wrote == the
 *                partition's generated views read at their RESOLVED paths (declared, or the
 *                codemod's rename of it once --apply moved the view with its Class-1 directory —
 *                revisited post-apply in T3), and there are exactly 5 of them; the
 *                derived count agrees across stdout, ledger rows and ledger header; AND
 *                refusedRenames == 0 on BOTH the stdout `refusedRenames=` line and the fresh
 *                runtime/S-OS-06/rename-plan.json this run just wrote (missing line / array, a stale
 *                plan, or a stdout/plan disagreement is a FAIL). A refused rename is a genuine
 *                refusal — --apply would refuse — so a green exit gate requires none.
 *                (Post-apply — T3/T5 — the derived rule must be revisited, not silently kept.)
 *
 * Exit: 0 = every item PASS · 1 = any item FAIL · 2 = usage / internal error (never green).
 *
 * The fixture discovery matches falsify-*.test.js only, so record-trust-exit.test.js (which
 * runs this enforcer) is never re-entered by item 1.
 *
 * Everything resolves from REPO_ROOT (two levels above this file), so a test may copy this
 * module into a temp tree and run it there without touching the real tree. There is no CLI
 * flag that skips an item: the exported `runRecordTrustExit({ items })` selector exists for
 * those tests; the CLI always runs all four.
 *
 *   node scripts/checks/record-trust-exit.js
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const FIXTURES_REL = "tests/regression/S-OS-06";
const FIXTURE_FILE_RE = /^falsify-.+\.test\.js$/;
const FALSIFIER_ID_RE = /^\s*const\s+FALSIFIER_ID\s*=\s*["']([^"']+)["']\s*;?\s*$/m;
const REQUIRED_FALSIFIERS = ["F1", "F2", "F3", "F4", "F5", "F6", "F8", "F9"];

const LOADER_REL = "scripts/open-source/partition-loader.js";
const CODEMOD_REL = "scripts/open-source/rename-mc.js";
const PLAN_REL = "runtime/S-OS-06/rename-plan.json";
const LOADER_CONSUMERS = [CODEMOD_REL, "scripts/checks/framework-purity.js", "scripts/checks/cutover-completeness.js"];
const LOADER_REQUIRE_RE = /require\((["'])(\.\/|\.\.\/open-source\/)partition-loader\1\)/;

const EXPECTED_GENERATED_VIEWS = 5;

const FIXTURE_CONCURRENCY = 4;
const FIXTURE_TIMEOUT_MS = 10 * 60 * 1000;
const DRYRUN_TIMEOUT_MS = 10 * 60 * 1000;
const MTIME_SLACK_MS = 2000;

const ITEMS = [
  { n: 1, id: "fixtures", run: checkFixtures },
  { n: 2, id: "guard", run: checkGuard },
  { n: 3, id: "deny-list", run: checkDenylist },
  { n: 4, id: "dry-run", run: checkDryRun },
];
const ITEM_IDS = ITEMS.map((i) => i.id);

// ── helpers ──────────────────────────────────────────────────────────────────

const toPosix = (p) => String(p).split(path.sep).join("/");
const absOf = (root, rel) => path.join(root, ...rel.split("/"));
const pass = (detail) => ({ ok: true, detail });
const fail = (detail) => ({ ok: false, detail });

function loaderAt(root) {
  return require(absOf(root, LOADER_REL));
}

/** A child `node --test` must not inherit the parent's test-runner context (it would report to it). */
function testChildEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

/** Spawn node with captured stdout/stderr and a hard timeout. Never rejects. */
function runNode(args, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let done = false;
    let timer = null;
    let child;
    const finish = (res) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, timedOut, ...res });
    };
    try {
      child = spawn(process.execPath, args, { cwd, env, windowsHide: true });
    } catch (e) {
      finish({ status: null, signal: null, error: e });
      return;
    }
    timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (e) => finish({ status: null, signal: null, error: e }));
    child.on("close", (code, signal) => finish({ status: code, signal, error: null }));
  });
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, worker));
  return out;
}

/** The LAST `# <key> N` TAP summary counters; null when any counter is absent (fail-closed). */
function parseTapSummary(stdout) {
  const keys = ["tests", "pass", "fail", "cancelled", "skipped", "todo"];
  const summary = {};
  for (const k of keys) {
    const all = [...String(stdout).matchAll(new RegExp(`^# ${k} (\\d+)\\s*$`, "gm"))];
    if (all.length === 0) return null;
    summary[k] = Number(all[all.length - 1][1]);
  }
  return summary;
}

function firstLines(text, n = 3) {
  return String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, n)
    .join(" | ")
    .slice(0, 400);
}

// ── item 1: fixtures ─────────────────────────────────────────────────────────

async function runFixture(root, file) {
  const rel = `${FIXTURES_REL}/${file}`;
  // A cwd-relative POSIX path: `node --test` treats its arguments as glob patterns, so an
  // absolute Windows path (backslashes) is not a safe argument.
  const r = await runNode(["--test", "--test-reporter=tap", rel], { cwd: root, env: testChildEnv(), timeoutMs: FIXTURE_TIMEOUT_MS });
  if (r.error) return { file, ok: false, reason: `did not start: ${r.error.message}` };
  if (r.timedOut || r.status === null) {
    return { file, ok: false, reason: `never reached an exit code (${r.timedOut ? "timed out" : `killed by ${r.signal}`}) — not a pass` };
  }
  const s = parseTapSummary(r.stdout);
  if (!s) return { file, ok: false, reason: `unparseable test summary (exit ${r.status}) — liveness is never certified on ambiguous output` };
  if (r.status !== 0 || s.fail > 0 || s.cancelled > 0) {
    const notOk = r.stdout.split(/\r?\n/).filter((l) => /^\s*not ok /.test(l));
    return { file, ok: false, reason: `exit ${r.status}, fail=${s.fail}, cancelled=${s.cancelled}: ${firstLines(notOk.join("\n") || r.stderr)}` };
  }
  if (s.skipped > 0 || s.todo > 0) {
    return { file, ok: false, reason: `skipped=${s.skipped} todo=${s.todo} — a skipped falsifier reads green while guarding nothing` };
  }
  if (s.pass === 0) return { file, ok: false, reason: "0 tests passed — an empty fixture falsifies nothing" };
  return { file, ok: true, pass: s.pass };
}

async function checkFixtures({ root }) {
  const dir = absOf(root, FIXTURES_REL);
  if (!fs.existsSync(dir)) return fail(`fixture directory ${FIXTURES_REL} is missing`);
  const files = fs.readdirSync(dir).filter((f) => FIXTURE_FILE_RE.test(f)).sort();
  if (files.length === 0) return fail(`no falsify-*.test.js fixtures under ${FIXTURES_REL}`);

  const byId = new Map();
  const structural = [];
  for (const f of files) {
    const m = fs.readFileSync(path.join(dir, f), "utf8").match(FALSIFIER_ID_RE);
    if (!m) {
      structural.push(`${f} declares no FALSIFIER_ID`);
    } else if (byId.has(m[1])) {
      structural.push(`FALSIFIER_ID ${m[1]} is declared by both ${byId.get(m[1])} and ${f}`);
    } else {
      byId.set(m[1], f);
    }
  }
  const missing = REQUIRED_FALSIFIERS.filter((id) => !byId.has(id));
  if (missing.length) structural.unshift(`missing required falsifier fixture(s): ${missing.join(", ")}`);
  if (structural.length) return fail(`${structural.join("; ")} (fixtures not run: the set is incomplete)`);

  const results = await mapLimit(files, FIXTURE_CONCURRENCY, (f) => runFixture(root, f));
  const bad = results.filter((r) => !r.ok);
  if (bad.length) return fail(bad.map((r) => `${r.file}: ${r.reason}`).join("; "));
  const tests = results.reduce((a, r) => a + r.pass, 0);
  const ids = [...byId.keys()].sort();
  return pass(`${files.length} falsify fixtures ran green (${tests} tests pass, 0 fail, 0 skipped); ids ${ids.join(",")}; required ${REQUIRED_FALSIFIERS.join(",")} present`);
}

// ── item 2: single-loader guard ──────────────────────────────────────────────

function checkGuard({ root }) {
  const loader = loaderAt(root);
  const offenders = loader.findUnroutedReaders({ root });
  if (!Array.isArray(offenders)) return fail("findUnroutedReaders returned a non-array — failing closed");
  if (offenders.length) {
    const where = offenders.slice(0, 5).map((o) => `${o.file}:${o.line}`).join(", ");
    return fail(`${offenders.length} un-routed partition reader line(s) outside ${LOADER_REL}: ${where}`);
  }
  const unrouted = [];
  for (const rel of LOADER_CONSUMERS) {
    const abs = absOf(root, rel);
    if (!fs.existsSync(abs)) unrouted.push(`${rel} (missing)`);
    else if (!LOADER_REQUIRE_RE.test(fs.readFileSync(abs, "utf8"))) unrouted.push(`${rel} (does not require the loader)`);
  }
  if (unrouted.length) return fail(`partition consumers not routed through ${LOADER_REL}: ${unrouted.join(", ")}`);
  return pass(`0 un-routed partition readers; ${LOADER_CONSUMERS.length} consumers require ${LOADER_REL}`);
}

// ── item 3: deny-list header ─────────────────────────────────────────────────

function checkDenylist({ root }) {
  const loader = loaderAt(root);
  const rel = toPosix(path.relative(root, loader.DENYLIST_PATH));
  if (!fs.existsSync(loader.DENYLIST_PATH)) return fail(`deny-list ${rel} is missing`);
  let partition;
  try {
    partition = loader.loadPartition({ forceReload: true });
  } catch (e) {
    return fail(`deny-list ${rel} does not load: ${e.message}`);
  }
  const q = partition && partition.denylist && partition.denylist.$question;
  if (typeof q !== "string" || !q.trim()) return fail(`deny-list ${rel} carries no $question header`);
  const shown = q.trim().length > 72 ? `${q.trim().slice(0, 72)}...` : q.trim();
  return pass(`${rel} exists and carries its $question header ("${shown}")`);
}

// ── item 4: codemod dry-run + PRE-apply derived rule ─────────────────────────

async function checkDryRun({ root }) {
  const codemod = absOf(root, CODEMOD_REL);
  if (!fs.existsSync(codemod)) return fail(`${CODEMOD_REL} is missing`);
  const loader = loaderAt(root);

  const startedAt = Date.now();
  const r = await runNode([codemod, "--dry-run"], { cwd: root, env: { ...process.env }, timeoutMs: DRYRUN_TIMEOUT_MS });
  if (r.error) return fail(`dry-run did not start: ${r.error.message}`);
  if (r.timedOut || r.status === null) return fail(`dry-run never reached an exit code (${r.timedOut ? "timed out" : `killed by ${r.signal}`})`);
  if (r.status !== 0) return fail(`dry-run exited ${r.status}: ${firstLines(r.stderr || r.stdout)}`);

  const num = (re) => {
    const m = r.stdout.match(re);
    return m ? Number(m[1]) : null;
  };
  const unclassified = num(/^\s*unclassified=(\d+)\s*$/m);
  const underived = num(/^\s*unpinned-unrewritten-underived=(\d+)\s*$/m);
  const derivedOut = num(/^\s*disposition counts:.*\bderived=(\d+)\s*$/m);
  const refusedOut = num(/^\s*refusedRenames=(\d+)\s*$/m);

  const problems = [];
  if (unclassified === null) problems.push("dry-run output has no unclassified= line (fail-closed, never read as 0)");
  else if (unclassified !== 0) problems.push(`unclassified=${unclassified}`);
  if (underived === null) problems.push("dry-run output has no unpinned-unrewritten-underived= line (fail-closed, never read as 0)");
  else if (underived !== 0) problems.push(`unpinned-unrewritten-underived=${underived}`);
  if (derivedOut === null) problems.push("dry-run output has no derived= disposition count (fail-closed)");
  if (refusedOut === null) problems.push("dry-run output has no refusedRenames= line (fail-closed, never read as 0)");
  else if (refusedOut !== 0) problems.push(`refusedRenames=${refusedOut}`);

  // refusedRenames == 0, read from the FRESH plan this dry-run just wrote (a stale plan is a FAIL).
  // Any entry there is a genuine refusal (--apply would refuse), so the plan must be empty of them.
  try {
    const planAbs = absOf(root, PLAN_REL);
    const st = fs.statSync(planAbs);
    if (st.mtimeMs + MTIME_SLACK_MS < startedAt) problems.push(`${PLAN_REL} was not rewritten by this dry-run (stale plan)`);
    const plan = JSON.parse(fs.readFileSync(planAbs, "utf8").replace(/^﻿/, ""));
    if (!Array.isArray(plan.refusedRenames)) {
      problems.push(`${PLAN_REL} has no refusedRenames array (fail-closed, never read as 0)`);
    } else {
      const planRefused = plan.refusedRenames.length;
      if (planRefused !== 0) {
        const named = plan.refusedRenames
          .slice(0, 3)
          .map((x) => `${x.from} -> ${x.to}${x.reason ? ` (${x.reason})` : ""}`)
          .join(", ");
        problems.push(`plan refusedRenames=${planRefused}: ${named}`);
      }
      if (refusedOut !== null && planRefused !== refusedOut) {
        problems.push(`refusedRenames disagreement: stdout=${refusedOut} plan=${planRefused}`);
      }
    }
  } catch (e) {
    problems.push(`plan ${PLAN_REL} unreadable: ${e.message}`);
  }

  // Derived rule (revisited post-apply in T3, as the header required): derived set == the generated views
  // (exactly 5), each read at its RESOLVED path — the declared path, or the codemod's rename of it once --apply
  // has moved the view with its Class-1 directory. The loader resolves a view entry through renamePath only
  // (like a pin), so this never admits a path beyond the 5 declared entries.
  let views;
  try {
    const partition = loader.loadPartition({ forceReload: true });
    const resolve = (g) => {
      const cands = partition.viewPathCandidates(g);
      return cands.find((p) => fs.existsSync(absOf(root, p))) || cands[0];
    };
    views = [...new Set(partition.generatedViews.map(resolve))].sort();
  } catch (e) {
    return fail(`${problems.concat(`partition does not load for the derived rule: ${e.message}`).join("; ")}`);
  }
  const ledgerRel = toPosix(path.relative(root, loader.COMMITTED_LEDGER_PATH));
  let ledger;
  try {
    const st = fs.statSync(loader.COMMITTED_LEDGER_PATH);
    if (st.mtimeMs + MTIME_SLACK_MS < startedAt) problems.push(`${ledgerRel} was not rewritten by this dry-run (stale ledger)`);
    ledger = JSON.parse(fs.readFileSync(loader.COMMITTED_LEDGER_PATH, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    problems.push(`committed ledger ${ledgerRel} unreadable: ${e.message}`);
  }
  if (ledger) {
    if (!Array.isArray(ledger.rows)) {
      problems.push(`committed ledger ${ledgerRel} has no rows array`);
    } else {
      const derivedRows = ledger.rows.filter((row) => row && row.disposition === "derived");
      const derivedFiles = [...new Set(derivedRows.map((row) => toPosix(row.file)))].sort();
      if (views.length !== EXPECTED_GENERATED_VIEWS) {
        problems.push(`the partition declares ${views.length} generated view(s), expected ${EXPECTED_GENERATED_VIEWS}`);
      }
      const extra = derivedFiles.filter((f) => !views.includes(f));
      const absent = views.filter((v) => !derivedFiles.includes(v));
      if (extra.length) problems.push(`derived occurrences outside the generated views: ${extra.slice(0, 5).join(", ")}`);
      if (absent.length) problems.push(`generated view(s) with no derived occurrence: ${absent.join(", ")}`);
      const headerDerived = ledger.dispositionCounts && ledger.dispositionCounts.derived;
      if (derivedOut !== null && !(derivedRows.length === derivedOut && headerDerived === derivedOut)) {
        problems.push(`derived count disagreement: stdout=${derivedOut} ledger-rows=${derivedRows.length} ledger-header=${headerDerived}`);
      }
      if (!problems.length) {
        return pass(
          `dry-run exit 0; unclassified=0; unpinned-unrewritten-underived=0; derived set == the ${views.length} generated views at their resolved paths (${derivedRows.length} derived occurrences); refusedRenames=0 (stdout and the fresh ${PLAN_REL} agree)`
        );
      }
    }
  }
  return fail(problems.join("; "));
}

// ── runner ───────────────────────────────────────────────────────────────────

/** Run the checklist (all items, or the named subset — tests only). Item exceptions are FAILs. */
async function runRecordTrustExit({ root = REPO_ROOT, items } = {}) {
  let selected = ITEMS;
  if (items !== undefined) {
    const unknown = items.filter((id) => !ITEM_IDS.includes(id));
    if (unknown.length) throw new Error(`record-trust-exit: unknown item(s): ${unknown.join(", ")}`);
    selected = ITEMS.filter((i) => items.includes(i.id));
  }
  return Promise.all(
    selected.map(async (item) => {
      try {
        const r = await item.run({ root });
        return { n: item.n, id: item.id, ok: r.ok === true, detail: r.detail };
      } catch (e) {
        return { n: item.n, id: item.id, ok: false, detail: `check threw — failing closed: ${e.message}` };
      }
    })
  );
}

/** 0 only when at least one item ran and every item passed. */
function exitCodeFor(results) {
  return Array.isArray(results) && results.length > 0 && results.every((r) => r && r.ok === true) ? 0 : 1;
}

function formatResult(r) {
  return `${r.ok ? "PASS" : "FAIL"} [${r.n} ${r.id}] ${r.detail}`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length) {
    process.stderr.write("usage: node scripts/checks/record-trust-exit.js   (no flags — every item always runs)\n");
    process.exitCode = 2;
    return;
  }
  process.stderr.write(`record-trust-exit: running ${ITEMS.length} items (fixtures + codemod dry-run take a few minutes)...\n`);
  const results = await runRecordTrustExit({});
  for (const r of results) process.stdout.write(`${formatResult(r)}\n`);
  const code = exitCodeFor(results);
  const passed = results.filter((r) => r.ok).length;
  process.stdout.write(`record-trust-exit: ${code === 0 ? "PASS" : "FAIL"} (${passed}/${results.length} items pass)\n`);
  process.exitCode = code;
}

module.exports = {
  runRecordTrustExit,
  exitCodeFor,
  formatResult,
  parseTapSummary,
  checkFixtures,
  checkGuard,
  checkDenylist,
  checkDryRun,
  REQUIRED_FALSIFIERS,
  EXPECTED_GENERATED_VIEWS,
  ITEM_IDS,
  REPO_ROOT,
};

if (require.main === module) {
  main().catch((e) => {
    process.stderr.write(`record-trust-exit: internal error — ${(e && e.stack) || e}\n`);
    process.exitCode = 2;
  });
}
