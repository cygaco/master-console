"use strict";

const { CHECK_NAMES } = require("../registry");

function run(ctx) {
  if (!ctx || !Array.isArray(ctx.executedNames)) {
    return { status: "skipped", reason: "no-executed-set-in-context", evidence: { expected: CHECK_NAMES.slice() } };
  }
  const expected = CHECK_NAMES.slice();
  const executed = ctx.executedNames.slice();
  const missingFromExecuted = expected.filter((n) => !executed.includes(n));
  const extraInExecuted = executed.filter((n) => !expected.includes(n));

  if (missingFromExecuted.length || extraInExecuted.length) {
    return {
      status: "fail",
      reason: "suite-set-drift",
      evidence: { expected, executed, missingFromExecuted, extraInExecuted },
    };
  }
  return { status: "pass", reason: "suite-set-complete", evidence: { expected, executed } };
}

module.exports = { name: "suite-completeness", run };
