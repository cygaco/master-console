#!/usr/bin/env node
"use strict";

const checkLib = require("../dispatch/check-lib");
const { TRANSPORT_SKIP_ALLOWED } = require("../dispatch/transport-skip-allowlist");

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
  let result;
  try {
    result = runFn({ root: opts.root || process.cwd() });
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
