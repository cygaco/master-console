"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const cHash = require("./lib/content-hash");

const REPO = path.resolve(__dirname, "..", "..");
const NOTE = /\[update\] reconcile-baseline: 1 locally edited files recorded; the update keeps them/;

function writeInstalled(root, source) {
  const file = path.join(root, ".claude", "framework-installed.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const assets = ["edited.md", "same.md"].map((dest) => {
    fs.writeFileSync(path.join(root, dest), "as installed\n");
    return {
      id: dest,
      dest,
      owner: "framework",
      installedHash: cHash.contentHash(path.join(root, dest)),
    };
  });
  fs.writeFileSync(path.join(root, "edited.md"), "operator edit\n");
  const body = {
    $schema: "mc/framework-installed/v2",
    installedVersion: "1.0.0",
    source,
    target: ".",
    assets,
    migrationsApplied: ["m-001"],
    userModified: ["earlier.md"],
    localOverrides: [{ path: "kept.md", ownerClass: "content" }],
    customField: { nested: [1, 2] },
  };
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + "\n");
  return { file, body };
}

function makeSourceTree(base) {
  const src = path.join(base, "source");
  for (const rel of [["scripts", "mc"], ["scripts", "hooks", "lib"]]) {
    fs.cpSync(path.join(REPO, ...rel), path.join(src, ...rel), { recursive: true });
  }
  fs.mkdirSync(path.join(src, "scripts", "checks"), { recursive: true });
  fs.copyFileSync(
    path.join(REPO, "scripts", "checks", "mc-manifest-honesty.js"),
    path.join(src, "scripts", "checks", "mc-manifest-honesty.js"),
  );
  return { src, ...writeInstalled(src, "self") };
}

function runUpdate(src, args, cwd) {
  return spawnSync(process.execPath, [path.join(src, "scripts", "mc", "update.js"), ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
  });
}

function assertRecordedOnly(file, before) {
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepStrictEqual(after, { ...before, userModified: ["earlier.md", "edited.md"] });
}

for (const flag of ["--reconcile-baseline", "--accept-local-drift"]) {
  test(`${flag} --apply records the edit in the target only and keeps installedHash`, () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "mc-rec-"));
    try {
      const { src, file: srcFile } = makeSourceTree(base);
      const tgt = path.join(base, "target");
      const { file, body } = writeInstalled(tgt, src);
      const srcBefore = fs.readFileSync(srcFile);

      const r = runUpdate(src, ["--to", "9.9.9", "--source", src, "--target", tgt, "--apply", flag], base);

      assert.match(r.stderr, NOTE, `stderr=${r.stderr}`);
      assert.match(r.stderr, /Capsule 9\.9\.9 missing release\.json/, `stderr=${r.stderr}`);
      assertRecordedOnly(file, body);
      assert.strictEqual(fs.readFileSync(path.join(tgt, "edited.md"), "utf8"), "operator edit\n");
      assert.ok(fs.readFileSync(srcFile).equals(srcBefore), "source framework-installed.json must be byte-identical");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
}

test("reconcile-baseline on a dry run writes nothing", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mc-rec-dry-"));
  try {
    const { src } = makeSourceTree(base);
    const tgt = path.join(base, "target");
    const { file } = writeInstalled(tgt, src);
    const before = fs.readFileSync(file);

    const r = runUpdate(src, ["--to", "9.9.9", "--source", src, "--target", tgt, "--dry-run", "--reconcile-baseline"], base);

    assert.match(r.stderr, /1 locally edited files found \(dry run, nothing written\); the update keeps them/, `stderr=${r.stderr}`);
    assert.ok(fs.readFileSync(file).equals(before));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("reconcile-baseline on the repository update.js runs from records without re-baselining", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mc-rec-self-"));
  try {
    const { src, file, body } = makeSourceTree(base);

    const r = runUpdate(src, ["--to", "9.9.9", "--apply", "--reconcile-baseline", "--no-discover"], base);

    assert.match(r.stderr, NOTE, `stderr=${r.stderr}`);
    assertRecordedOnly(file, body);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
