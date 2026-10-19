"use strict";
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
function consult(extra) {
  return Object.assign({ type: "beta-consult", ts: ISO, note: "x" }, extra);
}
function genericRow(extra) {
  return Object.assign({ id: "EVT-999991", ts: ISO, cat: "beta", actor: "beta", session: "s", data: { q: "?" } }, extra);
}

function betaEventsPath() {
  try {
    return require(path.join(__dirname, "..", "hooks", "lib", "paths")).PATHS.betaEvents;
  } catch {
    return path.join(__dirname, "..", "..", ".claude", "agents", "president", "_system", "beta", "events.jsonl");
  }
}

const KNOWN_LEDGER_DEFECTS = Object.freeze([]);

test("real betaEvents corpus: 0 structural findings + append-safe classification invariants", (t) => {
  const ledgerPath = betaEventsPath();
  if (!fs.existsSync(ledgerPath)) return;
  const text = fs.readFileSync(ledgerPath, "utf8");
  const res = MOD.computeFindings(text);
  const lines = text.split(/\r?\n/);

  const structural = res.findings
    .filter((f) => f.severity !== "advisory")
    .map((f) => {
      let msg_id = null;
      try {
        const row = JSON.parse(lines[f.line - 1]);
        msg_id = MOD.isPlainObject(row) && typeof row.msg_id === "string" ? row.msg_id : null;
      } catch {
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
    if (!presentMsgIds.has(k.msg_id)) continue;
    assert.ok(
      structural.some((f) => f.msg_id === k.msg_id && f.code === k.code),
      `pinned defect ${k.msg_id}/${k.code} is present in the ledger but no longer fires — the ${k.code} gate loosened (dead gate) or the defect was superseded and this pin must be retired`,
    );
  }
  assert.strictEqual(res.malformedLines, 0, "real corpus has no malformed lines");

  const parsed = text.split(/\r?\n/).filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
  const isTyped = (r) => MOD.isPlainObject(r) && typeof r.type === "string" && r.type.trim() !== "";
  const typedCount = parsed.filter(isTyped).length;
  assert.strictEqual(res.checkedConsult, typedCount, "every typed row must be checked as a consult row, none misclassified as generic");
  for (const r of parsed) {
    if (isTyped(r)) {
      assert.strictEqual(MOD.classifyRow(r), "consult", `typed row must classify consult: ${JSON.stringify(r).slice(0, 100)}`);
    }
  }
  assert.strictEqual(res.checkedConsult + res.skippedGeneric + res.unclassifiable, parsed.length, "classification must be exhaustive");
  if (!(res.checkedConsult > 0 && res.skippedGeneric > 0)) {
    t.skip("corpus lacks consult rows or generic rows — both-kinds assertion not applicable to this ledger");
    return;
  }
  assert.ok(res.checkedConsult > 0 && res.skippedGeneric > 0, "corpus has both consult and generic rows");
});

test("synthetic fixture: exact classification counts", () => {
  const text = ledger(
    consult({ boundary: "plan->design" }),
    { type: "beta-consult-verdict", ts: ISO, decision: "DECIDE" },
    genericRow(),
    genericRow({ id: "EVT-999992" }),
    { type: "beta-future-shape", ts: ISO, note: "benign" },
    "{not json",
  );
  const res = MOD.computeFindings(text);
  assert.strictEqual(res.checkedConsult, 3);
  assert.strictEqual(res.skippedGeneric, 2);
  assert.strictEqual(res.unclassifiable, 0);
  assert.strictEqual(res.malformedLines, 1);
  assert.strictEqual(res.structuralCount, 1, "the malformed line is the only structural finding");
  assert.strictEqual(res.advisoryCount, 1, "the benign unknown type is an advisory");
});

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
test("reconcile_entry_malformed fires on a null/primitive entry; object/string entries are GREEN", () => {
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-ledger-reconcile", ts: ISO, reconciles: [null] })), ["reconcile_entry_malformed"]);
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-ledger-reconcile", ts: ISO, reconciles: [42] })), ["reconcile_entry_malformed"]);
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-ledger-reconcile", ts: ISO, reconciles: [{ line: 234, msg_id: "abc" }] })), []);
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-ledger-reconcile", ts: ISO, reconciles: ["SP-x#boundary"] })), []);
});
test("empty_consult_row fires on a {type, ts}-only FLEX envelope", () => {
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-consult", ts: ISO })), ["empty_consult_row"]);
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-consult-request", ts: ISO })), ["empty_consult_row"]);
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-consult", ts: ISO, summary: "real consult" })), []);
});
test("malformed_json fires on an unparseable line and does not abort the scan", () => {
  const res = MOD.computeFindings(ledger("{not valid json", consult({ decision: "DECIDE" })));
  assert.deepStrictEqual(res.findings.map((f) => f.code), ["malformed_json"]);
  assert.strictEqual(res.checkedConsult, 1, "the well-formed row after the malformed one is still checked");
});

test("a partial {id,cat,actor} row (no session/data) is NOT generic — it is unclassifiable", () => {
  const partial = { id: "EVT-999999", ts: ISO, cat: "beta", actor: "beta" };
  assert.strictEqual(MOD.classifyRow(partial), "unclassifiable");
  const full = genericRow();
  assert.strictEqual(MOD.classifyRow(full), "generic");
});
test("a verdict-SHAPED row with an unknown type is STRUCTURAL, not advisory", () => {
  const res = MOD.computeFindings(ledger({ type: "beta-mutated", ts: ISO, decision: "DECIDE", class: "B" }));
  assert.deepStrictEqual(res.findings.map((f) => f.code), ["verdict_shaped_unknown_type"]);
  assert.strictEqual(res.structuralCount, 1);
});
test("a verdict-SHAPED row with the type field DELETED is STRUCTURAL", () => {
  const res = MOD.computeFindings(ledger({ ts: ISO, decision: "DECIDE", confidence: 0.9 }));
  assert.strictEqual(MOD.classifyRow({ ts: ISO, decision: "DECIDE" }), "unclassifiable");
  assert.deepStrictEqual(res.findings.map((f) => f.code), ["verdict_shaped_untyped_row"]);
  assert.strictEqual(res.structuralCount, 1);
});
test("a full generic-schema row with a TOP-LEVEL verdict field is NOT skipped as generic", () => {
  const hybrid = { id: "E1", ts: ISO, cat: "beta", actor: "beta", session: "s", data: {}, decision: "DECIDE" };
  assert.strictEqual(MOD.classifyRow(hybrid), "unclassifiable", "generic-skip must be by known-other-type, never an escape hatch for a verdict-shaped row");
  const res = MOD.computeFindings(ledger(hybrid));
  assert.strictEqual(res.skippedGeneric, 0);
  assert.deepStrictEqual(res.findings.map((f) => f.code), ["verdict_shaped_untyped_row"]);
});
test("a JSON null / scalar line is surfaced (unclassifiable), never crashes the scan", () => {
  const res = MOD.computeFindings(ledger("null", "42", '"hi"'));
  assert.strictEqual(res.unclassifiable, 3);
  assert.strictEqual(res.structuralCount, 0);
  assert.ok(res.findings.every((f) => f.code === "unclassifiable_row"));
  assert.strictEqual(MOD.hasVerdictShape(null), false);
  assert.strictEqual(MOD.hasContent(42), false);
  assert.strictEqual(MOD.isPlainObject([]), false);
  assert.strictEqual(MOD.isPlainObject({}), true);
});
test("a nested-array reconcile entry is malformed (typeof []==='object' loophole closed)", () => {
  assert.deepStrictEqual(structuralCodes(ledger({ type: "beta-ledger-reconcile", ts: ISO, reconciles: [[]] })), ["reconcile_entry_malformed"]);
});
test("a benign unknown type (no verdict shape) stays a graceful advisory", () => {
  const res = MOD.computeFindings(ledger({ type: "beta-some-future-shape", ts: ISO, note: "benign" }));
  assert.strictEqual(res.structuralCount, 0);
  assert.strictEqual(res.advisoryCount, 1);
  assert.strictEqual(res.findings[0].code, "unknown_type");
  assert.strictEqual(res.ok, true);
});

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
test("disclaimer names the structural-not-semantic boundary and the deferred semantic check", () => {
  assert.match(MOD.DISCLAIMER, /STRUCTURAL/);
  assert.match(MOD.DISCLAIMER, /SEMANTIC check is deferred/);
});

test("CLI SKIPS with exit 0 when the ledger is unreadable/absent", () => {
  const r = spawnSync("node", [SCRIPT, "--ledger", path.join(__dirname, "no-such-ledger-xyz.jsonl")], { encoding: "utf8" });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /SKIP \[reasoned-consult-honesty\]/);
});
test("CLI --enforce exits 1 on a real structural finding, 0 without --enforce", () => {
  const bad = path.join(__dirname, "reasoned-consult-honesty.testfixture.jsonl");
  fs.writeFileSync(bad, ledger({ type: "beta-verdict", ts: ISO }), "utf8");
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
