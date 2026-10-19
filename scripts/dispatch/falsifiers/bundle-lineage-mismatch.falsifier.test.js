"use strict";
// FALSIFIER: bundle-lineage-mismatch — record-trust gate: shared check-library drift. `promotion.from_src_digest` must be LOAD-BEARING at integrate()-time: a
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PCB = require(path.join(__dirname, "..", "pinned-checker-bundle"));

function makeDriftedSrcRoot() {
  const scratchSrc = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-drift-src-"));
  const liveSrc = PCB.DEFAULT_LIB_SRC;
  function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, ent.name);
      const d = path.join(dest, ent.name);
      if (ent.isDirectory()) copyDir(s, d);
      else fs.copyFileSync(s, d);
    }
  }
  copyDir(liveSrc, scratchSrc);
  const target = path.join(scratchSrc, "checks", "no-nul-bytes.js");
  fs.appendFileSync(target, "\n// drifted-fork-content\n");
  return scratchSrc;
}

test("bundle-lineage-mismatch — a bundle promoted from a DRIFTED (forked) check-lib source is REFUSED by loadPinnedCheckLib (bundle-lineage-mismatch)", (t) => {
  const ctl = require("../trusted-controller");

  const driftedSrc = makeDriftedSrcRoot();
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-drift-bundle-"));
  t.after(() => {
    fs.rmSync(driftedSrc, { recursive: true, force: true });
    fs.rmSync(outRoot, { recursive: true, force: true });
  });

  const { manifest, bundleRoot } = PCB.buildBundle({ srcRoot: driftedSrc, outRoot, promotedBy: "lineage-drift-test" });
  assert.ok(manifest.promotion.from_src_digest);
  assert.notStrictEqual(manifest.promotion.from_src_digest, PCB.sourceDigestOf(PCB.DEFAULT_LIB_SRC), "PRECONDITION: the drifted promotion must genuinely differ from the live source digest");

  assert.throws(
    () => ctl.loadPinnedCheckLib(manifest, { bundleRoot }),
    (e) => e.code === "bundle-lineage-mismatch",
  );
});

test("bundle-lineage-mismatch — the SAME drifted bundle REFUSES a full integrate() call before any check ever runs", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./_lib/controller-fixtures");
  const { headSha } = require("./_lib/git-scratch");
  const ctl = require("../trusted-controller");

  const driftedSrc = makeDriftedSrcRoot();
  const fx = makeControllerFixture("lineage-mismatch-e2e");
  const driftedOutRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-drift-e2e-bundle-"));
  t.after(() => {
    fs.rmSync(driftedSrc, { recursive: true, force: true });
    fs.rmSync(driftedOutRoot, { recursive: true, force: true });
    fx.cleanup();
  });

  const { manifest, bundleRoot, manifestPath } = PCB.buildBundle({ srcRoot: driftedSrc, outRoot: driftedOutRoot, promotedBy: "lineage-drift-e2e" });
  void manifest;
  void bundleRoot;

  const result = ctl.integrate(standardInput(fx), standardOpts(fx, { bundleManifestPath: manifestPath, bundleRoot }));
  assert.strictEqual(result.ok, false, "MUST-BLOCK: a drifted-source bundle must never authorize an integration");
  assert.strictEqual(result.decision, "BLOCKED");
  assert.strictEqual(result.reason, "bundle-lineage-mismatch");
  assert.strictEqual(headSha(fx.dir, fx.targetRef), fx.base);
});

test("bundle-lineage-mismatch — CONTROL: a bundle promoted from the REAL live check-lib source (the default, no srcRoot override) passes lineage cleanly", (t) => {
  const ctl = require("../trusted-controller");

  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-lineage-control-"));
  t.after(() => fs.rmSync(outRoot, { recursive: true, force: true }));

  const { manifest, bundleRoot } = PCB.buildBundle({ outRoot, promotedBy: "lineage-control" });
  const pinnedIndex = ctl.loadPinnedCheckLib(manifest, { bundleRoot });
  assert.ok(pinnedIndex && Array.isArray(pinnedIndex.CHECK_NAMES) && pinnedIndex.CHECK_NAMES.length > 0);
});
