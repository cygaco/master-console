"use strict";
/**
 * Tests for reasoned-consult-honesty.js (ED-234). Authentic teeth:
 *  - REAL-CORPUS 0-false-reject + append-safe INVARIANTS (no typed row misclassified as generic;
 *    exhaustive classification; 0 malformed) — binds coverage without pinning absolute counts against a
 *    live-growing ledger (backend r1 MED-2, corrected: absolute counts would rot on the next β append).
 *  - SYNTHETIC-FIXTURE exact classification counts — catches a misclassification regression deterministically.
 *  - PLANTED structural REDs: each violation code fires on a crafted row (incl. the r1 fixes F1-F3).
 *  - GRACEFUL GREENs: null/object confidence, optional fields, verdict-or-decision, generic rows.
 *  - ADVISORY vs STRUCTURAL: benign unknown type = advisory; verdict-SHAPED unknown/untyped = structural.
 *  - CLI teeth (spawnSync): SKIP-when-unreadable exit 0, --enforce exit 1 on a real finding, disclaimer.
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const MOD = require("./reasoned-consult-honesty");
const SCRIPT = path.join(__dirname, "reasoned-consult-honesty.js");
const ISO = "2026-07-23T12:00:00Z";

function ledger(...rows) {
  return rows.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n");
}
function structuralCodes(text) {
  return MOD.computeFindings(text).findings.filter((f) => f.severity !== "advisory").map((f) => f.code);
}
// A valid FLEX consult row carries a content field (`note`); tests of a SPECIFIC value-domain add their
// field on top so the empty_consult_row check (F1) does not also fire and obscure the assertion.
function consult(extra) {
  return Object.assign({ type: "beta-consult", ts: ISO, note: "x" }, extra);
}
function genericRow(extra) {
  return Object.assign({ id: "EVT-1", ts: ISO, cat: "beta", actor: "beta", session: "s", data: { q: "?" } }, extra);
}

function betaEventsPath() {
  try {
    return require(path.join(__dirname, "..", "hooks", "lib", "paths")).PATHS.betaEvents;
  } catch {
    return path.join(__dirname, "..", "..", ".claude", "agents", "president", "_system", "beta", "events.jsonl");
  }
}

// ── REAL-CORPUS 0-false-reject + append-safe invariants (the binding tooth β byte-verifies) ─────────────
//
// KNOWN LEDGER DEFECTS — the ledger is APPEND-ONLY and gitignored (operator-local), so a row that was
// malformed at write-time stays malformed forever; it can be superseded by a later correction row but never
// rewritten, and this enforcer is STRUCTURAL (it does not honor `corrects`/supersession — that is the
// SEMANTIC lane, ED-275). Each entry pins ONE row by writer-stamped msg_id + the exact finding code, with the
// reason it is tolerated. Both directions are asserted: an unpinned structural finding still REDs (a NEW
// malformed row is caught), and a pinned row that is PRESENT must still FIRE (a loosened vocab gate that
// stops seeing the known defect is a dead gate, and a retired defect must retire its pin). The CLI enforcer
// (`--enforce`, /scan:full) is NOT loosened by this list — it still reports the row.
const KNOWN_LEDGER_DEFECTS = Object.freeze([
  Object.freeze({
    msg_id: "d5a6bc49-c1dc-4f71-a180-1d34d045d6a0",
    code: "invalid_decision",
    reason:
      "2026-08-29 S-VLADW1-05 `beta-consult`/`consult-request` row: the controlled `decision` field holds a prose " +
      "status sentence ('ANSWERED by beta row 342 …') instead of the vocab token REQUESTED; written by the " +
      "epsilon Edit-anchor append lane, cannot be rewritten (append-only). Remedy owed: a correction row + " +
      "ED-275 supersession semantics; until then the enforcer keeps reporting it and this pin keeps it visible.",
  }),
]);

test("real betaEvents corpus: 0 structural findings + append-safe classification invariants", () => {
  const ledgerPath = betaEventsPath();
  if (!fs.existsSync(ledgerPath)) return; // fresh clone / CI: gitignored ledger absent — enforcer SKIPS.
  const text = fs.readFileSync(ledgerPath, "utf8");
  const res = MOD.computeFindings(text);
  const lines = text.split(/\r?\n/);

  // Structural findings, each joined to the writer-stamped msg_id of its row (findings carry only line numbers).
  const structural = res.findings
    .filter((f) => f.severity !== "advisory")
    .map((f) => {
      let msg_id = null;
      try {
        const row = JSON.parse(lines[f.line - 1]);
        msg_id = MOD.isPlainObject(row) && typeof row.msg_id === "string" ? row.msg_id : null;
      } catch {
        /* malformed_json rows have no msg_id; they are never pinnable */
      }
      return { line: f.line, code: f.code, msg_id, detail: f.detail };
    });
  const isPinned = (f) => KNOWN_LEDGER_DEFECTS.some((k) => k.msg_id === f.msg_id && k.code === f.code);
  const unexpected = structural.filter((f) => !isPinned(f));
  assert.deepStrictEqual(
    unexpected,
    [],
    `real corpus must be structurally clean apart from the pinned KNOWN_LEDGER_DEFECTS; unpinned finding(s) — either the ` +
      `checker false-rejects a legitimate shape (fix the checker's vocabulary) or a NEW malformed row was appended ` +
      `(report it; the ledger is append-only, never edit it): ${JSON.stringify(unexpected)}`,
  );
  // The other direction: a pinned defect whose row is PRESENT in this ledger must still be detected.
  const presentMsgIds = new Set(
    lines
      .filter((l) => l.trim() !== "")
      .map((l) => {
        try {
          const r = JSON.parse(l);
          return MOD.isPlainObject(r) ? r.msg_id : null;
        } catch {
          return null;
        }
      }),
  );
  for (const k of KNOWN_LEDGER_DEFECTS) {
    if (!presentMsgIds.has(k.msg_id)) continue; // another operator's ledger — the pin is simply unused here
    assert.ok(
      structural.some((f) => f.msg_id === k.msg_id && f.code === k.code),
      `pinned defect ${k.msg_id}/${k.code} is present in the ledger but no longer fires — the ${k.code} gate loosened (dead gate) or the defect was superseded and this pin must be retired`,
    );
  }
  assert.strictEqual(res.malformedLines, 0, "real corpus has no malformed lines");

  // Ground-truth re-derivation from the SAME bytes (append-safe: no hardcoded totals).
  const parsed = text.split(/\r?\n/).filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
  // Null-safe typed predicate (r3 7G-005): a JSON `null`/scalar line the enforcer handles gracefully must
  // not throw in the test either — mirror the production isPlainObject guard.
  const isTyped = (r) => MOD.isPlainObject(r) && typeof r.type === "string" && r.type.trim() !== "";
  const typedCount = parsed.filter(isTyped).length;
  // NO typed row may be classified generic (the r1 HIGH-2 misclassification-bypass regression).
  assert.strictEqual(res.checkedConsult, typedCount, "every typed row must be checked as a consult row, none misclassified as generic");
  // Row-IDENTITY (r2 7G-004): assert per-row, not just the aggregate count — a count can be satisfied by
  // compensating misclassifications; classify EVERY typed row and confirm it is "consult".
  for (const r of parsed) {
    if (isTyped(r)) {
      assert.strictEqual(MOD.classifyRow(r), "consult", `typed row must classify consult: ${JSON.stringify(r).slice(0, 100)}`);
    }
  }
  // Classification is exhaustive: every non-empty line lands in exactly one bucket.
  assert.strictEqual(res.checkedConsult + res.skippedGeneric + res.unclassifiable, parsed.length, "classification must be exhaustive");
  assert.ok(res.checkedConsult > 0 && res.skippedGeneric > 0, "corpus has both consult and generic rows");
});

