"use strict";
/**
 * readme-drift.test.js — fixture pass/fail + derivation checks for scripts/checks/readme-drift.js.
 *
 *   node --test scripts/checks/readme-drift.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(__dirname, "readme-drift.js");
const FIX = path.join(__dirname, "fixtures", "readme-drift");
const { parseReadme, countHooks, evaluate, expectedFromTree } = require("./readme-drift");

const EXPECT = ["--expect-version", "1.2.0", "--expect-skills", "237", "--expect-hooks", "75"];

function run(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

test("known-answer: the PASS fixture exits 0 against matching expectations", () => {
  const r = run(["--readme", path.join(FIX, "pass.md"), ...EXPECT]);
  assert.strictEqual(r.code, 0, r.out);
});

test("RED proof: the FAIL fixture (stale 0.8.0 / 140 / 57) exits 1 and prints expected vs found", () => {
  const r = run(["--readme", path.join(FIX, "fail.md"), ...EXPECT]);
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /version: expected "1\.2\.0", found "0\.8\.0"/);
  assert.match(r.out, /skills: expected 237, found 140/);
  assert.match(r.out, /hooks: expected 75, found 57/);
});

test("RED proof: a missing line is a failure, not a pass", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "readme-drift-"));
  const f = path.join(dir, "README.md");
  fs.writeFileSync(f, "# x\n\n**Version:** 1.2.0\n**Skills:** 237 slash commands\n");
  const r = run(["--readme", f, ...EXPECT]);
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /hooks: expected 75, found MISSING line/);
});

test("line form is exact: near-misses (bold missing, extra words) do not count", () => {
  const found = parseReadme("Version: 1.2.0\n**Skills:** 237 slash commands total\n**Hooks:** 75 automated hooks\n");
  assert.strictEqual(found.version, null);
  assert.strictEqual(found.skills, null);
  assert.strictEqual(found.hooks, 75);
});

test("evaluate(): string/number comparison and problem kinds", () => {
  const r = evaluate({ version: "1.2.0", skills: 237, hooks: 74 }, { version: "1.2.0", skills: 237, hooks: 75 });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.problems, [{ field: "hooks", expected: 75, found: 74, kind: "drift" }]);
  assert.strictEqual(evaluate({ version: "1.2.0", skills: 237, hooks: 75 }, { version: "1.2.0", skills: 237, hooks: 75 }).ok, true);
});

test("countHooks() sums hooks[].length over every event and group", () => {
  const settings = { hooks: { PreToolUse: [{ hooks: [{}, {}] }, { hooks: [{}] }], Stop: [{ hooks: [{}] }] } };
  assert.strictEqual(countHooks(settings), 4);
  assert.strictEqual(countHooks({}), 0);
});

test("expected values derive from the live tree (version string, positive skill + hook counts)", () => {
  const e = expectedFromTree(ROOT);
  assert.match(e.version, /^\d+\.\d+\.\d+/);
  assert.ok(e.skills > 100, `skills=${e.skills}`);
  assert.ok(e.hooks > 10, `hooks=${e.hooks}`);
});

test("fail-closed: an unreadable README exits 2", () => {
  const r = run(["--readme", path.join(FIX, "does-not-exist.md"), ...EXPECT]);
  assert.strictEqual(r.code, 2, r.out);
});
