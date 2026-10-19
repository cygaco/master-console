"use strict";
/**
 * FALSIFIER: bundle-corrupt-configured-refused-no-fallback
 *
 * THE ATTACK: the fallback-visibility ledger's honesty rests on ONE partition — a security refusal must
 * NEVER be fallback-eligible. The class is a SECURITY reason leaking into the operational bucket:
 *   (a) a pinned bundle that is CONFIGURED (a path was supplied) but is MISSING / unstatable — deleted,
 *       access-denied, or swapped out from under the broker; and
 *   (b) a configured bundle that EXISTS but is CORRUPT / structurally-incomplete (truncated JSON, missing
 *       required fields) — a tampered promoted bundle.
 * If either mapped to an OPERATIONAL reason, the broker would fall back to the ordinary un-brokered route
 * and land exactly the write it could not verify — a silent bypass, and a fabricated "operational" line in
 * the ledger the flip decision is argued from.
 *
 * MUST HOLD (conservative-by-construction): both (a) and (b) are SECURITY refusals. NO fallback. The ref
 * NEVER moves. Only the honest ABSENCE of any configured bundle (no path supplied at all) stays operational.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dog = require("../broker-dogfood");
const { brokerReleaseCommit } = require("../broker-release-commit");
const { makeTransportFixture } = require("./_lib/transport-fixtures");

test("FALSIFIER — a configured reason taxonomy: a security reason can NEVER be fallback-eligible", () => {
  for (const r of ["bundle-load-failed", "result-tree-materialize-failed"]) {
    assert.strictEqual(dog.classifyRefusal(r), "security", `${r} must classify SECURITY`);
    assert.strictEqual(dog.fallbackAllowed(r), false, `MUST-BLOCK: ${r} must NOT be fallback-eligible`);
  }
  assert.strictEqual(dog.fallbackAllowed("no-pinned-bundle-configured"), true, "true absence stays operational");
  const missing = dog.resolveBundleConfig({ bundleManifestPath: path.join(os.tmpdir(), `nope-${Date.now()}.json`) });
  assert.strictEqual(missing.ok, false);
  assert.strictEqual(missing.reason, "bundle-load-failed", "MUST-BLOCK: a configured-but-missing bundle maps to the SECURITY reason, not no-pinned-bundle-configured");
  const absent = dog.resolveBundleConfig({});
  assert.strictEqual(absent.reason, "no-pinned-bundle-configured", "a genuinely-unconfigured bundle stays the operational absence reason");
});

test("FALSIFIER MUST-BLOCK — a CONFIGURED-but-MISSING bundle is REFUSED with no fallback; the ref never moves", () => {
  const fx = makeTransportFixture("bundle-missing");
  try {
    const before = fx.head("refs/heads/main");
    fs.writeFileSync(path.join(fx.dir, "MANIFEST.generated.json"), JSON.stringify({ regen: 1 }));
    const res = brokerReleaseCommit(
      { message: "chore: regen", add: ["MANIFEST.generated.json"], target_ref: "refs/heads/main" },
      { gitRoot: fx.dir, spId: fx.spId, leaseRoot: fx.leaseRoot, bundleManifestPath: path.join(fx.dir, "does-not-exist-bundle.json"), emit: false },
      {},
    );
    assert.strictEqual(res.ok, false, "MUST-BLOCK: a configured-but-missing bundle must be refused");
    assert.strictEqual(res.reason, "bundle-load-failed");
    assert.strictEqual(res.classification, "security", "MUST-BLOCK: refused as SECURITY — never operational");
    assert.notStrictEqual(res.decision, "LANDED-BY-FALLBACK", "MUST-BLOCK: no ordinary fallback on a security refusal");
    assert.strictEqual(fx.head("refs/heads/main"), before, "MUST-BLOCK: refs/heads/main must be UNCHANGED");
  } finally {
    fx.cleanup();
  }
});

test("FALSIFIER MUST-BLOCK — a CONFIGURED-but-CORRUPT bundle is REFUSED with no fallback; the ref never moves", () => {
  const fx = makeTransportFixture("bundle-corrupt");
  try {
    const before = fx.head("refs/heads/main");
    fs.writeFileSync(path.join(fx.dir, "MANIFEST.generated.json"), JSON.stringify({ regen: 1 }));
    const corrupt = path.join(fx.dir, "corrupt-bundle-manifest.json");
    fs.writeFileSync(corrupt, "{ this is not valid json ");
    const res = brokerReleaseCommit(
      { message: "chore: regen", add: ["MANIFEST.generated.json"], target_ref: "refs/heads/main" },
      { gitRoot: fx.dir, spId: fx.spId, leaseRoot: fx.leaseRoot, bundleManifestPath: corrupt, bundleRoot: fx.dir, emit: false },
      {},
    );
    assert.strictEqual(res.ok, false, "MUST-BLOCK: a corrupt configured bundle must be refused");
    assert.strictEqual(dog.classifyRefusal(res.reason), "security", `MUST-BLOCK: ${res.reason} must classify SECURITY (no fallback)`);
    assert.notStrictEqual(res.decision, "LANDED-BY-FALLBACK", "MUST-BLOCK: no ordinary fallback on a corrupt bundle");
    assert.strictEqual(fx.head("refs/heads/main"), before, "MUST-BLOCK: refs/heads/main must be UNCHANGED");
  } finally {
    fx.cleanup();
  }
});
