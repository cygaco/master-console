#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

const GATE = path.resolve(__dirname, "mc-ship-coverage.js");
const WORKTREE_ROOT = path.resolve(__dirname, "..", "..");

let passes = 0;
let failures = 0;

function ok(name, condition, detail) {
  if (condition) {
    passes++;
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    const suffix = detail ? ` — ${detail}` : "";
    console.log(`  FAIL ${name}${suffix}`);
  }
}

function makeTempFixture(mcManifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wsc-test-"));

  fs.mkdirSync(path.join(dir, "_mc"), { recursive: true });
  if (typeof mcManifest === "string") {
    fs.writeFileSync(path.join(dir, "_mc", "MANIFEST.json"), mcManifest);
  } else {
    fs.writeFileSync(
      path.join(dir, "_mc", "MANIFEST.json"),
      JSON.stringify(mcManifest, null, 2),
    );
  }

  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  const fm = {
    assets: {
      guide: [{ src: "_guides/placeholder.md", dest: "_guides/placeholder.md" }],
    },
  };
  fs.writeFileSync(
    path.join(dir, ".claude", "framework-manifest.json"),
    JSON.stringify(fm, null, 2),
  );

  return dir;
}

function rmrf(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
  }
}

function runGate(fixtureDir, extraArgs = []) {
  const result = cp.spawnSync(
    process.execPath,
    [GATE, "--root", fixtureDir, "--json", ...extraArgs],
    { encoding: "utf8", timeout: 15_000 },
  );
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
  }
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    json,
  };
}

console.log("\n[a] New dangling seeded_from (not allowlisted) → exit 1");
{
  const manifest = {
    paths: {
      "_requirements/SomeFile.md": {
        owner: "project",
        kind: "file",
        seeded_from: "framework/templates/THIS_DOES_NOT_EXIST_NOT_IN_ALLOWLIST.md",
      },
    },
  };
  const dir = makeTempFixture(manifest);
  try {
    const r = runGate(dir);
    ok("(a) exit code is 1", r.code === 1, `got ${r.code}`);
    ok("(a) ok===false", r.json && r.json.ok === false, `json.ok=${r.json && r.json.ok}`);
    ok(
      "(a) dangling_unallowlisted has the new path",
      r.json &&
        Array.isArray(r.json.dangling_unallowlisted) &&
        r.json.dangling_unallowlisted.some((p) =>
          p.includes("THIS_DOES_NOT_EXIST_NOT_IN_ALLOWLIST"),
        ),
      `dangling_unallowlisted=${JSON.stringify(r.json && r.json.dangling_unallowlisted)}`,
    );
  } finally {
    rmrf(dir);
  }
}

console.log("\n[b] dangling seeded_from with empty KNOWN_DANGLING → exit 1 (zero-tolerance)");
{
  const manifest = {
    paths: {
      "_requirements/README.md": {
        owner: "project",
        kind: "file",
        seeded_from: "framework/templates/_requirements/README.md",
      },
      "_requirements/SomePolicy.md": {
        owner: "project",
        kind: "file",
        seeded_from: "framework/templates/policy/decision-policy.md",
      },
    },
  };
  const dir = makeTempFixture(manifest);
  try {
    const r = runGate(dir);
    ok("(b) exit code is 1", r.code === 1, `got ${r.code}; stderr=${r.stderr}`);
    ok("(b) ok===false", r.json && r.json.ok === false, `json.ok=${r.json && r.json.ok}`);
    ok(
      "(b) dangling_seeds_total===2",
      r.json && r.json.dangling_seeds_total === 2,
      `got ${r.json && r.json.dangling_seeds_total}`,
    );
    ok(
      "(b) dangling_allowlisted===0 (set is empty)",
      r.json && r.json.dangling_allowlisted === 0,
      `got ${r.json && r.json.dangling_allowlisted}`,
    );
    ok(
      "(b) dangling_unallowlisted has both paths",
      r.json &&
        Array.isArray(r.json.dangling_unallowlisted) &&
        r.json.dangling_unallowlisted.length === 2,
      `got ${JSON.stringify(r.json && r.json.dangling_unallowlisted)}`,
    );
  } finally {
    rmrf(dir);
  }
}

console.log("\n[c] Malformed _mc/MANIFEST.json → exit 2");
{
  const dir = makeTempFixture("{ this is not valid json >>>");
  try {
    const r = runGate(dir);
    ok("(c) exit code is 2", r.code === 2, `got ${r.code}`);
    ok(
      "(c) stderr contains 'invalid JSON' or 'mc-ship-coverage'",
      typeof r.stderr === "string" && r.stderr.includes("mc-ship-coverage"),
      `stderr=${r.stderr.slice(0, 200)}`,
    );
  } finally {
    rmrf(dir);
  }
}

console.log("\n[d] Exhaustive run against worktree → ok, info_gaps_count===0, dangling_unallowlisted===0");
{
  const r = runGate(WORKTREE_ROOT);
  ok("(d) exit code is 0", r.code === 0, `got ${r.code}; stderr=${(r.stderr || "").slice(0, 200)}`);
  ok("(d) ok===true", r.json && r.json.ok === true, `json.ok=${r.json && r.json.ok}`);
  ok(
    "(d) info_gaps_count===0",
    r.json && r.json.info_gaps_count === 0,
    `got ${r.json && r.json.info_gaps_count}; remaining=${JSON.stringify(r.json && r.json.info_gaps)}`,
  );
  ok(
    "(d) dangling_unallowlisted===0",
    r.json &&
      Array.isArray(r.json.dangling_unallowlisted) &&
      r.json.dangling_unallowlisted.length === 0,
    `got ${JSON.stringify(r.json && r.json.dangling_unallowlisted)}`,
  );
  ok(
    "(d) dangling_seeds_total===0",
    r.json && r.json.dangling_seeds_total === 0,
    `got ${r.json && r.json.dangling_seeds_total}`,
  );
}

