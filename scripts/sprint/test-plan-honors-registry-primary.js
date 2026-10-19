#!/usr/bin/env node
/* eslint-disable no-console */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const mcEnv = require("../hooks/lib/mc-env");

const REPO = path.resolve(__dirname, "..", "..");

const SPRINT = require("./paths");
const ROUTING_REL = path.relative(REPO, SPRINT.routing).split(path.sep).join("/");

let passed = 0;
let failed = 0;

function ok(name) {
  passed++;
  process.stdout.write(`  ok    ${name}\n`);
}
function fail(name, detail) {
  failed++;
  process.stdout.write(`  FAIL  ${name}\n`);
  if (detail) process.stdout.write(`        ${detail}\n`);
}

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

function buildProject(opts) {
  const { withPrimary = true } = opts || {};
  const tmp = fs.mkdtempSync(
    path.join(os.tmpdir(), "mc-plan-registry-primary-"),
  );
  for (const rel of [
    ".claude/paths.json",
    "schemas/sprint",
    "_mc/templates/sprint",
    ROUTING_REL,
  ]) {
    const src = path.join(REPO, rel);
    const dst = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    try {
      if (fs.statSync(src).isDirectory()) copyDirSync(src, dst);
      else fs.copyFileSync(src, dst);
    } catch {
    }
  }

  for (const sub of [
    ".claude/project/sprint",
    ".claude/project/sprint/sprints",
    ".claude/project/sprint/history",
    ".claude/project/sprint/plan-contracts",
    ".claude/project/sprint/checkpoints",
    ".claude/project/sprint/decisions",
  ]) {
    fs.mkdirSync(path.join(tmp, sub), { recursive: true });
  }

  const sprintId = "SP-99999999-001";
  if (withPrimary) {
    const reg = [
      "schema: mc/sprint/active-sprints/v1",
      `primary: ${sprintId}`,
      "sprints:",
      `  - id: ${sprintId}`,
      '    title: "Registry-pinned test sprint title"',
      "    status: planning",
      "    lane:",
      "      type: feature",
      '      value: "lane-from-registry"',
      '      isolation_notes: "set by registry, not by plan.js"',
      "    layout: per_sprint_subdir",
      `    pointer: ".claude/project/sprint/sprints/${sprintId}"`,
      '    created_at: "2026-01-01T00:00:07.054Z"',
      '    updated_at: "2026-01-01T00:00:07.054Z"',
      'created_at: "2026-01-01T00:00:00.000Z"',
      'updated_at: "2026-01-01T00:00:07.054Z"',
      "",
    ].join("\n");
    fs.writeFileSync(
      path.join(tmp, ".claude/project/sprint/active-sprints.yaml"),
      reg,
      "utf8",
    );
    fs.mkdirSync(path.join(tmp, `.claude/project/sprint/sprints/${sprintId}`), {
      recursive: true,
    });
  }

  const payloadPath = path.join(tmp, "payload.json");
  fs.writeFileSync(
    payloadPath,
    JSON.stringify({
      source_request: "test-plan-honors-registry-primary smoke",
      interpreted_intent: "verify plan.js honors registry primary",
      user_or_business_outcome: "the bug stays dead",
    }),
    "utf8",
  );

  return { tmp, sprintId, payloadPath };
}

function runPlan(tmp, payloadPath, extraArgs) {
  const planJs = path.join(REPO, "scripts", "sprint", "plan.js");
  const env = { ...process.env };
  env.CLAUDE_PROJECT_DIR = tmp;
  mcEnv.unsetEnv("SPRINT_ID", env);
  const r = spawnSync(
    process.execPath,
    [planJs, "--payload", payloadPath, ...(extraArgs || [])],
    {
      cwd: tmp,
      env,
      encoding: "utf8",
    },
  );
  return r;
}

function readCurrent(tmp, sprintId) {
  const p = path.join(
    tmp,
    ".claude/project/sprint/sprints",
    sprintId,
    "current.yaml",
  );
  if (!fs.existsSync(p)) return null;
  const txt = fs.readFileSync(p, "utf8");
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = /^(id|title):\s*(.*)$/.exec(line);
    if (m) {
      let v = m[2].trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      out[m[1]] = v;
    }
  }
  const laneIdx = txt.split(/\r?\n/).findIndex((l) => /^lane:/.test(l));
  if (laneIdx >= 0) {
    out.lane = {};
    const lines = txt.split(/\r?\n/);
    for (let i = laneIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (!/^\s/.test(l)) break;
      const m = /^\s+(type|value|isolation_notes):\s*(.*)$/.exec(l);
      if (m) {
        let v = m[2].trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        out.lane[m[1]] = v;
      }
    }
  }
  return out;
}

