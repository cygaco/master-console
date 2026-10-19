#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const { consult } = require("./consult");
const { evaluate } = require("./eval");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  PASS [${passed + failed + 1}]: ${name}\n`);
    passed++;
  } catch (e) {
    process.stdout.write(`  FAIL [${passed + failed + 1}]: ${name}\n    Error: ${e.message}\n`);
    failed++;
  }
}

test(
  "consult() parses envelope and flags 'install' (business-verb → flagged non-empty)",
  () => {
    const fakeDispatch = () => ({
      ok: true,
      provider: "openai",
      model: "gpt-5.5",
      role: "consult",
      output: "Please install this package for better results.",
    });

    const result = consult({ promptText: "evaluate this skill", dispatch: fakeDispatch });

    assert.strictEqual(typeof result, "object", "result should be an object");
    assert.strictEqual(result.ok, true, `ok should be true, got ${result.ok}`);
    assert(
      Array.isArray(result.flagged) && result.flagged.length > 0,
      `flagged should be non-empty, got ${JSON.stringify(result.flagged)}`
    );
    const flaggedJoined = result.flagged.join(" ").toLowerCase();
    assert(
      flaggedJoined.includes("install") || result.flagged.some((f) => /install/i.test(f)),
      `flagged should contain 'install', got ${JSON.stringify(result.flagged)}`
    );
  }
);

test(
  "evaluate() on fixture-satisfying target → accept, arbitration_needed:false, record valid",
  () => {
    const PATHS = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, ".claude", "paths.json"), "utf8")
    );
    const packPath = path.join(
      REPO_ROOT,
      PATHS.etcEvalPacks,
      "etc-author.example.json"
    );
    const pack = JSON.parse(fs.readFileSync(packPath, "utf8"));

    const target = ".claude/commands/etc/author.md";

    const fakeConsult = () => ({
      ok: true,
      critique: "The skill is well-organized, unambiguous, and consistent with the /etc namespace.",
      flagged: [],
    });

    const result = evaluate({ target, pack, consult: fakeConsult });

    assert.strictEqual(
      result.decision,
      "accept",
      `expected decision='accept', got '${result.decision}' (confidence=${result.confidence})`
    );
    assert.strictEqual(
      result.arbitration_needed,
      false,
      `arbitration_needed should be false, got ${result.arbitration_needed}`
    );
    assert(
      result.confidence >= 0.7,
      `confidence should be ≥0.7, got ${result.confidence}`
    );
    assert(
      result.record_path && fs.existsSync(result.record_path),
      `record_path should point to an existing file, got ${result.record_path}`
    );

    const va = spawnSync(
      process.execPath,
      [
        path.join(REPO_ROOT, "scripts", "contracts", "validate-artifact.js"),
        result.record_path,
      ],
      { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true }
    );
    assert.strictEqual(
      va.status,
      0,
      `validate-artifact.js should exit 0 for valid record, got ${va.status}\n${va.stderr || va.stdout}`
    );
  }
);

test(
  "evaluate() with judgment dimension and no consult → arbitration_needed:true",
  () => {
    const PATHS = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, ".claude", "paths.json"), "utf8")
    );
    const packPath = path.join(
      REPO_ROOT,
      PATHS.etcEvalPacks,
      "etc-author.example.json"
    );
    const pack = JSON.parse(fs.readFileSync(packPath, "utf8"));

    const hasJudgment = pack.rubric.some((d) => d.mechanical === false);
    assert(
      hasJudgment,
      "fixture pack must have at least one judgment dimension (mechanical:false) for this test to be valid"
    );

    const target = ".claude/commands/etc/author.md";

    const result = evaluate({ target, pack, consult: null });

    assert.strictEqual(
      result.arbitration_needed,
      true,
      `arbitration_needed should be true when judgment dim has no consult, got ${result.arbitration_needed}`
    );
  }
);

test(
  "deliberately malformed decision_record is REJECTED by validate-artifact.js (exit 1)",
  () => {
    const malformed = {
      type: "decision_record",
      id: "test-malformed-" + Date.now(),
      decision: "accept",
    };

    const tmpPath = path.join(
      os.tmpdir(),
      `etc-test-malformed-${Date.now()}.json`
    );
    fs.writeFileSync(tmpPath, JSON.stringify(malformed), "utf8");

    let vaStatus;
    try {
      const va = spawnSync(
        process.execPath,
        [
          path.join(REPO_ROOT, "scripts", "contracts", "validate-artifact.js"),
          tmpPath,
        ],
        { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true }
      );
      vaStatus = va.status;
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { }
    }

    assert.strictEqual(
      vaStatus,
      1,
      `validate-artifact.js should exit 1 (REJECTED) for malformed record, got exit ${vaStatus}`
    );
  }
);

process.stdout.write(`\nResults: ${passed} passed, ${failed} failed out of ${passed + failed} tests\n`);
if (failed > 0) {
  process.stdout.write("FAIL\n");
  process.exit(1);
} else {
  process.stdout.write("PASS\n");
  process.exit(0);
}
