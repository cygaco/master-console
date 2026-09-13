#!/usr/bin/env node
"use strict";

/**
 * D3 (SP-20260718-003 / I-3) — beta-consult.js resolveOutPath honors ABSOLUTE --out.
 * The bug: `path.join(ROOT, outFile)` corrupts an absolute --out (Windows:
 * ROOT\C:\...\file). Fix resolves relative-to-ROOT only when the path is relative.
 *
 *   node scripts/dispatch/beta-consult-out-abs.test.js
 */

const path = require("path");
const assert = require("assert");
const { harness } = require("../checks/lib/fixture-harness");
const { resolveOutPath } = require("./beta-consult");

const h = harness("beta-consult-out-abs");
const ROOT = path.resolve(__dirname, "..", "..");
// A HOST-absolute path, not a Windows literal: "C:\\tmp\\..." is RELATIVE on POSIX
// (path.isAbsolute → false), so the old literal made this test assert the bug on the
// Linux CI runner. Build the absolute path from the host's own filesystem root
// (C:\ on Windows, / on POSIX) so the assertion means the same thing everywhere.
const ABS_OUT = path.join(path.parse(ROOT).root, "tmp", "verdict.json");
assert.ok(path.isAbsolute(ABS_OUT), `fixture must be host-absolute: ${ABS_OUT}`);

h.test("resolveOutPath honors an ABSOLUTE --out exactly (no ROOT prefix)", () => {
  const abs = ABS_OUT;
  assert.strictEqual(resolveOutPath(abs, ROOT), abs, "absolute --out must be returned as-is (I-3)");
  // The bug's output (path.join(ROOT, abs)) must NOT equal the resolved path.
  assert.notStrictEqual(resolveOutPath(abs, ROOT), path.join(ROOT, abs), "must not ROOT-prefix an absolute path");
});

h.test("resolveOutPath resolves a RELATIVE --out under ROOT (backward-compat)", () => {
  const rel = path.join("runtime", "beta-consult", "v.json");
  assert.strictEqual(resolveOutPath(rel, ROOT), path.join(ROOT, rel), "relative --out resolves under ROOT");
});

// Teeth (β#4): the OLD path.join(ROOT, outFile) shape corrupts an absolute path.
h.violation("negative control: the old path.join(ROOT, abs) shape corrupts an absolute path", () => {
  const abs = ABS_OUT;
  const buggy = path.join(ROOT, abs); // the pre-fix behavior
  // If the buggy join differs from the true absolute path, it is a corruption → caught.
  const corrupted = buggy !== abs ? [buggy] : [];
  return { violations: corrupted };
});

h.done();
