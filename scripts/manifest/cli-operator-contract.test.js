"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { validateManifest } = require("./cli");
const { OPERATOR_CONTRACT_STRICTNESS } = require("../hooks/lib/project-config");

function baseManifest(operatorContract) {
  return {
    $schema: "mc/manifest/v1",
    project: { name: "x", slug: "x" },
    mc: { version: "1.0.0", installed: true, operatorContract },
    agents: {},
  };
}

test("valid block: no warnings, no errors", () => {
  const { errors, warnings } = validateManifest(
    baseManifest({
      enabled: true,
      strictness: "strict",
      maxLinesBeforeHeader: 5,
      allowIdentifiers: false,
      extraCommandPrefixes: [],
    }),
  );
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(warnings, []);
});

test("absent block entirely: no warnings, no errors (absent = ON via built-in defaults)", () => {
  const m = baseManifest(undefined);
  delete m.mc.operatorContract;
  const { errors, warnings } = validateManifest(m);
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(warnings, []);
});

test("malformed strictness value: WARN, never ERROR (never a trap)", () => {
  const { errors, warnings } = validateManifest(baseManifest({ strictness: "yolo" }));
  assert.deepStrictEqual(errors, [], "a malformed operatorContract block must never be an error");
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /strictness/);
});

test("malformed block (not an object): WARN, never ERROR", () => {
  const { errors, warnings } = validateManifest(baseManifest("not-an-object"));
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /not an object/);
});

test("wrong-typed fields: each gets its own warning, still zero errors", () => {
  const { errors, warnings } = validateManifest(
    baseManifest({ enabled: "yes", maxLinesBeforeHeader: -1, allowIdentifiers: 1, extraCommandPrefixes: "nope" }),
  );
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(warnings.length, 4);
});

test("every value in OPERATOR_CONTRACT_STRICTNESS is accepted with no warning", () => {
  for (const strictness of OPERATOR_CONTRACT_STRICTNESS) {
    const { errors, warnings } = validateManifest(baseManifest({ strictness }));
    assert.deepStrictEqual(errors, [], `strictness "${strictness}" must never error`);
    assert.deepStrictEqual(warnings, [], `strictness "${strictness}" must be accepted with no warning`);
  }
});

test("a value outside OPERATOR_CONTRACT_STRICTNESS still warns (enum is still enforced)", () => {
  assert.ok(!OPERATOR_CONTRACT_STRICTNESS.has("yolo"), "fixture value must stay outside the real enum");
  const { errors, warnings } = validateManifest(baseManifest({ strictness: "yolo" }));
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /strictness/);
});
