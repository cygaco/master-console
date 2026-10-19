#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { analyze, parseVerdictRows, extractMsgIds, realMsgId } = require("./betaevents-dedup-lint.js");
const { duplicateKeys } = require("./dedup-util.js");

function runCli(betaContent, { eventsContent, eventsUnreachable } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "be-cli-"));
  const betaFile = path.join(dir, "beta.jsonl");
  fs.writeFileSync(betaFile, betaContent);
  const argv = [path.join(__dirname, "betaevents-dedup-lint.js"), "--enforce", "--beta", betaFile];
  if (eventsUnreachable) {
    argv.push("--events", path.join(dir, "no-such-events.jsonl"));
  } else if (eventsContent != null) {
    const eventsFile = path.join(dir, "events.jsonl");
    fs.writeFileSync(eventsFile, eventsContent);
    argv.push("--events", eventsFile);
  }
  let code = null, out = "", err = "", spawnFailed = false;
  try {
    out = execFileSync("node", argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    code = 0;
  } catch (e) {
    if (typeof e.status === "number") code = e.status;
    else spawnFailed = true;
    out = String(e.stdout || ""); err = String(e.stderr || "");
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  return { code, out, err, spawnFailed };
}

let pass = 0, fail = 0, skip = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  PASS  " + name); }
  catch (e) {
    if (e && e.__skip) { skip++; console.log("  SKIP  " + name + " — " + e.message); return; }
    fail++; console.error("  FAIL  " + name + " — " + (e && e.message ? e.message : e));
  }
}
function skipTest(msg) { const e = new Error(msg); e.__skip = true; throw e; }
const row = (o) => JSON.stringify(o);

t("duplicateKeys: flags a key on >1 item; excludes null keys", () => {
  const dups = duplicateKeys([{ k: "a" }, { k: "a" }, { k: "b" }, { k: null }, { k: null }], (x) => x.k);
  assert.deepStrictEqual(dups, [{ key: "a", count: 2 }]);
});

t("REAL duplicate msg_id on two verdict rows -> flagged", () => {
  const beta = [
    row({ decision: "DECIDE", sprint: "SP-99999999-001", boundary: "gauntlet->release", msg_id: "abc" }),
    row({ decision: "DECIDE", sprint: "SP-99999999-001", boundary: "gauntlet->release", msg_id: "abc" }),
  ].join("\n");
  const r = analyze({ betaText: beta, eventsText: "" });
  assert.deepStrictEqual(r.dupMsgIds, ["abc"], JSON.stringify(r));
});

t("plan->design + plan->design-correction (distinct msg_ids) -> NO dup", () => {
  const beta = [
    row({ decision: "DECIDE", sprint: "SP-99999999-001", boundary: "plan->design", msg_id: "m1" }),
    row({ decision: "DECIDE", sprint: "SP-99999999-001", boundary: "plan->design-correction", msg_id: "m2" }),
  ].join("\n");
  const r = analyze({ betaText: beta, eventsText: "m1 m2" });
  assert.deepStrictEqual(r.dupMsgIds, [], JSON.stringify(r));
});

t("reconfirm rows (same sprint+boundary, distinct msg_ids) -> NO dup", () => {
  const beta = [
    row({ decision: "DECIDE", sprint: "SP-99999999-001", boundary: "gauntlet->release", msg_id: "r1" }),
    row({ decision: "DECIDE", sprint: "SP-99999999-001", boundary: "gauntlet->release", msg_id: "r2" }),
    row({ decision: "DECIDE", sprint: "SP-99999999-001", boundary: "gauntlet->release", msg_id: "r3" }),
  ].join("\n");
  const r = analyze({ betaText: beta, eventsText: "r1 r2 r3" });
  assert.deepStrictEqual(r.dupMsgIds, [], JSON.stringify(r));
});

t("a REQUESTED row is not a verdict (excluded from dedup)", () => {
  const beta = [
    row({ decision: "REQUESTED", sprint: "SP-99999999-001", boundary: "gauntlet->release", msg_id: "q" }),
    row({ decision: "REQUESTED", sprint: "SP-99999999-001", boundary: "gauntlet->release", msg_id: "q" }),
  ].join("\n");
  assert.strictEqual(parseVerdictRows(beta).length, 0);
  assert.deepStrictEqual(analyze({ betaText: beta, eventsText: "" }).dupMsgIds, []);
});

