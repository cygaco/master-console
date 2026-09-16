"use strict";
// Falsifier for scripts/checks/beta-ledger-refs.js (β-proposed enforcer, S-OS-06 r4, 2026-09-16).
// Policy: every β-verdict id cited in a cross-reference field must resolve to a row that carries
// it as its own msg_id. Each case plants the defect class and asserts RED, or the clean shape and
// asserts GREEN. Subject of every assertion is the enforcer's exit code + its printed finding.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SCRIPT = path.resolve(__dirname, "../../../scripts/checks/beta-ledger-refs.js");

function run(lines, extraArgs = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beta-ledger-refs-"));
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, lines.map((o) => JSON.stringify(o)).join("\n") + "\n");
  const r = spawnSync(process.execPath, [SCRIPT, "--file", file, ...extraArgs], { encoding: "utf8" });
  return { rc: r.status, out: r.stdout + r.stderr, dir };
}

const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";
const GHOST = "deadbeef-0000-4000-8000-000000000000";

test("GREEN: cross-refs that resolve (full id and 8-char short id)", () => {
  const { rc, out } = run([
    { msg_id: A, precedent: "none" },
    { msg_id: B, precedent: `rows 1 (${A.slice(0, 8)})`, parent_msg_id: A },
  ]);
  assert.equal(rc, 0, out);
  assert.match(out, /GREEN/);
});

test("RED: a cross-ref annotated as logged that has no row (the row-481 class)", () => {
  const { rc, out } = run([
    { msg_id: A },
    { msg_id: B, related_beta_verdict_ids: `${GHOST} (epsilon build-boundary consult, epsilon-logged)` },
  ]);
  assert.equal(rc, 1, out);
  assert.match(out, new RegExp(`UNRESOLVED row 2 related_beta_verdict_ids: ${GHOST}`));
});

test("RED: a silently absent precedent row (the 4f7b2c93 class)", () => {
  const { rc, out } = run([
    { msg_id: A },
    { msg_id: B, precedent: "row 470 (4f7b2c93)" },
  ]);
  assert.equal(rc, 1, out);
  assert.match(out, /UNRESOLVED row 2 precedent: 4f7b2c93/);
});

test("GREEN: a reference that honestly says it is unlogged is not a false presence claim", () => {
  const { rc, out } = run([
    { msg_id: A },
    { msg_id: B, related_beta_verdict_ids: `${GHOST} — UNLOGGED at time of writing, see row 3` },
  ]);
  assert.equal(rc, 0, out);
});

test("GREEN: correction notes cite the wrong id by design and are exempt (reported, not failed)", () => {
  const { rc, out } = run([
    { msg_id: A },
    { msg_id: B, id_correction_note: `row 1 was cited as ${GHOST}; correct id is ${A}` },
  ]);
  assert.equal(rc, 0, out);
  assert.match(out, /correction-note ref row 2 id_correction_note/);
});

test("RED then GREEN: the late-append repair resolves the reference (row-482 shape)", () => {
  const before = run([
    { msg_id: A },
    { msg_id: B, precedent: `${GHOST.slice(0, 8)}` },
  ]);
  assert.equal(before.rc, 1, before.out);
  const after = run([
    { msg_id: A },
    { msg_id: B, precedent: `${GHOST.slice(0, 8)}` },
    { msg_id: GHOST, ts_note: "late-append", related_id_correction_note: `row 2 cited ${GHOST} before this row existed` },
  ]);
  assert.equal(after.rc, 0, after.out);
});

test("Baseline is shrink-only: a baselined hole that starts resolving turns RED", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beta-ledger-refs-bl-"));
  const bl = path.join(dir, "baseline.json");
  fs.writeFileSync(bl, JSON.stringify({ entries: [{ row: 2, field: "precedent", id: GHOST.slice(0, 8) }] }));
  const hole = run([{ msg_id: A }, { msg_id: B, precedent: GHOST.slice(0, 8) }], ["--baseline", bl]);
  assert.equal(hole.rc, 0, hole.out); // baselined hole is tolerated
  const healed = run([{ msg_id: A }, { msg_id: B, precedent: GHOST.slice(0, 8) }, { msg_id: GHOST }], ["--baseline", bl]);
  assert.equal(healed.rc, 1, healed.out); // now resolves → baseline stale → RED
  assert.match(healed.out, /STALE-BASELINE row 2 precedent/);
});

test("RED: malformed ledger line fails closed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beta-ledger-refs-bad-"));
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, JSON.stringify({ msg_id: A }) + "\n{not json\n");
  const r = spawnSync(process.execPath, [SCRIPT, "--file", file], { encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /PARSE-ERROR row 2/);
});
