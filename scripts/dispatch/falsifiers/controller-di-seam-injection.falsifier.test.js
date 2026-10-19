"use strict";
// FALSIFIER: controller-di-seam-injection — record-trust gate.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

test("controller-di-seam-injection — `hookLivenessCheckFn: () => ({ok:true})` through production opts MUST NOT bypass the hook precondition", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./_lib/controller-fixtures");
  const { headSha } = require("./_lib/git-scratch");
  const ctl = require("../trusted-controller");

  const fx = makeControllerFixture("di-hook-injection", { skipHookInstall: true });
  t.after(() => fx.cleanup());

  const baseline = ctl.integrate(standardInput(fx), standardOpts(fx));
  assert.strictEqual(baseline.ok, false, "PRECONDITION: an un-fenced repo must be refused");
  assert.strictEqual(baseline.reason, "active-hook-not-installed");

  const attack = ctl.integrate(standardInput(fx), standardOpts(fx, { hookLivenessCheckFn: () => ({ ok: true }) }));
  assert.strictEqual(attack.ok, false, "MUST-BLOCK: a caller-injected hook-liveness override must be IGNORED on the production path");
  assert.strictEqual(attack.decision, "BLOCKED");
  assert.strictEqual(attack.reason, "active-hook-not-installed", "the REAL precondition must still be the one that ran");
  assert.strictEqual(headSha(fx.dir, fx.targetRef), fx.base, "the ref must never have advanced");
});

test("controller-di-seam-injection — `materializeResultTreeFn` / `treeResolver` / `materializedTreeResolver` through production opts MUST NOT substitute the scanned tree", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./_lib/controller-fixtures");
  const { headSha } = require("./_lib/git-scratch");
  const ctl = require("../trusted-controller");

  const fx = makeControllerFixture("di-materialize-injection");
  t.after(() => fx.cleanup());

  const poisonedResult = fx.poisonResultCommit();
  const input = standardInput(fx, { result_commit: poisonedResult });

  let injectedCalls = 0;
  const cleanDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "di-clean-substitute-"));
  t.after(() => fs.rmSync(cleanDir, { recursive: true, force: true }));
  const attack = ctl.integrate(
    input,
    standardOpts(fx, {
      materializeResultTreeFn: (rc, o) => {
        injectedCalls++;
        void rc;
        void o;
        return { dir: cleanDir, treeHash: "deadbeef", cleanup() {} };
      },
      treeResolver: () => "deadbeef",
      materializedTreeResolver: () => "deadbeef",
    }),
  );

  assert.strictEqual(injectedCalls, 0, "MUST-BLOCK: the injected materializer must never be CALLED by the production entrypoint");
  assert.strictEqual(attack.ok, false, "MUST-BLOCK: the REAL result tree is poisoned and must still be what gets scanned");
  assert.strictEqual(attack.reason, "check-failed");
  assert.strictEqual(attack.offending, "no-nul-bytes");
  assert.strictEqual(headSha(fx.dir, fx.targetRef), fx.base, "the ref must never have advanced");
});

test("controller-di-seam-injection — `checkLibSrcRoot` through production opts MUST NOT redirect the lineage comparison at a drifted source", (t) => {
  const os = require("os");
  const PCB = require("../pinned-checker-bundle");
  const { makeControllerFixture, standardInput, standardOpts } = require("./_lib/controller-fixtures");
  const { headSha } = require("./_lib/git-scratch");
  const ctl = require("../trusted-controller");

  const driftedSrc = fs.mkdtempSync(path.join(os.tmpdir(), "di-drift-src-"));
  const driftedOut = fs.mkdtempSync(path.join(os.tmpdir(), "di-drift-bundle-"));
  const fx = makeControllerFixture("di-checklibsrc-injection");
  t.after(() => {
    fs.rmSync(driftedSrc, { recursive: true, force: true });
    fs.rmSync(driftedOut, { recursive: true, force: true });
    fx.cleanup();
  });
  (function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, ent.name);
      const d = path.join(dest, ent.name);
      if (ent.isDirectory()) copyDir(s, d);
      else fs.copyFileSync(s, d);
    }
  })(PCB.DEFAULT_LIB_SRC, driftedSrc);
  fs.appendFileSync(path.join(driftedSrc, "checks", "no-nul-bytes.js"), "\n// drifted-fork-content\n");

  const { bundleRoot, manifestPath } = PCB.buildBundle({ srcRoot: driftedSrc, outRoot: driftedOut, promotedBy: "di-seam-test" });

  const attack = ctl.integrate(
    standardInput(fx),
    standardOpts(fx, { bundleManifestPath: manifestPath, bundleRoot, checkLibSrcRoot: driftedSrc }),
  );
  assert.strictEqual(attack.ok, false, "MUST-BLOCK: a caller-supplied checkLibSrcRoot must be IGNORED — lineage always compares against the LIVE check-lib");
  assert.strictEqual(attack.decision, "BLOCKED");
  assert.strictEqual(attack.reason, "bundle-lineage-mismatch");
  assert.strictEqual(headSha(fx.dir, fx.targetRef), fx.base);
});

test("controller-di-seam-injection — `leaseTokenResolver` / `liveHead` through production opts are DROPPED (an honest run is unaffected by a hostile injection)", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./_lib/controller-fixtures");
  const { headSha } = require("./_lib/git-scratch");
  const ctl = require("../trusted-controller");

  const fx = makeControllerFixture("di-lease-livehead-injection");
  t.after(() => fx.cleanup());

  let injectedLeaseCalls = 0;
  const result = ctl.integrate(
    standardInput(fx),
    standardOpts(fx, {
      leaseTokenResolver: () => {
        injectedLeaseCalls++;
        return 999999;
      },
      liveHead: "f".repeat(40),
    }),
  );
  assert.strictEqual(injectedLeaseCalls, 0, "MUST-BLOCK: the injected lease resolver must never be CALLED");
  assert.strictEqual(result.ok, true, `the honest run must be unaffected by the dropped seams: ${JSON.stringify(result)}`);
  assert.strictEqual(headSha(fx.dir, fx.targetRef), fx.result);

  const fx2 = makeControllerFixture("di-lease-livehead-forttest");
  t.after(() => fx2.cleanup());
  const viaTestSeam = ctl.integrateForTest(standardInput(fx2), standardOpts(fx2), { leaseTokenResolver: () => 999999 });
  assert.strictEqual(viaTestSeam.ok, false, "REACHABILITY: the same seam, via integrateForTest, genuinely changes the outcome");
  assert.strictEqual(headSha(fx2.dir, fx2.targetRef), fx2.base);
});
