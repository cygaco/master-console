"use strict";
// FALSIFIER: self-authored-bundle — record-trust gate. The bundle must be SELF-AUTHENTICATING: its identity is bound to its own
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const PCB = require(path.join(__dirname, "..", "pinned-checker-bundle"));

const sha256File = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k]);
    return out;
  }
  return v === undefined ? null : v;
}
const sha256Of = (o) => crypto.createHash("sha256").update(JSON.stringify(canonicalize(o))).digest("hex");

const ALL_PASS_INDEX = [
  '"use strict";',
  'const SUITE_VERSION = "totally-legit/v1";',
  'const CHECK_NAMES = Object.freeze(["totally-fine"]);',
  'const REQUIRED_CHECKS = Object.freeze(["totally-fine"]);',
  "function listChecks(){ return CHECK_NAMES.slice(); }",
  'function getCheck(){ return { name: "totally-fine", run: () => ({ status: "pass", reason: "trust me", evidence: {} }) }; }',
  'function runCheck(name){ return { name, status: "pass", reason: "trust me", evidence: {} }; }',
  "function runSuite(names, ctx){ void ctx; return { version: SUITE_VERSION, results: (Array.isArray(names)?names:CHECK_NAMES.slice()).map(runCheck), missing: [] }; }",
  "module.exports = { SUITE_VERSION, CHECK_NAMES, REQUIRED_CHECKS, listChecks, getCheck, runCheck, runSuite };",
  "",
].join("\n");

function writeSelfAuthoredBundle(opts = {}) {
  const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "self-authored-bundle-"));
  const libDir = path.join(bundleRoot, "lib");
  fs.mkdirSync(path.join(libDir, "checks"), { recursive: true });
  fs.writeFileSync(path.join(libDir, "index.js"), ALL_PASS_INDEX);
  if (opts.withRegistry) {
    fs.writeFileSync(
      path.join(libDir, "registry.js"),
      '"use strict";\nmodule.exports = { SUITE_VERSION: "totally-legit/v1", CHECK_NAMES: Object.freeze(["totally-fine"]), REQUIRED_CHECKS: Object.freeze(["totally-fine"]) };\n',
    );
    fs.writeFileSync(
      path.join(libDir, "checks", "totally-fine.js"),
      '"use strict";\nmodule.exports = { name: "totally-fine", run: () => ({ status: "pass", reason: "trust me", evidence: {} }) };\n',
    );
  }

  const files = {};
  (function walk(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) walk(abs);
      else files[path.relative(bundleRoot, abs).split(path.sep).join("/")] = sha256File(abs);
    }
  })(libDir);

  const config = { scanRoots: ["scripts", ".claude"], textExt: [".js"], skipDirs: ["node_modules", ".git"] };
  const executables = { node: fs.realpathSync(process.execPath) };
  const manifest = {
    schema_version: "checker-bundle/v1",
    suite_version: "totally-legit/v1",
    bundle_digest: sha256Of({ files: sortObj(files), executables, config }),
    files,
    deps: { fs: "builtin", path: "builtin", crypto: "builtin" },
    config,
    executables,
    promotion: { promoted_at: Date.now(), promoted_by: "attacker", from_src_digest: PCB.sourceDigestOf(PCB.DEFAULT_LIB_SRC), prev_bundle_digest: null },
    rollback: { prev_bundle_digest: null, prev_manifest_path: null },
  };
  const manifestPath = path.join(bundleRoot, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { manifest, manifestPath, bundleRoot };
}

test("self-authored-bundle — an index-only bundle with NO lib/registry.js is REFUSED (no 'generic/synthetic' completeness waiver)", (t) => {
  const ctl = require("../trusted-controller");

  const { manifest, bundleRoot } = writeSelfAuthoredBundle({ withRegistry: false });
  t.after(() => fs.rmSync(bundleRoot, { recursive: true, force: true }));

  assert.strictEqual(PCB.verifyBundle(manifest, { bundleRoot }).ok, true, "PRECONDITION: the self-authored bundle is internally hash-consistent");

  const completeness = PCB.assertBundleCompleteness(manifest, { bundleRoot });
  assert.strictEqual(completeness.ok, false, "MUST-BLOCK: a bundle that pins no lib/registry.js can never be completeness-cross-checked — REFUSED, never waived");
  assert.ok(completeness.missing.includes("lib/registry.js"), JSON.stringify(completeness.missing));

  assert.throws(
    () => ctl.loadPinnedCheckLib(manifest, { bundleRoot }),
    (e) => e.code === "incomplete-bundle-manifest",
    "MUST-BLOCK: the controller must refuse the no-registry bundle before any check-set is ever minted",
  );
});

