"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { scan } = require("./authority-pollution-scan");

const PLANT = path.join(__dirname, "fixtures", "authority-pollution", "plant");
const CLEAN = path.join(__dirname, "fixtures", "authority-pollution", "clean");
const CANONICAL = path.resolve(__dirname, "..", "..");

test("BLOCKING FIXTURE: the default-binding plant in a neutral AGENTS.md is CAUGHT", () => {
  const res = scan(PLANT);
  assert.ok(res.violations.length > 0, "the plant must be caught");
  const ids = new Set(res.violations.map((v) => v.patternId));
  assert.ok(ids.has("default-binding"), `expected default-binding to be caught; got [${[...ids]}]`);
  assert.ok(ids.has("identity-assertion"), "identity assertion caught");
  assert.ok(ids.has("authority-grant"), "authority grant caught");
  assert.ok(ids.has("operator-audience"), `expected operator-audience caught; got [${[...ids]}]`);
});

test("the default-binding paraphrase ('top-level session defaults to alex-alpha') is caught", () => {
  const res = scan(PLANT);
  const paraphraseCaught = res.violations.some(
    (v) => v.patternId === "default-binding" && /defaults to alex-alpha/i.test(v.text),
  );
  assert.ok(paraphraseCaught, "a paraphrase of the default binding must be caught, not just the literal");
});

test("CLEAN control: descriptive third-person mentions of the President do NOT trip the scan", () => {
  const res = scan(CLEAN);
  assert.strictEqual(res.violations.length, 0, `clean control tripped: ${JSON.stringify(res.violations)}`);
});

test("STANDING scan: the live canonical neutral graph is clean (zero ambient authority)", () => {
  const res = scan(CANONICAL);
  assert.strictEqual(
    res.violations.length,
    0,
    `canonical neutral graph has authority pollution:\n${res.violations.map((v) => `  ${v.file}:${v.line} [${v.patternId}]`).join("\n")}`,
  );
  assert.ok(res.surfaceCount >= 1, "at least the root AGENTS.md must be scanned");
});

const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const SRC = path.join(__dirname, "authority-pollution-scan.js");
const NO_LOCAL = "none (no instance-local skip file)";

function makeTree(localContent) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "authority-pollution-local-"));
  const w = (rel, body) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  };
  fs.mkdirSync(path.join(root, "scripts", "checks"), { recursive: true });
  fs.copyFileSync(SRC, path.join(root, "scripts", "checks", "authority-pollution-scan.js"));
  w("AGENTS.md", "# Agents\n\nThe President runs the company.\n");
  w("instance-copy/AGENTS.md", "You are Alex.\n");
  w("old-mc-v1-tree/GEMINI.md", "You are the President.\n");
  if (localContent !== undefined) w(".claude/project/memory/authority-pollution-skip.local.json", localContent);
  else fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  return root;
}

function loadCopy(root) {
  return require(path.join(root, "scripts", "checks", "authority-pollution-scan.js"));
}

function runCli(root) {
  return spawnSync(
    process.execPath,
    [path.join(root, "scripts", "checks", "authority-pollution-scan.js"), "--root", root],
    { encoding: "utf8" },
  );
}

test("with the instance-local file, its segments and substrings join the product skip rules", () => {
  const root = makeTree(JSON.stringify({ skipSegments: ["instance-copy"], skipSubstrings: ["mc-v1"] }));
  try {
    const res = loadCopy(root).scan(root);
    assert.strictEqual(res.violations.length, 0, `instance dirs were scanned: ${JSON.stringify(res.violations)}`);
    assert.strictEqual(res.instanceSkips, 2, "the result counts the instance-local entries");
    const cli = runCli(root);
    assert.strictEqual(cli.status, 0, cli.stdout + cli.stderr);
    assert.ok(cli.stdout.includes("instance-local skips: 2"), cli.stdout);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("without the file, only the product skip rules apply and the output says there are no instance entries", () => {
  const root = makeTree(undefined);
  try {
    const res = loadCopy(root).scan(root);
    const files = res.violations.map((v) => v.file.split(path.sep).join("/")).sort();
    assert.deepStrictEqual(files, ["instance-copy/AGENTS.md", "old-mc-v1-tree/GEMINI.md"]);
    assert.strictEqual(res.instanceSkips, NO_LOCAL);
    const cli = runCli(root);
    assert.strictEqual(cli.status, 1);
    assert.ok(cli.stdout.includes(`instance-local skips: ${NO_LOCAL}`), `CLI output must state the instance status:\n${cli.stdout}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const [label, content] of [
  ["not JSON", "{ skipSegments: "],
  ["an array", "[]"],
  ["neither key", "{}"],
  ["a non-string entry", JSON.stringify({ skipSegments: [1] })],
  ["an empty entry", JSON.stringify({ skipSubstrings: [""] })],
  ["a segment with a path separator", JSON.stringify({ skipSegments: ["a/b"] })],
]) {
  test(`a malformed instance-local file (${label}) fails loudly: scan() throws and the CLI exits 2`, () => {
    const root = makeTree(content);
    try {
      assert.throws(() => loadCopy(root).scan(root), /instance-local skip file malformed/);
      const cli = runCli(root);
      assert.strictEqual(cli.status, 2, cli.stdout + cli.stderr);
      assert.ok(cli.stderr.includes("instance-local skip file malformed"), cli.stderr);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
