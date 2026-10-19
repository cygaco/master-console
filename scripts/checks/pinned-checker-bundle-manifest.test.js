"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PCB = require(path.join(__dirname, "..", "dispatch", "pinned-checker-bundle"));

test("pinned-checker-bundle-manifest — buildBundle's manifest content hash covers files+executables+config, and verifyBundle re-hashes clean on an untouched promotion", () => {
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-clean-"));
  try {
    const { manifest, bundleRoot } = PCB.buildBundle({ outRoot, promotedBy: "test" });
    assert.strictEqual(manifest.schema_version, "checker-bundle/v1");
    assert.ok(manifest.bundle_digest && typeof manifest.bundle_digest === "string");
    assert.ok(Object.keys(manifest.files).length > 0, "the manifest must pin at least the check-lib files");
    assert.ok("lib/index.js" in manifest.files);
    assert.ok(manifest.executables && manifest.executables.node);
    assert.ok(manifest.promotion && manifest.promotion.from_src_digest, "promotion.from_src_digest must be stamped");

    const verified = PCB.verifyBundle(manifest, { bundleRoot });
    assert.strictEqual(verified.ok, true, JSON.stringify(verified.mismatches));
    assert.strictEqual(verified.observedDigest, verified.recomputedDigest);
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
});

test("pinned-checker-bundle-manifest — a supplied content hash that DIFFERS from the promoted pin BLOCKS (bundle_digest tamper, no on-disk file change)", () => {
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-digest-tamper-"));
  try {
    const { manifest, bundleRoot } = PCB.buildBundle({ outRoot, promotedBy: "test" });
    const tampered = { ...manifest, bundle_digest: "0".repeat(64) };
    const verified = PCB.verifyBundle(tampered, { bundleRoot });
    assert.strictEqual(verified.ok, false, "MUST-BLOCK: a supplied digest that does not match the recomputed one must fail verification");
    assert.ok(verified.mismatches.some((m) => m.reason === "bundle-digest-mismatch"));
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
});

test("pinned-checker-bundle-manifest — an ON-DISK file hash that differs from the pin BLOCKS before execution (runPinnedSuite never reaches step 5)", () => {
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-file-tamper-"));
  const candidateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-cand-"));
  try {
    const { manifest, bundleRoot } = PCB.buildBundle({ outRoot, promotedBy: "test" });
    const indexPath = path.join(bundleRoot, "lib", "index.js");
    fs.appendFileSync(indexPath, "\n// tampered-post-promotion\n");

    const res = PCB.runPinnedSuite(manifest, {}, { bundleRoot, candidateRoot });
    assert.strictEqual(res.ok, false, "MUST-BLOCK: an on-disk hash mismatch must refuse BEFORE execution");
    assert.strictEqual(res.reason, "bundle-pin-mismatch");
    assert.strictEqual(res.results.length, 0, "no check may have executed — the mismatch blocks BEFORE step 5");
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
    fs.rmSync(candidateRoot, { recursive: true, force: true });
  }
});

test("pinned-checker-bundle-manifest — loadBundleManifest REFUSES a manifest with an EMPTY files map (a vacuous pin)", () => {
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-empty-"));
  try {
    const manifestPath = path.join(outRoot, "manifest.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ schema_version: "checker-bundle/v1", bundle_digest: "a".repeat(64), files: {}, executables: { node: process.execPath } }),
    );
    assert.throws(() => PCB.loadBundleManifest(manifestPath), /empty|EMPTY|fail-closed/i);
  } finally {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
});
