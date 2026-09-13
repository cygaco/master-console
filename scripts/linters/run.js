#!/usr/bin/env node
/**
 * scripts/linters/run.js — Unified linter runner.
 *
 * Runs every project linter declared in package.json `lint:*` scripts,
 * plus the standalone path-lint and any `scripts/lint-*.js` modules.
 * Reports pass/fail per linter and aggregate exit code.
 *
 * Usage:
 *   node scripts/linters/run.js                  run all
 *   node scripts/linters/run.js --list           list discovered linters
 *   node scripts/linters/run.js --only paths     run only matching name
 *   node scripts/linters/run.js --json           JSON output
 *
 * Exit:
 *   0 — all passed
 *   1 — at least one failed
 *   2 — usage error
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function discover() {
  const linters = [];
  // 1. Standalone path-lint
  if (fs.existsSync("scripts/path-lint.js")) {
    linters.push({
      name: "path-lint",
      cmd: "node scripts/path-lint.js",
    });
  }
  // 2. scripts/lint-*.js
  if (fs.existsSync("scripts")) {
    for (const f of fs.readdirSync("scripts")) {
      if (f.startsWith("lint-") && f.endsWith(".js")) {
        const stem = f.replace(/\.js$/, "");
        linters.push({
          name: stem,
          cmd: `node scripts/${f}`,
        });
      }
    }
  }
  // 3. scripts/sprint/test-*.js (Sprint A R-8 / SP-20260518-007)
  // Sprint regression tests that should run on every lint pass to catch
  // bug-class recurrences at lint-time. The per-sprint corpus under
  // paths.sprintRegressionCorpus (tests/regression/<SP-id>/) is EXCLUDED
  // here — those fixtures run via /sprint:release ship-gate only.
  if (fs.existsSync("scripts/sprint")) {
    for (const f of fs.readdirSync("scripts/sprint")) {
      if (f.startsWith("test-") && f.endsWith(".js")) {
        const stem = f.replace(/\.js$/, "");
        linters.push({
          name: `sprint-${stem}`,
          cmd: `node scripts/sprint/${f}`,
        });
      }
    }
  }
  // 3b. scripts/mc/test-*.js (SP-20260528-001 / #438)
  // Framework/install-pipeline regression tests that should run on every lint
  // pass alongside the sprint tests. EXCLUDE heavy integration tests that have
  // their own on-demand/CI registration — test-install-matrix.js (~22s,
  // paths.testInstallMatrix) is a 7-scenario install matrix meant for the
  // /mc:release ship-gate, not the fast per-pass linter loop. Keeping it out
  // here preserves the harness's sub-10s budget while still wiring in the rest
  // (gate/CLI/smoke tests that were previously orphaned — nothing ran them).
  // test-install-matrix.js — ~22s 7-scenario install matrix (paths.testInstallMatrix),
  //   for the /mc:release ship-gate, not the fast per-pass loop.
  // test-hash-back-compat.js — a one-off install-time SMOKE (per its own docstring)
  //   that compares current file content to install-time `installedHash` prefixes;
  //   it necessarily rots as canonical evolves (every framework file edited since
  //   install diverges from its install snapshot), so it is a point-in-time
  //   diagnostic, NOT a continuous regression guard. Excluded by design.
  const WARPOS_TEST_EXCLUDE = new Set([
    "test-install-matrix.js",
    "test-hash-back-compat.js",
  ]);
  if (fs.existsSync("scripts/mc")) {
    for (const f of fs.readdirSync("scripts/mc")) {
      if (f.startsWith("test-") && f.endsWith(".js") && !WARPOS_TEST_EXCLUDE.has(f)) {
        const stem = f.replace(/\.js$/, "");
        linters.push({
          name: `mc-${stem}`,
          cmd: `node scripts/mc/${f}`,
        });
      }
    }
  }
  // 4. package.json scripts named lint:*
  if (fs.existsSync("package.json")) {
    try {
      const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
      for (const [name, cmd] of Object.entries(pkg.scripts || {})) {
        if (name.startsWith("lint")) {
          linters.push({
            name: `npm:${name}`,
            cmd: `npm run ${name} --silent`,
            shellCmd: cmd,
          });
        }
      }
    } catch {
      /* package.json unreadable */
    }
  }
  return linters;
}

function run(linter) {
  const start = Date.now();
  try {
    execSync(linter.cmd, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
    return { ...linter, ok: true, elapsedMs: Date.now() - start };
  } catch (e) {
    return {
      ...linter,
      ok: false,
      elapsedMs: Date.now() - start,
      error: (e.stdout || e.stderr || e.message || "")
        .toString()
        .trim()
        .slice(0, 500),
    };
  }
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const list = args.includes("--list");
  const oi = args.indexOf("--only");
  const only = oi !== -1 ? args[oi + 1] : null;

  let linters = discover();
  if (only) linters = linters.filter((l) => l.name.includes(only));

  if (linters.length === 0) {
    process.stderr.write(`no linters discovered\n`);
    process.exit(1);
  }

  if (list) {
    if (asJson) {
      process.stdout.write(JSON.stringify(linters, null, 2) + "\n");
    } else {
      process.stdout.write(`# ${linters.length} linter(s) discovered\n`);
      for (const l of linters) {
        process.stdout.write(`  ${l.name}  →  ${l.cmd}\n`);
      }
    }
    process.exit(0);
  }

  const results = [];
  for (const l of linters) {
    results.push(run(l));
  }

  const failed = results.filter((r) => !r.ok);
  if (asJson) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  } else {
    for (const r of results) {
      const tag = r.ok ? "PASS" : "FAIL";
      process.stdout.write(`${tag}  ${r.name}  (${r.elapsedMs}ms)\n`);
      if (!r.ok && r.error) {
        const indent = r.error
          .split("\n")
          .slice(0, 5)
          .map((l) => `      ${l}`)
          .join("\n");
        process.stdout.write(`${indent}\n`);
      }
    }
    process.stdout.write(
      `# ${results.length - failed.length}/${results.length} passed\n`,
    );
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

if (require.main === module) main();

module.exports = { discover, run };
