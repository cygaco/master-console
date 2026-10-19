"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

test("a spec edit with tests under _requirements/<feature>/tests and no recorded pass logs test.stale", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spec-test-staleness-"));
  fs.mkdirSync(path.join(root, "scripts", "hooks"), { recursive: true });
  fs.copyFileSync(path.join(__dirname, "spec-test-staleness.js"), path.join(root, "scripts", "hooks", "spec-test-staleness.js"));
  fs.mkdirSync(path.join(root, "_requirements", "alpha", "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "_requirements", "alpha", "tests", "a.spec.ts"), "");
  const payload = { tool_name: "Edit", tool_input: { file_path: "_requirements/04-features/alpha/PRD.md" } };
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "hooks", "spec-test-staleness.js")], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const events = path.join(root, ".claude", "project", "events", "events.jsonl");
  assert.ok(fs.existsSync(events), "no test.stale event was written");
  const ev = JSON.parse(fs.readFileSync(events, "utf8").trim().split("\n").pop());
  assert.strictEqual(ev.kind, "test.stale");
  assert.strictEqual(ev.feature, "alpha");
  assert.deepStrictEqual(ev.test_files, ["_requirements/alpha/tests/a.spec.ts"]);
  assert.strictEqual(ev.suggestion, "Tests have never passed. Run: npx playwright test _requirements/alpha");
});
