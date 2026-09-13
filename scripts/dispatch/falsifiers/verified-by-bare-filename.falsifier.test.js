"use strict";
// FALSIFIER: verified-by-bare-filename — record-trust gate FIX-6 class-closer, COMPLETED (SP-20260720-002
// Phase 4 R2, S5 / QA-SP002-006 + QA-SP002-R2-002).
//
// R1's `extractVerifiedByFilePaths` deliberately SKIPPED bare filenames ("too ambiguous"), so a dangling
// BARE `verified_by:` (e.g. `missing-bare-proof.test.js`, no directory component) produced
// `extracted_paths: []` and `evaluate_ok: true` — `class_closer_enforced: false`. The 10 real, fully-
// qualified declarations happened to resolve, which is exactly what makes an incomplete class-closer
// dangerous: it is GREEN on today's corpus while the class stays open. A class-closer that covers only the
// convenient form closes nothing.
//
// MUST-BLOCK: a bare, unresolvable verified_by declaration. CONTROL: a bare declaration that DOES resolve to
// a real repo file passes — so the gate is discriminating, not merely strict.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function scratchManifest(dir) {
  const manifestPath = path.join(dir, "record-trust-gate.manifest.json");
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ schema: "mc/record-trust-gate/v1", trust_anchor_forbidden_for_cross_session: [], surfaces: [] }, null, 2),
  );
  return manifestPath;
}

test("S5 verified-by-bare-filename — a BARE, dangling verified_by (no directory component) FAILS the gate (R1 passed it)", (t) => {
  const rtg = require("../../checks/record-trust-gate");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtg-bare-dangling-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const manifestPath = scratchManifest(dir);
  fs.writeFileSync(
    path.join(dir, "prd.md"),
    "- **AC-BARE — a fixture AC whose proof is declared as a BARE filename:**\n" +
      "  `verified_by:` `node --test missing-bare-proof.test.js`\n\n",
  );

  // The extractor must SEE it (R1 returned nothing at all here).
  const refs = rtg.extractVerifiedByRefs(fs.readFileSync(path.join(dir, "prd.md"), "utf8"));
  assert.deepStrictEqual(refs.paths, [], "no fully-qualified path is declared");
  assert.ok(refs.bare.includes("missing-bare-proof.test.js"), `the BARE form must be extracted, got ${JSON.stringify(refs)}`);

  const res = rtg.evaluate(rtg.loadManifest(manifestPath).manifest, { manifestPath, root: REPO_ROOT });
  assert.strictEqual(res.ok, false, "MUST-BLOCK: a bare verified_by that resolves to no file anywhere is the SAME dangling-claim class");
  assert.ok(
    res.violations.some((v) => /verified_by dangling reference/.test(v) && /missing-bare-proof\.test\.js/.test(v)),
    `expected a dangling-reference violation naming the bare file; got ${JSON.stringify(res.violations)}`,
  );
  assert.strictEqual(res.class_closer_enforced, true, "class_closer_enforced must be TRUE for all verified_by forms");
});

test("S5 verified-by-bare-filename — CONTROL: a BARE verified_by that DOES resolve to a real repo file passes (discriminating, not blanket-strict)", (t) => {
  const rtg = require("../../checks/record-trust-gate");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtg-bare-clean-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const manifestPath = scratchManifest(dir);
  // This very falsifier, named BARE — it exists under scripts/, so basename resolution must find it.
  fs.writeFileSync(
    path.join(dir, "prd.md"),
    "- **AC-BARE-CLEAN:**\n  `verified_by:` `node --test verified-by-bare-filename.falsifier.test.js`\n\n",
  );

  const vb = rtg.checkVerifiedByPaths(REPO_ROOT, path.join(dir, "prd.md"));
  assert.strictEqual(vb.bareChecked, 1, JSON.stringify(vb));
  assert.deepStrictEqual(vb.bareUnresolved, [], "a bare name backed by a real file must resolve");
  assert.strictEqual(vb.ok, true, JSON.stringify(vb));
  assert.strictEqual(vb.class_closer_enforced, true);

  const res = rtg.evaluate(rtg.loadManifest(manifestPath).manifest, { manifestPath, root: REPO_ROOT });
  assert.strictEqual(res.ok, true, JSON.stringify(res.violations));
});

test("S5 verified-by-bare-filename — MIXED forms in one prd: the qualified-dangling AND the bare-dangling are BOTH reported", (t) => {
  const rtg = require("../../checks/record-trust-gate");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtg-bare-mixed-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const manifestPath = scratchManifest(dir);
  fs.writeFileSync(
    path.join(dir, "prd.md"),
    "- **AC-ONE:**\n  `verified_by:` `node --test scripts/dispatch/no-such-qualified-file.test.js`\n\n" +
      "- **AC-TWO:**\n  `verified_by:` `node --test no-such-bare-file.test.js`\n\n",
  );

  const res = rtg.evaluate(rtg.loadManifest(manifestPath).manifest, { manifestPath, root: REPO_ROOT });
  assert.strictEqual(res.ok, false);
  assert.ok(res.violations.some((v) => /no-such-qualified-file\.test\.js/.test(v)), "the qualified dangling ref must be reported");
  assert.ok(res.violations.some((v) => /no-such-bare-file\.test\.js/.test(v)), "the bare dangling ref must be reported — MUST-BLOCK");
});

test("S5 verified-by-bare-filename — a bare name that is merely the BASENAME of an already-declared qualified path is not double-reported", (t) => {
  const rtg = require("../../checks/record-trust-gate");
  const refs = rtg.extractVerifiedByRefs(
    "- **AC-X:**\n  `verified_by:` `node --test scripts/dispatch/falsifiers/verified-by-bare-filename.falsifier.test.js`\n\n",
  );
  assert.deepStrictEqual(refs.paths, ["scripts/dispatch/falsifiers/verified-by-bare-filename.falsifier.test.js"]);
  assert.deepStrictEqual(refs.bare, [], "the trailing segment of a qualified path must never be re-counted as a bare ref");
});
