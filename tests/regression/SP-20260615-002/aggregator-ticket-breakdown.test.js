#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// aggregator-ticket-breakdown.test.js — SP-20260615-002 S-1 / AC-R1b.
//
// ::breakdown-per-sprint-from-tickets-map-one-bad-record-degrades-only-itself
//   The data aggregator emits summary.sprintBreakdown — a map keyed by EACH
//   in-flight sprint id (the same in-flight set generate() already computes) to its
//   ticket breakdown derived from the sprint record's `tickets:` state-column map:
//     { id, byState: { done[], in_progress[], in_review[], blocked[], … },
//       counts: { <state>: n }, total }
//   Asserts:
//     - the byState columns / counts / total reflect the current.yaml tickets map;
//     - PER-SPRINT fail-soft (β-4): a sprint whose record is missing/unparseable
//       degrades to { id, breakdownUnavailable:true, reason } for THAT one sprint,
//       never throwing and never blanking the other sprints' breakdowns;
//     - only in-flight sprints (non-terminal status) are keyed (a terminal sprint
//       like 'retrospected' is not in the breakdown map).
//
//   SANDBOX-SAFE: in-process generate({root}) over a temp --root fixture; the REAL
//   repo is never touched.
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

// Build a fixture root with an active-sprints.yaml listing the given {id,status}
// rows, and a sprints/<id>/current.yaml for each id present in `records`.
function makeRoot(activeRows, records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agg-breakdown-"));
  fs.mkdirSync(path.join(dir, ".claude", "project", "sprint"), { recursive: true });

  const lines = ["schema: mc/sprint/active-sprints/v1", "primary: null", "sprints:"];
  for (const r of activeRows) {
    lines.push(`  - id: ${r.id}`);
    lines.push(`    status: ${r.status}`);
  }
  fs.writeFileSync(
    path.join(dir, ".claude", "project", "sprint", "active-sprints.yaml"),
    lines.join("\n") + "\n",
  );

  for (const [id, body] of Object.entries(records || {})) {
    const sdir = path.join(dir, ".claude", "project", "sprint", "sprints", id);
    fs.mkdirSync(sdir, { recursive: true });
    fs.writeFileSync(path.join(sdir, "current.yaml"), body);
  }
  return dir;
}

// A current.yaml with the given state→[tickets] columns.
function currentYaml(id, columns) {
  const states = [
    "proposed", "planned", "designed", "ready_for_execution", "in_progress",
    "blocked", "waiting_on_human", "waiting_on_external_service", "in_review",
    "qa_failed", "redteam_failed", "done", "released", "deferred", "abandoned",
    "reopened", "superseded",
  ];
  const lines = [
    "schema: mc/sprint/current-sprint/v1",
    `id: ${id}`,
    `title: "Fixture ${id}"`,
    "status: in_progress",
    "tickets:",
  ];
  for (const s of states) {
    const tickets = (columns && columns[s]) || [];
    if (tickets.length === 0) {
      lines.push(`  ${s}: []`);
    } else {
      lines.push(`  ${s}:`);
      for (const t of tickets) lines.push(`    - ${t}`);
    }
  }
  lines.push('lane:');
  lines.push('  type: default');
  return lines.join("\n") + "\n";
}