t("message log UNREACHABLE (eventsText null) -> resolution SKIPPED, not flagged", () => {
  const beta = row({ decision: "DECIDE", sprint: "SP-99999999-001", boundary: "b", msg_id: "x" });
  const r = analyze({ betaText: beta, eventsText: null });
  assert.strictEqual(r.resolutionSkipped, true, JSON.stringify(r));
  assert.deepStrictEqual(r.unresolved, []);
});

t("strong-majority resolve + one missing -> the missing one is flagged (log proven authoritative)", () => {
  const ids = ["mmid1", "mmid2", "mmid3", "mmid4", "ghostxyz"];
  const beta = ids.map((id) => row({ decision: "DECIDE", sprint: "SP-99999999-001", boundary: id, msg_id: id })).join("\n");
  const eventsText = ["mmid1", "mmid2", "mmid3", "mmid4"].map((x) => `{"msg_id":"${x}"}`).join("\n");
  const r = analyze({ betaText: beta, eventsText });
  assert.deepStrictEqual(r.unresolved, ["ghostxyz"], JSON.stringify(r));
  assert.strictEqual(r.resolutionSkipped, false);
});

t("LOW resolution -> report-only SKIPS the advisory BUT unresolved SURVIVES (enforce fails closed)", () => {
  const ids = ["zqa1", "zqb2", "zqc3", "zqd4", "onlyoneresolves"];
  const beta = ids.map((id) => row({ decision: "DECIDE", sprint: "SP-99999999-001", boundary: id, msg_id: id })).join("\n");
  const r = analyze({ betaText: beta, eventsText: '{"msg_id":"onlyoneresolves"}' });
  assert.strictEqual(r.lowConfidence, true, JSON.stringify(r));
  assert.strictEqual(r.resolutionSkipped, true, "report-only skips the advisory");
  assert.strictEqual(r.logUnreachable, false);
  assert.strictEqual(r.unresolved.length, 4, "the 4 unresolved must SURVIVE for --enforce to fail closed: " + JSON.stringify(r));
});

t("msg_id present in the message log -> resolved", () => {
  const beta = row({ decision: "DECIDE", sprint: "SP-99999999-001", boundary: "b", msg_id: "found-1234" });
  const r = analyze({ betaText: beta, eventsText: '{"msg_id":"found-1234"}' });
  assert.deepStrictEqual(r.unresolved, []);
});

t("a verdict-shaped row that OMITS msg_id -> missingMsgId (blocks under enforce)", () => {
  const beta = row({ decision: "DECIDE", class: "B", sprint: "SP-99999999-001", boundary: "b" });
  const r = analyze({ betaText: beta, eventsText: '{"msg_id":"other"}' });
  assert.strictEqual(r.missingMsgId, 1);
  assert.strictEqual(r.logUnreachable, false);
  assert.strictEqual(r.missingMsgId > 0, true, "a verdict row without msg_id must be blockable under --enforce");
});

t("a missing-msg_id verdict blocks via the REAL CLI --enforce even when the log is UNREACHABLE", () => {
  const beta = row({ decision: "DECIDE", class: "B", sprint: "SP-99999999-001", boundary: "b" });
  const r = analyze({ betaText: beta, eventsText: null });
  assert.strictEqual(r.logUnreachable, true);
  assert.strictEqual(r.missingMsgId, 1);
  const { code, err, out, spawnFailed } = runCli(beta + "\n", { eventsUnreachable: true });
  if (spawnFailed) skipTest("nested node spawn unavailable (sandbox EPERM) — CLI tooth not exercisable here; the pure analyze() teeth above still run");
  assert.ok(/betaevents-dedup-lint:\s*FAIL/.test(err), "the CLI must produce its real FAIL output (not a spawn error): " + (err || out));
  assert.strictEqual(code, 1, "the REAL CLI --enforce must exit 1 on a missing-msg_id verdict even with an unreachable log: " + (err || out));
});