function readLatestPlanContract(tmp) {
  const dir = path.join(tmp, ".claude/project/sprint/plan-contracts");
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^PC-\d{8}-\d{4}\.yaml$/.test(f))
    .sort();
  if (!files.length) return null;
  const txt = fs.readFileSync(path.join(dir, files[files.length - 1]), "utf8");
  const out = { _file: files[files.length - 1] };
  for (const line of txt.split(/\r?\n/)) {
    const m = /^(id|sprint):\s*(.*)$/.exec(line);
    if (m) {
      let v = m[2].trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      out[m[1]] = v;
    }
  }
  return out;
}

{
  const { tmp, sprintId, payloadPath } = buildProject({ withPrimary: true });
  const r = runPlan(tmp, payloadPath, ["--sprint", sprintId]);
  if (r.status !== 0) {
    fail(
      "case1: plan.js --sprint <primary> exits 0",
      `status=${r.status} stderr=${r.stderr}`,
    );
  } else {
    ok("case1: plan.js --sprint <primary> exits 0");
  }
  const cur = readCurrent(tmp, sprintId);
  if (!cur) {
    fail("case1: current.yaml written under sprints/<primary>/");
  } else if (cur.id !== sprintId) {
    fail(
      "case1: current.yaml id == --sprint primary",
      `expected ${sprintId}, got ${cur.id}`,
    );
  } else {
    ok("case1: current.yaml id == --sprint primary (no mint)");
  }
  if (cur && cur.title === "Registry-pinned test sprint title") {
    ok("case3: title bootstrapped from registry entry");
  } else {
    fail(
      "case3: title bootstrapped from registry entry",
      `got title=${cur && cur.title}`,
    );
  }
  if (
    cur &&
    cur.lane &&
    cur.lane.type === "feature" &&
    cur.lane.value === "lane-from-registry"
  ) {
    ok("case3: lane bootstrapped from registry entry");
  } else {
    fail(
      "case3: lane bootstrapped from registry entry",
      `got lane=${JSON.stringify(cur && cur.lane)}`,
    );
  }
  const pc = readLatestPlanContract(tmp);
  if (!pc) {
    fail("case1: plan contract written");
  } else if (pc.sprint !== sprintId) {
    fail(
      "case1: plan contract sprint == primary",
      `PC=${pc._file} sprint=${pc.sprint}, expected ${sprintId}`,
    );
  } else {
    ok("case1: plan contract sprint == primary");
  }
  if (r.stderr && /WARN: --sprint .* but ensureCurrentSprint/.test(r.stderr)) {
    fail("case5: no spurious sanity-check WARN on happy path", r.stderr);
  } else {
    ok("case5: no spurious sanity-check WARN on happy path");
  }
}

{
  const { tmp, sprintId, payloadPath } = buildProject({ withPrimary: true });
  const r = runPlan(tmp, payloadPath, []);
  if (r.status !== 0) {
    fail(
      "case2: plan.js (no --sprint flag) exits 0",
      `status=${r.status} stderr=${r.stderr}`,
    );
  } else {
    ok("case2: plan.js (no --sprint flag) exits 0");
  }
  const cur = readCurrent(tmp, sprintId);
  if (!cur || cur.id !== sprintId) {
    fail(
      "case2: current.yaml id == registry primary (no flag)",
      `got ${cur && cur.id}`,
    );
  } else {
    ok("case2: current.yaml id == registry primary (no flag)");
  }
  const pc = readLatestPlanContract(tmp);
  if (!pc || pc.sprint !== sprintId) {
    fail(
      "case2: plan contract sprint == registry primary",
      `got ${pc && pc.sprint}`,
    );
  } else {
    ok("case2: plan contract sprint == registry primary");
  }
}

{
  const { tmp, payloadPath } = buildProject({ withPrimary: false });
  const r = runPlan(tmp, payloadPath, []);
  if (r.status !== 0) {
    fail(
      "case4: plan.js (no registry) exits 0 (mint path)",
      `status=${r.status} stderr=${r.stderr}`,
    );
  } else {
    ok("case4: plan.js (no registry) exits 0 (mint path)");
  }
  const pc = readLatestPlanContract(tmp);
  if (!pc || !/^SP-\d{8}-\d{3}$/.test(pc.sprint || "")) {
    fail("case4: minted sprint id has valid shape", `got ${pc && pc.sprint}`);
  } else {
    ok("case4: minted sprint id has valid shape");
  }
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
