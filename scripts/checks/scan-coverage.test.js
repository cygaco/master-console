#!/usr/bin/env node
"use strict";

const { evaluate } = require("./scan-coverage.js");

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) pass++;
  else {
    fail++;
    console.error("FAIL: " + name);
  }
}

check(
  "clean → 0 findings",
  evaluate({
    scanSkills: ["full", "a", "b"],
    fullSelf: "full",
    fullReferenced: new Set(["a", "b"]),
    exclusions: {},
  }).length === 0,
);

check(
  "uncovered fires",
  evaluate({
    scanSkills: ["full", "a", "orphan"],
    fullSelf: "full",
    fullReferenced: new Set(["a"]),
    exclusions: {},
  }).some((x) => x.kind === "uncovered" && x.message.includes("orphan")),
);

check(
  "excluded → no uncovered",
  !evaluate({
    scanSkills: ["full", "a", "info"],
    fullSelf: "full",
    fullReferenced: new Set(["a"]),
    exclusions: { info: "read-only informational" },
  }).some((x) => x.kind === "uncovered"),
);

check(
  "dangling fires",
  evaluate({
    scanSkills: ["full", "a"],
    fullSelf: "full",
    fullReferenced: new Set(["a", "ghost"]),
    exclusions: {},
  }).some((x) => x.kind === "dangling" && x.message.includes("ghost")),
);

check(
  "stale-exclusion fires",
  evaluate({
    scanSkills: ["full", "a"],
    fullSelf: "full",
    fullReferenced: new Set(["a"]),
    exclusions: { gone: "reason" },
  }).some((x) => x.kind === "stale-exclusion"),
);

check(
  "reasonless-exclusion fires",
  evaluate({
    scanSkills: ["full", "a", "x"],
    fullSelf: "full",
    fullReferenced: new Set(["a"]),
    exclusions: { x: "" },
  }).some((x) => x.kind === "reasonless-exclusion"),
);

check(
  "full itself not flagged",
  !evaluate({
    scanSkills: ["full"],
    fullSelf: "full",
    fullReferenced: new Set([]),
    exclusions: {},
  }).length,
);

console.log(`scan-coverage.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