t("the REAL CLI --enforce exits 0 on a clean verdict row (resolvable msg_id)", () => {
  const beta = row({ decision: "DECIDE", sprint: "SP-99999999-001", boundary: "b", msg_id: "cli-ok-1234" });
  const { code, err, out, spawnFailed } = runCli(beta + "\n", { eventsContent: '{"msg_id":"cli-ok-1234"}\n' });
  if (spawnFailed) skipTest("nested node spawn unavailable (sandbox EPERM) — CLI tooth not exercisable here");
  assert.ok(/betaevents-dedup-lint:\s*OK/.test(out), "the CLI must produce its real OK output (not a spawn error): " + (err || out));
  assert.strictEqual(code, 0, "a clean resolvable verdict must not block under --enforce: " + (err || out));
});

t("a WHITESPACE-only msg_id counts as MISSING under enforce", () => {
  const beta = row({ decision: "DECIDE", class: "B", sprint: "SP-99999999-001", boundary: "b", msg_id: "   " });
  const r = analyze({ betaText: beta, eventsText: null });
  assert.strictEqual(r.missingMsgId, 1, "a whitespace-only msg_id must be MISSING, not present: " + JSON.stringify(r));
});

t("raw-match: a padded msg_id is INVALID -> MISSING (real ids never carry whitespace; no trim surface)", () => {
  const beta = row({ decision: "DECIDE", class: "B", sprint: "SP-99999999-001", boundary: "b", msg_id: "  pad-1  " });
  const r = analyze({ betaText: beta, eventsText: '{"msg_id":"pad-1"}' });
  assert.strictEqual(r.missingMsgId, 1, "a padded msg_id is invalid under raw-match -> MISSING: " + JSON.stringify(r));
});

t("every non-ASCII invisible that JS .trim() would strip -> MISSING (raw-match, no trim leak)", () => {
  const invis = [
    0xFEFF, 0x00A0, 0x1680,
    0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A,
    0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0x000C, 0x000B, 0x200B, 0x2060,
    0x09, 0x0A, 0x0D,
  ];
  for (const cp of invis) {
    const c = String.fromCharCode(cp);
    for (const id of [c + "knownid" + c, "known" + c + "id"]) {
      const beta = row({ decision: "DECIDE", class: "B", sprint: "SP-99999999-001", boundary: "b", msg_id: id });
      assert.strictEqual(analyze({ betaText: beta, eventsText: null }).missingMsgId, 1, "U+" + cp.toString(16) + " (wrap/interior) must be MISSING");
    }
  }
});

t("realMsgId: RAW-match — null on blank/absent/non-string/padded/invisible; bare ids valid", () => {
  assert.strictEqual(realMsgId({ msg_id: "  x  " }), null);
  assert.strictEqual(realMsgId({ msg_id: "x" }), "x");
  assert.strictEqual(realMsgId({ msg_id: "   " }), null);
  assert.strictEqual(realMsgId({ msg_id: "" }), null);
  assert.strictEqual(realMsgId({}), null);
  assert.strictEqual(realMsgId({ msg_id: 5 }), null);
  assert.strictEqual(realMsgId({ msg_id: "​" }), null);
  assert.strictEqual(realMsgId({ msg_id: "﻿⁠‌‍" }), null);
  assert.strictEqual(realMsgId({ msg_id: "​keep​" }), null);
  assert.strictEqual(realMsgId({ msg_id: String.fromCharCode(0) }), null);
  assert.strictEqual(realMsgId({ msg_id: String.fromCharCode(7) }), null);
  assert.strictEqual(realMsgId({ msg_id: String.fromCharCode(27) }), null);
  assert.strictEqual(realMsgId({ msg_id: String.fromCharCode(127) }), null);
  assert.strictEqual(realMsgId({ msg_id: "d-abcd1234-0000beef" }), "d-abcd1234-0000beef");
  assert.strictEqual(realMsgId({ msg_id: "00000000-0000-4000-8000-000000000001" }), "00000000-0000-4000-8000-000000000001");
});

t("zero-width: a msg_id of only U+200B counts as MISSING (blocks under enforce)", () => {
  const beta = row({ decision: "DECIDE", class: "B", sprint: "SP-99999999-001", boundary: "b", msg_id: "​" });
  const r = analyze({ betaText: beta, eventsText: null });
  assert.strictEqual(r.missingMsgId, 1, "a zero-width-only msg_id must be MISSING: " + JSON.stringify(r));
});

