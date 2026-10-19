#!/usr/bin/env node
"use strict";

const path = require("path");
const assert = require("assert");
const { harness } = require("../checks/lib/fixture-harness");
const { resolveOutPath } = require("./beta-consult");

const h = harness("beta-consult-out-abs");
const ROOT = path.resolve(__dirname, "..", "..");
const ABS_OUT = path.join(path.parse(ROOT).root, "tmp", "verdict.json");
assert.ok(path.isAbsolute(ABS_OUT), `fixture must be host-absolute: ${ABS_OUT}`);

h.test("resolveOutPath honors an ABSOLUTE --out exactly (no ROOT prefix)", () => {
  const abs = ABS_OUT;
  assert.strictEqual(resolveOutPath(abs, ROOT), abs, "absolute --out must be returned as-is");
  assert.notStrictEqual(resolveOutPath(abs, ROOT), path.join(ROOT, abs), "must not ROOT-prefix an absolute path");
});

h.test("resolveOutPath resolves a RELATIVE --out under ROOT (backward-compat)", () => {
  const rel = path.join("runtime", "beta-consult", "v.json");
  assert.strictEqual(resolveOutPath(rel, ROOT), path.join(ROOT, rel), "relative --out resolves under ROOT");
});

h.violation("negative control: the old path.join(ROOT, abs) shape corrupts an absolute path", () => {
  const abs = ABS_OUT;
  const buggy = path.join(ROOT, abs);
  const corrupted = buggy !== abs ? [buggy] : [];
  return { violations: corrupted };
});

h.done();
