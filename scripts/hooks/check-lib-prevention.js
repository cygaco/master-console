#!/usr/bin/env node
"use strict";

const checkLib = require("../dispatch/check-lib");

function runPrevention(ctx = {}) {
  const suite = checkLib.runSuite(checkLib.REQUIRED_CHECKS, ctx);
  const blockingReasons = suite.results
    .filter((r) => r.status === "fail" || r.status === "timeout")
    .map((r) => ({ name: r.name, status: r.status, reason: r.reason }));
  if (suite.missing.length) {
    blockingReasons.push({ name: suite.missing.join(","), status: "missing", reason: "check-registry-drift" });
  }
  return { ...suite, blocked: blockingReasons.length > 0, blockingReasons };
}

function ctxFromHookEvent(event) {
  const filePath = event && event.tool_input && event.tool_input.file_path;
  const content = (event && event.tool_input && (event.tool_input.content || event.tool_input.new_string)) || "";
  return {
    envelope: event && event.envelope,
    filePath,
    content,
  };
}

function computeExitCode(inputText, opts = {}) {
  const runFn = typeof opts.runPreventionFn === "function" ? opts.runPreventionFn : runPrevention;
  let ctx = {};
  try {
    const event = JSON.parse(inputText || "{}");
    ctx = ctxFromHookEvent(event);
  } catch {
  }
  let result;
  try {
    result = runFn(ctx);
  } catch (e) {
    process.stderr.write(`check-lib-prevention: RUNNER ERROR (distinct non-zero exit 3 — NEVER a silent pass): ${e && e.message ? e.message : e}\n`);
    return 3;
  }
  if (result.blocked) {
    process.stderr.write(`check-lib-prevention: BLOCKED — ${JSON.stringify(result.blockingReasons)}\n`);
    return 2;
  }
  return 0;
}

function main() {
  let input = "";
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    process.exit(computeExitCode(input));
  });
}

module.exports = { runPrevention, ctxFromHookEvent, computeExitCode };

if (require.main === module) main();
