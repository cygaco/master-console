"use strict";
/**
 * leak-gate.test.js — the runner propagates real exit codes and mirrors the CI workflow.
 *
 *   node --test scripts/checks/leak-gate.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const { GATES, runGates, summarize } = require("./leak-gate");

test("a red stub gate fails the run; a green one passes; an erroring one is exit 2", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "leak-gate-"));
  const green = path.join(dir, "green.js");
  const red = path.join(dir, "red.js");
  const err = path.join(dir, "err.js");
  fs.writeFileSync(green, "process.exit(0)");
  fs.writeFileSync(red, "process.exit(1)");
  fs.writeFileSync(err, "process.exit(2)");
  const all = runGates([{ name: "g", args: [green] }, { name: "r", args: [red] }], { cwd: dir, quiet: true });
  assert.deepStrictEqual(all.map((r) => r.code), [0, 1]);
  assert.strictEqual(summarize(all).code, 1);
  assert.strictEqual(summarize(runGates([{ name: "g", args: [green] }], { cwd: dir, quiet: true })).code, 0);
  assert.strictEqual(summarize(runGates([{ name: "e", args: [err] }, { name: "g", args: [green] }], { cwd: dir, quiet: true })).code, 2);
});

test("every gate script exists and the CI workflow runs the same gates as its own steps", () => {
  for (const g of GATES) assert.ok(fs.existsSync(path.join(ROOT, g.args[0])), `missing ${g.args[0]}`);
  const wf = fs.readFileSync(path.join(ROOT, ".github", "workflows", "leak-gate.yml"), "utf8");
  for (const g of GATES) {
    const cmd = `node ${g.args.join(" ")}`;
    assert.ok(wf.includes(cmd), `workflow must run "${cmd}" as its own step`);
  }
  assert.ok(wf.includes("npm test"), "workflow must run npm test");
  assert.ok(!/node scripts\/[^\n]*\|\s*(tail|head)/.test(wf), "a gate must never be piped through tail/head");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.strictEqual(pkg.scripts["leak-gate"], "node scripts/checks/leak-gate.js");
});
