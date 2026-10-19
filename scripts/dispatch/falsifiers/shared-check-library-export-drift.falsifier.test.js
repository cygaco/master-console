"use strict";
// FALSIFIER: shared-check-library-export-drift — record-trust gate. Adversarial: the pinned check-lib snapshot is missing (renamed/typo'd) a REQUIRED export
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const PCB = require(path.join(__dirname, "..", "pinned-checker-bundle"));

function writeDriftedCheckLib(srcRoot) {
  const indexSrc = [
    '"use strict";',
    'const SUITE_VERSION = "drift-suite/v1";',
    'const CHECK_NAMES = Object.freeze(["noop"]);',
    'const REQUIRED_CHECKS = Object.freeze(["noop"]);',
    "function listChecks(){ return CHECK_NAMES.slice(); }",
    "// getCheck INTENTIONALLY RENAMED — simulates an export-drift (rename/typo) regression.",
    'function fetchCheck(name){ if (name !== "noop") throw new Error("unregistered"); return { name: "noop", run: () => ({ status: "pass", reason: "ok", evidence: {} }) }; }',
    'function runCheck(name, ctx){ fetchCheck(name); return { name, status: "pass", reason: "ok", evidence: {} }; }',
    "function runSuite(names, ctx){ return { version: SUITE_VERSION, results: (Array.isArray(names) ? names : CHECK_NAMES.slice()).map((n) => runCheck(n, ctx)), missing: [] }; }",
    "// getCheck is DELIBERATELY OMITTED from this export object.",
    "module.exports = { SUITE_VERSION, CHECK_NAMES, REQUIRED_CHECKS, listChecks, runCheck, runSuite };",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(srcRoot, "index.js"), indexSrc);

  fs.writeFileSync(
    path.join(srcRoot, "registry.js"),
    '"use strict";\nmodule.exports = { SUITE_VERSION: "drift-suite/v1", CHECK_NAMES: Object.freeze(["noop"]), REQUIRED_CHECKS: Object.freeze(["noop"]) };\n',
  );
  fs.mkdirSync(path.join(srcRoot, "checks"), { recursive: true });
  fs.writeFileSync(
    path.join(srcRoot, "checks", "noop.js"),
    '"use strict";\nfunction run(){ return { status: "pass", reason: "ok", evidence: {} }; }\nmodule.exports = { name: "noop", run };\n',
  );
}

test("shared-check-library-export-drift — a renamed/missing required export is CAUGHT, not silently skipped", (t) => {
  const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-drift-src-"));
  const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-drift-bundle-"));
  const candidateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pcb-drift-cand-"));
  t.after(() => {
    for (const d of [srcRoot, bundleRoot, candidateRoot]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
      }
    }
  });
  writeDriftedCheckLib(srcRoot);
  const { manifest } = PCB.buildBundle({ srcRoot, outRoot: bundleRoot, suiteVersion: "drift-suite/v1", promotedBy: "falsifier-test", externalDeps: [] });

  const attack = PCB.runPinnedSuite(manifest, {}, { bundleRoot, candidateRoot });
  assert.strictEqual(attack.ok, false, "MUST-BLOCK: a drifted export contract must refuse the run");
  assert.strictEqual(attack.reason, "check-export-missing");
  assert.ok(Array.isArray(attack.missingExports) && attack.missingExports.includes("getCheck"), "the SPECIFIC drifted/missing export must be named");
  assert.strictEqual(attack.results.length, 0, "a drifted contract must never partially execute — fail-open would be the exact hole this closes");

  const realIndex = require(path.join(__dirname, "..", "check-lib"));
  const realContract = PCB.assertCheckLibExports(realIndex);
  assert.strictEqual(realContract.ok, true, "CONTROL: the real check-lib module must satisfy the export contract");
  assert.deepStrictEqual(realContract.missing, []);
});
