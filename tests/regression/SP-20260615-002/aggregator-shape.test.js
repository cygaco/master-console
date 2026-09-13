#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// aggregator-shape.test.js — SP-20260615-002 S-1 / AC-R1c.
//
// ::summary-has-four-areas-and-v1-fields-unchanged
//   Given a fully-populated --root fixture, generate({root}).summary contains ALL
//   FOUR named data areas the operator asked for —
//     (a) inFlight / activelyExecuting active sprints,
//     (b) the prioritized `ranked` roadmap order + hasPickupQueue,
//     (c) `epics`,
//     (d) `sprintBreakdown`
//   — AND the v1 fields (nextAction, ranked, inFlight, gaps, sectionsUnavailable[])
//   are STILL present and unchanged in shape, so the existing --text board and the
//   v1 regression suite stay green (extend, do not break).
//
//   SANDBOX-SAFE: in-process generate({root}) over a temp fixture tree.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "panel", "roadmap.js");
const roadmap = require(SCRIPT);

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

// Build a FULLY-populated fixture tree exercising every source.
function makeFullRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agg-shape-"));
  const sprintDir = path.join(dir, ".claude", "project", "sprint");
  const memDir = path.join(dir, ".claude", "project", "memory");
  const epicsDir = path.join(dir, "trackers", "epics");
  fs.mkdirSync(sprintDir, { recursive: true });
  fs.mkdirSync(memDir, { recursive: true });
  fs.mkdirSync(epicsDir, { recursive: true });

  // ROADMAP.md — Prioritized order + Sprint Pickup Queue.
  fs.writeFileSync(
    path.join(dir, "ROADMAP.md"),
    [
      "# Roadmap",
      "",
      "### Prioritized order",
      "",
      "**Ranked do-next:**",
      "1. **First thing** — do it",
      "2. **Second thing** — then this",
      "",
      "## Sprint Pickup Queue",
      "",
      "- something",
      "",
    ].join("\n"),
  );

  // TRACKER.md — Current Highest-Priority Next Action.
  fs.writeFileSync(
    path.join(dir, "TRACKER.md"),
    [
      "# Tracker",
      "",
      "## Current Highest-Priority Next Action",
      "",
      "**NEXT ACTION: ship the roadmap panel data layer.**",
      "",
      "## Something else",
      "",
    ].join("\n"),
  );

  // active-sprints.yaml — one active sprint with a record.
  fs.writeFileSync(
    path.join(sprintDir, "active-sprints.yaml"),
    [
      "schema: mc/sprint/active-sprints/v1",
      "primary: SP-LIVE",
      "sprints:",
      "  - id: SP-LIVE",
      "    status: in_progress",
      "",
    ].join("\n"),
  );

  // sprints/SP-LIVE/current.yaml — a tickets map.
  const sdir = path.join(sprintDir, "sprints", "SP-LIVE");
  fs.mkdirSync(sdir, { recursive: true });
  fs.writeFileSync(
    path.join(sdir, "current.yaml"),
    [
      "schema: mc/sprint/current-sprint/v1",
      "id: SP-LIVE",
      'title: "Live sprint"',
      "status: in_progress",
      "tickets:",
      "  done:",
      "    - T-1",
      "  in_progress:",
      "    - T-2",
      "  in_review: []",
      "  blocked: []",
      "lane:",
      "  type: default",
      "",
    ].join("\n"),
  );

  // enforcement-debt.jsonl + recurring-issues.jsonl — one open each.
  fs.writeFileSync(
    path.join(memDir, "enforcement-debt.jsonl"),
    JSON.stringify({ id: "ED-001", status: "open", policy: "a policy" }) + "\n",
  );
  fs.writeFileSync(
    path.join(memDir, "recurring-issues.jsonl"),
    JSON.stringify({ id: "RI-001", status: "open", title: "an issue" }) + "\n",
  );

  // trackers/epics/*.md — one epic.
  fs.writeFileSync(
    path.join(epicsDir, "E-SHAPE-001-shape.md"),
    [
      "# E-SHAPE-001 — Shape Epic",
      "",
      "- **Epic label and number:** E-SHAPE-001",
      "- **Title:** Shape Epic",
      "- **Current state:** Active",
      "- **Percent completion:** ~75% — most of the way",
      "",
      "## Related sprints",
      "- **SP-LIVE** — the live one — Active",
      "",
    ].join("\n"),
  );

  return dir;
}

