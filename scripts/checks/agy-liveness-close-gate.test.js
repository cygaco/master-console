#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { evaluateAgyLivenessClose, latestVerifiedAgyRecord, resolveSinceMs } = require("./agy-liveness-close-gate.js");
const { signRecord, verifyRecord } = require("../dispatch/attest-signing.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  PASS  " + name); }
  catch (e) { fail++; console.error("  FAIL  " + name + " — " + (e && e.message ? e.message : e)); }
}

const CLEAN = { ok: true, fallback: false, auth_fallback: false, provider: "antigravity", tool_id: "agy" };

t("clean agy record (auth_fallback:false) -> closeable", () => {
  assert.strictEqual(evaluateAgyLivenessClose(CLEAN).closeable, true);
});

t("provider:'openai' + tool_id:'agy' -> NOT closeable (both fields required)", () => {
  const r = evaluateAgyLivenessClose({ ...CLEAN, provider: "openai" });
  assert.strictEqual(r.closeable, false);
  assert.ok(r.reasons.some((x) => /provider/.test(x)), JSON.stringify(r.reasons));
});

t("provider ABSENT + tool_id:'agy' -> NOT closeable", () => {
  const rec = { ok: true, fallback: false, auth_fallback: false, tool_id: "agy" };
  assert.strictEqual(evaluateAgyLivenessClose(rec).closeable, false);
});

t("auth_fallback:'indeterminate' -> NOT closeable (the fail-open trap)", () => {
  const r = evaluateAgyLivenessClose({ ...CLEAN, auth_fallback: "indeterminate" });
  assert.strictEqual(r.closeable, false);
  assert.ok(r.reasons.some((x) => /auth_fallback/.test(x)), JSON.stringify(r.reasons));
});

t("auth_fallback:true -> NOT closeable", () => {
  assert.strictEqual(evaluateAgyLivenessClose({ ...CLEAN, auth_fallback: true }).closeable, false);
});

t("auth_fallback ABSENT -> NOT closeable (unstamped != proven)", () => {
  const rec = { ok: true, fallback: false, provider: "antigravity", tool_id: "agy" };
  const r = evaluateAgyLivenessClose(rec);
  assert.strictEqual(r.closeable, false);
  assert.ok(r.reasons.some((x) => /auth_fallback/.test(x)), JSON.stringify(r.reasons));
});

t("provider fallback:true -> NOT closeable", () => {
  assert.strictEqual(evaluateAgyLivenessClose({ ...CLEAN, fallback: true }).closeable, false);
});

t("ok:false -> NOT closeable", () => {
  assert.strictEqual(evaluateAgyLivenessClose({ ...CLEAN, ok: false }).closeable, false);
});

t("wrong tool_id -> NOT closeable", () => {
  assert.strictEqual(evaluateAgyLivenessClose({ ...CLEAN, tool_id: "codex" }).closeable, false);
});

t("empty/undefined record -> NOT closeable (fail-closed)", () => {
  assert.strictEqual(evaluateAgyLivenessClose(undefined).closeable, false);
  assert.strictEqual(evaluateAgyLivenessClose({}).closeable, false);
});

