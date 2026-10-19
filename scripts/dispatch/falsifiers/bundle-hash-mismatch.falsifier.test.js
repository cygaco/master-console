"use strict";
// FALSIFIER: bundle-hash-mismatch — record-trust gate.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const PCB = require(path.join(__dirname, "..", "pinned-checker-bundle"));

test("bundle-hash-mismatch MUST-BLOCK before execution when a pinned file's on-disk hash != the promoted pin", (t) => {
  const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-bhm-bundle-"));
  const candidateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-bhm-cand-"));
  t.after(() => {
    for (const d of [bundleRoot, candidateRoot]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
      }
    }
  });

  const { manifest } = PCB.buildBundle({ outRoot: bundleRoot, promotedBy: "falsifier-test" });

  const preAttackVerify = PCB.verifyBundle(manifest, { bundleRoot });
  assert.strictEqual(preAttackVerify.ok, true, "precondition: the freshly-built bundle must verify clean before we attack it");

  const tamperedRel = Object.keys(manifest.files).find((k) => k.endsWith("index.js"));
  assert.ok(tamperedRel, "precondition: the bundle must contain a pinned index.js to tamper with");
  fs.appendFileSync(path.join(bundleRoot, tamperedRel), "\n// tampered-after-promotion\n");

  const attack = PCB.runPinnedSuite(manifest, {}, { bundleRoot, candidateRoot });
  assert.strictEqual(attack.ok, false, "MUST-BLOCK: a tampered pinned file must refuse the run");
  assert.strictEqual(attack.reason, "bundle-pin-mismatch");
  assert.strictEqual(attack.results.length, 0, "BLOCK BEFORE execute — zero checks may run over a mismatched bundle");
  assert.ok(
    attack.mismatches.some((m) => m.path === tamperedRel && m.reason === "hash-mismatch"),
    "the exact tampered file must be named in the mismatch report",
  );

  const bundleRoot2 = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-bhm-bundle2-"));
  t.after(() => {
    try {
      fs.rmSync(bundleRoot2, { recursive: true, force: true });
    } catch {
    }
  });
  const built2 = PCB.buildBundle({ outRoot: bundleRoot2, promotedBy: "falsifier-test" });
  const control = PCB.runPinnedSuite(built2.manifest, {}, { bundleRoot: bundleRoot2, candidateRoot });
  assert.strictEqual(control.ok, true, "CONTROL: an untampered bundle must verify+execute cleanly");
  assert.ok(control.results.length > 0, "CONTROL: checks must actually have RUN");
});