// ── SYNTHETIC-FIXTURE exact classification counts (deterministic regression catch) ─────────────────────
test("synthetic fixture: exact classification counts", () => {
  const text = ledger(
    consult({ boundary: "plan->design" }),                                   // consult
    { type: "beta-consult-verdict", ts: ISO, decision: "DECIDE" },            // consult (verdict family)
    genericRow(),                                                            // generic
    genericRow({ id: "EVT-2" }),                                             // generic
    { type: "beta-future-shape", ts: ISO, note: "benign" },                  // consult, advisory unknown_type
    "{not json",                                                            // malformed
  );
  const res = MOD.computeFindings(text);
  assert.strictEqual(res.checkedConsult, 3);
  assert.strictEqual(res.skippedGeneric, 2);
  assert.strictEqual(res.unclassifiable, 0);
  assert.strictEqual(res.malformedLines, 1);
  assert.strictEqual(res.structuralCount, 1, "the malformed line is the only structural finding");
  assert.strictEqual(res.advisoryCount, 1, "the benign unknown type is an advisory");
});

// ── PLANTED structural REDs ────────────────────────────────────────────────────
test("invalid_decision fires on a decision outside the vocab", () => {
  assert.deepStrictEqual(structuralCodes(ledger(consult({ decision: "MAYBE" }))), ["invalid_decision"]);
});
test("invalid_class fires on a class outside {A,B,C}", () => {
  assert.deepStrictEqual(structuralCodes(ledger(consult({ class: "Z" }))), ["invalid_class"]);
});
test("invalid_confidence fires on out-of-range number, wrong type, and bad object value", () => {
  assert.deepStrictEqual(structuralCodes(ledger(consult({ confidence: 1.5 }))), ["invalid_confidence"]);
  assert.deepStrictEqual(structuralCodes(ledger(consult({ confidence: "high" }))), ["invalid_confidence"]);
  assert.deepStrictEqual(structuralCodes(ledger(consult({ confidence: { a: 2 } }))), ["invalid_confidence"]);
});
test("invalid_msg_id fires on a whitespace-bearing id", () => {
  assert.deepStrictEqual(structuralCodes(ledger(consult({ msg_id: "has space" }))), ["invalid_msg_id"]);
});
test("missing_or_invalid_ts fires on absent and unparseable ts", () => {
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-consult", note: "x" })), ["missing_or_invalid_ts"]);
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-consult", ts: "not-a-date", note: "x" })), ["missing_or_invalid_ts"]);
});
test("verdict_row_missing_verdict fires on a verdict type with neither decision nor verdict", () => {
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-verdict", ts: ISO })), ["verdict_row_missing_verdict"]);
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-consult-verdict", ts: ISO })), ["verdict_row_missing_verdict"]);
});
test("reconcile_missing_reconciles fires on absent and empty reconciles[]", () => {
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-ledger-reconcile", ts: ISO })), ["reconcile_missing_reconciles"]);
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-ledger-reconcile", ts: ISO, reconciles: [] })), ["reconcile_missing_reconciles"]);
});
test("F3: reconcile_entry_malformed fires on a null/primitive entry; object/string entries are GREEN", () => {
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-ledger-reconcile", ts: ISO, reconciles: [null] })), ["reconcile_entry_malformed"]);
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-ledger-reconcile", ts: ISO, reconciles: [42] })), ["reconcile_entry_malformed"]);
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-ledger-reconcile", ts: ISO, reconciles: [{ line: 234, msg_id: "abc" }] })), []);
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-ledger-reconcile", ts: ISO, reconciles: ["SP-x#boundary"] })), []);
});
test("F1: empty_consult_row fires on a {type, ts}-only FLEX envelope", () => {
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-consult", ts: ISO })), ["empty_consult_row"]);
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-consult-request", ts: ISO })), ["empty_consult_row"]);
  // A content field clears it.
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-consult", ts: ISO, summary: "real consult" })), []);
});
test("malformed_json fires on an unparseable line and does not abort the scan", () => {
  const res = MOD.computeFindings(ledger("{not valid json", consult({ decision: "DECIDE" })));
  assert.deepStrictEqual(res.findings.map((f) => f.code), ["malformed_json"]);
  assert.strictEqual(res.checkedConsult, 1, "the well-formed row after the malformed one is still checked");
});

