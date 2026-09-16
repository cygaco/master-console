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

test("CEILING is printed: GREEN says what it cannot see (β e79b4d13)", () => {
  const { rc, out } = run([{ msg_id: A }, { msg_id: B, precedent: A.slice(0, 8) }]);
  assert.equal(rc, 0, out);
  assert.match(out, /CEILING: .*never cited and never stubbed is OUTSIDE this instrument/);
});

test("RED: an issued-stub with no full verdict row is unfulfilled (the uncited-verdict class made visible) — plant isolated to ONE defect (β d8471fa6)", () => {
  // The stub is well-formed (authoritative:false) so the ONLY defect is the missing verdict row and
  // the red is attributable to exactly one rule; the case also asserts MALFORMED-STUB did NOT fire.
  const { rc, out } = run([
    { msg_id: A },
    { msg_id: GHOST, record_kind: "issued-stub", authoritative: false, issued_to: "epsilon", boundary: "r4 lane I parser" },
  ]);
  assert.equal(rc, 1, out);
  assert.match(out, new RegExp(`UNFULFILLED-STUB row 2: ${GHOST} issued to epsilon`));
  assert.doesNotMatch(out, /MALFORMED-STUB/, "the plant must trip only the rule in its title");
});

test("GREEN: an issued-stub followed by its full verdict row is fulfilled", () => {
  const { rc, out } = run([
    { msg_id: GHOST, record_kind: "issued-stub", authoritative: false, issued_to: "epsilon", boundary: "r4 lane I parser" },
    { msg_id: GHOST, record_kind: "verdict", decision: "DECIDE", answer: "the ruling" },
  ]);
  assert.equal(rc, 0, out);
  assert.match(out, /1 issued-stubs \(0 unfulfilled\)/);
});

test("GREEN: a WITHDRAWN row resolves a stub whose verdict is legitimately never appended (β b8e5f3c7 cond. 2)", () => {
  const { rc, out } = run([
    { msg_id: GHOST, record_kind: "issued-stub", authoritative: false, issued_to: "epsilon", boundary: "r4" },
    { msg_id: GHOST, record_kind: "withdrawn", reason: "superseded before append" },
  ]);
  assert.equal(rc, 0, out);
});

test("RED: a stub that could be read as a ruling is malformed (β b8e5f3c7 cond. 1)", () => {
  const noFlag = run([{ msg_id: GHOST, record_kind: "issued-stub", issued_to: "epsilon" }, { msg_id: GHOST, record_kind: "verdict" }]);
  assert.equal(noFlag.rc, 1, noFlag.out);
  assert.match(noFlag.out, /MALFORMED-STUB row 1: .*missing authoritative:false/);
  const withAnswer = run([{ msg_id: GHOST, record_kind: "issued-stub", authoritative: false, answer: "looks like a ruling" }, { msg_id: GHOST, record_kind: "verdict" }]);
  assert.equal(withAnswer.rc, 1, withAnswer.out);
  assert.match(withAnswer.out, /MALFORMED-STUB row 1: .*carries decision\/answer/);
});

// β verdict c4a06f28 (OPTION C): the ledger is gitignored by design, so a pristine tree and CI
// have no subject. Absent SUBJECT → SKIP, printed, with the path looked for. Present subject →
// the assertion runs exactly as before (present-and-broken is RED). The existence check is
// DIRECT (fs.existsSync), never inferred from exit code 2, which is also the code for other
// setup errors. This narrows row 485's "landing precondition" to a LOCAL-SUITE precondition.
// ONE gated path, used by the live case AND by the plant below (β d5c8a271: the skip branch had
// been proven only in its two passing directions; the plant proves present-and-BROKEN still
// reaches the assertion and goes RED, i.e. the existence gate does not swallow breakage).
function existenceGatedCheck(ledger, t) {
  if (!fs.existsSync(ledger)) {
    const msg = `SKIP: paths.betaEvents not present in this tree (gitignored by design) — looked for ${ledger}; referential integrity NOT evaluated here`;
    console.log(msg);
    if (t) t.diagnostic(msg);
    return { skipped: true, status: null, out: msg };
  }
  const args = [SCRIPT];
  if (ledger !== resolveLiveLedger()) args.push("--file", ledger);
  const r = spawnSync(process.execPath, args, { encoding: "utf8", cwd: path.resolve(__dirname, "../../..") });
  return { skipped: false, status: r.status, out: r.stdout + r.stderr };
}

function resolveLiveLedger() {
  const root = path.resolve(__dirname, "../../..");
  try { const p = require(path.join(root, "scripts/hooks/lib/paths")).PATHS.betaEvents; if (p) return p; } catch (_) { /* fall through */ }
  return path.join(root, ".claude/agents/president/_system/beta/events.jsonl");
}

