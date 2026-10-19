"use strict";
const test = require("node:test");
const assert = require("node:assert");

const { reduceBlockingReasons } = require("./pre-commit-check-lib");
const { TRANSPORT_SKIP_ALLOWED } = require("../dispatch/transport-skip-allowlist");

const REQUIRED = new Set(["false-green-envelope", "no-nul-bytes"]);

test("single-source shape: exactly one frozen name, the pinned reason, shared with the authority", () => {
  assert.deepStrictEqual(
    Object.keys(TRANSPORT_SKIP_ALLOWED),
    ["false-green-envelope"],
    "the skip allowance stays exactly one pinned name",
  );
  assert.strictEqual(TRANSPORT_SKIP_ALLOWED["false-green-envelope"], "no-envelope-in-context");
  assert.ok(Object.isFrozen(TRANSPORT_SKIP_ALLOWED), "allowlist must stay frozen (silent widening = visible diff)");
  const ctl = require("../dispatch/trusted-controller");
  assert.strictEqual(ctl.TRANSPORT_SKIP_ALLOWED, TRANSPORT_SKIP_ALLOWED, "controller re-exports the single source");
});

test("POSITIVE: the exact allowlisted name+reason pair does NOT block", () => {
  const out = reduceBlockingReasons(
    [{ name: "false-green-envelope", status: "skipped", reason: "no-envelope-in-context" }],
    REQUIRED,
  );
  assert.deepStrictEqual(out, [], "the authority-tolerated pair must not block local feedback");
});

test("NEGATIVE: the allowlisted check skipped for any OTHER reason still blocks", () => {
  const out = reduceBlockingReasons(
    [{ name: "false-green-envelope", status: "skipped", reason: "checker-crashed" }],
    REQUIRED,
  );
  assert.strictEqual(out.length, 1, "same name, different reason: must block");
  assert.strictEqual(out[0].name, "false-green-envelope");
});

test("NEGATIVE: any OTHER required check skipped still blocks — even with the allowlisted reason string", () => {
  const out = reduceBlockingReasons(
    [{ name: "no-nul-bytes", status: "skipped", reason: "no-envelope-in-context" }],
    REQUIRED,
  );
  assert.strictEqual(out.length, 1, "different name: must block regardless of reason");
  assert.strictEqual(out[0].name, "no-nul-bytes");
});

test("fail and timeout always block — the alignment touches ONLY the skip branch", () => {
  const out = reduceBlockingReasons(
    [
      { name: "false-green-envelope", status: "fail", reason: "x" },
      { name: "no-nul-bytes", status: "timeout", reason: "y" },
    ],
    REQUIRED,
  );
  assert.strictEqual(out.length, 2, "fail/timeout are never tolerated, allowlisted name or not");
});

test("a skipped OPTIONAL (non-required) check never blocked and still does not", () => {
  const out = reduceBlockingReasons(
    [{ name: "some-optional-check", status: "skipped", reason: "whatever" }],
    REQUIRED,
  );
  assert.deepStrictEqual(out, [], "non-required skips stay non-blocking (pre-existing contract)");
});
