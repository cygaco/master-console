#!/usr/bin/env node

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const rf = require("./dispatch-record-fields");
const { verifyGauntlet } = require("./gauntlet-verify");

let passed = 0;
const failures = [];
function check(name, cond) {
  if (cond) passed++;
  else {
    failures.push(name);
    process.stderr.write(`  FAIL: ${name}\n`);
  }
}

const sr = rf.startedRow({
  role: "reviewer",
  provider: "openai",
  model: "gpt-5.5",
  dispatch_id: "d-1",
  sprint_id: "SP-TEST-A",
  started_at: "2026-07-16T10:00:00.000Z",
});
check("startedRow phase == started", sr.phase === "started");
check("startedRow ok is false", sr.ok === false);
check("startedRow carries role/provider/started_at", sr.role === "reviewer" && sr.provider === "openai" && sr.started_at === "2026-07-16T10:00:00.000Z");
check("startedRow carries sprint_id", sr.sprint_id === "SP-TEST-A");

let threwRole = false, threwProvider = false;
try { rf.startedRow({ provider: "x" }); } catch { threwRole = true; }
try { rf.startedRow({ role: "x" }); } catch { threwProvider = true; }
check("startedRow throws without role", threwRole);
check("startedRow throws without provider", threwProvider);

check("isStartedRow true for a started row", rf.isStartedRow(sr) === true);
check("isStartedRow false for a completion", rf.isStartedRow({ ok: true, role: "r" }) === false);
check("isStartedRow false for junk", rf.isStartedRow(null) === false && rf.isStartedRow("x") === false);

const completion = { dispatch_id: "d-1", role: "reviewer", ok: true, completed_at: "2026-07-16T10:05:00.000Z", provider: "openai" };
check("startedRow superseded once its completion lands", rf.startedRowSuperseded(sr, [sr, completion]) === true);
check("startedRow NOT superseded without a completion", rf.startedRowSuperseded(sr, [sr]) === false);

const qKnown = rf.quotaField("openai", { auth_mode: "api_key", credits_remaining: 12, tier_ok: true });
check("quotaField stamps known values", qKnown.quota.auth_mode === "api_key" && qKnown.quota.credits_remaining === 12 && qKnown.quota.tier_ok === true);
check("quotaField known flag true when values present", qKnown.quota.known === true);
const qUnknown = rf.quotaField("gemini");
check("quotaField honest unknown", qUnknown.quota.known === false && qUnknown.quota.provider === "gemini");
check("quotaField always stamps provider + checked_at", typeof qUnknown.quota.checked_at === "string" && qUnknown.quota.provider === "gemini");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drf-test-"));
const ledger = path.join(dir, "sub", "led.jsonl");
const wrote = rf.appendRecord(ledger, sr);
check("appendRecord writes + creates parent dir", wrote === true && fs.existsSync(ledger));
const back = JSON.parse(fs.readFileSync(ledger, "utf8").trim());
check("appendRecord round-trips the record", back.phase === "started" && back.dispatch_id === "d-1");

const startedOnly = verifyGauntlet({
  runId: "SP-TEST-A",
  roles: ["reviewer"],
  sprintId: "SP-TEST-A",
  records: [sr],
});
check("gauntlet-verify does NOT satisfy a role with only a started-row", startedOnly.ok === false);
const rr = startedOnly.roles.find((r) => r.role === "reviewer");
check("started-only role is not 'ran'", rr && rr.status !== "ran" && rr.satisfied === false);

const withCompletion = verifyGauntlet({
  runId: "SP-TEST-A",
  roles: ["reviewer"],
  sprintId: "SP-TEST-A",
  records: [sr, { ...completion, sprint_id: "SP-TEST-A", started_at: "2026-07-16T10:00:00.000Z" }],
});
check("gauntlet-verify satisfies the role once its completion lands", withCompletion.ok === true);

const ledger2 = path.join(dir, "sub2", "led2.jsonl");
const startedOk = rf.recordStart(ledger2, {
  role: "builder",
  provider: "claude",
  dispatch_id: "d-2",
  sprint_id: "SP-TEST-B",
  started_at: "2026-07-19T09:00:00.000Z",
});
check("recordStart returns true on a successful append", startedOk === true);
check("recordStart creates the ledger file", fs.existsSync(ledger2));
const startedBack = JSON.parse(fs.readFileSync(ledger2, "utf8").trim());
check("recordStart writes a well-formed started-row", startedBack.phase === "started" && startedBack.ok === false);
check("recordStart's started-row carries dispatch_id/role/provider", startedBack.dispatch_id === "d-2" && startedBack.role === "builder" && startedBack.provider === "claude");

let recordStartThrewRole = false, recordStartThrewProvider = false;
try { rf.recordStart(ledger2, { provider: "x" }); } catch { recordStartThrewRole = true; }
try { rf.recordStart(ledger2, { role: "x" }); } catch { recordStartThrewProvider = true; }
check("recordStart throws without role (same validation as startedRow)", recordStartThrewRole);
check("recordStart throws without provider (same validation as startedRow)", recordStartThrewProvider);

const completion2 = {
  dispatch_id: "d-2",
  role: "builder",
  provider: "claude",
  ok: true,
  started_at: "2026-07-19T09:00:00.000Z",
  completed_at: "2026-07-19T09:05:00.000Z",
  ...rf.quotaField("claude", { auth_mode: "chatgpt", tier_ok: true }),
};
const completionAppended = rf.appendRecord(ledger2, completion2);
check("the completion record appends to the SAME ledger the started-row used", completionAppended === true);
const rows2 = fs
  .readFileSync(ledger2, "utf8")
  .trim()
  .split(/\r?\n/)
  .map((l) => JSON.parse(l));
check("ledger holds exactly 2 rows: started then completed", rows2.length === 2 && rows2[0].phase === "started" && typeof rows2[1].completed_at === "string");
check("started-row and completion correlate by the SAME dispatch_id", rows2[0].dispatch_id === "d-2" && rows2[1].dispatch_id === "d-2");
check("startedRowSuperseded is true once the correlated completion is present in the read set", rf.startedRowSuperseded(rows2[0], rows2) === true);
check("the completion carries a quota fragment with known:true + the passed-in fields", rows2[1].quota.known === true && rows2[1].quota.auth_mode === "chatgpt" && rows2[1].quota.tier_ok === true);

const qFull = rf.quotaField("codex", {
  requests_remaining: 3,
  note: "weekly limit near cap",
  source: "runProvider.result.quota",
});
check("quotaField stamps requests_remaining/note/source", qFull.quota.requests_remaining === 3 && qFull.quota.note === "weekly limit near cap" && qFull.quota.source === "runProvider.result.quota");
check("quotaField(known-fields) sets known:true", qFull.quota.known === true);
check("quotaField defaults provider to null (not undefined) when omitted", rf.quotaField(undefined).quota.provider === null);

try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }

if (failures.length) {
  process.stderr.write(`\nFAIL [dispatch-record-fields.test] ${failures.length} failed, ${passed} passed\n`);
  process.exit(1);
}
process.stdout.write(`OK [dispatch-record-fields.test] ${passed} passed\n`);
process.exit(0);
