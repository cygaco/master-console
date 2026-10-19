#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { readGitHead } = require("./git-head");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
function mkRepo(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-githead-"));
  const gitDir = path.join(root, ".git");
  fs.mkdirSync(gitDir, { recursive: true });
  try { return fn(root, gitDir); } finally { try { fs.rmSync(root, { recursive: true, force: true }); } catch { } }
}

test("loose ref → the SHA in refs/heads/<branch>", () => {
  mkRepo((root, gitDir) => {
    fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
    fs.mkdirSync(path.join(gitDir, "refs", "heads"), { recursive: true });
    fs.writeFileSync(path.join(gitDir, "refs", "heads", "main"), SHA + "\n");
    assert.equal(readGitHead(root), SHA);
  });
});
test("detached HEAD → HEAD is the SHA itself", () => {
  mkRepo((root, gitDir) => {
    fs.writeFileSync(path.join(gitDir, "HEAD"), SHA + "\n");
    assert.equal(readGitHead(root), SHA);
  });
});
test("packed ref → the SHA from packed-refs", () => {
  mkRepo((root, gitDir) => {
    fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
    fs.writeFileSync(path.join(gitDir, "packed-refs"), `# pack-refs with: peeled fully-peeled sorted\n${SHA} refs/heads/main\n`);
    assert.equal(readGitHead(root), SHA);
  });
});
test("malformed packed-ref (non-hex token) → '' (fail-closed, not the bad token)", () => {
  mkRepo((root, gitDir) => {
    fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
    fs.writeFileSync(path.join(gitDir, "packed-refs"), `not-a-sha refs/heads/main\n`);
    assert.equal(readGitHead(root), "", "a non-hex packed-ref token must not become the code_sha");
  });
});
test("malformed LOOSE ref (non-hex) → '' (fail-closed)", () => {
  mkRepo((root, gitDir) => {
    fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
    fs.mkdirSync(path.join(gitDir, "refs", "heads"), { recursive: true });
    fs.writeFileSync(path.join(gitDir, "refs", "heads", "main"), "garbage-not-a-sha\n");
    assert.equal(readGitHead(root), "");
  });
});
test("malformed loose ref + VALID packed fallback → '' (loose is authoritative, no fall-through)", () => {
  mkRepo((root, gitDir) => {
    fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
    fs.mkdirSync(path.join(gitDir, "refs", "heads"), { recursive: true });
    fs.writeFileSync(path.join(gitDir, "refs", "heads", "main"), "garbage-not-a-sha\n");
    fs.writeFileSync(path.join(gitDir, "packed-refs"), `${SHA} refs/heads/main\n`);
    assert.equal(readGitHead(root), "", "a malformed loose ref must not fall through to the packed SHA");
  });
});
test("no .git → '' (fail-closed, not a crash)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-nogit-"));
  try { assert.equal(readGitHead(root), ""); } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

if (failures.length) {
  process.stderr.write(`FAIL [git-head.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [git-head.test] ${passed} passed (loose/detached/packed resolve; malformed packed/loose fail closed)\n`);
