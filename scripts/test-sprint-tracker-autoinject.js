#!/usr/bin/env node
// Smoke-test for sprint-tracker-guard auto-injection. Spawns the hook with
// synthetic Write payloads across the known sprint path patterns and asserts
// the hook emits hookSpecificOutput.updatedInput with the correct schema
// header, or warns/passes as appropriate. Replaces the old BLOCK behavior
// for the missing-schema case. Source: /scan:patterns 2026-05-13 (126x/day).

"use strict";

const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const REPO = path.resolve(__dirname, "..");
const guard = path.join(REPO, "scripts/hooks/sprint-tracker-guard.js");

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "autoinject-"));
  fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
  fs.copyFileSync(
    path.join(REPO, ".claude/paths.json"),
    path.join(tmp, ".claude/paths.json"),
  );
  copyDir(path.join(REPO, "schemas/sprint"), path.join(tmp, "schemas/sprint"));
  copyDir(path.join(REPO, "scripts/sprint"), path.join(tmp, "scripts/sprint"));
  copyDir(
    path.join(REPO, "scripts/hooks/lib"),
    path.join(tmp, "scripts/hooks/lib"),
  );
  return tmp;
}

function run(tmp, filePath, content) {
  const payload = JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: filePath, content },
  });
  const r = spawnSync(process.execPath, [guard], {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: tmp },
  });
  let parsed = null;
  try {
    parsed = JSON.parse((r.stdout || "").trim());
  } catch {
    /* ignore */
  }
  return { stdout: r.stdout, stderr: r.stderr, parsed, code: r.status };
}

function classify(r) {
  if (
    r.parsed &&
    r.parsed.hookSpecificOutput &&
    r.parsed.hookSpecificOutput.updatedInput
  ) {
    return {
      result: "inject",
      detail: r.parsed.hookSpecificOutput.updatedInput.content
        .split("\n")[0]
        .trim(),
    };
  }
  if (r.parsed && r.parsed.decision === "block") {
    return { result: "block", detail: r.parsed.reason || "" };
  }
  if (
    (r.stderr || "").includes("[sprint-tracker-guard]") &&
    (r.stderr || "").includes("Allowing (warn-only)")
  ) {
    return { result: "warn", detail: "" };
  }
  if (r.code === 0 && !r.parsed) {
    return { result: "pass", detail: "" };
  }
  return { result: "unknown", detail: `code=${r.code} stderr=${r.stderr}` };
}

const tmp = setup();

const cases = [
  {
    name: "approval missing schema → auto-inject",
    rel: ".claude/project/sprint/approvals/AP-20991231-001.yaml",
    content:
      "id: AP-20991231-001\nsprint: SP-test\nlevel: plan_approval_required\nstate: pending\n",
    expect: "inject",
    expectedKind: "approval",
  },
  {
    name: "ticket missing schema → auto-inject",
    rel: ".claude/project/sprint/tickets/T-20991231-001.yaml",
    content: "id: T-20991231-001\nstatus: proposed\n",
    expect: "inject",
    expectedKind: "ticket",
  },
  {
    name: "release missing schema → auto-inject",
    rel: ".claude/project/sprint/releases/RL-20991231-001.yaml",
    content: "id: RL-20991231-001\nstatus: preparing\n",
    expect: "inject",
    expectedKind: "release",
  },
  {
    name: "checkpoint missing schema → auto-inject sprint-progress",
    rel: ".claude/project/sprint/checkpoints/SP-20991231-001-0001.yaml",
    content: "sprint: SP-20991231-001\nstatus: pending\n",
    expect: "inject",
    expectedKind: "sprint-progress",
  },
  {
    name: "sprints/<id>/current.yaml missing schema → auto-inject",
    rel: ".claude/project/sprint/sprints/SP-20991231-001/current.yaml",
    content: "id: SP-20991231-001\n",
    expect: "inject",
    expectedKind: "current-sprint",
  },
  {
    name: "plan-contract missing schema → auto-inject",
    rel: ".claude/project/sprint/plan-contracts/PC-20991231-0001.yaml",
    content: "id: PC-20991231-0001\n",
    expect: "inject",
    expectedKind: "plan-contract",
  },
  {
    name: "active-sprints.yaml missing schema → auto-inject",
    rel: ".claude/project/sprint/active-sprints.yaml",
    content: "primary: SP-test\nsprints: []\n",
    expect: "inject",
    expectedKind: "active-sprints",
  },
  {
    name: "external-service missing schema → auto-inject",
    rel: ".claude/project/sprint/external-services/ESD-20991231-001.yaml",
    content: "id: ESD-20991231-001\nstatus: pending\n",
    expect: "inject",
    expectedKind: "external-service-dependency",
  },
  {
    name: "unknown sprint path missing schema → warn-only",
    rel: ".claude/project/sprint/weird-new-thing.yaml",
    content: "foo: bar\n",
    expect: "warn",
  },
  {
    name: "ticket WITH schema header → no inject (existing validation still applies)",
    rel: ".claude/project/sprint/tickets/T-20991231-002.yaml",
    content:
      "schema: mc/sprint/ticket/v1\nid: T-20991231-002\nsprint: SP-test\n",
    // Existing protection-1 schema validation correctly blocks a minimal
    // ticket missing required fields. We only assert that auto-inject is
    // NOT triggered for files that already have a schema: header.
    expect: "block",
  },
  {
    name: "non-yaml file → no-op (pass-through)",
    rel: ".claude/project/sprint/tickets/notes.txt",
    content: "free text\n",
    expect: "pass",
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const fp = path.join(tmp, c.rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const r = run(tmp, fp, c.content);
  const cls = classify(r);
  let ok = cls.result === c.expect;
  if (ok && c.expect === "inject") {
    ok = cls.detail.includes(`mc/sprint/${c.expectedKind}/v1`);
  }
  if (ok) {
    pass++;
    process.stdout.write(
      `  PASS  ${c.name}  → ${cls.result}${cls.detail ? " [" + cls.detail.slice(0, 60) + "]" : ""}\n`,
    );
  } else {
    fail++;
    process.stdout.write(
      `  FAIL  ${c.name}\n        expected=${c.expect} got=${cls.result}\n        detail=${cls.detail.slice(0, 200)}\n        stderr=${(r.stderr || "").slice(0, 200)}\n`,
    );
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

process.stdout.write(`\n${pass}/${pass + fail} passed\n`);
process.exit(fail > 0 ? 1 : 0);