function main() {
  // ── 1. breakdown reflects the tickets map (byState/counts/total) ────────────
  ok("breakdown per in-flight sprint: byState columns + counts + total from tickets map", () => {
    const dir = makeRoot(
      [
        { id: "SP-A", status: "in_progress" },
        { id: "SP-B", status: "review" },
      ],
      {
        "SP-A": currentYaml("SP-A", {
          done: ["T-1", "T-2"],
          in_progress: ["T-3"],
          in_review: ["T-4", "T-5", "T-6"],
          blocked: ["T-7"],
        }),
        "SP-B": currentYaml("SP-B", { done: ["T-9"] }),
      },
    );
    const { summary } = roadmap.generate({ root: dir });
    const bd = summary.sprintBreakdown;
    assert.ok(bd && typeof bd === "object", "sprintBreakdown is an object map");

    const a = bd["SP-A"];
    assert.ok(a && !a.breakdownUnavailable, "SP-A breakdown present and healthy");
    assert.deepStrictEqual(a.byState.done, ["T-1", "T-2"], "done column");
    assert.deepStrictEqual(a.byState.in_progress, ["T-3"], "in_progress column");
    assert.deepStrictEqual(a.byState.in_review, ["T-4", "T-5", "T-6"], "in_review column");
    assert.deepStrictEqual(a.byState.blocked, ["T-7"], "blocked column");
    assert.strictEqual(a.counts.done, 2, "done count");
    assert.strictEqual(a.counts.in_review, 3, "in_review count");
    assert.strictEqual(a.total, 7, "total = 2 + 1 + 3 + 1");

    const b = bd["SP-B"];
    assert.ok(b && b.total === 1 && b.counts.done === 1, "SP-B total/counts correct");
  });

  // ── 2. PER-SPRINT degrade: missing record → {breakdownUnavailable}, rest fine ─
  ok("missing record for one sprint → {id, breakdownUnavailable, reason}; others intact", () => {
    const dir = makeRoot(
      [
        { id: "SP-OK", status: "in_progress" },
        { id: "SP-MISSING", status: "in_progress" }, // no current.yaml written
      ],
      {
        "SP-OK": currentYaml("SP-OK", { done: ["T-1"], in_progress: ["T-2"] }),
      },
    );
    const { summary } = roadmap.generate({ root: dir });
    const bd = summary.sprintBreakdown;

    assert.ok(bd["SP-OK"] && bd["SP-OK"].total === 2, "healthy sprint breakdown intact");

    const m = bd["SP-MISSING"];
    assert.ok(m, "the missing-record sprint must still be keyed (surfaced as such)");
    assert.strictEqual(m.breakdownUnavailable, true, "missing record → breakdownUnavailable:true");
    assert.ok(m.id === "SP-MISSING" && m.reason, "carries id + a reason");
    // The whole call must not throw and must not blank the other sprint.
    assert.ok(!bd["SP-OK"].breakdownUnavailable, "missing one sprint does not blank another");
  });

  // ── 3. PER-SPRINT degrade: corrupt YAML record → {breakdownUnavailable} ─────
  ok("structurally-corrupt record (unterminated flow seq) → that sprint breakdownUnavailable, not silent empty", () => {
    const dir = makeRoot(
      [
        { id: "SP-GOOD", status: "in_progress" },
        { id: "SP-BAD", status: "in_progress" },
      ],
      {
        "SP-GOOD": currentYaml("SP-GOOD", { done: ["T-1"] }),
        // Unterminated flow collection — a corruption a line scanner would otherwise
        // mis-read as an empty breakdown. Must degrade THAT sprint, not normalize.
        "SP-BAD": "schema: x\nid: SP-BAD\ntickets:\n  done: [\n",
      },
    );
    const { summary } = roadmap.generate({ root: dir });
    const bd = summary.sprintBreakdown;
    assert.ok(bd["SP-GOOD"] && bd["SP-GOOD"].total === 1, "good sprint intact");
    assert.strictEqual(bd["SP-BAD"].breakdownUnavailable, true, "corrupt record degrades that sprint");
    assert.ok(!bd["SP-GOOD"].breakdownUnavailable, "corrupt sibling does not blank the good one");
  });

  // ── 4. only IN-FLIGHT sprints are keyed (terminal status excluded) ──────────
  ok("terminal-status sprints are NOT in the breakdown map (in-flight set only)", () => {
    const dir = makeRoot(
      [
        { id: "SP-LIVE", status: "in_progress" },
        { id: "SP-DEAD", status: "retrospected" }, // terminal → excluded
      ],
      {
        "SP-LIVE": currentYaml("SP-LIVE", { done: ["T-1"] }),
        "SP-DEAD": currentYaml("SP-DEAD", { done: ["T-9"] }),
      },
    );
    const { summary } = roadmap.generate({ root: dir });
    const bd = summary.sprintBreakdown;
    assert.ok(bd["SP-LIVE"], "in-flight sprint keyed");
    assert.ok(!("SP-DEAD" in bd), "terminal sprint must NOT be keyed in the breakdown");
  });

  // ── 5. direct parser probe: empty id list → empty map, no throw ─────────────
  ok("parseSprintBreakdown(root, []) → empty map, never throws", () => {
    const dir = makeRoot([], {});
    const parsed = roadmap.parseSprintBreakdown(dir, []);
    assert.deepStrictEqual(parsed.byId, {}, "no ids → empty breakdown map");
  });

  console.log(`\naggregator-ticket-breakdown: ${pass}/${pass + fail} pass`);
  process.exit(fail ? 1 : 0);
}

main();
