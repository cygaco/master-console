"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const REFUSAL = /has no scripts\/mc\/snapshot-installed\.js, so its baseline cannot be reconciled in place\. Nothing was changed\./;

function writeInstalled(root, source) {
  const file = path.join(root, ".claude", "framework-installed.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = {
    $schema: "mc/framework-installed/v2",
    installedVersion: "1.0.0",
    source,
    target: ".",
    assets: [],
  };
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + "\n");
  return file;
}

function makeSourceTree(base) {
  const src = path.join(base, "source");
  fs.cpSync(path.join(REPO, "scripts", "mc"), path.join(src, "scripts", "mc"), { recursive: true });
  fs.cpSync(path.join(REPO, "scripts", "hooks", "lib"), path.join(src, "scripts", "hooks", "lib"), { recursive: true });
  const installedFile = writeInstalled(src, "self");
  return { src, installedFile };
}

function runUpdate(src, args, cwd) {
  return spawnSync(process.execPath, [path.join(src, "scripts", "mc", "update.js"), ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
  });
}

test("reconcile-baseline refuses a target without its own snapshot script and leaves the source untouched", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mc-update-reconcile-"));
  try {
    const { src, installedFile: srcInstalled } = makeSourceTree(base);
    const tgt = path.join(base, "target");
    const tgtInstalled = writeInstalled(tgt, src);
    assert.ok(!fs.existsSync(path.join(tgt, "scripts", "mc", "snapshot-installed.js")));
    const srcBefore = fs.readFileSync(srcInstalled);
    const tgtBefore = fs.readFileSync(tgtInstalled);

    const r = runUpdate(src, ["--to", "9.9.9", "--source", src, "--target", tgt, "--apply", "--reconcile-baseline"], base);

    assert.notStrictEqual(r.status, 0, `expected a non-zero exit; stdout=${r.stdout} stderr=${r.stderr}`);
    assert.match(r.stderr, REFUSAL, `stderr=${r.stderr}`);
    assert.doesNotMatch(r.stderr, /\[update\] reconcile-baseline:/, "no snapshot script may run");
    assert.ok(fs.readFileSync(srcInstalled).equals(srcBefore), "source framework-installed.json must be byte-identical");
    assert.ok(fs.readFileSync(tgtInstalled).equals(tgtBefore), "target framework-installed.json must be byte-identical");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("reconcile-baseline on the repository update.js runs from still runs that repository's snapshot script", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mc-update-reconcile-self-"));
  try {
    const { src, installedFile: srcInstalled } = makeSourceTree(base);
    const before = fs.readFileSync(srcInstalled, "utf8");

    const r = runUpdate(src, ["--to", "9.9.9", "--apply", "--reconcile-baseline", "--no-discover"], base);

    assert.doesNotMatch(r.stderr, REFUSAL, `stderr=${r.stderr}`);
    assert.match(r.stderr, /\[update\] reconcile-baseline: snapshot-installed: re-baselined consumer snapshot in place/, `stderr=${r.stderr}`);
    const after = JSON.parse(fs.readFileSync(srcInstalled, "utf8"));
    assert.notStrictEqual(fs.readFileSync(srcInstalled, "utf8"), before);
    assert.strictEqual(after.rebaselineSource, "local-disk (--reconcile-baseline)");
    assert.match(r.stderr, /Capsule 9\.9\.9 missing release\.json/, `stderr=${r.stderr}`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