t("U+FEFF/U+2060/U+200C/U+200D zero-width msg_ids also MISSING", () => {
  for (const zw of ["﻿", "⁠", "‌", "‍"]) {
    const beta = row({ decision: "DECIDE", sprint: "SP-99999999-001", boundary: "b", msg_id: zw });
    assert.strictEqual(analyze({ betaText: beta, eventsText: null }).missingMsgId, 1, "zero-width U+" + zw.charCodeAt(0).toString(16) + " must be MISSING");
  }
});

t("allowlist: a zero-width-WRAPPED id is INVALID -> MISSING (a real id has no invisibles)", () => {
  const beta = row({ decision: "DECIDE", sprint: "SP-99999999-001", boundary: "b", msg_id: "​zwid-1​" });
  const r = analyze({ betaText: beta, eventsText: '{"msg_id":"zwid-1"}' });
  assert.strictEqual(r.missingMsgId, 1, "a zw-wrapped id is invalid (has invisibles) -> MISSING: " + JSON.stringify(r));
  assert.deepStrictEqual(r.unresolved, [], "a MISSING id is not in the resolution set: " + JSON.stringify(r));
});

t("a control-char-only msg_id (NUL/BEL/ESC/DEL) counts as MISSING under enforce", () => {
  for (const cc of [0, 7, 27, 127].map((n) => String.fromCharCode(n))) {
    const beta = row({ decision: "DECIDE", class: "B", sprint: "SP-99999999-001", boundary: "b", msg_id: cc });
    assert.strictEqual(analyze({ betaText: beta, eventsText: null }).missingMsgId, 1, "control U+" + cc.charCodeAt(0).toString(16) + " must be MISSING");
  }
});

t("allowlist: a UUID / dispatch-id / slug msg_id is VALID (not falsely rejected)", () => {
  for (const id of ["00000000-0000-4000-8000-000000000001", "d-abcd1234-0000beef", "beta-design-build-verdict"]) {
    const beta = row({ decision: "DECIDE", sprint: "SP-99999999-001", boundary: "b", msg_id: id });
    const r = analyze({ betaText: beta, eventsText: `{"msg_id":"${id}"}` });
    assert.strictEqual(r.missingMsgId, 0, id + " must be a valid id");
    assert.deepStrictEqual(r.unresolved, [], id + " must resolve");
  }
});

t("β reconcile-row exemption: a NON-verdict row (no decision) with no msg_id -> NOT counted", () => {
  const beta = [row({ record_kind: "reconcile", sprint: "SP-99999999-001", boundary: "b" }), row({ sprint: "SP-99999999-001", note: "housekeeping" })].join("\n");
  const r = analyze({ betaText: beta, eventsText: "" });
  assert.strictEqual(r.missingMsgId, 0, "only verdict-shaped (decision) rows require a msg_id");
});

t("betaText null -> skipped (gitignored advisory ledger absent)", () => {
  assert.strictEqual(analyze({ betaText: null, eventsText: null }).skipped, true);
});

t("extractMsgIds parses msg_id field VALUES for exact membership (no substring leak)", () => {
  const set = extractMsgIds('{"decision":"DECIDE","msg_id":"abc"}\n{"msg_id":"abcd"}');
  assert.strictEqual(set.has("abc"), true);
  assert.strictEqual(set.has("abcd"), true);
  assert.strictEqual(set.has("ab"), false, "a substring must NOT be a member");
});

t("PREFIX COLLISION: verdict m1 is NOT resolved by a log containing only m10 (exact, not substring)", () => {
  const beta = ["r1", "r2", "r3", "r4", "m1"].map((id) => row({ decision: "DECIDE", sprint: "S", boundary: id, msg_id: id })).join("\n");
  const eventsText = ['r1', 'r2', 'r3', 'r4', 'm10'].map((x) => `{"msg_id":"${x}"}`).join("\n");
  const r = analyze({ betaText: beta, eventsText });
  assert.deepStrictEqual(r.unresolved, ["m1"], "m1 must NOT be resolved by m10 (substring): " + JSON.stringify(r));
  assert.strictEqual(r.resolutionSkipped, false);
});

console.log("\n" + pass + "/" + (pass + fail) + " passed" + (skip ? " (" + skip + " skipped)" : ""));
process.exit(fail ? 1 : 0);
