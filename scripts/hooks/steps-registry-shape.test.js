"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const HOOKS = __dirname;
const STEPS_REL = "_requirements/00-canonical/STEPS.json";

const ARRAY_OK = {
  version: 1,
  phases: [{ id: "plan", ordered: true }, { id: "ship" }],
  steps: [
    { id: "DRAFT", phase: "plan", position: 1, component: "DraftView", feature: "plan" },
    { id: "SEND", phase: "ship", position: 2, component: "SendJob", feature: "ship" },
  ],
};
const ARRAY_EMPTY = { version: 1, phases: [], steps: [] };
const ARRAY_STRING_PHASES = {
  version: 1,
  phases: ["plan"],
  steps: [{ id: "DRAFT", phase: "plan", position: 1, component: "DraftView", feature: "plan" }],
};
const ARRAY_LISTED = {
  version: 1,
  phases: [{ id: "plan", steps: ["DRAFT"] }],
  steps: [{ id: "DRAFT", phase: "plan", position: 1, component: "DraftView", feature: "plan" }],
};
const ARRAY_BAD_PHASE = {
  version: 1,
  phases: [{ id: "plan" }],
  steps: [{ id: "DRAFT", phase: "nope", position: 1, component: "DraftView", feature: "plan" }],
};
const ARRAY_DUP_STEP = {
  version: 1,
  phases: [{ id: "plan" }],
  steps: [
    { id: "DRAFT", phase: "plan", position: 1, component: "A", feature: "plan" },
    { id: "DRAFT", phase: "plan", position: 2, component: "B", feature: "plan" },
  ],
};
const ARRAY_NO_ID = {
  version: 1,
  phases: [{ id: "plan" }],
  steps: [{ phase: "plan", position: 1, component: "A", feature: "plan" }],
};
const OBJECT_OK = {
  version: 1,
  phases: { plan: { steps: ["DRAFT"] } },
  steps: { DRAFT: { phase: "plan", position: 1, component: "DraftView", feature: "plan" } },
};
const OBJECT_UNLISTED = {
  version: 1,
  phases: { plan: { steps: [] } },
  steps: { DRAFT: { phase: "plan", position: 1, component: "DraftView", feature: "plan" } },
};

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "steps-shape-"));
}

function guardBlocks(doc) {
  const root = tmpRoot();
  try {
    const event = {
      tool_name: "Write",
      tool_input: { file_path: path.join(root, ...STEPS_REL.split("/")), content: JSON.stringify(doc, null, 2) },
    };
    const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
    delete env.STEP_REGISTRY_GUARD_STRICT;
    const r = spawnSync(process.execPath, [path.join(HOOKS, "step-registry-guard.js")], {
      input: JSON.stringify(event), encoding: "utf8", cwd: root, env,
    });
    assert.strictEqual(r.status, 0, r.stderr);
    return { blocked: /"decision":"block"/.test(r.stdout), stderr: r.stderr };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function precommit(doc) {
  const root = tmpRoot();
  try {
    const git = (...a) => spawnSync("git", a, { cwd: root, encoding: "utf8" });
    git("init", "-q");
    fs.mkdirSync(path.join(root, "scripts", "hooks"), { recursive: true });
    fs.copyFileSync(path.join(HOOKS, "pre-commit-steps-check.js"), path.join(root, "scripts", "hooks", "pre-commit-steps-check.js"));
    fs.mkdirSync(path.join(root, "_requirements", "00-canonical"), { recursive: true });
    fs.writeFileSync(path.join(root, ...STEPS_REL.split("/")), JSON.stringify(doc, null, 2));
    const add = git("add", STEPS_REL);
    assert.strictEqual(add.status, 0, add.stderr);
    const r = spawnSync(process.execPath, [path.join(root, "scripts", "hooks", "pre-commit-steps-check.js")], { cwd: root, encoding: "utf8" });
    return { status: r.status, stderr: r.stderr };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

for (const [name, doc] of [
  ["array shape (canon-engine) with object phases", ARRAY_OK],
  ["array shape with no phases or steps", ARRAY_EMPTY],
  ["array shape with string phases", ARRAY_STRING_PHASES],
  ["array shape with a phase steps[] listing", ARRAY_LISTED],
  ["object shape", OBJECT_OK],
]) {
  test(`step-registry-guard accepts a valid ${name}`, () => {
    const r = guardBlocks(doc);
    assert.strictEqual(r.blocked, false, r.stderr);
  });
  test(`pre-commit-steps-check accepts a valid ${name}`, () => {
    const r = precommit(doc);
    assert.strictEqual(r.status, 0, r.stderr);
  });
}

function guardBlocksSource(rel, content) {
  const root = tmpRoot();
  try {
    const event = { tool_name: "Write", tool_input: { file_path: path.join(root, ...rel.split("/")), content } };
    const env = { ...process.env, CLAUDE_PROJECT_DIR: root };
    delete env.STEP_REGISTRY_GUARD_STRICT;
    const r = spawnSync(process.execPath, [path.join(HOOKS, "step-registry-guard.js")], {
      input: JSON.stringify(event), encoding: "utf8", cwd: root, env,
    });
    assert.strictEqual(r.status, 0, r.stderr);
    return { blocked: /"decision":"block"/.test(r.stdout), stderr: r.stderr };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("step-registry-guard blocks a hardcoded integer step in src/app/page.tsx (no file is a known-violation exemption by default)", () => {
  const r = guardBlocksSource("src/app/page.tsx", "if (currentStep === 5) { setCurrentStep(2); }\n");
  assert.strictEqual(r.blocked, true, r.stderr);
  assert.match(r.stderr, /hardcoded integer step reference\(s\) in src\/app\/page\.tsx/);
});

for (const [name, doc, finding] of [
  ["array-shape step naming an undeclared phase", ARRAY_BAD_PHASE, /step "DRAFT" has unknown or missing phase "nope"/],
  ["array-shape duplicate step id", ARRAY_DUP_STEP, /duplicate step id "DRAFT"/],
  ["array-shape step with no id", ARRAY_NO_ID, /steps\[0\] has no id/],
  ["object-shape step missing from its phase's steps[]", OBJECT_UNLISTED, /not listed in phases\.plan\.steps/],
]) {
  test(`step-registry-guard blocks an ${name}`, () => {
    const r = guardBlocks(doc);
    assert.strictEqual(r.blocked, true, r.stderr);
    assert.match(r.stderr, finding);
  });
  test(`pre-commit-steps-check blocks an ${name}`, () => {
    const r = precommit(doc);
    assert.strictEqual(r.status, 1, r.stderr);
    assert.match(r.stderr, finding);
  });
}
