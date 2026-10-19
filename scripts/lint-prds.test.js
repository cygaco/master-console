"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function runLint(prd, srcFiles) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lint-prds-"));
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "paths.json"), JSON.stringify({ specsRoot: "_requirements/04-features" }));
  const featureDir = path.join(root, "_requirements", "04-features", "alpha");
  fs.mkdirSync(featureDir, { recursive: true });
  fs.writeFileSync(path.join(featureDir, "PRD.md"), prd);
  for (const rel of srcFiles) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), "export {};\n");
  }
  const r = spawnSync(process.execPath, [path.join(__dirname, "lint-prds.js")], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  fs.rmSync(root, { recursive: true, force: true });
  return r;
}

const STORY_WARN = /PRD may contain embedded user stories/;

test("user-story detector flags generic personas", () => {
  const r = runLint("# PRD\n\nAs a developer, I want a build.\n", []);
  assert.match(r.stdout, STORY_WARN, r.stdout + r.stderr);
});

test("user-story detector carries no product-specific persona", () => {
  const r = runLint("# PRD\n\nAs a job seeker, I want a list.\n", []);
  assert.doesNotMatch(r.stdout, STORY_WARN, r.stdout + r.stderr);
});

test("code drift: generic infrastructure files are exempt, a product-specific lib file is not", () => {
  const r = runLint("# PRD\n", ["src/lib/pipeline.ts", "src/lib/scraper-scripts.ts"]);
  assert.doesNotMatch(r.stdout, /Source file not claimed by any PRD: src\/lib\/pipeline\.ts/, r.stdout + r.stderr);
  assert.match(r.stdout, /Source file not claimed by any PRD: src\/lib\/scraper-scripts\.ts/, r.stdout + r.stderr);
});