// ── F2: classification-bypass hardening ─────────────────────────────────────────
test("F2a: a partial {id,cat,actor} row (no session/data) is NOT generic — it is unclassifiable", () => {
  const partial = { id: "EVT-9", ts: ISO, cat: "beta", actor: "beta" };
  assert.strictEqual(MOD.classifyRow(partial), "unclassifiable");
  const full = genericRow();
  assert.strictEqual(MOD.classifyRow(full), "generic");
});
test("F2b: a verdict-SHAPED row with an unknown type is STRUCTURAL, not advisory", () => {
  const res = MOD.computeFindings(ledger({ type: "beta-mutated", ts: ISO, decision: "DECIDE", class: "B" }));
  assert.deepStrictEqual(res.findings.map((f) => f.code), ["verdict_shaped_unknown_type"]);
  assert.strictEqual(res.structuralCount, 1);
});
test("F2b: a verdict-SHAPED row with the type field DELETED is STRUCTURAL", () => {
  const res = MOD.computeFindings(ledger({ ts: ISO, decision: "DECIDE", confidence: 0.9 }));
  assert.strictEqual(MOD.classifyRow({ ts: ISO, decision: "DECIDE" }), "unclassifiable");
  assert.deepStrictEqual(res.findings.map((f) => f.code), ["verdict_shaped_untyped_row"]);
  assert.strictEqual(res.structuralCount, 1);
});
test("r2 7G-001: a full generic-schema row with a TOP-LEVEL verdict field is NOT skipped as generic", () => {
  const hybrid = { id: "E1", ts: ISO, cat: "beta", actor: "beta", session: "s", data: {}, decision: "DECIDE" };
  assert.strictEqual(MOD.classifyRow(hybrid), "unclassifiable", "generic-skip must be by known-other-type, never an escape hatch for a verdict-shaped row");
  const res = MOD.computeFindings(ledger(hybrid));
  assert.strictEqual(res.skippedGeneric, 0);
  assert.deepStrictEqual(res.findings.map((f) => f.code), ["verdict_shaped_untyped_row"]);
});
test("r2 7G-002: a JSON null / scalar line is surfaced (unclassifiable), never crashes the scan", () => {
  const res = MOD.computeFindings(ledger("null", "42", '"hi"'));
  assert.strictEqual(res.unclassifiable, 3);
  assert.strictEqual(res.structuralCount, 0);
  assert.ok(res.findings.every((f) => f.code === "unclassifiable_row"));
  // helpers are non-object-safe
  assert.strictEqual(MOD.hasVerdictShape(null), false);
  assert.strictEqual(MOD.hasContent(42), false);
  assert.strictEqual(MOD.isPlainObject([]), false);
  assert.strictEqual(MOD.isPlainObject({}), true);
});
test("r2 7G-003: a nested-array reconcile entry is malformed (typeof []==='object' loophole closed)", () => {
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-ledger-reconcile", ts: ISO, reconciles: [[]] })), ["reconcile_entry_malformed"]);
});
test("a benign unknown type (no verdict shape) stays a graceful advisory", () => {
  const res = MOD.computeFindings(ledger({ type: "beta-some-future-shape", ts: ISO, note: "benign" }));
  assert.strictEqual(res.structuralCount, 0);
  assert.strictEqual(res.advisoryCount, 1);
  assert.strictEqual(res.findings[0].code, "unknown_type");
  assert.strictEqual(res.ok, true);
});