test("LIVE LEDGER: referential integrity holds on paths.betaEvents when it is present; absent ledger SKIPS visibly (β c4a06f28)", (t) => {
  const r = existenceGatedCheck(resolveLiveLedger(), t);
  if (r.skipped) return;
  assert.equal(r.status, 0, `live ledger RED:\n${r.out}`);
});

test("PLANT (β d5c8a271): the same existence-gated path goes RED on a present-and-BROKEN ledger, then GREEN once repaired", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beta-ledger-refs-plant-"));
  const file = path.join(dir, "events.jsonl");
  // present-and-broken: a cited id with no row
  fs.writeFileSync(file, [JSON.stringify({ msg_id: A }), JSON.stringify({ msg_id: B, precedent: `row 1 (${GHOST.slice(0, 8)})` })].join("\n") + "\n");
  const broken = existenceGatedCheck(file);
  assert.equal(broken.skipped, false, "a present ledger must never take the skip branch");
  assert.equal(broken.status, 1, `present-and-broken must be RED through the gated path:\n${broken.out}`);
  assert.match(broken.out, new RegExp(`UNRESOLVED row 2 precedent: ${GHOST.slice(0, 8)}`));
  // repair by late-append → the same path goes GREEN
  fs.appendFileSync(file, JSON.stringify({ msg_id: GHOST, record_kind: "verdict" }) + "\n");
  const repaired = existenceGatedCheck(file);
  assert.equal(repaired.skipped, false);
  assert.equal(repaired.status, 0, `repaired ledger must be GREEN:\n${repaired.out}`);
  // and absence through the SAME path is the skip, not a pass-by-accident
  const absent = existenceGatedCheck(path.join(dir, "does-not-exist.jsonl"));
  assert.equal(absent.skipped, true);
  assert.match(absent.out, /^SKIP: paths\.betaEvents not present/);
});

// β verdict c1d47a92 (targeted widening): a PRESENCE-CLAIM artifact (a file whose purpose is to assert
// what is in the ledger) is in the enforcer's population. Tokens bucket as ledger-row / git-object /
// declared-unlogged / UNKNOWN; UNKNOWN is RED. This is NOT a general artifact sweep.
test("ARTIFACT MODE: an id cited in a presence-claim artifact that is neither a ledger row nor a git object is RED; declared UNLOGGED passes; git SHAs pass", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beta-ledger-refs-artifact-"));
  const ledger = path.join(dir, "events.jsonl");
  fs.writeFileSync(ledger, JSON.stringify({ msg_id: A }) + "\n");
  const headSha = spawnSync("git", ["-C", path.resolve(__dirname, "../../.."), "rev-parse", "--short=8", "HEAD"], { encoding: "utf8" }).stdout.trim();
  assert.match(headSha, /^[0-9a-f]{8}$/, "needs a git repo to resolve a real object");
  const art = path.join(dir, "RULINGS.md");
  const write = (body) => fs.writeFileSync(art, body);
  const runArt = () => { const r = spawnSync(process.execPath, [SCRIPT, "--file", ledger, "--artifact", art], { encoding: "utf8" }); return { rc: r.status, out: r.stdout + r.stderr }; };
  // GREEN: a ledger id + a real commit sha
  write(`Ruled per β \`${A.slice(0, 8)}\`, landed at ${headSha}.\n`);
  let r = runArt();
  assert.equal(r.rc, 0, r.out);
  assert.match(r.out, /ledger-row 1, git-object 1, declared-unlogged 0, UNKNOWN 0/);
  // RED: a cited id with no row and no object (the row-495 class at the moment β read it)
  write(`Ruled per β \`${GHOST.slice(0, 8)}\` (row 495).\n`);
  r = runArt();
  assert.equal(r.rc, 1, r.out);
  assert.match(r.out, new RegExp(`UNKNOWN-IN-ARTIFACT .*: ${GHOST.slice(0, 8)}`));
  // GREEN: the same id declared UNLOGGED (the shared honesty convention)
  write(`Ruled per β \`${GHOST.slice(0, 8)}\`.\n\nUNLOGGED: ${GHOST.slice(0, 8)} — cited before its row exists\n`);
  r = runArt();
  assert.equal(r.rc, 0, r.out);
  assert.match(r.out, /declared-unlogged 1, UNKNOWN 0/);
  // RED: a missing artifact file is a defect, not a skip
  const missing = spawnSync(process.execPath, [SCRIPT, "--file", ledger, "--artifact", path.join(dir, "nope.md")], { encoding: "utf8" });
  assert.equal(missing.status, 1, missing.stdout);
  assert.match(missing.stdout, /ARTIFACT-MISSING/);
  assert.match(missing.stdout, /bucket order: ledger-row → declared-unlogged → git-object → UNKNOWN/);
  assert.match(missing.stdout, /GIT-OBJECT CEILING/);
});

