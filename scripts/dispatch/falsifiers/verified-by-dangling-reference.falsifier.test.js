"use strict";
// FALSIFIER: verified-by-dangling-reference — record-trust gate FIX-6 class-closer (SP-20260720-002 Phase 4
// R1; ED-056/G0.1 claims-vs-disk false-green class). A prd.md that DECLARES a `verified_by:` file which does
// NOT exist on disk must FAIL the record-trust-gate — never silently pass. This proves the enforcer
// self-detects a dangling claim, not just that today's (currently-clean) corpus happens to pass. MUST-BLOCK.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const RECORD_TRUST_GATE = path.join(__dirname, "..", "..", "checks", "record-trust-gate.js");

test("FIX-6 class-closer verified-by-dangling-reference — a scratch prd.md naming a NONEXISTENT verified_by file FAILS record-trust-gate's evaluate()", () => {
  const rtg = require("../../checks/record-trust-gate");

  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "rtg-verifiedby-scratch-"));
  try {
    const manifestPath = path.join(scratchDir, "record-trust-gate.manifest.json");
    const manifest = {
      schema: "mc/record-trust-gate/v1",
      trust_anchor_forbidden_for_cross_session: [],
      surfaces: [
        {
          id: "S-scratch",
          choke_point: "scripts/dispatch/trusted-controller.js#integrate",
          structural_guard: "scripts/dispatch/trusted-controller.js",
          scope: "same-session",
          trust_anchor: "n/a",
          falsifier_fixtures: [],
          positive_companions: [],
        },
      ],
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // A prd.md right beside the manifest, declaring a verified_by pointer to a file that was NEVER created.
    const prdPath = path.join(scratchDir, "prd.md");
    fs.writeFileSync(
      prdPath,
      "- **AC-SCRATCH — a fixture AC:**\n" +
        "  `verified_by:` `node --test scripts/dispatch/this-file-does-not-exist-anywhere.test.js`\n\n",
    );

    const loaded = rtg.loadManifest(manifestPath);
    assert.strictEqual(loaded.ok, true);
    const res = rtg.evaluate(loaded.manifest, { manifestPath });

    assert.strictEqual(res.ok, false, "MUST-BLOCK: a dangling verified_by reference must fail the gate");
    assert.ok(
      res.violations.some((v) => /verified_by dangling reference/.test(v) && /this-file-does-not-exist-anywhere\.test\.js/.test(v)),
      `expected a dangling-reference violation naming the missing file; got: ${JSON.stringify(res.violations)}`,
    );
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
});

test("FIX-6 class-closer verified-by-dangling-reference — CONTROL: a prd.md whose verified_by file DOES exist does not trip the check", () => {
  const rtg = require("../../checks/record-trust-gate");

  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "rtg-verifiedby-clean-"));
  try {
    const manifestPath = path.join(scratchDir, "record-trust-gate.manifest.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ schema: "mc/record-trust-gate/v1", trust_anchor_forbidden_for_cross_session: [], surfaces: [] }, null, 2),
    );
    const prdPath = path.join(scratchDir, "prd.md");
    // Names a REAL file (this very falsifier), so the extracted path resolves relative to the REPO ROOT
    // (checkVerifiedByPaths resolves against `opts.root`, which the test drives explicitly below).
    fs.writeFileSync(
      prdPath,
      "- **AC-SCRATCH-CLEAN:**\n" +
        "  `verified_by:` `node --test scripts/dispatch/falsifiers/verified-by-dangling-reference.falsifier.test.js`\n\n",
    );

    const root = path.resolve(__dirname, "..", "..", ".."); // repo root
    const vb = rtg.checkVerifiedByPaths(root, prdPath);
    assert.strictEqual(vb.ok, true, JSON.stringify(vb));
    assert.strictEqual(vb.checked, 1);
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
});

test("FIX-6 class-closer verified-by-dangling-reference — a manifest with NO sibling prd.md is unaffected (checked:0, never a violation)", () => {
  const rtg = require("../../checks/record-trust-gate");
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "rtg-verifiedby-noprd-"));
  try {
    const manifestPath = path.join(scratchDir, "record-trust-gate.manifest.json");
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ schema: "mc/record-trust-gate/v1", trust_anchor_forbidden_for_cross_session: [], surfaces: [] }, null, 2),
    );
    const loaded = rtg.loadManifest(manifestPath);
    const res = rtg.evaluate(loaded.manifest, { manifestPath });
    assert.strictEqual(res.ok, true, JSON.stringify(res.violations));
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
});
