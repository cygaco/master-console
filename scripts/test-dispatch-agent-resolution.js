#!/usr/bin/env node
/**
 * test-dispatch-agent-resolution.js — verify ADR-0007 department-tree spec
 * resolution in scripts/dispatch-agent.js. Imports findAgentSpec directly.
 *
 * Post-cutover the agent system is ONE mode-agnostic department tree
 * (president/ + engineering/<pod>/ + product/quality/ + growth/ + _system/), so
 * resolution is no longer mode-branched. The pod specs are named by FILE-stem at
 * the pod level (engineering/security/reviewer.md whose frontmatter is
 * `name: security-reviewer`), so resolution must consult frontmatter `name:`,
 * not just the file stem.
 */

"use strict";
const mcEnv = require("./hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const fs = require("fs");
const os = require("os");
const path = require("path");

const projectDir = path.resolve(__dirname, "..");
process.env.CLAUDE_PROJECT_DIR = projectDir;

const dispatch = require(path.join(projectDir, "scripts", "dispatch-agent.js"));

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(`${name}: ${detail || "false"}`);
  }
}

// The faces resolve under president/ regardless of mode.
for (const face of ["alpha", "beta", "gamma", "delta", "epsilon"]) {
  const spec = dispatch.findAgentSpec(face);
  check(
    `${face} resolves under president/`,
    spec && spec.includes(path.join("president", `${face}.md`)),
    spec,
  );
}

// Pod workers resolve under engineering/<pod>/ by FRONTMATTER name (the file
// stem is builder/reviewer/fixer at the pod level — the stem alone would miss
// the canonical name, which is the bug the DFS-by-name fix closes).
const podCases = [
  ["frontend-builder", path.join("engineering", "frontend", "builder.md")],
  ["backend-builder", path.join("engineering", "backend", "builder.md")],
  ["security-builder", path.join("engineering", "security", "builder.md")],
  ["frontend-reviewer", path.join("engineering", "frontend", "reviewer.md")],
  ["backend-reviewer", path.join("engineering", "backend", "reviewer.md")],
  ["security-reviewer", path.join("engineering", "security", "reviewer.md")],
  ["frontend-fixer", path.join("engineering", "frontend", "fixer.md")],
  ["security-fixer", path.join("engineering", "security", "fixer.md")],
];
for (const [role, expectedTail] of podCases) {
  const spec = dispatch.findAgentSpec(role);
  check(
    `${role} resolves to ${expectedTail} (by frontmatter name)`,
    spec && spec.includes(expectedTail),
    spec,
  );
}

// Quality + system roles.
const otherCases = [
  ["qa-reviewer", path.join("product", "quality", "qa-reviewer.md")],
  ["design-quality", path.join("product", "quality", "design-quality.md")],
  ["visual-review", path.join("product", "quality", "visual-review.md")],
  ["test-runner", path.join("product", "quality", "test-runner.md")],
  // S-7 (PLAN §9.4): learner→ops-analyst re-homed _system→president;
  // stub-scaffold→skeleton-builder re-homed _system→engineering; cabinet new in president.
  ["ops-analyst", path.join("president", "ops-analyst.md")],
  ["skeleton-builder", path.join("engineering", "skeleton-builder.md")],
  ["cabinet", path.join("president", "cabinet.md")],
  ["design-lead", path.join("product", "design-lead.md")],
];
for (const [role, expectedTail] of otherCases) {
  const spec = dispatch.findAgentSpec(role);
  check(
    `${role} resolves to ${expectedTail}`,
    spec && spec.includes(expectedTail),
    spec,
  );
}

// Unknown role → null
const unknown = dispatch.findAgentSpec("definitely-not-a-real-role");
check("unknown role returns null", unknown === null, String(unknown));

// detectMode still honours MC_MODE (the mode signal persists even though
// resolution is mode-agnostic — the conducting face uses it for orchestration).
const prev = mcEnv.readEnv("MODE");
mcEnv.setEnv("MODE", "oneshot");
check("detectMode honours MC_MODE=oneshot", dispatch.detectMode() === "oneshot");
mcEnv.setEnv("MODE", "adhoc");
check("detectMode honours MC_MODE=adhoc", dispatch.detectMode() === "adhoc");
mcEnv.setEnv("MODE", "sprint");
check("detectMode honours MC_MODE=sprint", dispatch.detectMode() === "sprint");
if (prev === undefined) mcEnv.unsetEnv("MODE");
else mcEnv.setEnv("MODE", prev);

const prevProjectDir = process.env.CLAUDE_PROJECT_DIR;
const modeProject = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-agent-mode-"));
fs.mkdirSync(path.join(modeProject, ".claude", "runtime"), { recursive: true });
fs.writeFileSync(
  path.join(modeProject, ".claude", "runtime", "mode.json"),
  JSON.stringify({ mode: "sprint" }),
);
process.env.CLAUDE_PROJECT_DIR = modeProject;
check("detectMode reads CLAUDE_PROJECT_DIR mode.json=sprint", dispatch.detectMode() === "sprint");
if (prevProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
else process.env.CLAUDE_PROJECT_DIR = prevProjectDir;

if (failed > 0) {
  console.error(`FAIL — ${failed} of ${passed + failed} cases failed:`);
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log(`OK — ${passed} cases passed (department-tree resolution)`);
process.exit(0);
