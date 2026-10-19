"use strict";
// FALSIFIER: pinned-bundle-path-symlink — record-trust gate.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const PCB = require(path.join(__dirname, "..", "pinned-checker-bundle"));

test("pinned-bundle-path-symlink MUST-BLOCK a hostile symlink resolving into candidateRoot", (t) => {
  const candidateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-symlink-cand-"));
  t.after(() => {
    try {
      fs.rmSync(candidateRoot, { recursive: true, force: true });
    } catch {
    }
  });

  const hostileTarget = path.join(candidateRoot, "hostile-node");
  fs.writeFileSync(hostileTarget, "not a real executable — just needs to exist for realpath to resolve\n");
  const linkPath = path.join(os.tmpdir(), `pcb-evil-node-link-${process.pid}-${Date.now()}`);

  let symlinked = true;
  try {
    fs.symlinkSync(hostileTarget, linkPath);
  } catch {
    symlinked = false;
  }
  t.after(() => {
    try {
      fs.unlinkSync(linkPath);
    } catch {
    }
  });
  if (!symlinked) {
    return t.skip("symlink creation not permitted in this environment (Windows Developer Mode / admin required) — falsifier RED pending environment capability");
  }

  const manifest = {
    schema_version: "checker-bundle/v1",
    suite_version: "n/a",
    bundle_digest: "n/a",
    files: {},
    executables: { node: linkPath },
    config: {},
  };

  assert.strictEqual(fs.realpathSync(linkPath), fs.realpathSync(hostileTarget));

  let thrown = null;
  try {
    PCB.resolveExecutable(manifest, "node", { candidateRoot });
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown, "MUST-BLOCK: resolveExecutable must refuse a symlink that realpath-resolves inside candidateRoot");
  assert.strictEqual(thrown.code, "resolution-outside-candidate", "the exact reason code must be resolution-outside-candidate");

  const cleanManifest = { ...manifest, executables: { node: process.execPath } };
  const resolved = PCB.resolveExecutable(cleanManifest, "node", { candidateRoot });
  assert.strictEqual(resolved, fs.realpathSync(process.execPath));
});
