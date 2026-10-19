"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const events = require("./update-events");

function emitAndRead(sessionEnv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-update-events-"));
  const file = path.join(dir, "events.jsonl");
  const saved = { sid: process.env.CLAUDE_SESSION_ID, ef: process.env.MC_EVENTS_FILE };
  try {
    if (sessionEnv === undefined) delete process.env.CLAUDE_SESSION_ID;
    else process.env.CLAUDE_SESSION_ID = sessionEnv;
    process.env.MC_EVENTS_FILE = file;
    events.emitPreflightGate(dir, { txId: "t", gate: "g", status: "pass" });
    const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
    return JSON.parse(lines[lines.length - 1]);
  } finally {
    if (saved.sid === undefined) delete process.env.CLAUDE_SESSION_ID;
    else process.env.CLAUDE_SESSION_ID = saved.sid;
    if (saved.ef === undefined) delete process.env.MC_EVENTS_FILE;
    else process.env.MC_EVENTS_FILE = saved.ef;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("session falls back to \"mc-update\" when CLAUDE_SESSION_ID is unset", () => {
  const env = emitAndRead(undefined);
  assert.strictEqual(env.cat, "mc.update.preflight");
  assert.strictEqual(env.session, "mc-update");
});

test("session is CLAUDE_SESSION_ID when set", () => {
  const env = emitAndRead("sess-123");
  assert.strictEqual(env.session, "sess-123");
});
