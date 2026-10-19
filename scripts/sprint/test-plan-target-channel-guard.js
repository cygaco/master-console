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
const ROUTING_REL = path
  .relative(REPO, SPRINT.routing)
  .split(path.sep)
  .join("/");

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

const PRIMARY_ID = "S-EXAMPLE-01";
const OTHER_ID = "S-EXAMPLE-02";

function buildProject() {
  const tmp = fs.mkdtempSync(
    path.join(os.tmpdir(), "mc-plan-target-channel-"),
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

  const reg = [
    "schema: mc/sprint/active-sprints/v1",
    `primary: ${PRIMARY_ID}`,
    "sprints:",
    `  - id: ${PRIMARY_ID}`,
    '    title: "ENGINE — holds primary"',
    "    status: planning",
    "    lane:",
    "      type: default",
    "      value: null",
    '      isolation_notes: ""',
    "    layout: per_sprint_subdir",
    `    pointer: ".claude/project/sprint/sprints/${PRIMARY_ID}"`,
    '    created_at: "2026-07-30T00:52:06.116Z"',
    '    updated_at: "2026-07-30T00:52:06.116Z"',
    `  - id: ${OTHER_ID}`,
    '    title: "AUDIT — not primary"',
    "    status: planning",
    "    lane:",
    "      type: default",
    "      value: null",
    '      isolation_notes: ""',
    "    layout: per_sprint_subdir",
    `    pointer: ".claude/project/sprint/sprints/${OTHER_ID}"`,
    '    created_at: "2026-07-30T00:52:06.116Z"',
    '    updated_at: "2026-07-30T00:52:06.116Z"',
    'created_at: "2026-07-30T00:52:00.000Z"',
    'updated_at: "2026-07-30T00:52:06.116Z"',
    "",
  ].join("\n");
  fs.writeFileSync(
    path.join(tmp, ".claude/project/sprint/active-sprints.yaml"),
    reg,
    "utf8",
  );
  for (const id of [PRIMARY_ID, OTHER_ID]) {
    fs.mkdirSync(path.join(tmp, `.claude/project/sprint/sprints/${id}`), {
      recursive: true,
    });
  }
  return tmp;
}

function writePayload(tmp, name, extra) {
  const p = path.join(tmp, name);
  fs.writeFileSync(
    p,
    JSON.stringify({
      source_request: "target-channel guard fixture",
      interpreted_intent: "verify the guard refuses an inert target channel",
      user_or_business_outcome: "a mis-associated contract can never land",
      ...extra,
    }),
    "utf8",
  );
  return p;
}

function runPlan(tmp, payloadPath, extraArgs) {
  const planJs = path.join(REPO, "scripts", "sprint", "plan.js");
  const env = { ...process.env };
  env.CLAUDE_PROJECT_DIR = tmp;
  mcEnv.unsetEnv("SPRINT_ID", env);
  return spawnSync(
    process.execPath,
    [planJs, "--payload", payloadPath, ...(extraArgs || [])],
    { cwd: tmp, env, encoding: "utf8" },
  );
}

function contractCount(tmp) {
  const dir = path.join(tmp, ".claude/project/sprint/plan-contracts");
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => /^PC-\d{8}-\d{4}\.yaml$/.test(f))
    .length;
}

function latestContractSprint(tmp) {
  const dir = path.join(tmp, ".claude/project/sprint/plan-contracts");
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^PC-\d{8}-\d{4}\.yaml$/.test(f))
    .sort();
  if (!files.length) return null;
  const txt = fs.readFileSync(path.join(dir, files[files.length - 1]), "utf8");
  const m = /^sprint:\s*(.*)$/m.exec(txt);
  if (!m) return null;
  return m[1].trim().replace(/^"|"$/g, "");
}

{
  const tmp = buildProject();
  const pay = writePayload(tmp, "audit-payload.json", { sprint: OTHER_ID });
  const r = runPlan(tmp, pay, []);
  if (r.status === 0) {
    fail(
      "case1: refuses when payload.sprint != resolved target",
      `exited 0 — the guard did not fire. stderr=${r.stderr}`,
    );
  } else {
    ok("case1: refuses when payload.sprint != resolved target");
  }
  if (/PLAN_TARGET_CHANNEL_MISMATCH/.test(r.stderr || "")) {
    ok("case1: refusal carries the named error PLAN_TARGET_CHANNEL_MISMATCH");
  } else {
    fail(
      "case1: refusal carries the named error PLAN_TARGET_CHANNEL_MISMATCH",
      `stderr=${r.stderr}`,
    );
  }
  if (contractCount(tmp) === 0) {
    ok("case1: NO plan contract written on refusal (no side effects)");
  } else {
    fail(
      "case1: NO plan contract written on refusal (no side effects)",
      `found ${contractCount(tmp)} contract(s), sprint=${latestContractSprint(tmp)}`,
    );
  }
}