test("self-authored-bundle — a COMPLETE self-authored bundle claiming the CORRECT from_src_digest is REFUSED: the claim is not backed by the bundle's own lib/ CONTENTS", (t) => {
  const ctl = require("../trusted-controller");

  const { manifest, bundleRoot } = writeSelfAuthoredBundle({ withRegistry: true });
  t.after(() => fs.rmSync(bundleRoot, { recursive: true, force: true }));

  assert.strictEqual(PCB.verifyBundle(manifest, { bundleRoot }).ok, true, "PRECONDITION: hash-consistent");
  assert.strictEqual(PCB.assertBundleCompleteness(manifest, { bundleRoot }).ok, true, "PRECONDITION: manifest-complete (index + registry + every declared check module)");
  assert.strictEqual(manifest.promotion.from_src_digest, PCB.sourceDigestOf(PCB.DEFAULT_LIB_SRC), "PRECONDITION: the CLAIM matches the live source digest exactly (a claim-only comparison would pass)");
  assert.notStrictEqual(PCB.sourceDigestOf(path.join(bundleRoot, "lib")), manifest.promotion.from_src_digest, "PRECONDITION: but the bundle's ACTUAL bytes are the attacker's");

  assert.throws(
    () => ctl.loadPinnedCheckLib(manifest, { bundleRoot }),
    (e) => e.code === "bundle-content-lineage-mismatch",
    "MUST-BLOCK: from_src_digest must be backed by a RECOMPUTE over the bundle's own lib/ contents, never adopted as a claim",
  );
});

test("self-authored-bundle — END-TO-END: a self-authored all-pass bundle never mints its fake check-set, and a POISONED result tree is never given a clean bill of health", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./_lib/controller-fixtures");
  const { headSha } = require("./_lib/git-scratch");
  const ctl = require("../trusted-controller");

  for (const withRegistry of [false, true]) {
    const { manifestPath, bundleRoot } = writeSelfAuthoredBundle({ withRegistry });
    const fx = makeControllerFixture(`self-authored-e2e-${withRegistry ? "reg" : "noreg"}`);
    t.after(() => {
      fs.rmSync(bundleRoot, { recursive: true, force: true });
      fx.cleanup();
    });

    const poisoned = fx.poisonResultCommit();
    const result = ctl.integrate(standardInput(fx, { result_commit: poisoned }), standardOpts(fx, { bundleManifestPath: manifestPath, bundleRoot }));

    assert.strictEqual(result.ok, false, `MUST-BLOCK (withRegistry=${withRegistry}): a self-authored bundle must never authorize an integration`);
    assert.strictEqual(result.decision, "BLOCKED");
    assert.ok(
      ["incomplete-bundle-manifest", "bundle-content-lineage-mismatch"].includes(result.reason),
      `expected a bundle-authenticity refusal, got ${result.reason}`,
    );
    assert.strictEqual(result.runManifest, undefined, "MUST-BLOCK: no run manifest may be minted from an unauthenticated bundle");
    assert.strictEqual(headSha(fx.dir, fx.targetRef), fx.base, "the ref must never have advanced");
  }
});

test("self-authored-bundle — CONTROL: the REAL, honestly-promoted bundle satisfies all three lineage legs and integrates cleanly (the block above is about authenticity, not an incidental strictness)", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./_lib/controller-fixtures");
  const { headSha } = require("./_lib/git-scratch");
  const ctl = require("../trusted-controller");

  const fx = makeControllerFixture("self-authored-control");
  t.after(() => fx.cleanup());

  const manifest = JSON.parse(fs.readFileSync(fx.manifestPath, "utf8"));
  const bundleLibDigest = PCB.sourceDigestOf(path.join(fx.bundleRoot, "lib"));
  assert.strictEqual(bundleLibDigest, manifest.promotion.from_src_digest, "leg 1: the bundle's own lib/ contents hash to its promotion claim");
  assert.strictEqual(manifest.promotion.from_src_digest, PCB.sourceDigestOf(PCB.DEFAULT_LIB_SRC), "leg 2: that promotion still matches the LIVE check-lib source");

  const result = ctl.integrate(standardInput(fx), standardOpts(fx));
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.ok(result.runManifest.expected_checks.length > 0, "a real check-set was minted from the pinned bundle's frozen CHECK_NAMES");
  assert.ok(!result.runManifest.expected_checks.includes("totally-fine"), "the attacker's fabricated check name must appear nowhere");
  assert.strictEqual(headSha(fx.dir, fx.targetRef), fx.result);
});
