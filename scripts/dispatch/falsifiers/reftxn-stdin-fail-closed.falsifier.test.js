"use strict";
// FALSIFIER: reftxn-stdin-fail-closed — record-trust gate. A stdin read failure in protected-ref-transaction.js's 'prepared' phase must ABORT (exit
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

const HOOK = path.join(__dirname, "..", "..", "hooks", "protected-ref-transaction.js");

test("reftxn-stdin-fail-closed — a stdin READ FAILURE in the 'prepared' phase returns exit 1 (ABORT), never exit 0", () => {
  const hook = require("../../hooks/protected-ref-transaction");
  const throwingReadStdin = () => {
    throw new Error("simulated EBADF — stdin unreadable");
  };
  const code = hook.main(["node", "protected-ref-transaction.js", "prepared"], {}, { readStdin: throwingReadStdin });
  assert.strictEqual(code, 1, "MUST-BLOCK: a stdin read failure in the prepared phase must ABORT (exit 1), never silently allow (exit 0)");
});

test("reftxn-stdin-fail-closed — the SAME stdin read failure in a non-prepared (purely informational) phase does NOT abort (exit 0) — only 'prepared' can actually stop a git transaction", () => {
  const hook = require("../../hooks/protected-ref-transaction");
  const throwingReadStdin = () => {
    throw new Error("simulated EBADF — stdin unreadable");
  };
  for (const state of ["committed", "aborted"]) {
    const code = hook.main(["node", "protected-ref-transaction.js", state], {}, { readStdin: throwingReadStdin });
    assert.strictEqual(code, 0, `state=${state}`);
  }
});

test("reftxn-stdin-fail-closed — CONTROL: a healthy stdin read in the 'prepared' phase touching a protected ref with NO fence still refuses for the ORIGINAL reason (no-current-controller-fence), proving the fix didn't change the non-failure path", () => {
  const hook = require("../../hooks/protected-ref-transaction");
  const okReadStdin = () => `${"0".repeat(40)} ${"1".repeat(40)} refs/heads/main\n`;
  const result = hook.evaluate({ state: "prepared", stdinText: okReadStdin(), env: {} });
  assert.strictEqual(result.allow, false);
  assert.strictEqual(result.reason, "no-current-controller-fence");
});

test("reftxn-stdin-fail-closed — readStdin() itself never swallows a read failure into \"\" (the ROOT cause)", () => {
  if (!fs.existsSync(HOOK)) return;
  const hook = require("../../hooks/protected-ref-transaction");
  const src = fs.readFileSync(HOOK, "utf8");
  const fnMatch = src.match(/function readStdin\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fnMatch, "readStdin() must be extractable from source");
  assert.ok(!/catch\s*\{\s*\n?\s*return\s*"";?/.test(fnMatch[0]), "readStdin() must NEVER catch-and-return an empty string fallback");
  void hook;
});
