"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const GATE = path.join(__dirname, "mc-ship-coverage.js");
const PLANTED = "_private-tree/example.md";

function fixture(localRules) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ship-local-"));
  fs.mkdirSync(path.join(dir, "_mc"), { recursive: true });
  fs.writeFileSync(path.join(dir, "_mc", "MANIFEST.json"), JSON.stringify({ paths: { [PLANTED]: { owner: "framework", kind: "file" } } }));
  fs.mkdirSync(path.join(dir, ".claude", "project", "memory"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "framework-manifest.json"), JSON.stringify({ assets: { guide: [{ src: "_guides/placeholder.md", dest: "_guides/placeholder.md" }] } }));
  if (localRules !== undefined) {
    fs.writeFileSync(path.join(dir, ".claude", "project", "memory", "mc-ship-coverage.local.json"), typeof localRules === "string" ? localRules : JSON.stringify(localRules));
  }
  return dir;
}
const run = (dir) => {
  const r = spawnSync(process.execPath, [GATE, "--root", dir, "--json"], { encoding: "utf8" });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { }
  return { code: r.status, json, stderr: r.stderr };
};

test("with the instance-local rule, the instance-only tree is a reviewed exclusion", () => {
  const r = run(fixture({ knownNotShipped: [{ prefix: "_private-tree/", reason: "instance-only tree" }] }));
  assert.ok(r.json, r.stderr);
  assert.ok(!(r.json.info_gaps || []).includes(PLANTED), JSON.stringify(r.json.info_gaps));
  assert.strictEqual(r.json.instance_rules, 1);
});

test("without the file, the same path is an unreviewed gap and the output says there are no instance rules", () => {
  const r = run(fixture(undefined));
  assert.strictEqual(r.code, 1, r.stderr);
  assert.ok((r.json.info_gaps || []).includes(PLANTED), JSON.stringify(r.json.info_gaps));
  assert.strictEqual(r.json.instance_rules, "none (no instance-local rules file)");
});

test("a malformed instance-local file exits 2", () => {
  const r = run(fixture("{ not json"));
  assert.strictEqual(r.code, 2, r.stderr);
});
