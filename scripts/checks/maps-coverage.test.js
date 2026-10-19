#!/usr/bin/env node
"use strict";

const { evaluate, verdict } = require("./maps-coverage.js");

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) pass++;
  else {
    fail++;
    console.error("FAIL: " + name);
  }
}

const base = {
  mapsSkills: ["all", "hooks", "skills"],
  allSelf: "all",
  allReferenced: new Set(["hooks", "skills"]),
  mapFiles: ["hooks.jsonl", "skills.md"],
  generators: new Set(["hooks", "skills"]),
  allowlist: {},
  staleNames: [],
};

check("clean → 0 blocking", evaluate(base).filter((f) => f.severity !== "warn").length === 0);

check(
  "unregistered-skill fires",
  evaluate({ ...base, mapsSkills: ["all", "hooks", "orphan"] }).some(
    (f) => f.kind === "unregistered-skill" && f.message.includes("orphan"),
  ),
);

check(
  "excluded skill → ok",
  !evaluate({ ...base, mapsSkills: ["all", "hooks", "orphan"], allowlist: { orphan: "reason" } }).some(
    (f) => f.kind === "unregistered-skill",
  ),
);

check(
  "dangling-registry fires",
  evaluate({ ...base, allReferenced: new Set(["hooks", "skills", "ghost"]) }).some(
    (f) => f.kind === "dangling-registry" && f.message.includes("ghost"),
  ),
);

check(
  "orphan-map-file fires",
  evaluate({ ...base, mapFiles: ["hooks.jsonl", "weird.json"] }).some(
    (f) => f.kind === "orphan-map-file" && f.message.includes("weird.json"),
  ),
);

check(
  "allowlisted map file → ok",
  !evaluate({ ...base, mapFiles: ["hooks.jsonl", "weird.json"], allowlist: { weird: "manual registry" } }).some(
    (f) => f.kind === "orphan-map-file",
  ),
);

const staleF = evaluate({ ...base, staleNames: ["hooks.jsonl"] });
check("stale → warn only (non-blocking)", staleF.some((f) => f.kind === "stale-map" && f.severity === "warn") && staleF.filter((f) => f.severity !== "warn").length === 0);

check("all itself not flagged", !evaluate({ mapsSkills: ["all"], allSelf: "all", allReferenced: new Set([]), mapFiles: [], generators: new Set(), allowlist: {}, staleNames: [] }).length);

check("no map files + no findings → not-initialized (exit 3)", (() => { const v = verdict({ findings: evaluate({ ...base, mapFiles: [] }), mapFiles: [] }); return typeof v === "object" && v.code === 3 && v.status === "not-initialized"; })());
check("map files + no findings → ok (exit 0)", typeof verdict === "function" && verdict({ findings: evaluate(base), mapFiles: base.mapFiles }).code === 0);
check("blocking findings → exit 1 even with no map files", typeof verdict === "function" && verdict({ findings: [{ severity: "high" }], mapFiles: [] }).code === 1);
check("warn-only findings + no map files → still not-initialized", typeof verdict === "function" && verdict({ findings: [{ severity: "warn" }], mapFiles: [] }).code === 3);

console.log(`maps-coverage.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