// ── GRACEFUL GREENs (must NOT produce a structural finding) ─────────────────────
test("confidence:null (not-applicable marker) is GREEN", () => {
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-consult-request", ts: ISO, boundary: "plan->design", from: "epsilon", to: "beta", confidence: null })), []);
});
test("per-dimension confidence object is GREEN", () => {
  assert.deepStrictEqual(structuralCodes(ledger(consult({ topic: "epic", confidence: { lane_a: 0.9, lane_b: 0.82 } }))), []);
});
test("optional fields (self_correction/supersedes/ts_approx/priming/riders/note) are GREEN", () => {
  const row = consult({ decision: "DECIDE", class: "B", confidence: 0.87, self_correction: "x", supersedes: "y", ts_approx: true, priming: "z", riders: [] });
  assert.deepStrictEqual(structuralCodes(ledger(row)), []);
});
test("verdict family passes with verdict-only OR decision-only", () => {
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-consult-retraction", ts: ISO, verdict: "RETRACTED-ATTRIBUTION" })), []);
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-consult-verdict", ts: ISO, decision: "DECIDE" })), []);
});
test("lowercase decision token is accepted (case-insensitive, graceful)", () => {
  assert.deepStrictEqual(structuralCodes(ledger(consult({ decision: "decide" }))), []);
});
test("full 5-field generic logger row is classified generic and skipped", () => {
  assert.strictEqual(MOD.classifyRow(genericRow()), "generic");
  const res = MOD.computeFindings(ledger(genericRow()));
  assert.strictEqual(res.skippedGeneric, 1);
  assert.strictEqual(res.structuralCount, 0);
});

