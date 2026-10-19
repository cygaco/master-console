#!/usr/bin/env node
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { EVENTS_FILE } = require("../hooks/lib/logger");
const { isStaticFixtureSprintId } = require("../lib/fixture-event-ids");

function countFixtureRows(file = EVENTS_FILE) {
  if (!fs.existsSync(file)) return 0;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  let count = 0;
  for (const line of lines) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const sid = e && e.data && (e.data.sprint || e.data.sprint_id);
    if (isStaticFixtureSprintId(sid)) count++;
  }
  return count;
}

test(
  "GUARD events-pollution-differential SELF-PROOF: countFixtureRows() itself sees a planted fixture-id row as delta +1 — never touches the real canonical events.jsonl",
  () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "mc-events-selfproof-"));
    const tmpEventsFile = path.join(tmpHome, "events.jsonl");
    try {
      const realRow = JSON.stringify({
        data: { kind: "gauntlet-package-closed", sprint: "integrate-9.9.0-lanec" },
      });
      fs.writeFileSync(tmpEventsFile, realRow + "\n", "utf8");
      const before = countFixtureRows(tmpEventsFile);
      assert.strictEqual(before, 0, "a real-shaped sprint id must not be counted as fixture");

      const fixtureRow = JSON.stringify({
        data: { kind: "gauntlet-package-closed", sprint: "SP-CLI2" },
      });
      fs.appendFileSync(tmpEventsFile, fixtureRow + "\n", "utf8");
      const after = countFixtureRows(tmpEventsFile);

      assert.strictEqual(after - before, 1, `planted exactly one fixture row; expected delta 1, got ${after - before}`);
      assert.notStrictEqual(
        path.resolve(tmpEventsFile).toLowerCase(),
        path.resolve(EVENTS_FILE).toLowerCase(),
        "the self-proof must never read or write the real canonical events.jsonl",
      );
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 3 });
    }
  },
);
