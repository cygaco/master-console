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

test("GREEN: an honest absence is declared STRUCTURALLY in unlogged_refs, per id", () => {
  const { rc, out } = run([
    { msg_id: A },
    { msg_id: B, related_beta_verdict_ids: `${GHOST} — unlogged at time of writing`, unlogged_refs: [GHOST] },
  ]);
  assert.equal(rc, 0, out);
  assert.match(out, /declared in unlogged_refs/);
});

test("RED: a prose 'unlogged' marker is NOT an escape (β d9c17e45 F2 — absolution by regex removed)", () => {
  const { rc, out } = run([
    { msg_id: A },
    { msg_id: B, related_beta_verdict_ids: `${GHOST} — UNLOGGED at time of writing, see row 3` },
  ]);
  assert.equal(rc, 1, out);
  assert.match(out, new RegExp(`UNRESOLVED row 2 related_beta_verdict_ids: ${GHOST}`));
});

test("RED: one honest declaration must not absolve a NEIGHBOURING id in the same string", () => {
  const GHOST2 = "feedface-0000-4000-8000-000000000000";
  const { rc, out } = run([
    { msg_id: A },
    { msg_id: B, related_beta_verdict_ids: `${GHOST} (unlogged, see below); ${GHOST2} (epsilon-logged)`, unlogged_refs: [GHOST] },
  ]);
  assert.equal(rc, 1, out);
  assert.match(out, new RegExp(`UNRESOLVED row 2 related_beta_verdict_ids: ${GHOST2}`));
  assert.doesNotMatch(out, new RegExp(`UNRESOLVED row 2 related_beta_verdict_ids: ${GHOST}\\b`));
});

test("Field selection is a PROPERTY: a never-seen cross-ref field name is scanned by default (β F1)", () => {
  const { rc, out } = run([
    { msg_id: A },
    { msg_id: B, ratifies_prior_ruling_ids: `${GHOST}` },
  ]);
  assert.equal(rc, 1, out);
  assert.match(out, /UNRESOLVED row 2 ratifies_prior_ruling_ids/);
});

test("Excluded-by-property fields (consult ids, git SHAs, narrative) do not fail on foreign ids", () => {
  const { rc, out } = run([
    { msg_id: A },
    { msg_id: B, epsilon_consult_msg_id: GHOST, consult_thread: "deadbeef", commit: "0defcd64", verified_head: "9699d7fc", summary: `see ${GHOST}`, answer: "harness msg deadbeef" },
  ]);
  assert.equal(rc, 0, out);
});

test("Population reconciliation: every EXCLUDED field is emitted with its id-shaped token count (β e4b7d209)", () => {
  const { rc, out } = run([
    { msg_id: A },
    { msg_id: B, epsilon_consult_msg_id: GHOST, commit: "0defcd64", summary: `see ${GHOST} and deadbeef`, answer: "none" },
  ]);
  assert.equal(rc, 0, out);
  assert.match(out, /excluded-by-property \(\d+ field names/);
  assert.match(out, /\bsummary=2\b/);
  assert.match(out, /\bcommit=1\b/);
  assert.match(out, /\bepsilon_consult_msg_id=1\b/);
  assert.match(out, /\banswer=0\b/);
});

test("Prefix ceiling is printed; slug-style own ids do not collide on prefix", () => {
  const { rc, out } = run([
    { msg_id: "evt-s-sp-20260512-001-beta-001" },
    { msg_id: "evt-s-sp-20260512-001-beta-002", precedent: "evt-s-sp-20260512-001-beta-001" },
  ]);
  assert.equal(rc, 0, out);
  assert.match(out, /prefix ceiling 8 hex \(0 collisions\)/);
});

test("RED: two hex ids sharing the prefix ceiling make short-id resolution ambiguous", () => {
  const { rc, out } = run([
    { msg_id: "c0ffee00-1111-4111-8111-111111111111" },
    { msg_id: "c0ffee00-2222-4222-8222-222222222222" },
  ]);
  assert.equal(rc, 1, out);
  assert.match(out, /PREFIX-COLLISION c0ffee00/);
});

test("LIVE LEDGER: referential integrity holds on paths.betaEvents (this is the CI hook, β F4)", () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", cwd: path.resolve(__dirname, "../../..") });
  assert.equal(r.status, 0, `live ledger RED:\n${r.stdout}${r.stderr}`);
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
