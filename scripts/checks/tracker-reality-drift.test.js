#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { scan, historyStart } = require("./tracker-reality-drift.js");

let pass = 0, fail = 0;
const fails = [];
function t(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; fails.push(`  ✗ ${name}: ${e.message}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trd-fix-"));
fs.writeFileSync(path.join(tmp, "E-FIX-999.md"), [
  "# E-FIX-999",
  "## Verification log",
  "| Item | Should exist? | State | Where | Proof | Checked | By |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  "| legend | — | Verified Exists | Verified Nonexistent | Missing But Required | — | — |",
  "| The drift enforcer | Yes | Missing But Required | `scripts/checks/tracker-reality-drift.js` | x | YYYY-MM-DD | a |",
  "| Absent tool | Yes | Missing But Required | scripts/checks/zzz-does-not-exist.js | | 2026 | a |",
  "| Incomplete | Yes | Exists But Incomplete | scripts/checks/tracker-reality-drift.js | | | |",
  "",
  "## Change log",
  "| Historic | Yes | Missing But Required | `scripts/checks/tracker-reality-drift.js` | | | |",
].join("\n"));

t("FLAGS a verification-log row: 'Missing But Required' + an EXISTING named script", () => {
  const r = scan({ epicsDir: tmp });
  assert.ok(!r.error, "scan errored: " + r.error);
  const hits = r.findings.filter((f) => f.artifact === "scripts/checks/tracker-reality-drift.js");
  assert.strictEqual(hits.length, 1, "expected exactly 1 flag, got " + JSON.stringify(r.findings));
  assert.strictEqual(hits[0].line, 6, "flag on wrong line: " + hits[0].line);
});
t("does NOT flag a row naming a NON-EXISTENT script (the claim is honest)", () => {
  assert.ok(!scan({ epicsDir: tmp }).findings.some((f) => /zzz-does-not-exist/.test(f.artifact)));
});
t("does NOT flag the state-vocabulary LEGEND row", () => {
  assert.ok(!scan({ epicsDir: tmp }).findings.some((f) => f.line === 5));
});
t("does NOT flag 'Exists But Incomplete' (only the exact 'Missing But Required' state)", () => {
  assert.ok(!scan({ epicsDir: tmp }).findings.some((f) => f.line === 8));
});
t("does NOT flag rows in the HISTORY (Change log) section", () => {
  assert.ok(!scan({ epicsDir: tmp }).findings.some((f) => f.line >= 11));
});
t("fail-CLOSED: a missing epics dir returns an error (never a silent 0)", () => {
  assert.ok(scan({ epicsDir: path.join(tmp, "nope") }).error, "expected an error for a missing dir");
});
t("historyStart finds the first Session/Change log heading", () => {
  assert.strictEqual(historyStart(["a", "## Change log", "b"]), 1);
  assert.strictEqual(historyStart(["a", "b"]), 2);
});

const tmpLabel = fs.mkdtempSync(path.join(os.tmpdir(), "trd-label-"));
fs.writeFileSync(path.join(tmpLabel, "label-row.md"), [
  "# label row",
  "| Labelled row | Yes | Missing But Required | `scripts/checks/tracker-reality-drift.js` | §10 states | | |",
].join("\n"));
t("a section-numbered '§N states' label does not make a claim row a legend", () => {
  const r = scan({ epicsDir: tmpLabel });
  assert.ok(!r.error, "scan errored: " + r.error);
  assert.ok(r.findings.some((f) => f.line === 2), "expected the labelled claim row to flag, got " + JSON.stringify(r.findings));
});
try { fs.rmSync(tmpLabel, { recursive: true, force: true }); } catch { }

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }

if (fail) {
  process.stderr.write(fails.join("\n") + "\n");
  process.stderr.write(`tracker-reality-drift test: ${pass}/${pass + fail} passed, ${fail} FAILED\n`);
  process.exit(1);
}
process.stdout.write(`tracker-reality-drift test: ${pass}/${pass} passed\n`);
process.exit(0);
