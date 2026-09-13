#!/usr/bin/env node
"use strict";
/**
 * Teeth for git-head.js (SR-013/QA-012 provenance source + R5-BE-001 sweep). Proves the fs ref-reader
 * resolves a loose ref, a detached HEAD, and a packed ref — and FAILS CLOSED on a malformed packed-ref
 * (a non-hex token must NOT become the code_sha the attestation binds to).
 *
 *   node scripts/dispatch/git-head.test.js
 */
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

const SHA = "abcdef0123456789abcdef0123456789abcdef01";
function mkRepo(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mc-githead-"));
  const gitDir = path.join(root, ".git");
  fs.mkdirSync(gitDir, { recursive: true });
  try { return fn(root, gitDir); } finally { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ } }
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
// ── R5-BE-001: a MALFORMED packed-ref token must FAIL CLOSED (return ""), never a non-commit value. ──
test("R5-BE-001: malformed packed-ref (non-hex token) → '' (fail-closed, not the bad token)", () => {
  mkRepo((root, gitDir) => {
    fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
    fs.writeFileSync(path.join(gitDir, "packed-refs"), `not-a-sha refs/heads/main\n`);
    assert.equal(readGitHead(root), "", "a non-hex packed-ref token must not become the code_sha");
  });
});
test("R5-BE-001: malformed LOOSE ref (non-hex) → '' (fail-closed)", () => {
  mkRepo((root, gitDir) => {
    fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
    fs.mkdirSync(path.join(gitDir, "refs", "heads"), { recursive: true });
    fs.writeFileSync(path.join(gitDir, "refs", "heads", "main"), "garbage-not-a-sha\n");
    assert.equal(readGitHead(root), "");
  });
});
// ── R6-BE-001: a malformed LOOSE ref that EXISTS must NOT fall through to a valid packed-refs entry —
//    the loose ref is authoritative; a malformed one fails CLOSED (a stale packed SHA is the WRONG commit). ──
test("R6-BE-001: malformed loose ref + VALID packed fallback → '' (loose is authoritative, no fall-through)", () => {
  mkRepo((root, gitDir) => {
    fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
    fs.mkdirSync(path.join(gitDir, "refs", "heads"), { recursive: true });
    fs.writeFileSync(path.join(gitDir, "refs", "heads", "main"), "garbage-not-a-sha\n");
    fs.writeFileSync(path.join(gitDir, "packed-refs"), `${SHA} refs/heads/main\n`); // a stale/valid packed entry
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
process.stdout.write(`OK   [git-head.test] ${passed} passed (loose/detached/packed resolve; malformed packed/loose fail closed — R5-BE-001)\n`);
