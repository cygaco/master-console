"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { proposal, parseArgs } = require("./deprecate");

test("proposal skeleton: schema, status and the framework owner", () => {
  const p = proposal(parseArgs(["skill:demo", "--type", "skill"]));
  assert.strictEqual(p.$schema, "mc/deprecation-proposal/v1");
  assert.strictEqual(p.id, "skill:demo");
  assert.strictEqual(p.status, "deprecated");
  assert.strictEqual(p.owner, "mc-framework");
});

test("proposal requires an id", () => {
  assert.throws(() => proposal({}), /missing id/);
});
