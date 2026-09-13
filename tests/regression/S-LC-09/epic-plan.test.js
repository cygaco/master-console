#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// epic-plan.test.js — S-LC-09. /epic:plan's backing logic (scripts/epic/plan.js)
// MUST emit a section-complete, round-trip-linked epic file (the brief's
// "validate-passing / section-complete" proof). The tracker validator lints
// TRACKER.md, not an epic file body, so an epic file's correctness IS its
// section-completeness (verifyEpicMarkdown, parsed by the SAME splitSections the
// validator uses) + a resolvable tracker linkage.
//
// PLANTED VIOLATIONS (no false-green): an epic with a required section deleted
// MUST fail verify; an empty-DoD payload MUST be refused.
// ─────────────────────────────────────────────────────────────────────────────

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const { harness } = require(path.join(ROOT, "scripts", "checks", "lib", "fixture-harness"));
const plan = require(path.join(ROOT, "scripts", "epic", "plan.js"));
const { verifyEpicMarkdown } = require(path.join(ROOT, "scripts", "epic", "lib.js"));

const h = harness("S-LC-09/epic-plan");

function goodPayload(over) {
  return {
    epicId: "E-EXAMPLE-001",
    slug: "example-epic",
    title: "Example Epic for the S-LC-09 Test",
    owner: "President Agent",
    goal: "Prove /epic:plan emits a validate-shape epic file.",
    background: "S-LC-09 regression fixture.",
    scope: "The example scope.",
    outOfScope: "Everything else.",
    definitionOfDone: ["DoD item one — proven by X.", "DoD item two — proven by Y."],
    acceptanceCriteria: ["AC: correct tracker linkage — proven by this test."],
    sprintCandidates: [{ id: "S-EX-01", goal: "first wave", state: "Planned" }],
    dependencies: ["E-OTHER-001 — prerequisite"],
    risks: ["a risk — mitigation"],
    decisions: [{ date: "2026-06-09", text: "one epic" }],
    openQuestions: ["an open question"],
    date: "2026-06-09",
    sessionId: "TEST-S-LC-09",
    agent: "Alex",
    ...over,
  };
}

// ── PURE core: a complete payload builds a section-complete, linked epic ──────
h.pass("buildEpic: complete payload → section-complete + round-trip linked", () => {
  const built = plan.buildEpic(goodPayload());
  return (
    built.ok === true &&
    built.verify.ok === true &&
    built.linkage.epicPointsToPlan === true &&
    built.linkage.planPointsToEpic === true
  );
});

h.pass("verifyEpicMarkdown: every required H2 section present + non-blank in the emitted epic", () => {
  const built = plan.buildEpic(goodPayload());
  const v = verifyEpicMarkdown(built.epic);
  return v.ok && v.missing.length === 0 && v.blank.length === 0;
});

h.pass("companion plan carries the tracker-linkage pointer back to the epic file", () => {
  const built = plan.buildEpic(goodPayload());
  return built.plan.includes("trackers/epics/E-EXAMPLE-001-example-epic.md");
});

// ── PLANTED VIOLATION #1: an epic missing a required section must FAIL verify ──
h.violation("verifyEpicMarkdown: an epic with the DoD section deleted FAILS (no false-green)", () => {
  const built = plan.buildEpic(goodPayload());
  const broken = built.epic.replace(/## Definition of Done[\s\S]*?(?=\n## )/, "");
  return verifyEpicMarkdown(broken); // { ok:false, missing:[...] } → not-pass
});

// ── PLANTED VIOLATION #2: an empty-DoD payload must be refused ─────────────────
h.violation("buildEpic: empty-DoD payload is refused (blank required section)", () => {
  return plan.buildEpic(goodPayload({ definitionOfDone: [] })); // { ok:false, errors:[...] }
});

// ── END-TO-END: the CLI writes both artifacts, is idempotent, refuses clobber ─
h.test("end-to-end: plan.js emits both artifacts into a sealed root; idempotent + read-before-write", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-eplan-"));
  try {
    const payloadFile = path.join(tmp, "payload.json");
    fs.writeFileSync(payloadFile, JSON.stringify(goodPayload()), "utf8");
    const PLAN = path.join(ROOT, "scripts", "epic", "plan.js");
    const env = { ...process.env, CLAUDE_PROJECT_DIR: tmp };

    // first run → exit 0, both files emitted
    let r = spawnSync(process.execPath, [PLAN, "--payload", payloadFile], { encoding: "utf8", env });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
    const epicFile = path.join(tmp, "trackers", "epics", "E-EXAMPLE-001-example-epic.md");
    const planFile = path.join(tmp, "_planning", "epics", "E-EXAMPLE-001.md");
    assert.ok(fs.existsSync(epicFile), "epic file emitted");
    assert.ok(fs.existsSync(planFile), "plan artifact emitted under _planning/epics/ (defensive mkdir-p)");

    const epicMd = fs.readFileSync(epicFile, "utf8");
    assert.ok(verifyEpicMarkdown(epicMd).ok, "emitted epic is section-complete on disk");
    assert.ok(epicMd.includes("_planning/epics/E-EXAMPLE-001.md"), "epic points to plan");
    assert.ok(
      fs.readFileSync(planFile, "utf8").includes("trackers/epics/E-EXAMPLE-001-example-epic.md"),
      "plan points to epic (round-trip)",
    );

    // read-before-write: a second run WITHOUT --force refuses (exit 3), file unchanged
    const before = fs.readFileSync(epicFile, "utf8");
    r = spawnSync(process.execPath, [PLAN, "--payload", payloadFile], { encoding: "utf8", env });
    assert.strictEqual(r.status, 3, "refuses to clobber without --force");
    assert.strictEqual(fs.readFileSync(epicFile, "utf8"), before, "file untouched after the refusal");

    // idempotent: --force reproduces byte-identical content
    r = spawnSync(process.execPath, [PLAN, "--payload", payloadFile, "--force"], { encoding: "utf8", env });
    assert.strictEqual(r.status, 0, "force re-run ok");
    assert.strictEqual(fs.readFileSync(epicFile, "utf8"), before, "idempotent: identical content on a --force re-run");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

h.done();