t("latestVerifiedAgyRecord returns the SIGNED clean record and SKIPS unsigned/tampered", () => {
  const tmp = path.join(os.tmpdir(), "agy-close-ledger-" + process.pid + ".jsonl");
  try {
    const base = { ...CLEAN, provider: "antigravity", completed_at: "2026-07-23T06:00:00.000Z" };
    const signed = { ...base, attest_sig: signRecord(base) };
    assert.ok(verifyRecord(signed), "control: signRecord output must verify");
    const unsigned = { ...CLEAN, provider: "antigravity", completed_at: "2026-07-23T06:05:00.000Z" };
    const tampered = { ...signed, completed_at: "2026-07-23T06:10:00.000Z" };
    fs.writeFileSync(tmp, [signed, unsigned, tampered].map((r) => JSON.stringify(r)).join("\n") + "\n");
    const found = latestVerifiedAgyRecord(tmp, 0, verifyRecord);
    assert.ok(found.record, "a verified record must be returned: " + JSON.stringify(found));
    assert.strictEqual(found.record.completed_at, "2026-07-23T06:00:00.000Z", "only the SIGNED record is trusted: " + JSON.stringify(found.record));
    assert.ok(found.skippedUnverified >= 2, "unsigned + tampered must be skipped: " + JSON.stringify(found));
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

t("latestVerifiedAgyRecord returns null when only unsigned records match (fail-closed)", () => {
  const tmp = path.join(os.tmpdir(), "agy-close-ledger-unsigned-" + process.pid + ".jsonl");
  try {
    const unsigned = { ...CLEAN, provider: "antigravity", completed_at: "2026-07-23T06:00:00.000Z" };
    fs.writeFileSync(tmp, JSON.stringify(unsigned) + "\n");
    const found = latestVerifiedAgyRecord(tmp, 0, verifyRecord);
    assert.strictEqual(found.record, null, "an unsigned agy record cannot close: " + JSON.stringify(found));
    assert.strictEqual(found.skippedUnverified, 1);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

t("flipping auth_fallback on a signed record BREAKS the signature (settable-label close)", () => {
  const rec = { ...CLEAN, auth_fallback: true, completed_at: "2026-07-23T06:00:00.000Z" };
  const signed = { ...rec, attest_sig: signRecord(rec) };
  assert.ok(verifyRecord(signed), "control: the signed auth_fallback:true record verifies");
  const forged = { ...signed, auth_fallback: false };
  assert.strictEqual(verifyRecord(forged), false, "a flipped auth_fallback must invalidate the signature");
});

t("latestVerifiedAgyRecord ignores a signed provider:'openai'+tool_id:'agy' record (both fields)", () => {
  const tmp = path.join(os.tmpdir(), "agy-close-ledger-mismatch-" + process.pid + ".jsonl");
  try {
    const base = { ok: true, fallback: false, auth_fallback: false, provider: "openai", tool_id: "agy", completed_at: "2026-07-23T06:00:00.000Z" };
    const signed = { ...base, attest_sig: signRecord(base) };
    fs.writeFileSync(tmp, JSON.stringify(signed) + "\n");
    const found = latestVerifiedAgyRecord(tmp, 0, verifyRecord);
    assert.strictEqual(found.record, null, "a provider-mismatched record must not be selected: " + JSON.stringify(found));
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

t("resolveSinceMs: absent flag -> no floor (sinceMs 0)", () => {
  const r = resolveSinceMs(["--completions", "x"]);
  assert.deepStrictEqual(r, { ok: true, sinceMs: 0 });
});

t("resolveSinceMs: BARE --since (no value) -> invalid (not treated as absent)", () => {
  const r = resolveSinceMs(["--completions", "x", "--since"]);
  assert.strictEqual(r.ok, false, JSON.stringify(r));
});

t("resolveSinceMs: --since followed by another flag -> invalid (missing value)", () => {
  const r = resolveSinceMs(["--since", "--completions", "x"]);
  assert.strictEqual(r.ok, false, JSON.stringify(r));
});

t("resolveSinceMs: --since with an unparseable value -> invalid", () => {
  assert.strictEqual(resolveSinceMs(["--since", "not-a-date"]).ok, false);
});

t("resolveSinceMs: --since with a valid ISO date -> finite floor", () => {
  const r = resolveSinceMs(["--since", "2026-07-22T00:00:00.000Z"]);
  assert.strictEqual(r.ok, true);
  assert.ok(Number.isFinite(r.sinceMs) && r.sinceMs > 0, JSON.stringify(r));
});

t("CLI --since invalid/bare exits 2; valid closes (env-tolerant)", () => {
  const cp = require("child_process");
  const tmp = path.join(os.tmpdir(), "agy-close-cli-" + process.pid + ".jsonl");
  const gate = path.join(__dirname, "agy-liveness-close-gate.js");
  try {
    const base = { ...CLEAN, completed_at: "2026-07-23T00:00:00.000Z" };
    fs.writeFileSync(tmp, JSON.stringify({ ...base, attest_sig: signRecord(base) }) + "\n");
    const invalid = cp.spawnSync(process.execPath, [gate, "--completions", tmp, "--since", "not-a-date"], { encoding: "utf8" });
    if (invalid.error) { console.log("    (skip — child-process env-blocked: " + invalid.error.code + ")"); return; }
    assert.strictEqual(invalid.status, 2, "invalid --since must exit 2: " + JSON.stringify({ status: invalid.status, err: invalid.stderr }));
    const bare = cp.spawnSync(process.execPath, [gate, "--completions", tmp, "--since"], { encoding: "utf8" });
    assert.strictEqual(bare.status, 2, "BARE --since must exit 2: " + JSON.stringify({ status: bare.status, err: bare.stderr }));
    const good = cp.spawnSync(process.execPath, [gate, "--completions", tmp, "--since", "2026-07-22T00:00:00.000Z"], { encoding: "utf8" });
    assert.strictEqual(good.status, 0, "valid past --since should close: " + JSON.stringify({ status: good.status, err: good.stderr }));
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

console.log("\n" + pass + "/" + (pass + fail) + " passed");
process.exit(fail ? 1 : 0);
