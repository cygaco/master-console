"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { runAll, GENERATORS, CHECKS } = require("./regen-all.js");

function fakeRun(redNames = []) {
  const calls = [];
  const run = (args) => {
    calls.push(args.join(" "));
    const step = [...GENERATORS, ...CHECKS].find((s) => s.args.join(" ") === args.join(" "));
    return { status: redNames.includes(step.name) ? 3 : 0, output: "stub output" };
  };
  return { run, calls };
}

test("all green: three generators in order, then four checks, ok", () => {
  const { run, calls } = fakeRun();
  const lines = [];
  const r = runAll({ root: "/x", run, log: (l) => lines.push(l) });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(calls, [
    "scripts/generate-framework-manifest.js",
    "scripts/mc/snapshot-installed.js",
    "scripts/mc/manifest/build.js",
    "scripts/generate-framework-manifest.js --check",
    "scripts/mc/snapshot-installed.js --check",
    "scripts/checks/mc-manifest-honesty.js",
    "scripts/mc/manifest/validate.js --strict",
  ]);
  assert.strictEqual(lines.filter((l) => l.startsWith("GREEN")).length, 7);
  assert.strictEqual(lines[lines.length - 1], "manifests: all green");
});

test("a red generator stops the run before the later generators and the checks", () => {
  const { run, calls } = fakeRun(["installed-snapshot"]);
  const lines = [];
  const r = runAll({ root: "/x", run, log: (l) => lines.push(l) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(calls.length, 2);
  assert.ok(lines.some((l) => l.startsWith("RED") && l.includes("installed-snapshot") && l.includes("exit 3")));
  assert.ok(lines.some((l) => l.includes("stub output")), "the red step's output tail is printed");
});

test("a red check does not stop the other checks; the run is red", () => {
  const { run, calls } = fakeRun(["mc-manifest-honesty"]);
  const lines = [];
  const r = runAll({ root: "/x", run, log: (l) => lines.push(l) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(calls.length, 7);
  assert.strictEqual(r.results.filter((x) => !x.ok).length, 1);
  assert.strictEqual(lines[lines.length - 1], "manifests: RED");
});

function fixtureRoot(failRel) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "regen-all-"));
  const order = path.join(dir, "order.txt");
  const rels = [...new Set([...GENERATORS, ...CHECKS].map((s) => s.args[0]))];
  for (const rel of rels) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const code = rel === failRel ? 1 : 0;
    fs.writeFileSync(
      abs,
      `require("fs").appendFileSync(${JSON.stringify(order)}, ${JSON.stringify(rel)} + " " + process.argv.slice(2).join(" ") + " @" + process.env.CLAUDE_PROJECT_DIR + "\\n");\nprocess.exit(${code});\n`,
    );
  }
  fs.copyFileSync(path.join(__dirname, "regen-all.js"), path.join(dir, "scripts", "mc", "manifest", "regen-all.js"));
  return { dir, order };
}

test("CLI: runs every step from the repo root and exits 0 when all are green", () => {
  const { dir, order } = fixtureRoot(null);
  const env = { ...process.env, CLAUDE_PROJECT_DIR: path.join(os.tmpdir(), "some-other-checkout") };
  const r = spawnSync(process.execPath, [path.join(dir, "scripts", "mc", "manifest", "regen-all.js")], { encoding: "utf8", env });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const lines = fs.readFileSync(order, "utf8").trim().split(/\r?\n/);
  assert.strictEqual(lines.length, 7);
  for (const l of lines) assert.ok(l.endsWith(`@${dir}`), `each step sees the fixture root as its project dir: ${l}`);
  assert.match(r.stdout, /manifests: all green/);
});

test("CLI: exits 1 when a check is red", () => {
  const { dir } = fixtureRoot("scripts/mc/manifest/validate.js");
  const r = spawnSync(process.execPath, [path.join(dir, "scripts", "mc", "manifest", "regen-all.js")], { encoding: "utf8" });
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /RED {3}check mc-manifest validate --strict/);
});
