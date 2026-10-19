"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

test("the trigger is read from its own comment block, not from an earlier one", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guard-promotion-"));
  fs.mkdirSync(path.join(root, "scripts", "hooks"), { recursive: true });
  fs.mkdirSync(path.join(root, ".claude", "project", "events"), { recursive: true });
  fs.copyFileSync(path.join(__dirname, "..", ".claude", "paths.json"), path.join(root, ".claude", "paths.json"));
  fs.writeFileSync(path.join(root, "scripts", "hooks", "x-guard.js"),
    '/**\n * doc block\n * actor: "doc-actor"\n */\n/**\n * PROMOTION_TRIGGER:\n *   actor: "trigger-actor"\n *   action: ["a1"]\n */\n');
  const r = spawnSync(process.execPath, [path.join(__dirname, "check-guard-promotion.js"), "--json"], {
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const row = JSON.parse(r.stdout).rows.find((x) => x.guard === "x-guard.js");
  assert.ok(row, r.stdout);
  assert.strictEqual(row.actor, "trigger-actor");
  assert.deepStrictEqual(row.actions, ["a1"]);
});
