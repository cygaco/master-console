"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO = path.resolve(__dirname, "..");
const COMPILER = path.join(__dirname, "truth-compiler.js");

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "truth-compiler-"));
  const w = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  w(".claude/paths.json", fs.readFileSync(path.join(REPO, ".claude", "paths.json"), "utf8"));
  w(
    "_requirements/00-canonical/PRECEDENCE.json",
    JSON.stringify({ cascade: [{ pattern: "_requirements/04-features/*/PRD.md", level: 2 }] }),
  );
  w("_requirements/00-canonical/fixtures/sample.json", JSON.stringify({ a: 1 }));
  w("_requirements/04-features/demo/PRD.md", "# Demo\n");
  w(
    ".claude/project/events/events.jsonl",
    JSON.stringify({
      ts: "2026-01-01T00:00:00.000Z",
      cat: "spec",
      data: { file: "_requirements/00-canonical/fixtures/sample.json", how: "edit" },
    }) + "\n",
  );
  return root;
}

function probe(root) {
  const code = `
    const t = require(${JSON.stringify(COMPILER)});
    process.stdout.write(JSON.stringify({
      drift: t.checkFixtureDrift().map((g) => g.file),
      feature: t.compileFeatureTruth("demo") ? "found" : "missing",
      level: t.getLevel("_requirements/04-features/demo/PRD.md"),
      arch: t.getDocType("_requirements/03-architecture/DATA-CONTRACTS.md"),
    }));
  `;
  const r = spawnSync(process.execPath, ["-e", code], {
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: "utf8",
  });
  assert.strictEqual(r.status, 0, `probe failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

test("the requirements tree is read under _requirements/ (paths.requirementsRoot)", () => {
  const root = makeProject();
  try {
    const out = probe(root);
    assert.deepStrictEqual(
      out.drift,
      ["_requirements/00-canonical/fixtures/sample.json"],
      "the fixture-drift check finds the edited canonical fixture",
    );
    assert.strictEqual(out.feature, "found", "a feature folder under paths.specsRoot is compiled");
    assert.strictEqual(out.level, 2, "the precedence cascade is loaded from _requirements/00-canonical");
    assert.strictEqual(out.arch, "architecture", "a doc under paths.architectureRoot is typed architecture");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