{
  const tmp = buildProject();
  const pay = writePayload(tmp, "engine-payload.json", { sprint: PRIMARY_ID });
  const r = runPlan(tmp, pay, []);
  if (r.status !== 0) {
    fail(
      "case2: proceeds when payload.sprint == resolved target",
      `status=${r.status} stderr=${r.stderr}`,
    );
  } else {
    ok("case2: proceeds when payload.sprint == resolved target");
  }
  if (latestContractSprint(tmp) === PRIMARY_ID) {
    ok("case2: contract stamped with the agreed sprint");
  } else {
    fail(
      "case2: contract stamped with the agreed sprint",
      `got ${latestContractSprint(tmp)}`,
    );
  }
}

{
  const tmp = buildProject();
  const pay = writePayload(tmp, "audit-payload.json", { sprint: OTHER_ID });
  const r = runPlan(tmp, pay, ["--sprint", OTHER_ID]);
  if (r.status !== 0) {
    fail(
      "case2b: --sprint <other> + agreeing payload proceeds",
      `status=${r.status} stderr=${r.stderr}`,
    );
  } else {
    ok("case2b: --sprint <other> + agreeing payload proceeds");
  }
  if (latestContractSprint(tmp) === OTHER_ID) {
    ok("case2b: contract bound to the flag-targeted non-primary sprint");
  } else {
    fail(
      "case2b: contract bound to the flag-targeted non-primary sprint",
      `got ${latestContractSprint(tmp)}`,
    );
  }
}

{
  const tmp = buildProject();
  const pay = writePayload(tmp, "bad-shape.json", { sprint: 42 });
  const r = runPlan(tmp, pay, []);
  if (r.status !== 0 && /PLAN_TARGET_CHANNEL_MISMATCH/.test(r.stderr || "")) {
    ok("case3: refuses a non-string payload.sprint (fail-closed on shape)");
  } else {
    fail(
      "case3: refuses a non-string payload.sprint (fail-closed on shape)",
      `status=${r.status} stderr=${r.stderr}`,
    );
  }
  if (contractCount(tmp) === 0) {
    ok("case3: no artifact written on shape refusal");
  } else {
    fail("case3: no artifact written on shape refusal");
  }
}

{
  const tmp = buildProject();
  const pay = writePayload(tmp, "no-sprint-key.json", {});
  const r = runPlan(tmp, pay, []);
  if (r.status !== 0) {
    fail(
      "case4: payload without a sprint key still exits 0 (documented shape)",
      `status=${r.status} stderr=${r.stderr}`,
    );
  } else {
    ok("case4: payload without a sprint key still exits 0 (documented shape)");
  }
  if (/PLAN_TARGET_CHANNEL_MISMATCH/.test(r.stderr || "")) {
    fail("case4: no spurious mismatch refusal", r.stderr);
  } else {
    ok("case4: no spurious mismatch refusal");
  }
  if (latestContractSprint(tmp) === PRIMARY_ID) {
    ok("case4: still resolves to registry primary (behaviour intact)");
  } else {
    fail(
      "case4: still resolves to registry primary (behaviour intact)",
      `got ${latestContractSprint(tmp)}`,
    );
  }
}

{
  const tmp = buildProject();
  const pay = writePayload(tmp, "no-sprint-key.json", {});
  const r = runPlan(tmp, pay, []);
  if (/PLAN_TARGET_FROM_AMBIENT/.test(r.stderr || "")) {
    ok("case5: emits PLAN_TARGET_FROM_AMBIENT when --sprint is omitted");
  } else {
    fail(
      "case5: emits PLAN_TARGET_FROM_AMBIENT when --sprint is omitted",
      `stderr=${r.stderr}`,
    );
  }
  if (r.status === 0) {
    ok("case5: DOOR 2 is loud, NOT fatal (documented route still works)");
  } else {
    fail(
      "case5: DOOR 2 is loud, NOT fatal (documented route still works)",
      `status=${r.status}`,
    );
  }
  if (/of 2 registered sprints/.test(r.stderr || "")) {
    ok("case5: names the resolved target and the registered count");
  } else {
    fail(
      "case5: names the resolved target and the registered count",
      `stderr=${r.stderr}`,
    );
  }
}

{
  const tmp = buildProject();
  const pay = writePayload(tmp, "no-sprint-key.json", {});
  const r = runPlan(tmp, pay, ["--sprint", OTHER_ID]);
  if (/PLAN_TARGET_FROM_AMBIENT/.test(r.stderr || "")) {
    fail("case6: no ambient warning when --sprint is passed", r.stderr);
  } else {
    ok("case6: no ambient warning when --sprint is passed");
  }
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
