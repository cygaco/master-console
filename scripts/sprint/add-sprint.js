#!/usr/bin/env node
// Add a new sprint to active-sprints.yaml and set it as primary.
// Usage: node scripts/sprint/add-sprint.js --id <id> --title <title>
const fs = require("fs");
const path = require("path");
const SPRINT = require("./paths");
const { readYamlMaybe, writeYaml, readText, render } = require("./fs");

function get(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
}

const id = get("--id");
const title = get("--title");
if (!id || !title) {
  process.stderr.write("Usage: --id <id> --title <title>\n");
  process.exit(2);
}

const repo = path.resolve(__dirname, "..", "..");
const regPath = path.join(
  repo,
  ".claude",
  "project",
  "sprint",
  "active-sprints.yaml",
);
const now = new Date().toISOString();
// WG-3: a fresh repo has no active-sprints.yaml, so readYamlMaybe returns
// null and `reg.sprints` would throw — crashing the entry point to the whole
// sprint pipeline. Initialize a schema-valid empty registry instead; the
// `reg.primary = id` assignment below then yields a valid registry (primary
// points at the present, newly-created sprint).
const reg = readYamlMaybe(regPath) || {
  schema: "mc/sprint/active-sprints/v1",
  primary: null,
  sprints: [],
  created_at: now,
  updated_at: now,
};
if (!Array.isArray(reg.sprints)) reg.sprints = [];
const pointer = `.claude/project/sprint/sprints/${id}`;

if (reg.sprints.some((s) => s.id === id)) {
  process.stderr.write(`sprint ${id} already exists\n`);
  process.exit(1);
}

reg.sprints.push({
  id,
  title,
  status: "planning",
  lane: { type: "default", value: null, isolation_notes: "" },
  layout: "per_sprint_subdir",
  pointer,
  created_at: now,
  updated_at: now,
});
reg.primary = id;
reg.updated_at = now;

writeYaml(regPath, reg);
fs.mkdirSync(path.join(repo, pointer), { recursive: true });

// WG-14: a sprint minted here must carry its own per-sprint tracker files
// (current.yaml + progress.yaml) or `ticket.js create` cannot resolve the
// sprint — a manually-minted sprint then can't mint tickets at all. init.js
// renders these for the bootstrap sprint; mirror that for every add-sprint
// sprint. Render from templates when present; otherwise fall back to a
// minimal schema-valid tracker so ticket minting works even on a fresh
// install whose sprint templates are absent (WG-10 class). writeYaml injects
// the `schema:` header from the path for the fallback case.
const sprintDir = path.join(repo, pointer);
const tmplDir = path.join(SPRINT.templates, "init");
const renderData = {
  sprint_id: id,
  sprint_title: title,
  sprint_objective: "Run /sprint:plan to set this.",
  created_at: now,
  updated_at: now,
  project_name: "your project",
};
for (const t of [
  { tmpl: "current-sprint.yaml.tmpl", out: "current.yaml", fallback: minimalCurrent },
  { tmpl: "sprint-progress.yaml.tmpl", out: "progress.yaml", fallback: minimalProgress },
]) {
  const outPath = path.join(sprintDir, t.out);
  if (fs.existsSync(outPath)) continue;
  const tmplText = readText(path.join(tmplDir, t.tmpl));
  if (tmplText !== null) {
    fs.writeFileSync(outPath, render(tmplText, renderData), "utf8");
  } else {
    writeYaml(outPath, t.fallback(id, title, now));
  }
}
process.stdout.write(`tracker: current.yaml + progress.yaml ready for ${id}\n`);

// SP-20260519-001 R-2: append sprint row to ROADMAP.md ledger.
// Fail-open: never blocks add-sprint.
try {
  const ledger = require("./ledger");
  const lr = ledger.appendSprintRow({
    id,
    title,
    status: "planning",
    startedAt: now,
  });
  if (lr.written) {
    process.stdout.write(`roadmap: ROADMAP.md row added for ${id}\n`);
  } else if (lr.reason !== "already-present") {
    process.stderr.write(`roadmap: skipped (${lr.reason})\n`);
  }
} catch (err) {
  process.stderr.write(`roadmap: skipped (${err.message})\n`);
}

process.stdout.write(`added ${id} as primary\n`);

// ── WG-14 fallbacks: minimal schema-valid trackers when templates are absent.
// Mirror _mc/templates/sprint/init/{current-sprint,sprint-progress}.yaml.tmpl.
// writeYaml injects the `schema:` header from the file path, so it is omitted here.
function minimalCurrent(id, title, now) {
  return {
    id,
    title,
    objective: "Run /sprint:plan to set this.",
    status: "not_started",
    created_at: now,
    updated_at: now,
    source_request: "",
    interpreted_intent: "",
    plan_contract: null,
    risk_level: "low",
    approval_state: "none_required",
    current_phase: "idle",
    tickets: {
      proposed: [],
      planned: [],
      designed: [],
      ready_for_execution: [],
      in_progress: [],
      blocked: [],
      waiting_on_human: [],
      waiting_on_external_service: [],
      in_review: [],
      qa_failed: [],
      redteam_failed: [],
      done: [],
      released: [],
      deferred: [],
      abandoned: [],
      reopened: [],
      superseded: [],
    },
    requirements: {
      prd: null,
      high_level_stories: null,
      granular_stories: null,
      copy: null,
      inputs: null,
      trace: null,
      acceptance_criteria: null,
      qa_plan: null,
      redteam_plan: null,
      release_plan: null,
    },
  };
}

function minimalProgress(id, _title, now) {
  return {
    sprint: id,
    updated_at: now,
    current_phase: "idle",
    current_command: "none",
    current_ticket: null,
    current_task: null,
    current_loop: null,
    status: "starting",
    last_completed_step: "tracker_initialized",
    next_action:
      "Run /sprint:plan with a brief plain-language request to begin.",
    active_files: [],
    modified_files: [],
    blockers: [],
    approvals_needed: [],
    external_services_needed: [],
    resume_command: "/sprint:plan",
    safe_to_continue: true,
    stop_reason: null,
  };
}
