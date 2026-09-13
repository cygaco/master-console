#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const routing = require("../../../scripts/sprint/routing");
const ledger = require("../../../scripts/sprint/ledger");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("routing trace accepts named wave sprint ids", () => {
  const errors = routing.validateTraceRow({
    schema: "mc/sprint/routing-trace/v1",
    sprint_id: "S-PF-01",
    phase: "planning",
    artifact_id: "PC-20260611-0075",
    model: "claude:claude-opus-4-8",
    evidence: "ok",
    recorded_at: "2026-06-11T21:00:00.000Z",
    recorded_by: "test",
    artifact_path: null,
    model_class: null,
    diff_reviewer: null,
    decision_ledger_ref: null,
    ticket_id: null,
    notes: ""
  });
  assert.deepStrictEqual(errors, []);
});

test("routing trace rejects arbitrary sprint ids", () => {
  const errors = routing.validateTraceRow({
    schema: "mc/sprint/routing-trace/v1",
    sprint_id: "S-PF",
    phase: "planning",
    artifact_id: "PC-20260611-0075",
    model: "claude:claude-opus-4-8",
    evidence: "ok",
    recorded_at: "2026-06-11T21:00:00.000Z",
    recorded_by: "test"
  });
  assert(errors.some((e) => e.includes("sprint_id missing or malformed")));
});

test("roadmap ledger accepts named wave sprint ids", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-named-sprint-"));
  fs.writeFileSync(
    path.join(tmp, "ROADMAP.md"),
    [
      "# Roadmap",
      "",
      "## Sprints",
      "| Sprint | Title | Status | Started | Closed | Release |",
      "| --- | --- | --- | --- | --- | --- |",
      "<!-- ledger:sprints -->",
      ""
    ].join("\n"),
    "utf8"
  );

  const result = ledger.appendSprintRow(
    {
      id: "S-PF-01",
      title: "Product Foundation W0 telemetry seam",
      status: "planning",
      startedAt: "2026-06-11T21:00:00.000Z"
    },
    { projectRoot: tmp }
  );

  assert.strictEqual(result.written, true, JSON.stringify(result));
  const text = fs.readFileSync(path.join(tmp, "ROADMAP.md"), "utf8");
  assert(text.includes("[S-PF-01](.claude/project/sprint/sprints/S-PF-01/)"));
});

let pass = 0;
let fail = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`PASS ${t.name}`);
    pass++;
  } catch (err) {
    console.error(`FAIL ${t.name}: ${err.stack || err.message}`);
    fail++;
  }
}

console.log(`named-sprint-id: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
