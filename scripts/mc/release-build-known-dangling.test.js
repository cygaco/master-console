"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const mcEnv = require("../hooks/lib/mc-env");

const ROOT = mcEnv.readEnv("KNOWN_DANGLING_ROOT") || path.join(__dirname, "..", "..");
const { KNOWN_DANGLING_REFS } = require(path.join(ROOT, "scripts", "mc", "release-build.js"));
const isFile = (rel) => fs.existsSync(path.join(ROOT, rel)) && fs.statSync(path.join(ROOT, rel)).isFile();
const cls = (row) => (/^\(([ABC])\)/.exec(row.reason) || [])[1];

test("every row carries a class (A), (B) or (C)", () => {
  const bad = KNOWN_DANGLING_REFS.filter((r) => !cls(r));
  assert.deepStrictEqual(bad, []);
});

test("(A) example paths do not exist as files", () => {
  const present = KNOWN_DANGLING_REFS.filter((r) => cls(r) === "A" && isFile(r.script)).map((r) => r.script);
  assert.deepStrictEqual(present, []);
});

test("(B) and (C) scripts exist in this tree", () => {
  const missing = KNOWN_DANGLING_REFS.filter((r) => cls(r) !== "A" && !isFile(r.script)).map((r) => `${r.skill} -> ${r.script}`);
  assert.deepStrictEqual(missing, []);
});

test("every row's skill exists and still names its script", () => {
  const dead = KNOWN_DANGLING_REFS.filter((r) => !isFile(r.skill) || !fs.readFileSync(path.join(ROOT, r.skill), "utf8").includes(r.script))
    .map((r) => `${r.skill} -> ${r.script}`);
  assert.deepStrictEqual(dead, []);
});
