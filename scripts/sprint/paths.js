#!/usr/bin/env node

"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");

(function rescueProjectDirFromWorktree() {
  try {
    if (process.env.CLAUDE_PROJECT_DIR) return;
    const cwd = process.cwd();
    const looksLikeWorktree =
      /[\\/]\.claude[\\/]worktrees[\\/]/.test(cwd) ||
      /worktrees/.test(path.basename(path.dirname(cwd)));
    let gitFile = false;
    try {
      const gitPath = path.join(cwd, ".git");
      const st = fs.statSync(gitPath);
      gitFile = st.isFile();
    } catch {
      let cursor = cwd;
      for (let i = 0; i < 6; i++) {
        try {
          const st = fs.statSync(path.join(cursor, ".git"));
          gitFile = st.isFile();
          break;
        } catch {
          const parent = path.dirname(cursor);
          if (parent === cursor) break;
          cursor = parent;
        }
      }
    }
    if (!looksLikeWorktree && !gitFile) return;
    const { execSync } = require("child_process");
    const commonDir = execSync("git rev-parse --git-common-dir", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    if (!commonDir) return;
    const abs = path.isAbsolute(commonDir)
      ? commonDir
      : path.resolve(cwd, commonDir);
    const mainRoot = path.dirname(abs);
    if (mainRoot && fs.existsSync(mainRoot)) {
      process.env.CLAUDE_PROJECT_DIR = mainRoot;
    }
  } catch {
  }
})();

const { PROJECT, PATHS } = require("../hooks/lib/paths");

function p(key, fallbackRel) {
  const v = PATHS && PATHS[key];
  if (v && typeof v === "string") return v;
  return path.join(PROJECT, fallbackRel);
}

const LEGACY_CURRENT = p(
  "sprintCurrent",
  ".claude/project/sprint/current-sprint.yaml",
);
const LEGACY_PROGRESS = p(
  "sprintProgress",
  ".claude/project/sprint/sprint-progress.yaml",
);

const SPRINT = {
  PROJECT,
  root: p("sprintRoot", ".claude/project/sprint"),
  activeRegistry: p(
    "sprintActiveRegistry",
    ".claude/project/sprint/active-sprints.yaml",
  ),
  sprints: p("sprintSprints", ".claude/project/sprint/sprints"),
  history: p("sprintHistory", ".claude/project/sprint/history"),
  planContracts: p(
    "sprintPlanContracts",
    ".claude/project/sprint/plan-contracts",
  ),
  tickets: p("sprintTickets", ".claude/project/sprint/tickets"),
  issues: p("sprintIssues", ".claude/project/sprint/issues"),
  issuesLedger: p("sprintIssuesLedger", "issues.md"),
  externalServices: p(
    "sprintExternalServices",
    ".claude/project/sprint/external-services",
  ),
  releases: p("sprintReleases", ".claude/project/sprint/releases"),
  approvals: p("sprintApprovals", ".claude/project/sprint/approvals"),
  decisions: p("sprintDecisions", ".claude/project/sprint/decisions"),
  ralph: p("sprintRalph", ".claude/project/sprint/ralph"),
  checkpoints: p("sprintCheckpoints", ".claude/project/sprint/checkpoints"),
  requirements: p("sprintRequirements", ".claude/project/sprint/requirements"),
  templates: p("sprintTemplates", "_mc/templates/sprint"),
  schemas: p("sprintSchemas", "schemas/sprint"),
  routing: p(
    "sprintRouting",
    ".claude/agents/president/_system/policy/sprint-routing.json",
  ),
  reference: p(
    "sprintReference",
    ".claude/project/reference/sprint-workflow.md",
  ),
  LEGACY_CURRENT,
  LEGACY_PROGRESS,
};

let _fsModule = null;
function fsModule() {
  if (_fsModule) return _fsModule;
  _fsModule = require("./fs");
  return _fsModule;
}

function loadRegistry() {
  if (!fs.existsSync(SPRINT.activeRegistry)) return null;
  try {
    return fsModule().readYamlMaybe(SPRINT.activeRegistry);
  } catch {
    return null;
  }
}

function active() {
  if (mcEnv.readEnv("SPRINT_ID")) return mcEnv.readEnv("SPRINT_ID");
  const reg = loadRegistry();
  if (!reg || !reg.primary) return null;
  return reg.primary;
}

function statusOf(id) {
  const reg = loadRegistry();
  if (!reg || !Array.isArray(reg.sprints)) return null;
  const s = reg.sprints.find((x) => x && x.id === id);
  return s && typeof s.status === "string" ? s.status : null;
}

function parseSprintArg(argv) {
  let explicit = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--sprint") {
      explicit = argv[i + 1] || null;
      break;
    }
  }
  if (explicit) {
    const reg = loadRegistry();
    const known =
      reg && Array.isArray(reg.sprints)
        ? reg.sprints.some((s) => s.id === explicit)
        : false;
    if (!known) {
      process.stderr.write(
        `unknown sprint: ${explicit}. See ${SPRINT.activeRegistry} for the live set, or run /sprint:status.\n`,
      );
      return { id: null, error: "unknown_sprint" };
    }
    mcEnv.setEnv("SPRINT_ID", explicit);
    return { id: explicit, error: null };
  }
  const primary = active();
  return { id: primary, error: null };
}

function entry(id) {
  if (!id) return null;
  const reg = loadRegistry();
  if (!reg || !Array.isArray(reg.sprints)) return null;
  return reg.sprints.find((s) => s.id === id) || null;
}

function pointerDir(reg, id) {
  const e =
    reg && Array.isArray(reg.sprints)
      ? reg.sprints.find((s) => s.id === id)
      : null;
  if (e && e.pointer) {
    return path.isAbsolute(e.pointer)
      ? e.pointer
      : path.join(SPRINT.PROJECT, e.pointer);
  }
  return path.join(SPRINT.sprints, id);
}

function forSprint(id) {
  const reg = loadRegistry();
  const e = entry(id);
  const dir = pointerDir(reg, id);
  const layout = e && e.layout ? e.layout : "per_sprint_subdir";
  let current, progress;
  if (layout === "legacy_root") {
    current = LEGACY_CURRENT;
    progress = LEGACY_PROGRESS;
  } else {
    current = path.join(dir, "current.yaml");
    progress = path.join(dir, "progress.yaml");
  }
  return {
    id,
    layout,
    pointer: dir,
    current,
    progress,
    ralph: path.join(SPRINT.ralph, id),
    checkpoints: SPRINT.checkpoints,
    requirements: path.join(SPRINT.requirements, id),
    history: path.join(SPRINT.history, id),
  };
}

SPRINT.active = active;
SPRINT.entry = entry;
SPRINT.forSprint = forSprint;
SPRINT.parseSprintArg = parseSprintArg;
SPRINT.statusOf = statusOf;
SPRINT.CLOSED_STATUSES = new Set(["closed", "abandoned", "retrospected"]);

Object.defineProperty(SPRINT, "current", {
  enumerable: true,
  get() {
    const id = active();
    if (!id) return LEGACY_CURRENT;
    return forSprint(id).current;
  },
});
Object.defineProperty(SPRINT, "progress", {
  enumerable: true,
  get() {
    const id = active();
    if (!id) return LEGACY_PROGRESS;
    return forSprint(id).progress;
  },
});

module.exports = SPRINT;
