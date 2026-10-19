"use strict";
// FALSIFIER: check-lib-consumer-runner-error — record-trust gate. Both check-lib-prevention.js (the Claude hook consumer) and pre-commit-check-lib.js (the
const test = require("node:test");
const assert = require("node:assert");

test("check-lib-consumer-runner-error — check-lib-prevention.js's computeExitCode returns a DISTINCT non-zero (3) on a runner exception, never 0", () => {
  const hook = require("../../hooks/check-lib-prevention");

  const throwingRunFn = () => {
    throw new Error("simulated broken check-lib registry");
  };
  const code = hook.computeExitCode("{}", { runPreventionFn: throwingRunFn });
  assert.strictEqual(code, 3, "MUST-BLOCK: a runner exception must be a DISTINCT non-zero exit, never 0 (a silent pass)");
  assert.notStrictEqual(code, 0);
  assert.notStrictEqual(code, 2, "must be DISTINCT from the ordinary BLOCKED exit code too — a runner crash is not the same claim as 'a required check genuinely failed'");
});

test("check-lib-consumer-runner-error — check-lib-prevention.js CONTROL: a clean run (no exception) still returns 0", () => {
  const hook = require("../../hooks/check-lib-prevention");
  const code = hook.computeExitCode("{}");
  assert.strictEqual(code, 0);
});

test("check-lib-consumer-runner-error — pre-commit-check-lib.js's computeExitCode returns a DISTINCT non-zero (2) on a runner exception, never 0", () => {
  const hook = require("../../hooks/pre-commit-check-lib");

  const throwingRunFn = () => {
    throw new Error("simulated broken check-lib registry");
  };
  const code = hook.computeExitCode({ runCheckLibSuiteFn: throwingRunFn });
  assert.strictEqual(code, 2, "MUST-BLOCK: a runner exception must be a DISTINCT non-zero exit, never 0");
  assert.notStrictEqual(code, 0);
  assert.notStrictEqual(code, 1, "must be DISTINCT from the ordinary 'a required check failed' exit code too");
});

test("check-lib-consumer-runner-error — pre-commit-check-lib.js CONTROL: a non-throwing, non-blocked runner result returns 0 (proving the runner-error code is DISTINCT from the ordinary clean path, not just 'always non-zero')", () => {
  const hook = require("../../hooks/pre-commit-check-lib");
  const cleanRunFn = () => ({ version: "v", results: [], missing: [], blocked: false, blockingReasons: [] });
  const code = hook.computeExitCode({ runCheckLibSuiteFn: cleanRunFn });
  assert.strictEqual(code, 0);
});
