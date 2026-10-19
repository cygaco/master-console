#!/usr/bin/env node

"use strict";
const mcEnv = require("./lib/mc-env");

const fs = require("fs");
const path = require("path");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let event;
  try {
    event = JSON.parse(input);
  } catch {
    process.exit(0);
  }
  try {
    handle(event);
  } catch {
    process.exit(0);
  }
});

function handle(event) {
  const tool = event.tool_name;
  if (tool !== "Edit" && tool !== "Write") {
    process.exit(0);
  }
  const filePath = (event.tool_input && event.tool_input.file_path) || "";
  if (!filePath) process.exit(0);

  let PROJECT, PATHS;
  try {
    ({ PROJECT, PATHS } = require("./lib/paths"));
  } catch {
    process.exit(0);
  }
  const sprintRoot = PATHS.sprintRoot
    ? PATHS.sprintRoot
    : path.join(PROJECT, ".claude/project/sprint");
  const fileAbs = path.isAbsolute(filePath)
    ? filePath
    : path.join(PROJECT, filePath);
  const norm = fileAbs.replace(/\\/g, "/");
  const rootNorm = sprintRoot.replace(/\\/g, "/");

  if (!norm.startsWith(rootNorm + "/")) {
    process.exit(0);
  }

  const rel = norm.slice(rootNorm.length + 1);
  const cls = classify(rel, event);
  if (!cls) process.exit(0);

  const policyPath = PATHS.sprintRouting
    ? PATHS.sprintRouting
    : path.join(
        PROJECT,
        ".claude/agents/president/_system/policy/sprint-routing.json",
      );
  if (!fs.existsSync(policyPath)) {
    debugLog(`policy missing at ${policyPath} — fail-open`);
    process.exit(0);
  }
  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  } catch {
    process.exit(0);
  }
  const enforcement = (policy && policy.enforcement) || {
    mode: "warn",
    rolled_out_at: null,
    soft_rollout_until: null,
  };
  if (!["warn", "block"].includes(enforcement.mode)) {
    process.exit(0);
  }

  const sprintStatus = lookupSprintStatus(PROJECT, PATHS, cls.sprint);
  if (
    sprintStatus &&
    ["closed", "abandoned", "retrospected"].includes(sprintStatus)
  ) {
    debugLog(`sprint ${cls.sprint} status=${sprintStatus} → exempt`);
    process.exit(0);
  }

  const decisionsDir = PATHS.sprintDecisions
    ? PATHS.sprintDecisions
    : path.join(PROJECT, ".claude/project/sprint/decisions");
  const tracePath = path.join(decisionsDir, "routing-trace.jsonl");
  const hit = traceExists(tracePath, cls.sprint, cls.phase, cls.artifact_id);
  if (hit) {
    process.exit(0);
  }

  const fixCmd = `node scripts/sprint/routing.js record --phase ${cls.phase} --artifact ${cls.artifact_id} --sprint ${cls.sprint} --model claude:claude-opus-4-8 --allow-single-vendor`;
  if (enforcement.mode === "warn") {
    const softRolloutNote = enforcement.soft_rollout_until
      ? ` soft rollout until ${enforcement.soft_rollout_until}.`
      : "";
    process.stderr.write(
      `routing-guard (warn): write to ${rel} has no matching trace row.\n` +
        `  sprint=${cls.sprint} phase=${cls.phase} artifact=${cls.artifact_id}.${softRolloutNote}\n` +
        `  proceed allowed. To silence, record: ${fixCmd}\n`,
    );
    logEvent(PROJECT, "audit", {
      action: "sprint.routing.guard_warned",
      artifact_path: rel,
      sprint_id: cls.sprint,
      inferred_phase: cls.phase,
      mode: "warn",
    });
    process.exit(0);
  }
  process.stderr.write(
    `routing-guard: BLOCKED — write to ${rel} requires a matching trace row first.\n` +
      `  sprint=${cls.sprint} phase=${cls.phase} artifact=${cls.artifact_id}.\n` +
      `  fix: ${fixCmd}\n`,
  );
  logEvent(PROJECT, "block", {
    action: "sprint.routing.guard_blocked",
    artifact_path: rel,
    sprint_id: cls.sprint,
    inferred_phase: cls.phase,
    mode: "block",
  });
  console.log(
    JSON.stringify({
      decision: "block",
      reason: `sprint-routing-guard: missing routing trace for sprint=${cls.sprint} phase=${cls.phase} artifact=${cls.artifact_id}`,
    }),
  );
  process.exit(0);
}

