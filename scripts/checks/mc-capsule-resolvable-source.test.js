"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const CHECK = path.join(__dirname, "mc-capsule-resolvable.js");

function mkSource(version) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mc-capres-src-"));
  const capsuleDir = path.join(base, "framework", "releases", version);
  fs.mkdirSync(capsuleDir, { recursive: true });
  fs.writeFileSync(path.join(capsuleDir, "release.json"), JSON.stringify({ version }));
  return base;
}
function mkEmptyTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mc-capres-tgt-"));
}
function run(args) {
  return spawnSync(process.execPath, [CHECK, ...args], { encoding: "utf8" });
}

test("GREEN: an explicit --source carrying the capsule resolves it (highest priority)", () => {
  const src = mkSource("9.9.9");
  const tgt = mkEmptyTarget();
  try {
    const r = run(["--to", "9.9.9", "--source", src, "--target", tgt]);
    assert.strictEqual(r.status, 0, `expected green; got exit ${r.status}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout + r.stderr, /resolved/i);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(tgt, { recursive: true, force: true });
  }
});

test("RED: without --source the same capsule is not found (the pre-fix behaviour, now scoped to no-source)", () => {
  const src = mkSource("9.9.9");
  const tgt = mkEmptyTarget();
  try {
    const r = run(["--to", "9.9.9", "--target", tgt]);
    assert.strictEqual(r.status, 1, `expected red without --source; got exit ${r.status}`);
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(tgt, { recursive: true, force: true });
  }
});