// LIVE ARTIFACT (β e0b3d951): the widening was proven on a fixture and wired to nothing — the third
// "enforcer exists and is not on the path" tonight. This case runs the artifact mode against the REAL
// rulings file, mirroring the live-ledger case. ABSENCE DISCRIMINATOR, recorded beside both behaviours:
//   - the LEDGER is gitignored → absent BY DESIGN in a pristine tree → visible SKIP (nothing to check
//     ledger ids against);
//   - the RULINGS FILE is committed → absent UNEXPECTEDLY → RED (a presence-claim artifact must exist).
// REGISTERED EXPIRY (β e0b3d951): this case is round-scoped. REMOVE IT when S-OS-06 closes and the
// rulings move into runtime/S-OS-06/DONE-REPORT.md — a permanent fixture pointing at a round artifact
// is the F7 stale-pin shape. Trigger: the S-OS-06 close commit. Filed under: S-OS-06 r4 close checklist.
test("LIVE ARTIFACT: runtime/S-OS-06/r4/ALPHA-RULINGS.md resolves against the live ledger (EXPIRES at S-OS-06 close; β e0b3d951)", (t) => {
  const root = path.resolve(__dirname, "../../..");
  const ledger = resolveLiveLedger();
  const rulings = path.join(root, "runtime", "S-OS-06", "r4", "ALPHA-RULINGS.md");
  if (!fs.existsSync(ledger)) {
    const msg = `SKIP: paths.betaEvents not present in this tree (gitignored by design) — looked for ${ledger}; the rulings file cannot be resolved against an absent ledger`;
    console.log(msg);
    t.diagnostic(msg);
    return;
  }
  // The artifact is committed: its absence is a defect, so no skip branch here.
  assert.ok(fs.existsSync(rulings), `presence-claim artifact missing: ${rulings}`);
  const r = spawnSync(process.execPath, [SCRIPT, "--file", ledger, "--artifact", rulings], { encoding: "utf8", cwd: root });
  assert.equal(r.status, 0, `live artifact RED:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /artifact .*ALPHA-RULINGS\.md: \d+ id-shaped tokens → ledger-row \d+, git-object \d+, declared-unlogged \d+, UNKNOWN 0/);
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

test("Baseline is keyed on the resolved TARGET, not on --file (β a71e5c34): canonical-shaped path ⇒ baseline applies; --no-baseline overrides", () => {
  // A fixture living at a canonical-shaped path gets the shipped baseline (row-keyed, so on a
  // 2-row fixture its entries are STALE → RED with STALE-BASELINE lines) — proving the baseline
  // was applied because of the TARGET, not because a flag was absent.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beta-ledger-refs-canon-"));
  const canonShaped = path.join(dir, ".claude", "agents", "president", "_system", "beta", "events.jsonl");
  fs.mkdirSync(path.dirname(canonShaped), { recursive: true });
  fs.writeFileSync(canonShaped, [JSON.stringify({ msg_id: A }), JSON.stringify({ msg_id: B, precedent: A.slice(0, 8) })].join("\n") + "\n");
  const withBaseline = spawnSync(process.execPath, [SCRIPT, "--file", canonShaped], { encoding: "utf8" });
  assert.match(withBaseline.stdout, /4 baselined historical holes/, withBaseline.stdout);
  assert.match(withBaseline.stdout, /STALE-BASELINE/, "the shipped baseline was applied to a canonical-shaped target");
  // The same fixture at a non-canonical path: no baseline, GREEN.
  const plain = run([{ msg_id: A }, { msg_id: B, precedent: A.slice(0, 8) }]);
  assert.equal(plain.rc, 0, plain.out);
  assert.match(plain.out, /0 baselined historical holes/);
  // --no-baseline is the explicit override on a canonical-shaped target.
  const noBaseline = spawnSync(process.execPath, [SCRIPT, "--file", canonShaped, "--no-baseline"], { encoding: "utf8" });
  assert.equal(noBaseline.status, 0, noBaseline.stdout);
  assert.match(noBaseline.stdout, /0 baselined historical holes/);
});

test("RED: malformed ledger line fails closed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beta-ledger-refs-bad-"));
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, JSON.stringify({ msg_id: A }) + "\n{not json\n");
  const r = spawnSync(process.execPath, [SCRIPT, "--file", file], { encoding: "utf8" });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /PARSE-ERROR row 2/);
});