function main() {
  const dir = makeFullRoot();
  const { summary } = roadmap.generate({ root: dir });

  // ── v1 fields present + unchanged in shape ──────────────────────────────────
  ok("v1 field nextAction present (string, populated)", () => {
    assert.strictEqual(typeof summary.nextAction, "string", "nextAction is a string");
    assert.ok(/ship the roadmap panel/i.test(summary.nextAction), "nextAction value parsed");
  });
  ok("v1 field ranked present (array of {n,text})", () => {
    assert.ok(Array.isArray(summary.ranked), "ranked is an array");
    assert.ok(summary.ranked.length >= 2, "ranked has the two items");
    assert.ok(
      summary.ranked.every((r) => typeof r.n === "number" && typeof r.text === "string"),
      "each ranked item has {n:number, text:string}",
    );
    assert.strictEqual(summary.hasPickupQueue, true, "hasPickupQueue detected");
  });
  ok("v1 field inFlight present (array of sprint rows)", () => {
    assert.ok(Array.isArray(summary.inFlight), "inFlight is an array");
    assert.ok(summary.inFlight.some((s) => s.id === "SP-LIVE"), "SP-LIVE is in flight");
    assert.ok(Array.isArray(summary.activelyExecuting), "activelyExecuting is an array");
  });
  ok("v1 field gaps present (enforcementDebtOpen + recurringIssuesOpen)", () => {
    assert.ok(summary.gaps && typeof summary.gaps === "object", "gaps is an object");
    assert.strictEqual(summary.gaps.enforcementDebtOpen, 1, "1 open debt");
    assert.strictEqual(summary.gaps.recurringIssuesOpen, 1, "1 open issue");
  });
  ok("v1 field sectionsUnavailable present (array, empty on a healthy fixture)", () => {
    assert.ok(Array.isArray(summary.sectionsUnavailable), "sectionsUnavailable is an array");
    assert.deepStrictEqual(summary.sectionsUnavailable, [], "fully-populated fixture → nothing unavailable");
  });

  // ── all FOUR data areas present ─────────────────────────────────────────────
  ok("area (a): inFlight / activelyExecuting active sprints present", () => {
    assert.ok("inFlight" in summary && "activelyExecuting" in summary, "active-sprints area present");
  });
  ok("area (b): ranked roadmap order + hasPickupQueue present", () => {
    assert.ok("ranked" in summary && "hasPickupQueue" in summary, "roadmap area present");
  });
  ok("area (c): epics present (array with the parsed epic)", () => {
    assert.ok(Array.isArray(summary.epics), "epics is an array");
    const e = summary.epics.find((x) => x.id === "E-SHAPE-001");
    assert.ok(e, "the fixture epic is present");
    assert.strictEqual(e.state, "Active", "epic state parsed");
    assert.strictEqual(e.percent, 75, "epic percent parsed");
    assert.deepStrictEqual(e.childSprints, ["SP-LIVE"], "epic childSprints parsed");
  });
  ok("area (d): sprintBreakdown present (keyed by in-flight sprint id)", () => {
    assert.ok(summary.sprintBreakdown && typeof summary.sprintBreakdown === "object", "sprintBreakdown is a map");
    const b = summary.sprintBreakdown["SP-LIVE"];
    assert.ok(b && b.total === 2, "SP-LIVE breakdown present with total 2");
    assert.deepStrictEqual(b.byState.done, ["T-1"], "done column threads through");
  });

  // ── the four areas + v1 fields coexist (the extend-not-break contract) ──────
  ok("four-area + v1-field coexistence: all keys present in ONE summary object", () => {
    const required = [
      // v1
      "nextAction", "ranked", "inFlight", "gaps", "sectionsUnavailable",
      // four areas (new + carried)
      "epics", "sprintBreakdown", "activelyExecuting", "hasPickupQueue",
    ];
    const missing = required.filter((k) => !(k in summary));
    assert.deepStrictEqual(missing, [], `summary missing keys: ${missing.join(", ")}`);
  });

  console.log(`\naggregator-shape: ${pass}/${pass + fail} pass`);
  process.exit(fail ? 1 : 0);
}

main();