// ── helper unit teeth ───────────────────────────────────────────────────────────
test("isProvided treats null and undefined as not-provided", () => {
  assert.strictEqual(MOD.isProvided(null), false);
  assert.strictEqual(MOD.isProvided(undefined), false);
  assert.strictEqual(MOD.isProvided(0), true);
  assert.strictEqual(MOD.isProvided(""), true);
});
test("confidenceValid accepts scalar and object, rejects out-of-range and array", () => {
  assert.strictEqual(MOD.confidenceValid(0.5), true);
  assert.strictEqual(MOD.confidenceValid({ a: 0.5, b: 0.9 }), true);
  assert.strictEqual(MOD.confidenceValid(1.1), false);
  assert.strictEqual(MOD.confidenceValid([0.5]), false);
  assert.strictEqual(MOD.confidenceValid({}), false);
});
test("hasVerdictShape and hasContent detect the intended fields", () => {
  assert.strictEqual(MOD.hasVerdictShape({ decision: "DECIDE" }), true);
  assert.strictEqual(MOD.hasVerdictShape({ note: "x" }), false);
  assert.strictEqual(MOD.hasContent({ boundary: "b" }), true);
  assert.strictEqual(MOD.hasContent({ logged_by: "x" }), false);
});
test("disclaimer names the structural-not-semantic boundary and ED-275", () => {
  assert.match(MOD.DISCLAIMER, /STRUCTURAL/);
  assert.match(MOD.DISCLAIMER, /ED-275/);
});

// ── CLI teeth (spawnSync) ───────────────────────────────────────────────────────
test("CLI SKIPS with exit 0 when the ledger is unreadable/absent", () => {
  const r = spawnSync("node", [SCRIPT, "--ledger", path.join(__dirname, "no-such-ledger-xyz.jsonl")], { encoding: "utf8" });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /SKIP \[reasoned-consult-honesty\]/);
});
test("CLI --enforce exits 1 on a real structural finding, 0 without --enforce", () => {
  const bad = path.join(__dirname, "reasoned-consult-honesty.testfixture.jsonl");
  fs.writeFileSync(bad, ledger({ type: "beta-verdict", ts: ISO }), "utf8"); // verdict row missing verdict
  try {
    const enforced = spawnSync("node", [SCRIPT, "--ledger", bad, "--enforce"], { encoding: "utf8" });
    assert.strictEqual(enforced.status, 1, "enforce must exit 1 on a structural finding");
    assert.match(enforced.stderr, /verdict_row_missing_verdict/);
    const reportOnly = spawnSync("node", [SCRIPT, "--ledger", bad], { encoding: "utf8" });
    assert.strictEqual(reportOnly.status, 0, "report-only default must exit 0 even with a finding");
  } finally {
    fs.rmSync(bad, { force: true });
  }
});
test("CLI prints the structural-not-semantic disclaimer on a clean GREEN run", () => {
  const good = path.join(__dirname, "reasoned-consult-honesty.testfixture-green.jsonl");
  fs.writeFileSync(good, ledger({ type: "beta-consult-verdict", ts: ISO, decision: "DECIDE", class: "B", confidence: 0.9 }), "utf8");
  try {
    const r = spawnSync("node", [SCRIPT, "--ledger", good], { encoding: "utf8" });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /OK   \[reasoned-consult-honesty\]/);
    assert.match(r.stdout, /STRUCTURAL well-formedness only/);
  } finally {
    fs.rmSync(good, { force: true });
  }
});
