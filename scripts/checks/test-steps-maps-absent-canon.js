#!/usr/bin/env node
/**
 * test-steps-maps-absent-canon.js — W4 RESTRUCTURE regression test.
 *
 * generate-steps-maps.js is FRAMEWORK tooling. After W4 the product canon
 * (STEPS.json + the 3 canonical step-table docs) is relocated out of canonical
 * _requirements/ into the per-product slot — so in MC-canonical the file is
 * ABSENT. The generator (and its --check / CI mode, run by the blocking
 * pre-commit-steps-check.js hook) must NO-OP with exit 0 rather than crash on
 * the missing STEPS.json (the prior unconditional readFileSync threw ENOENT).
 *
 * This pins both halves so the absence-tolerance can't silently regress AND
 * the real generation path still works:
 *
 *   1. absent STEPS.json → bare run exits 0 (no-op, no crash).
 *   2. absent STEPS.json → --check exits 0 (the pre-commit/CI path is clean).
 *   3. present STEPS.json + target docs → round-trips: after a bare regen, a
 *      --check exits 0 (the generator still does its real job, not a blanket
 *      "always 0" stub).
 *   4. present STEPS.json + a HAND-CORRUPTED auto-gen region → --check exits 1
 *      (the drift gate still bites — absence-tolerance didn't defang it).
 *
 * Uses the WARPOS_STEPS_ROOT test seam (cf. WARPOS_PURITY_ROOT) to point the
 * generator's PROJECT root at a throwaway fixture dir.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const SCRIPT = path.join(__dirname, "..", "generate-steps-maps.js");

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${name}`);
    pass++;
  } else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    fail++;
  }
}

// Run generate-steps-maps.js against `root` (via the test seam); return result.
function runGen(root, args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, WARPOS_STEPS_ROOT: root },
  });
}

function mkroot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "steps-maps-"));
  fs.mkdirSync(path.join(dir, "_requirements", "00-canonical"), {
    recursive: true,
  });
  return dir;
}

function rmrf(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

// A minimal but schema-valid product canon for the happy-path cases.
const STEPS_JSON = JSON.stringify(
  {
    version: 1,
    phases: {
      onboarding: { required: true, ordered: true, steps: ["UPLOAD"] },
      dashboard: { required: false, ordered: false, steps: ["DEEP_DIVE"] },
    },
    steps: {
      UPLOAD: {
        position: 1,
        phase: "onboarding",
        component: "Step1Resume",
        component_file: "src/components/steps/Step1Resume.tsx",
        feature: "onboarding",
        requires_data: null,
        produces_data: "resumeRaw",
      },
      DEEP_DIVE: {
        position: 2,
        phase: "dashboard",
        component: "DeepDive",
        component_file: "src/components/steps/DeepDive.tsx",
        feature: "deep-dive",
        requires_data: "resumeRaw",
        produces_data: "analysis",
      },
    },
  },
  null,
  2,
);

// A target doc carrying an (initially empty) auto-gen region. The generator
// fills the region from STEPS.json on a bare run.
function docWithRegion(regionName) {
  const start = `<!-- maps:steps:START (region=${regionName}) --- auto-generated from _requirements/00-canonical/STEPS.json; do not edit manually. Regenerate: /maps:steps or node scripts/generate-steps-maps.js -->`;
  const end = `<!-- maps:steps:END (region=${regionName}) -->`;
  return `# Doc\n\n${start}\n\n(placeholder)\n\n${end}\n`;
}

function writeFullCanon(root) {
  const canon = path.join(root, "_requirements", "00-canonical");
  fs.writeFileSync(path.join(canon, "STEPS.json"), STEPS_JSON);
  fs.writeFileSync(
    path.join(canon, "PRODUCT_MODEL.md"),
    docWithRegion("product-model-onboarding").replace(
      "(placeholder)\n\n<!-- maps:steps:END (region=product-model-onboarding) -->",
      `(placeholder)\n\n<!-- maps:steps:END (region=product-model-onboarding) -->\n\n<!-- maps:steps:START (region=product-model-dashboard) --- auto-generated from _requirements/00-canonical/STEPS.json; do not edit manually. Regenerate: /maps:steps or node scripts/generate-steps-maps.js -->\n\n(placeholder)\n\n<!-- maps:steps:END (region=product-model-dashboard) -->`,
    ),
  );
  fs.writeFileSync(
    path.join(canon, "GLOSSARY.md"),
    docWithRegion("glossary-onboarding").replace(
      "(placeholder)\n\n<!-- maps:steps:END (region=glossary-onboarding) -->",
      `(placeholder)\n\n<!-- maps:steps:END (region=glossary-onboarding) -->\n\n<!-- maps:steps:START (region=glossary-dashboard) --- auto-generated from _requirements/00-canonical/STEPS.json; do not edit manually. Regenerate: /maps:steps or node scripts/generate-steps-maps.js -->\n\n(placeholder)\n\n<!-- maps:steps:END (region=glossary-dashboard) -->`,
    ),
  );
  fs.writeFileSync(
    path.join(canon, "GOLDEN_PATHS.md"),
    docWithRegion("golden-paths-flow"),
  );
}

// ── Case 1 + 2: STEPS.json ABSENT (the W4 canonical state) ─────────────
{
  const root = mkroot(); // 00-canonical dir exists, but NO STEPS.json
  const bare = runGen(root, []);
  ok(
    "1. absent STEPS.json → bare run exits 0 (no-op, no crash)",
    bare.status === 0,
    `exit ${bare.status}; stderr: ${(bare.stderr || "").trim()}`,
  );

  const check = runGen(root, ["--check"]);
  ok(
    "2. absent STEPS.json → --check exits 0 (pre-commit/CI path clean)",
    check.status === 0,
    `exit ${check.status}; stderr: ${(check.stderr || "").trim()}`,
  );

  rmrf(root);
}

// ── Case 3: present canon → real round-trip still works ────────────────
{
  const root = mkroot();
  writeFullCanon(root);

  // Bare regen fills the regions from STEPS.json…
  const regen = runGen(root, []);
  ok(
    "3a. present canon → bare regen exits 0",
    regen.status === 0,
    `exit ${regen.status}; stderr: ${(regen.stderr || "").trim()}`,
  );

  // …and a follow-up --check sees no drift (the generator did real work).
  const check = runGen(root, ["--check"]);
  ok(
    "3b. present canon → --check exits 0 after regen (not a blanket-0 stub)",
    check.status === 0,
    `exit ${check.status}; stderr: ${(check.stderr || "").trim()}`,
  );

  rmrf(root);
}

// ── Case 4: present canon + corrupted region → drift gate still bites ───
{
  const root = mkroot();
  writeFullCanon(root);
  runGen(root, []); // populate regions

  // Hand-corrupt one generated region body so --check must report drift.
  const gp = path.join(root, "_requirements", "00-canonical", "GOLDEN_PATHS.md");
  const body = fs.readFileSync(gp, "utf8");
  const corrupted = body.replace(
    /(<!-- maps:steps:START \(region=golden-paths-flow\)[^>]*-->)[\s\S]*?(<!-- maps:steps:END \(region=golden-paths-flow\) -->)/,
    "$1\n\nHAND-EDITED GARBAGE THAT DIFFERS FROM STEPS.json\n\n$2",
  );
  ok(
    "4a. corruption actually changed the region (test sanity)",
    corrupted !== body,
    "regex did not match the region",
  );
  fs.writeFileSync(gp, corrupted);

  const check = runGen(root, ["--check"]);
  ok(
    "4b. present canon + corrupted region → --check exits 1 (drift gate bites)",
    check.status === 1,
    `exit ${check.status}; stdout: ${(check.stdout || "").trim()}`,
  );

  rmrf(root);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
