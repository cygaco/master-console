"use strict";
// FALSIFIER: checker-self-modification — record-trust gate.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const PCB = require(path.join(__dirname, "..", "pinned-checker-bundle"));

function writeSyntheticCheckLib(srcRoot) {
  fs.mkdirSync(path.join(srcRoot, "checks"), { recursive: true });
  const indexSrc = [
    '"use strict";',
    'const SUITE_VERSION = "synthetic-mutator-suite/v1";',
    'const CHECK_NAMES = Object.freeze(["mutator"]);',
    'const REQUIRED_CHECKS = Object.freeze(["mutator"]);',
    'const REGISTRY = { mutator: require("./checks/mutator") };',
    "function listChecks(){ return CHECK_NAMES.slice(); }",
    'function getCheck(name){ const m = REGISTRY[name]; if(!m) throw new Error("unregistered:"+name); return m; }',
    "function runCheck(name, ctx){",
    "  const c = getCheck(name);",
    "  let raw;",
    '  try { raw = c.run(ctx); } catch (e) { raw = { status: "fail", reason: "check-threw", evidence: { error: String((e && e.message) || e) } }; }',
    '  return { name, status: raw.status, reason: raw.reason || "", evidence: raw.evidence || {} };',
    "}",
    "function runSuite(names, ctx){",
    "  const list = Array.isArray(names) ? names : CHECK_NAMES.slice();",
    "  const results = []; const missing = [];",
    "  for (const n of list) { try { getCheck(n); } catch { missing.push(n); continue; } results.push(runCheck(n, ctx)); }",
    "  return { version: SUITE_VERSION, results, missing };",
    "}",
    "module.exports = { SUITE_VERSION, CHECK_NAMES, REQUIRED_CHECKS, listChecks, getCheck, runCheck, runSuite };",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(srcRoot, "index.js"), indexSrc);

  const mutatorSrc = [
    '"use strict";',
    'const fs = require("fs");',
    "function run(ctx) {",
    "  if (ctx && ctx.mutateSelf) {",
    '    try { fs.appendFileSync(__filename, "\\n// mutated-mid-run\\n"); } catch { /* best-effort */ }',
    "  }",
    '  return { status: "pass", reason: "mutator-ran", evidence: {} };',
    "}",
    'module.exports = { name: "mutator", run };',
    "",
  ].join("\n");
  fs.writeFileSync(path.join(srcRoot, "checks", "mutator.js"), mutatorSrc);

  fs.writeFileSync(
    path.join(srcRoot, "registry.js"),
    '"use strict";\nmodule.exports = { SUITE_VERSION: "synthetic-mutator-suite/v1", CHECK_NAMES: Object.freeze(["mutator"]), REQUIRED_CHECKS: Object.freeze(["mutator"]) };\n',
  );
}

test("checker-self-modification — a checker mutating its own pinned file mid-run is detected and BLOCKS", (t) => {
  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-selfmod-src-"));
  const candidateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-selfmod-cand-"));
  const bundleRootAttack = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-selfmod-bundle-a-"));
  const bundleRootControl = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-selfmod-bundle-c-"));
  t.after(() => {
    for (const d of [srcRoot, candidateRoot, bundleRootAttack, bundleRootControl]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
      }
    }
  });
  writeSyntheticCheckLib(srcRoot);

  const attackBuild = PCB.buildBundle({
    srcRoot,
    outRoot: bundleRootAttack,
    suiteVersion: "synthetic-mutator-suite/v1",
    promotedBy: "falsifier-test",
    externalDeps: [],
  });
  const attack = PCB.runPinnedSuite(attackBuild.manifest, { mutateSelf: true }, { bundleRoot: bundleRootAttack, candidateRoot });
  assert.strictEqual(attack.ok, false, "MUST-BLOCK: a checker that mutates its own pinned file mid-run must fail-closed");
  assert.strictEqual(attack.reason, "checker-mutated-mid-run");
  assert.ok(typeof attack.preDigest === "string" && attack.preDigest.length > 0, "preDigest must have been computed");
  assert.ok(typeof attack.postDigest === "string" && attack.postDigest.length > 0, "postDigest must have been computed");
  assert.notStrictEqual(attack.preDigest, attack.postDigest, "preDigest and postDigest must differ — the mutation must actually be detected, not assumed");
  assert.ok(attack.results.length > 0, "the check DID run (the mutation happens mid-run, not pre-execution) — this differs from bundle-hash-mismatch's BEFORE-execute block");

  const controlBuild = PCB.buildBundle({
    srcRoot,
    outRoot: bundleRootControl,
    suiteVersion: "synthetic-mutator-suite/v1",
    promotedBy: "falsifier-test",
    externalDeps: [],
  });
  const control = PCB.runPinnedSuite(controlBuild.manifest, { mutateSelf: false }, { bundleRoot: bundleRootControl, candidateRoot });
  assert.strictEqual(control.ok, true, "CONTROL: a stable (non-mutating) checker run must succeed");
  assert.strictEqual(control.preDigest, control.postDigest, "CONTROL: pre/post digests must be EQUAL when nothing mutated");
});
