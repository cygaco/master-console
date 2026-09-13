#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
/**
 * epsilon-paired-waiter.test.js — teeth for the ED-256 paired-waiter check (r3, DoE design-lock).
 * SCOPE FROM LEDGER STATE (security r2 #4): a started row with NO terminal completion is OUTSTANDING; a
 * terminal completion (any ok) means the wrapper lived to write it — an honest ok:FALSE death suppresses
 * unconditionally (backend r2 #4), a SUCCESS (ok:true) suppresses only when VERIFIED (security r2 #1).
 * Liveness of a produced artifact is real-file/non-empty/produced-after-start (β), lstat (ED-270 symlink).
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { evaluatePairedWaiter, artifactProducedFs } = require("./epsilon-liveness.js");
const { startedRow } = require("../dispatch/dispatch-record-fields.js");

let pass = 0, fail = 0, skip = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  PASS  " + name); }
  catch (e) {
    // A LOUD skip (not a silent PASS — backend r3: a green-on-skip is the honesty class this sprint kills).
    if (e && e.__skip) { skip++; console.log("  SKIP  " + name + " — " + e.message); return; }
    fail++; console.error("  FAIL  " + name + " — " + (e && e.message ? e.message : e));
  }
}
function skipTest(msg) { const e = new Error(msg); e.__skip = true; throw e; }

const NOW = Date.parse("2026-07-23T08:00:00.000Z");
const STALE = 10 * 60 * 1000;
const min = (m) => new Date(NOW - m * 60 * 1000).toISOString();
const started = (o) => ({ phase: "started", ok: false, dispatch_id: o.id, role: o.role || "backend-builder", started_at: o.at, ...o.extra });
// A REAL production completion record: recordCompletion stamps NO `phase` field, HAS completed_at
// (hunter r3 — the earlier fabricated phase:"completion" masked the over-fire on the real shape).
const completion = (id, ok, extra) => ({ ok, dispatch_id: id, role: "backend-builder", provider: "openai", completed_at: min(20), ...extra });
const verifyAll = () => true;
const verifyNone = () => false;
const producedOnly = (real) => (p) => p === real;

// ── scope-from-ledger-state ──────────────────────────────────────────────────────────────────────────

t("security r2 #4: a production-shape started row with NO terminal + stale -> FIRES (was inert)", () => {
  const recs = [started({ id: "d0", at: min(30) })]; // no background/artifact_path fields at all
  const r = evaluatePairedWaiter({ records: recs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyNone });
  assert.strictEqual(r.findings.length, 1, "the check must fire on a real-shape outstanding row: " + JSON.stringify(r));
});

t("backend r2 #4: a VERIFIED ok:FALSE death (signed) SUPPRESSES -> NOT flagged", () => {
  const recs = [started({ id: "d1", at: min(30) }), completion("d1", false)];
  const r = evaluatePairedWaiter({ records: recs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyAll });
  assert.deepStrictEqual(r.findings, [], "a verified ok:false death means the wrapper lived: " + JSON.stringify(r));
});

t("7G-004: a FORGED UNSIGNED ok:FALSE does NOT suppress -> FLAGGED (settable-label asymmetry closed)", () => {
  const recs = [started({ id: "d1f", at: min(30) }), completion("d1f", false)];
  const r = evaluatePairedWaiter({ records: recs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyNone });
  assert.strictEqual(r.findings.length, 1, "an UNVERIFIED ok:false must not suppress a stall: " + JSON.stringify(r));
});

t("7G-004 (default verifier): a REAL-SIGNED ok:false death suppresses; an UNSIGNED one does not", () => {
  const { signRecord } = require("../dispatch/attest-signing.js");
  const startedR = started({ id: "sig1", at: min(30) });
  const deathBase = { ok: false, dispatch_id: "sig1", role: "backend-builder", provider: "openai", completed_at: min(20) };
  const signedDeath = { ...deathBase, attest_sig: signRecord(deathBase) };
  // NO isVerified injected -> the default (verifyRecord for ok:false) runs.
  assert.deepStrictEqual(evaluatePairedWaiter({ records: [startedR, signedDeath], nowMs: NOW, staleMs: STALE, artifactProduced: () => false }).findings, [], "a real signed ok:false death suppresses");
  assert.strictEqual(evaluatePairedWaiter({ records: [started({ id: "sig2", at: min(30) }), { ...deathBase, dispatch_id: "sig2" }], nowMs: NOW, staleMs: STALE, artifactProduced: () => false }).findings.length, 1, "an UNSIGNED ok:false does NOT suppress");
});

t("7G-004: completed_at:null does NOT count as a terminal completion -> FLAGGED", () => {
  const recs = [started({ id: "dnull", at: min(30) }), { ok: false, dispatch_id: "dnull", role: "backend-builder", completed_at: null }];
  const r = evaluatePairedWaiter({ records: recs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyAll });
  assert.strictEqual(r.findings.length, 1, "completed_at:null is not a valid completion timestamp: " + JSON.stringify(r));
});

t("backend-7G-007: completed_at:0 (a NUMBER, Date.parse-coercible) does NOT count as terminal -> FLAGGED", () => {
  const recs = [started({ id: "dzero", at: min(30) }), { ok: false, dispatch_id: "dzero", role: "backend-builder", completed_at: 0 }];
  const r = evaluatePairedWaiter({ records: recs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyAll });
  assert.strictEqual(r.findings.length, 1, "a numeric completed_at:0 must not suppress (Date.parse coerces a number): " + JSON.stringify(r));
});

t("backend-7G-007: a non-ISO but Date.parse-able completed_at string does NOT suppress -> FLAGGED", () => {
  const recs = [started({ id: "dstr", at: min(30) }), { ok: false, dispatch_id: "dstr", role: "backend-builder", completed_at: "Jan 1 2099" }];
  const r = evaluatePairedWaiter({ records: recs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyAll });
  assert.strictEqual(r.findings.length, 1, "a non-canonical-ISO timestamp must not suppress: " + JSON.stringify(r));
});

t("backend-7G-007: a completion BEFORE its own start (ordering) does NOT suppress -> FLAGGED", () => {
  // started 30m ago, completed 40m ago (EARLIER than its own start) — impossible; must not suppress.
  const recs = [started({ id: "dord", at: min(30) }), { ok: false, dispatch_id: "dord", role: "backend-builder", completed_at: min(40) }];
  const r = evaluatePairedWaiter({ records: recs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyAll });
  assert.strictEqual(r.findings.length, 1, "a death before its own start must not suppress: " + JSON.stringify(r));
});

t("backend-7G-012: a calendar-INVALID completed_at (2026-02-31, shape-valid) does NOT suppress -> FLAGGED", () => {
  // Feb 31 passes ISO_TS_RE (shape) but Date-normalizes to Mar 3 — not a canonical toISOString round-trip.
  const recs = [started({ id: "dcal", at: min(30) }), { ok: false, dispatch_id: "dcal", role: "backend-builder", completed_at: "2026-02-31T00:00:00.000Z" }];
  const r = evaluatePairedWaiter({ records: recs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyAll });
  assert.strictEqual(r.findings.length, 1, "a calendar-invalid completed_at must not suppress (exact toISOString round-trip): " + JSON.stringify(r));
});

t("backend-7G-013: a FUTURE completed_at (2099, valid ISO + >= start) does NOT suppress -> FLAGGED (temporal upper bound)", () => {
  const recs = [started({ id: "dfut", at: min(30) }), { ok: false, dispatch_id: "dfut", role: "backend-builder", completed_at: "2099-01-01T00:00:00.000Z" }];
  const r = evaluatePairedWaiter({ records: recs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyAll });
  assert.strictEqual(r.findings.length, 1, "a future completed_at must not suppress (bounded [start, now+skew]): " + JSON.stringify(r));
});

t("backend-7G-013: within-skew completed_at (now+3m) SUPPRESSES; beyond-skew (now+1h) does NOT", () => {
  const near = new Date(NOW + 3 * 60000).toISOString();
  const far = new Date(NOW + 60 * 60000).toISOString();
  const okRecs = [started({ id: "dnear", at: min(30) }), { ok: false, dispatch_id: "dnear", role: "backend-builder", completed_at: near }];
  assert.deepStrictEqual(evaluatePairedWaiter({ records: okRecs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyAll }).findings, [], "within-skew completion suppresses");
  const farRecs = [started({ id: "dfar", at: min(30) }), { ok: false, dispatch_id: "dfar", role: "backend-builder", completed_at: far }];
  assert.strictEqual(evaluatePairedWaiter({ records: farRecs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyAll }).findings.length, 1, "beyond-skew completion must not suppress");
});

t("backend-7G-013 SKEW boundary (qa r3h): completed_at == now+SKEW suppresses (inclusive); == now+SKEW+1ms FLAGS", () => {
  const SKEW = 5 * 60 * 1000; // must match epsilon-liveness.js SKEW_MS
  const atSkew = new Date(NOW + SKEW).toISOString(); // exactly now + skew (inclusive boundary)
  const overSkew = new Date(NOW + SKEW + 1).toISOString(); // 1ms over
  const okRecs = [started({ id: "dskew", at: min(30) }), { ok: false, dispatch_id: "dskew", role: "backend-builder", completed_at: atSkew }];
  assert.deepStrictEqual(evaluatePairedWaiter({ records: okRecs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyAll }).findings, [], "completed_at exactly at now+skew suppresses (inclusive boundary)");
  const overRecs = [started({ id: "dover", at: min(30) }), { ok: false, dispatch_id: "dover", role: "backend-builder", completed_at: overSkew }];
  assert.strictEqual(evaluatePairedWaiter({ records: overRecs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyAll }).findings.length, 1, "completed_at 1ms over now+skew must FLAG (exclusive above the boundary)");
});

t("backend-7G-013 SYMMETRIC: a calendar-INVALID started_at -> FLAGGED malformed-start (never silent-skip)", () => {
  const recs = [{ phase: "started", ok: false, dispatch_id: "dbadstart", role: "backend-builder", started_at: "2026-02-31T00:00:00.000Z" }];
  const r = evaluatePairedWaiter({ records: recs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyAll });
  assert.strictEqual(r.findings.length, 1, "a malformed started_at must FLAG, never silent-skip: " + JSON.stringify(r));
  assert.strictEqual(r.findings[0].type, "outstanding-dispatch-malformed-start");
});

t("backend-7G-013 SYMMETRIC: an unparseable started_at -> FLAGGED (not silent-skip)", () => {
  const recs = [{ phase: "started", ok: false, dispatch_id: "dgarbage", role: "backend-builder", started_at: "not-a-timestamp" }];
  assert.strictEqual(evaluatePairedWaiter({ records: recs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyAll }).findings.length, 1);
});

t("backend-7G-013 SYMMETRIC: a FUTURE started_at (now+1h) -> FLAGGED future-start", () => {
  const future = new Date(NOW + 60 * 60000).toISOString();
  const recs = [{ phase: "started", ok: false, dispatch_id: "dfutstart", role: "backend-builder", started_at: future }];
  const r = evaluatePairedWaiter({ records: recs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyAll });
  assert.strictEqual(r.findings.length, 1, "a future started_at must FLAG: " + JSON.stringify(r));
  assert.strictEqual(r.findings[0].type, "outstanding-dispatch-future-start");
});

t("QA-7G-012 (encoding): a signed NUMERIC death re-pointed to a STRING dispatch_id does NOT suppress its target", () => {
  const { signRecord } = require("../dispatch/attest-signing.js");
  const startedR = started({ id: "123", at: min(30) }); // started row keyed on the STRING "123"
  const deathNum = { ok: false, dispatch_id: 123, role: "backend-builder", provider: "openai", completed_at: min(20) };
  const signed = { ...deathNum, attest_sig: signRecord(deathNum) }; // signed with NUMERIC 123
  signed.dispatch_id = "123"; // mutate number -> string so byId correlates to the started row
  const r = evaluatePairedWaiter({ records: [startedR, signed], nowMs: NOW, staleMs: STALE, artifactProduced: () => false });
  assert.strictEqual(r.findings.length, 1, "a numeric->string dispatch_id-mutated death must NOT suppress (type-coercion alias closed): " + JSON.stringify(r));
});

t("QA-7G-012 (producer): recordCompletion REFUSES to sign a non-string dispatch_id (unsigned, cannot suppress)", () => {
  const { recordCompletion } = require("../dispatch-agent.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-num-"));
  const prev = process.env.DISPATCH_LEDGER_DIR;
  process.env.DISPATCH_LEDGER_DIR = dir;
  try {
    recordCompletion({ ok: false, dispatch_id: 777, role: "backend-builder", provider: "openai", completed_at: min(20) });
    const rec = fs.readFileSync(path.join(dir, "dispatch-completions.jsonl"), "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l)).find((x) => x.dispatch_id === 777);
    assert.ok(rec, "the record was written");
    assert.strictEqual(rec.attest_sig, undefined, "a non-string dispatch_id must NOT be signed");
    assert.strictEqual(rec.dispatch_id_type_invalid, true, "flagged type-invalid");
  } finally {
    if (prev === undefined) delete process.env.DISPATCH_LEDGER_DIR; else process.env.DISPATCH_LEDGER_DIR = prev;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

t("security r2 #1: a VERIFIED ok:true completion SUPPRESSES -> NOT flagged", () => {
  const recs = [started({ id: "d2", at: min(30) }), completion("d2", true)];
  const r = evaluatePairedWaiter({ records: recs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyAll });
  assert.deepStrictEqual(r.findings, []);
});

t("security r2 #1: an UNVERIFIED ok:true completion does NOT suppress -> FLAGGED", () => {
  const recs = [started({ id: "d3", at: min(30) }), completion("d3", true)];
  const r = evaluatePairedWaiter({ records: recs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyNone });
  assert.strictEqual(r.findings.length, 1, "an unsigned success must not suppress: " + JSON.stringify(r));
});

t("a NON-completion ok:true row (phase:'note') does NOT suppress -> FLAGGED", () => {
  const recs = [started({ id: "d4", at: min(30) }), { phase: "note", ok: true, dispatch_id: "d4" }];
  const r = evaluatePairedWaiter({ records: recs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyAll });
  assert.strictEqual(r.findings.length, 1);
});

t("DoE (d): fires regardless of a stamped/omitted opt-in field (scope is ledger state, not the row)", () => {
  const withFlag = [started({ id: "d5", at: min(30), extra: { background: true } })];
  const noFlag = [started({ id: "d6", at: min(30) })];
  const opts = { nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyNone };
  assert.strictEqual(evaluatePairedWaiter({ records: withFlag, ...opts }).findings.length, 1);
  assert.strictEqual(evaluatePairedWaiter({ records: noFlag, ...opts }).findings.length, 1, "a row that omits the opt-in must STILL be evaluated");
});

// ── artifact-produced grace path (β settable-label close) ─────────────────────────────────────────────

t("β: artifact_path stamped but NOT produced -> FLAGGED", () => {
  const recs = [started({ id: "d7", at: min(30), extra: { artifact_path: "runtime/ghost.txt" } })];
  const r = evaluatePairedWaiter({ records: recs, nowMs: NOW, staleMs: STALE, artifactProduced: producedOnly("runtime/real.txt"), isVerified: verifyNone });
  assert.strictEqual(r.findings.length, 1);
});

t("artifact_path produced -> OK (real evidence of progress)", () => {
  const recs = [started({ id: "d8", at: min(30), extra: { artifact_path: "runtime/real.txt" } })];
  const r = evaluatePairedWaiter({ records: recs, nowMs: NOW, staleMs: STALE, artifactProduced: producedOnly("runtime/real.txt"), isVerified: verifyNone });
  assert.deepStrictEqual(r.findings, []);
});

t("not stale (age < staleMs) -> NOT flagged", () => {
  const recs = [started({ id: "d9", at: min(5) })];
  assert.deepStrictEqual(evaluatePairedWaiter({ records: recs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyNone }).findings, []);
});

t("historical (age > windowMs) -> NOT flagged", () => {
  const recs = [started({ id: "d10", at: min(180) })];
  assert.deepStrictEqual(evaluatePairedWaiter({ records: recs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyNone }).findings, []);
});

// ── QA-R2-001: the env opt-out cannot downgrade the default verifier ──────────────────────────────────

t("QA-R2-001: WARPOS_LIVENESS_REQUIRE_SIG=0 does NOT let an UNSIGNED ok:true completion suppress", () => {
  const prev = mcEnv.readEnv("LIVENESS_REQUIRE_SIG");
  mcEnv.setEnv("LIVENESS_REQUIRE_SIG", "0");
  try {
    // No isVerified injected -> the default verifier runs; an unsigned completion (no attest_sig) must NOT
    // verify even under the env opt-out, so the started row stays FLAGGED.
    const recs = [started({ id: "denv", at: min(30) }), completion("denv", true)];
    const r = evaluatePairedWaiter({ records: recs, nowMs: NOW, staleMs: STALE, artifactProduced: () => false });
    assert.strictEqual(r.findings.length, 1, "the env must not downgrade signature verification: " + JSON.stringify(r));
  } finally {
    if (prev === undefined) mcEnv.unsetEnv("LIVENESS_REQUIRE_SIG"); else mcEnv.setEnv("LIVENESS_REQUIRE_SIG", prev);
  }
});

// ── DoE required INTEGRATION test: the REAL production started-row writer shape ────────────────────────

t("INTEGRATION (DoE): a REAL startedRow (production shape) stale + no terminal -> FIRES", () => {
  const realRow = startedRow({ role: "backend-reviewer", provider: "openai", dispatch_id: "dreal", started_at: min(30) });
  // Sanity: the real writer stamps NONE of the old opt-in fields (the inert-check regression).
  assert.strictEqual(realRow.background, undefined);
  assert.strictEqual(realRow.artifact_path, undefined);
  const r = evaluatePairedWaiter({ records: [realRow], nowMs: NOW, staleMs: STALE, artifactProduced: () => false, isVerified: verifyNone });
  assert.strictEqual(r.findings.length, 1, "must fire on the real writer shape: " + JSON.stringify(r));
});

t("hunter r3 OVER-FIRE regression (QA-TEETH-005): a REAL recordCompletion completion (production writer) -> NOT flagged", () => {
  // QA-TEETH-005 (qa r3c): the earlier version HAND-CONSTRUCTED the completion + injected verifyAll — the
  // exact synthetic≠production gap that caused the r3 over-fire, sitting IN the test meant to prove
  // production-correctness. This drives the REAL production writer (dispatch-agent#recordCompletion) into an
  // isolated ledger (DISPATCH_LEDGER_DIR test seam), reads the record it ACTUALLY wrote, and evaluates with
  // the DEFAULT verifier (NO isVerified injection) — so the test proves BOTH the real completion shape (no
  // `phase`, signed, quota-stamped) AND the real signature-verify path (isVerifiedLivenessRecord) suppress
  // the stall. The r3 over-fire bug (keying on phase:"completion") and a broken signature path are both caught.
  const { recordCompletion } = require("../dispatch-agent.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-ledger-"));
  const prevDir = process.env.DISPATCH_LEDGER_DIR;
  process.env.DISPATCH_LEDGER_DIR = dir;
  try {
    recordCompletion({ ok: true, dispatch_id: "ddone", role: "backend-reviewer", provider: "openai", completed_at: min(20) });
    const written = fs.readFileSync(path.join(dir, "dispatch-completions.jsonl"), "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l));
    const realCompletion = written.find((r) => r.dispatch_id === "ddone");
    assert.ok(realCompletion, "recordCompletion must have written a record for ddone");
    assert.strictEqual(realCompletion.phase, undefined, "the REAL production completion stamps NO phase field (the r3 over-fire root)");
    assert.strictEqual(typeof realCompletion.attest_sig, "string", "the REAL production completion is signed — the default verifier must accept it");
    const realRow = startedRow({ role: "backend-reviewer", provider: "openai", dispatch_id: "ddone", started_at: min(30) });
    // NO isVerified injected -> the DEFAULT verifier (isVerifiedLivenessRecord for ok:true) runs against the
    // REAL signature — this is the production-shape integration the earlier over-fire test was faking.
    const r = evaluatePairedWaiter({ records: [realRow, realCompletion], nowMs: NOW, staleMs: STALE, artifactProduced: () => false });
    assert.deepStrictEqual(r.findings, [], "a REAL recordCompletion ok:true completion must suppress (not over-fire): " + JSON.stringify(r));
  } finally {
    if (prevDir === undefined) delete process.env.DISPATCH_LEDGER_DIR; else process.env.DISPATCH_LEDGER_DIR = prevDir;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

// ── artifactProducedFs (real filesystem resolver, incl. ED-270 lstat) ─────────────────────────────────

t("artifactProducedFs: a real non-empty file modified after start -> true", () => {
  const p = path.join(os.tmpdir(), "pw-real-" + process.pid + ".txt");
  try { fs.writeFileSync(p, "produced"); assert.strictEqual(artifactProducedFs(p, fs.statSync(p).mtimeMs - 1000), true); }
  finally { try { fs.unlinkSync(p); } catch {} }
});

t("qa r2 #2: a DIRECTORY -> false", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pw-dir-"));
  try { assert.strictEqual(artifactProducedFs(d, 0), false); } finally { try { fs.rmdirSync(d); } catch {} }
});

t("R1a: a 0-byte file -> false", () => {
  const p = path.join(os.tmpdir(), "pw-empty-" + process.pid + ".txt");
  try { fs.writeFileSync(p, ""); assert.strictEqual(artifactProducedFs(p, 0), false); } finally { try { fs.unlinkSync(p); } catch {} }
});

t("produced-after-start: a file modified BEFORE started_at -> false", () => {
  const p = path.join(os.tmpdir(), "pw-old-" + process.pid + ".txt");
  try { fs.writeFileSync(p, "x"); assert.strictEqual(artifactProducedFs(p, fs.statSync(p).mtimeMs + 60000), false); }
  finally { try { fs.unlinkSync(p); } catch {} }
});

t("ED-270: a SYMLINK to a real produced file -> false (lstat rejects it)", () => {
  const target = path.join(os.tmpdir(), "pw-target-" + process.pid + ".txt");
  const link = path.join(os.tmpdir(), "pw-link-" + process.pid + ".txt");
  try {
    fs.writeFileSync(target, "concurrently-written");
    try { fs.symlinkSync(target, link); } catch (e) { skipTest("symlink unavailable (" + e.code + ") — not a PASS"); }
    assert.strictEqual(artifactProducedFs(link, fs.statSync(target).mtimeMs - 1000), false, "a symlink must not spoof a produced artifact");
  } finally { try { fs.unlinkSync(link); } catch {} try { fs.unlinkSync(target); } catch {} }
});

t("artifactProducedFs: absent path -> false", () => {
  assert.strictEqual(artifactProducedFs(path.join(os.tmpdir(), "pw-absent-" + process.pid), 0), false);
});

console.log("\n" + pass + "/" + (pass + fail) + " passed" + (skip ? " (" + skip + " skipped)" : ""));
process.exit(fail ? 1 : 0);
