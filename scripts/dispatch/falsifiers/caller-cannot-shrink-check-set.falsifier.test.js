"use strict";
// FALSIFIER: caller-cannot-shrink-check-set — record-trust gate
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const CONTROLLER = path.join(__dirname, "..", "trusted-controller.js");

test("caller-cannot-shrink-check-set — expected_checks:[] over a FAILING tree is still REFUSED (the pinned required check FIRED)", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./_lib/controller-fixtures");
  const { headSha } = require("./_lib/git-scratch");
  const ctl = require("../trusted-controller");

  for (const attackShape of [
    { label: "empty array", expected_checks: [] },
    { label: "shrunk single-name subset (still can't drop the OTHER required checks)", expected_checks: ["suite-completeness"] },
  ]) {
    const fx = makeControllerFixture(`shrink-${attackShape.label.replace(/[^a-z0-9]/gi, "").slice(0, 12)}`);
    t.after(() => fx.cleanup());

    const poisonedResult = fx.poisonResultCommit();
    const input = standardInput(fx, { result_commit: poisonedResult, expected_checks: attackShape.expected_checks });
    const result = ctl.integrate(input, standardOpts(fx));

    assert.strictEqual(result.ok, false, `MUST-BLOCK (${attackShape.label}): a shrunk/empty expected_checks must not vacuously pass`);
    assert.strictEqual(result.decision, "BLOCKED");
    assert.strictEqual(result.reason, "check-failed", `(${attackShape.label})`);
    assert.strictEqual(result.offending, "no-nul-bytes", `(${attackShape.label})`);
    assert.deepStrictEqual(
      result.runManifest.expected_checks.slice().sort(),
      ["false-green-envelope", "no-nul-bytes", "suite-completeness"],
      `(${attackShape.label}) expected_checks must ALWAYS be the pinned bundle's full frozen CHECK_NAMES`,
    );
    for (const req of ["false-green-envelope", "no-nul-bytes", "suite-completeness"]) {
      assert.ok(result.runManifest.required_checks.includes(req), `(${attackShape.label}) required_checks must still include '${req}' — shrink had ZERO effect`);
    }

    assert.strictEqual(headSha(fx.dir, fx.targetRef), fx.base, `(${attackShape.label}) main must not have advanced`);
  }
});

test("mintRunManifest — input.expected_checks naming a name OUTSIDE the pinned bundle's CHECK_NAMES is rejected (assert-subset half)", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./_lib/controller-fixtures");
  const ctl = require("../trusted-controller");

  const fx = makeControllerFixture("shrink-outside-bundle");
  t.after(() => fx.cleanup());

  const result = ctl.integrate(standardInput(fx, { expected_checks: ["not-a-real-pinned-check"] }), standardOpts(fx));
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "expected-checks-not-in-bundle");
});