function classify(rel, event) {
  rel = rel.replace(/\\/g, "/");

  const reqMatch = rel.match(/^requirements\/((?:SP-\d{8}-\d{3,4}|S-[A-Z0-9]+-\d{2,3}))\/[^/]+\.md$/);
  if (reqMatch) {
    return {
      sprint: reqMatch[1],
      phase: "design",
      artifact_id: `design:${reqMatch[1]}`,
    };
  }

  const retroMatch = rel.match(/^history\/((?:SP-\d{8}-\d{3,4}|S-[A-Z0-9]+-\d{2,3}))\/retro\.yaml$/);
  if (retroMatch) {
    return {
      sprint: retroMatch[1],
      phase: "retrospective",
      artifact_id: `retro:${retroMatch[1]}`,
    };
  }

  const relMatch = rel.match(/^releases\/(RL-\d{8}-\d+)\.yaml$/);
  if (relMatch) {
    const releaseId = relMatch[1];
    const sprint = sprintFromReleaseContent(event);
    if (!sprint) return null;
    return {
      sprint,
      phase: "release",
      artifact_id: releaseId,
    };
  }

  return null;
}

function sprintFromReleaseContent(event) {
  const ti = event.tool_input || {};
  const body = (ti.content || "") + "\n" + (ti.new_string || "");
  const m = body.match(/(?:^|\n)\s*sprint:\s*["']?((?:SP-\d{8}-\d{3,4}|S-[A-Z0-9]+-\d{2,3}))["']?/);
  return m ? m[1] : null;
}

function traceExists(tracePath, sprint, phase, artifact) {
  if (!fs.existsSync(tracePath)) return false;
  let raw;
  try {
    raw = fs.readFileSync(tracePath, "utf8");
  } catch {
    return false;
  }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const row = JSON.parse(t);
      if (
        row &&
        row.sprint_id === sprint &&
        row.phase === phase &&
        row.artifact_id === artifact
      ) {
        return true;
      }
    } catch {
    }
  }
  return false;
}

function lookupSprintStatus(PROJECT, PATHS, sprintId) {
  const regPath = PATHS.sprintActiveRegistry
    ? PATHS.sprintActiveRegistry
    : path.join(PROJECT, ".claude/project/sprint/active-sprints.yaml");
  if (!fs.existsSync(regPath)) return null;
  let raw;
  try {
    raw = fs.readFileSync(regPath, "utf8");
  } catch {
    return null;
  }
  const idLine = raw.indexOf(`id: ${sprintId}`);
  if (idLine < 0) return null;
  const slice = raw.slice(idLine, idLine + 400);
  const m = slice.match(/\n\s*status:\s*(\w+)/);
  return m ? m[1] : null;
}

function debugLog(msg) {
  if (mcEnv.readEnv("DEBUG") === "1") {
    process.stderr.write(`routing-guard (debug): ${msg}\n`);
  }
}

function logEvent(PROJECT, category, payload) {
  try {
    const loggerPath = path.join(
      PROJECT,
      "scripts",
      "hooks",
      "lib",
      "logger.js",
    );
    if (!fs.existsSync(loggerPath)) return;
    const { log } = require(loggerPath);
    log(category, payload, { actor: "sprint-routing-guard" });
  } catch {
  }
}
