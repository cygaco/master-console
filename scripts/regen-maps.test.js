"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function freshTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "regen-maps-"));
  for (const d of ["scripts/hooks/lib", ".claude/commands", ".claude/project/memory", ".claude/project/events", ".claude/project/maps", "_requirements/_standards"]) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  fs.copyFileSync(path.join(__dirname, "regen-maps.js"), path.join(root, "scripts", "regen-maps.js"));
  fs.copyFileSync(path.join(__dirname, "..", ".claude", "paths.json"), path.join(root, ".claude", "paths.json"));
  fs.writeFileSync(path.join(root, ".claude", "settings.json"), JSON.stringify({ hooks: {} }));
  fs.writeFileSync(path.join(root, ".claude", "manifest.json"), JSON.stringify({ build: { features: [] } }));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture" }));
  fs.writeFileSync(path.join(root, "_requirements", "_standards", "PRD_TEMPLATE.md"), "# PRD template\n");
  return root;
}
const regen = (root) => spawnSync(process.execPath, [path.join(root, "scripts", "regen-maps.js")], { cwd: root, encoding: "utf8" });
const maps = (root, f) => fs.readFileSync(path.join(root, ".claude", "project", "maps", f), "utf8");
const meta = (root) => JSON.parse(maps(root, "enforcements.jsonl").split("\n")[0]);

test("a fresh tree's enforcement map has no invented gap counts", () => {
  const root = freshTree();
  const r = regen(root);
  assert.strictEqual(r.status, 0, r.stderr);
  const m = meta(root);
  assert.deepStrictEqual([m.total_gaps, m.gaps_closed, m.gaps_open], [0, 0, 0]);
});

test("the uncurated count includes uncurated entries carried forward", () => {
  const root = freshTree();
  fs.writeFileSync(path.join(root, "scripts", "hooks", "x-guard.js"), "// fixture hook\n");
  fs.writeFileSync(path.join(root, ".claude", "project", "maps", "enforcements.jsonl"),
    JSON.stringify({ _meta: true, name: "Enforcements Map" }) + "\n" + JSON.stringify({ id: "x-guard", type: "hook", uncurated: true }) + "\n");
  const r = regen(root);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(meta(root).uncurated_count, 1);
});

test("the spec-template count reads _requirements/_standards/", () => {
  const root = freshTree();
  const r = regen(root);
  assert.strictEqual(r.status, 0, r.stderr);
  const row = maps(root, "systems-inventory.jsonl").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.id === "requirements-templates");
  assert.ok(row, "no requirements-templates row");
  assert.strictEqual(row.count, 1);
});

test("architecture.md leaves out the pages, steps, dashboard and extension sections when absent", () => {
  const root = freshTree();
  fs.mkdirSync(path.join(root, "src", "components", "ui"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "components", "ui", "button.tsx"), "export {};\n");
  const r = regen(root);
  assert.strictEqual(r.status, 0, r.stderr);
  const md = maps(root, "architecture.md");
  assert.match(md, /## UI atoms/);
  for (const h of ["## Pages", "## Steps", "## Extension", "## Dashboard", "DM modules"]) assert.ok(!md.includes(h), `unexpected section ${h}`);
});
