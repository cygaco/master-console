"use strict";
// FALSIFIER: empty-bundle-manifest — record-trust gate. An empty or self-authored external `files:{}` manifest must never be accepted as
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PCB = require(path.join(__dirname, "..", "pinned-checker-bundle"));
const CONTROLLER = path.join(__dirname, "..", "trusted-controller.js");

test("empty-bundle-manifest — loadBundleManifest REFUSES an empty-files self-authored manifest (fail-closed at the loader)", () => {
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-empty-mf-"));
  try {
    const manifestPath = path.join(outRoot, "manifest.json");
    const files = {};
    const executables = { node: process.execPath };
    const config = {};
    const crypto = require("crypto");
    const digest = crypto.createHash("sha256").update(JSON.stringify({ files, executables, config })).digest("hex");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ schema_version: "checker-bundle/v1", bundle_digest: digest, files, executables, config }),
    );
    assert.throws(() => PCB.loadBundleManifest(manifestPath), /EMPTY|empty/);
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
});

test("empty-bundle-manifest — runPinnedSuite REFUSES an in-memory manifest missing lib/checks/*.js entries even though lib/index.js + lib/registry.js are present (incomplete, not just empty)", () => {
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-incomplete-mf-"));
  const candidateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-incomplete-cand-"));
  try {
    const { manifest, bundleRoot } = PCB.buildBundle({ outRoot, promotedBy: "incomplete-manifest-test" });
    const shrunk = { ...manifest, files: {} };
    for (const [rel, hash] of Object.entries(manifest.files)) {
      if (rel === "lib/index.js" || rel === "lib/registry.js") shrunk.files[rel] = hash;
    }
    const crypto = require("crypto");
    const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
    shrunk.bundle_digest = crypto.createHash("sha256").update(JSON.stringify({ files: sortObj(shrunk.files), executables: shrunk.executables, config: shrunk.config })).digest("hex");

    const res = PCB.runPinnedSuite(shrunk, {}, { bundleRoot, candidateRoot });
    assert.strictEqual(res.ok, false, "MUST-BLOCK: a manifest missing checker modules must be refused even though its OWN (shrunk) hash is internally consistent");
    assert.strictEqual(res.reason, "incomplete-bundle-manifest");
    assert.ok(res.missing.some((m) => m.startsWith("lib/checks/")), JSON.stringify(res.missing));
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
    fs.rmSync(candidateRoot, { recursive: true, force: true });
  }
});

test("empty-bundle-manifest — CONTROL: the real, fully-promoted bundle is complete (assertBundleCompleteness ok:true)", () => {
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-complete-control-"));
  try {
    const { manifest, bundleRoot } = PCB.buildBundle({ outRoot, promotedBy: "complete-bundle-control" });
    const res = PCB.assertBundleCompleteness(manifest, { bundleRoot });
    assert.strictEqual(res.ok, true, JSON.stringify(res.missing));
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
});

test("empty-bundle-manifest — the CONTROLLER's own loadPinnedCheckLib refuses an incomplete manifest before the pinned suite ever runs", () => {
  const ctl = require("../trusted-controller");
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-controller-incomplete-"));
  try {
    const { manifest, bundleRoot } = PCB.buildBundle({ outRoot, promotedBy: "controller-incomplete-test" });
    const shrunk = { ...manifest, files: { "lib/index.js": manifest.files["lib/index.js"] } };
    const crypto = require("crypto");
    const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
    shrunk.bundle_digest = crypto.createHash("sha256").update(JSON.stringify({ files: sortObj(shrunk.files), executables: shrunk.executables, config: shrunk.config })).digest("hex");

    assert.throws(
      () => ctl.loadPinnedCheckLib(shrunk, { bundleRoot }),
      (e) => e.code === "incomplete-bundle-manifest",
    );
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
});