console.log("\n[e] unallowlisted owner=framework info_gap path → exit 1 (enforced)");
{
  const manifest = {
    paths: {
      "some-custom-dir/unreviewd-framework-tool.js": {
        owner: "framework",
        kind: "file",
      },
    },
  };
  const dir = makeTempFixture(manifest);
  try {
    const r = runGate(dir);
    ok("(e) exit code is 1 (info_gaps now block)", r.code === 1, `got ${r.code}; stderr=${r.stderr}`);
    ok("(e) ok===false", r.json && r.json.ok === false, `json.ok=${r.json && r.json.ok}`);
    ok(
      "(e) info_gaps_count > 0",
      r.json && r.json.info_gaps_count > 0,
      `got info_gaps_count=${r.json && r.json.info_gaps_count}`,
    );
    ok(
      "(e) hard_gaps is empty (path is NOT a hard-signal root)",
      r.json &&
        Array.isArray(r.json.hard_gaps) &&
        r.json.hard_gaps.length === 0,
      `hard_gaps=${JSON.stringify(r.json && r.json.hard_gaps)}`,
    );
  } finally {
    rmrf(dir);
  }
}

console.log("\n[f] new dangle inside framework/templates/_requirements/ NOT in the allowlist → exit 1");
{
  const newDangle = "framework/templates/_requirements/BRAND_NEW_UNREVIEWD_TEMPLATE.md";
  const manifest = {
    paths: {
      "_requirements/SomeSeededFile.md": {
        owner: "project",
        kind: "file",
        seeded_from: newDangle,
      },
    },
  };
  const dir = makeTempFixture(manifest);
  try {
    const r = runGate(dir);
    ok("(f) exit code is 1 (new dangle in known-dir REDs with exact match)", r.code === 1, `got ${r.code}`);
    ok("(f) ok===false", r.json && r.json.ok === false, `json.ok=${r.json && r.json.ok}`);
    ok(
      "(f) dangling_unallowlisted contains the new path",
      r.json &&
        Array.isArray(r.json.dangling_unallowlisted) &&
        r.json.dangling_unallowlisted.some((p) => p.includes("BRAND_NEW_UNREVIEWD_TEMPLATE")),
      `dangling_unallowlisted=${JSON.stringify(r.json && r.json.dangling_unallowlisted)}`,
    );
  } finally {
    rmrf(dir);
  }
}

console.log("\n[g] dangling seeded_from with the allowlist empty → RED");
{
  const formerlyAllowed = "framework/templates/_requirements/03-architecture/SECURITY.md";
  const manifest = {
    paths: {
      "_requirements/Architecture/Security.md": {
        owner: "project",
        kind: "file",
        seeded_from: formerlyAllowed,
      },
    },
  };
  const dir = makeTempFixture(manifest);
  try {
    const r = runGate(dir);
    ok("(g) exit code is 1 (dangling value REDs with the allowlist empty)", r.code === 1, `got ${r.code}; stderr=${r.stderr}`);
    ok("(g) ok===false", r.json && r.json.ok === false, `json.ok=${r.json && r.json.ok}`);
    ok(
      "(g) dangling_allowlisted===0 (set empty)",
      r.json && r.json.dangling_allowlisted === 0,
      `got ${r.json && r.json.dangling_allowlisted}`,
    );
    ok(
      "(g) dangling_unallowlisted contains the planted value",
      r.json &&
        Array.isArray(r.json.dangling_unallowlisted) &&
        r.json.dangling_unallowlisted.some((p) => p.includes("SECURITY.md")),
      `dangling_unallowlisted=${JSON.stringify(r.json && r.json.dangling_unallowlisted)}`,
    );
  } finally {
    rmrf(dir);
  }
}

console.log("\n[h] unshipped _mc/templates path → info_gaps (not hard_gaps), exit 1");
{
  const planted = "_mc/templates/app-scaffold/UNSHIPPED_NEW_TEMPLATE.tmpl";
  const manifest = {
    paths: {
      [planted]: {
        owner: "framework",
        kind: "file",
      },
    },
  };
  const dir = makeTempFixture(manifest);
  try {
    const r = runGate(dir);
    ok("(h) exit code is 1", r.code === 1, `got ${r.code}; stderr=${r.stderr}`);
    ok("(h) ok===false", r.json && r.json.ok === false, `json.ok=${r.json && r.json.ok}`);
    ok(
      "(h) the _mc/templates path is in info_gaps",
      r.json &&
        Array.isArray(r.json.info_gaps) &&
        r.json.info_gaps.some((p) => p.includes("_mc/templates/app-scaffold/UNSHIPPED_NEW_TEMPLATE")),
      `info_gaps=${JSON.stringify(r.json && r.json.info_gaps)}`,
    );
    ok(
      "(h) it is NOT in hard_gaps (_mc/ not in HARD_SIGNAL_ROOTS)",
      r.json &&
        Array.isArray(r.json.hard_gaps) &&
        !r.json.hard_gaps.some((p) => p.includes("_mc/templates")),
      `hard_gaps=${JSON.stringify(r.json && r.json.hard_gaps)}`,
    );
  } finally {
    rmrf(dir);
  }
}

console.log(`\n${passes + failures} tests: ${passes} passed, ${failures} failed`);
if (failures > 0) {
  console.error(`FAIL test-mc-ship-coverage: ${failures} test(s) failed`);
  process.exit(1);
} else {
  console.log("OK   test-mc-ship-coverage: all tests passed");
  process.exit(0);
}
