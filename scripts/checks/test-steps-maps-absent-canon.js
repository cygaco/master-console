#!/usr/bin/env node

"use strict";
const mcEnv = require("../hooks/lib/mc-env");

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

function runGen(root, args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...mcEnv.envPair("STEPS_ROOT", root) },
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
  }
}

const STEPS_JSON = JSON.stringify(
  {
    version: 1,
    phases: {
      onboarding: { required: true, ordered: true, steps: ["INTAKE"] },
      dashboard: { required: false, ordered: false, steps: ["REVIEW_STEP"] },
    },
    steps: {
      INTAKE: {
        position: 1,
        phase: "onboarding",
        component: "StepIntake",
        component_file: "src/flow/StepIntake.tsx",
        feature: "onboarding",
        requires_data: null,
        produces_data: "intakeRaw",
      },
      REVIEW_STEP: {
        position: 2,
        phase: "dashboard",
        component: "StepReview",
        component_file: "src/flow/StepReview.tsx",
        feature: "review-feature",
        requires_data: "intakeRaw",
        produces_data: "analysis",
      },
    },
  },
  null,
  2,
);

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

{
  const root = mkroot();
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

{
  const root = mkroot();
  writeFullCanon(root);

  const regen = runGen(root, []);
  ok(
    "3a. present canon → bare regen exits 0",
    regen.status === 0,
    `exit ${regen.status}; stderr: ${(regen.stderr || "").trim()}`,
  );

  const check = runGen(root, ["--check"]);
  ok(
    "3b. present canon → --check exits 0 after regen (not a blanket-0 stub)",
    check.status === 0,
    `exit ${check.status}; stderr: ${(check.stderr || "").trim()}`,
  );

  rmrf(root);
}

{
  const root = mkroot();
  writeFullCanon(root);
  runGen(root, []);

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

const REPO = path.join(__dirname, "..", "..");
const CANON_DIR = ["_requirements", "00-canonical"];

function startMarker(regionName) {
  return `<!-- maps:steps:START (region=${regionName}) --- auto-generated from _requirements/00-canonical/STEPS.json; do not edit manually. Regenerate: /maps:steps or node scripts/generate-steps-maps.js -->`;
}
function endMarker(regionName) {
  return `<!-- maps:steps:END (region=${regionName}) -->`;
}
function docWithRegions(regionNames) {
  const blocks = regionNames.map(
    (n) => `${startMarker(n)}\n\n(placeholder)\n\n${endMarker(n)}`,
  );
  return `# Doc\n\n${blocks.join("\n\n")}\n`;
}
function regionBody(body, regionName) {
  const re = new RegExp(
    `<!-- maps:steps:START \\(region=${regionName}\\)[^>]*-->([\\s\\S]*?)<!-- maps:steps:END \\(region=${regionName}\\) -->`,
  );
  const m = body.match(re);
  return m ? m[1] : null;
}
function writeCanon(root, stepsBody, phaseSlugs) {
  const canon = path.join(root, ...CANON_DIR);
  fs.writeFileSync(path.join(canon, "STEPS.json"), stepsBody);
  fs.writeFileSync(
    path.join(canon, "PRODUCT_MODEL.md"),
    docWithRegions(phaseSlugs.map((p) => `product-model-${p}`)),
  );
  fs.writeFileSync(
    path.join(canon, "GLOSSARY.md"),
    docWithRegions(phaseSlugs.map((p) => `glossary-${p}`)),
  );
  fs.writeFileSync(
    path.join(canon, "GOLDEN_PATHS.md"),
    docWithRegions(["golden-paths-flow"]),
  );
}
function readCanon(root, name) {
  return fs.readFileSync(path.join(root, ...CANON_DIR, name), "utf8");
}
const IMPOSED_MODEL_RE = /dashboard|onboarding|score|unlock|point/i;

{
  const root = mkroot();
  const steps = JSON.stringify(
    {
      version: 1,
      phases: {
        intake: { required: true, ordered: true, steps: ["COLLECT", "CONFIRM"] },
        review: {
          required: false,
          ordered: false,
          description: "Checks a reviewer runs.",
          steps: ["AUDIT"],
        },
        archive: { steps: ["STORE"] },
      },
      steps: {
        COLLECT: { position: 1, phase: "intake", component: "CollectForm", feature: "intake", produces_data: "raw" },
        CONFIRM: { position: 2, phase: "intake", component: "ConfirmForm", feature: "intake", requires_data: "raw" },
        AUDIT: { position: 3, phase: "review", component: "AuditPanel", feature: "audit" },
        STORE: { position: 4, phase: "archive", component: "StoreJob", feature: "archive" },
      },
    },
    null,
    2,
  );
  writeCanon(root, steps, ["intake", "review", "archive"]);

  const regen = runGen(root, []);
  ok(
    "5a. declared phases intake/review/archive → bare regen exits 0",
    regen.status === 0,
    `exit ${regen.status}; stderr: ${(regen.stderr || "").trim()}`,
  );

  const pm = readCanon(root, "PRODUCT_MODEL.md");
  const gl = readCanon(root, "GLOSSARY.md");
  const gp = readCanon(root, "GOLDEN_PATHS.md");
  const want = { intake: ["COLLECT", "CONFIRM"], review: ["AUDIT"], archive: ["STORE"] };
  const perPhaseOk = Object.entries(want).every(([ph, ids]) => {
    const a = regionBody(pm, `product-model-${ph}`) || "";
    const b = regionBody(gl, `glossary-${ph}`) || "";
    return ids.every((id) => a.includes(`| ${id} |`) && b.includes(`| ${id} |`));
  });
  ok(
    "5b. each declared phase's product-model + glossary region lists that phase's steps",
    perPhaseOk,
    `PRODUCT_MODEL:\n${pm}\nGLOSSARY:\n${gl}`,
  );

  const flow = regionBody(gp, "golden-paths-flow") || "";
  const iIn = flow.indexOf("Intake phase");
  const iRe = flow.indexOf("Review phase");
  const iAr = flow.indexOf("Archive phase");
  ok(
    "5c. golden-paths-flow renders every declared phase, in declaration order",
    iIn >= 0 && iIn < iRe && iRe < iAr && flow.includes("COLLECT → CONFIRM") && flow.includes("{AUDIT}"),
    `flow:\n${flow}`,
  );

  ok(
    "5d. the per-phase description from STEPS.json is rendered",
    (regionBody(pm, "product-model-review") || "").includes("Checks a reviewer runs."),
    `PRODUCT_MODEL:\n${pm}`,
  );

  const generated = [
    ...["intake", "review", "archive"].map((p) => regionBody(pm, `product-model-${p}`) || ""),
    ...["intake", "review", "archive"].map((p) => regionBody(gl, `glossary-${p}`) || ""),
    flow,
  ].join("\n");
  ok(
    "5e. generated regions carry no onboarding/dashboard/score wording the product did not declare",
    !IMPOSED_MODEL_RE.test(generated),
    `matched: ${(generated.match(IMPOSED_MODEL_RE) || [""])[0]}`,
  );

  const check = runGen(root, ["--check"]);
  ok(
    "5f. declared phases → --check exits 0 after regen",
    check.status === 0,
    `exit ${check.status}; stderr: ${(check.stderr || "").trim()}`,
  );

  rmrf(root);
}

{
  const root = mkroot();
  const steps = JSON.stringify({
    version: 1,
    phases: [{ id: "plan", ordered: true }, { id: "ship" }],
    steps: [
      { id: "DRAFT", phase: "plan", position: 1, component: "DraftView", feature: "plan" },
      { id: "SEND", phase: "ship", position: 2, component: "SendJob", feature: "ship" },
    ],
  });
  writeCanon(root, steps, ["plan", "ship"]);
  const regen = runGen(root, []);
  const pm = readCanon(root, "PRODUCT_MODEL.md");
  ok(
    "6. array-shaped phases/steps → one region per phase, filled from steps[].phase",
    regen.status === 0 &&
      (regionBody(pm, "product-model-plan") || "").includes("| DRAFT |") &&
      (regionBody(pm, "product-model-ship") || "").includes("| SEND |"),
    `exit ${regen.status}; stderr: ${(regen.stderr || "").trim()}\n${pm}`,
  );
  rmrf(root);
}

{
  const root = mkroot();
  const tmplDir = path.join(REPO, "_mc", "templates", "canonical");
  const stepsBody = fs
    .readFileSync(path.join(tmplDir, "STEPS.json.tmpl"), "utf8")
    .replace("{{phases}}", "[]")
    .replace("{{steps}}", "[]");
  let parses = true;
  try {
    JSON.parse(stepsBody);
  } catch {
    parses = false;
  }
  ok("7a. STEPS.json.tmpl rendered with the canon-engine defaults is valid JSON", parses);
  const canon = path.join(root, ...CANON_DIR);
  fs.writeFileSync(path.join(canon, "STEPS.json"), stepsBody);
  for (const name of ["PRODUCT_MODEL", "GLOSSARY", "GOLDEN_PATHS"]) {
    fs.copyFileSync(path.join(tmplDir, `${name}.md.tmpl`), path.join(canon, `${name}.md`));
  }
  const before = readCanon(root, "GOLDEN_PATHS.md");
  const bare = runGen(root, []);
  const check = runGen(root, ["--check"]);
  ok(
    "7b. template default (no phases declared) → bare + --check exit 0, docs untouched",
    bare.status === 0 && check.status === 0 && readCanon(root, "GOLDEN_PATHS.md") === before,
    `bare ${bare.status} / check ${check.status}; stderr: ${(bare.stderr || "").trim()} ${(check.stderr || "").trim()}`,
  );
  rmrf(root);
}

{
  const root = mkroot();
  const seed = path.join(REPO, "_mc", "BASELINE", ...CANON_DIR);
  for (const name of ["STEPS.json", "PRODUCT_MODEL.md", "GLOSSARY.md", "GOLDEN_PATHS.md"]) {
    fs.copyFileSync(path.join(seed, name), path.join(root, ...CANON_DIR, name));
  }
  const check = runGen(root, ["--check"]);
  ok(
    "8. _mc/BASELINE seeded canon → --check exits 0 (its regions match the generator)",
    check.status === 0,
    `exit ${check.status}; stderr: ${(check.stderr || "").trim()}`,
  );
  rmrf(root);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
