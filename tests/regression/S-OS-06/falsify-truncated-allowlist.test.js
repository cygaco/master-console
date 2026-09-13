#!/usr/bin/env node
"use strict";
/**
 * F3 falsify-truncated-allowlist (BLOCKING tier) — S-OS-06 T2, AC-7.3.
 *
 * An empty, truncated, header-less, mis-shaped or deleted partition — or one whose
 * allow-view is EMPTY — must make the gates fail CLOSED with exit 2. Never 0 (green on
 * nothing) and never 1 (a routine violation that reads as "the list works"). GREEN
 * companion: the intact partition exits 0 on both gates.
 *
 *   node --test tests/regression/S-OS-06/falsify-truncated-allowlist.test.js
 */
const FALSIFIER_ID = "F3";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const H = require("./falsifier-harness");

test(`${FALSIFIER_ID} GREEN: intact partition — cutover exits 0 and purity exits 0`, () => {
  H.withFixture({}, (fx) => {
    const cut = fx.runCutover([]);
    assert.strictEqual(cut.status, 0, cut.out);
    const pur = fx.runPurity([]);
    assert.strictEqual(pur.status, 0, pur.out);
  });
});

const UNREADABLE = [
  ["an empty file", () => ""],
  ["a whitespace-only file", () => "  \n\n"],
  ["JSON truncated mid-document", (raw) => raw.slice(0, Math.floor(raw.length / 2))],
  ["valid JSON without the $question header", (raw) => { const p = JSON.parse(raw); delete p.$question; return JSON.stringify(p); }],
  ["a JSON array instead of the partition object", () => "[]"],
  ["a section that is not an array", (raw) => { const p = JSON.parse(raw); p.pathGlobs = { pattern: "history/**" }; return JSON.stringify(p); }],
];

function assertFailsClosed(fx, label) {
  const cut = fx.runCutover([]);
  assert.strictEqual(cut.status, 2, `cutover must exit 2 on ${label}: ${cut.out}`);
  assert.match(cut.stderr, /fail-closed|failing CLOSED/);
  const pur = fx.runPurity([]);
  assert.strictEqual(pur.status, 2, `purity must exit 2 on ${label}: ${pur.out}`);
  const dry = fx.runCodemod(["--dry-run"]);
  assert.notStrictEqual(dry.status, 0, `the codemod must never read ${label} as a valid partition: ${dry.out}`);
}

for (const [label, corrupt] of UNREADABLE) {
  test(`${FALSIFIER_ID} RED: ${label} -> cutover exit 2 and purity exit 2 (fail CLOSED, never green)`, () => {
    H.withFixture({}, (fx) => {
      fx.writePartition(corrupt(fx.read(H.REL.partition)));
      assertFailsClosed(fx, label);
    });
  });
}

test(`${FALSIFIER_ID} RED: the partition artifact deleted -> cutover exit 2 and purity exit 2`, () => {
  H.withFixture({}, (fx) => {
    fs.rmSync(path.join(fx.dir, ...H.REL.partition.split("/")));
    assertFailsClosed(fx, "a deleted partition");
  });
});

test(`${FALSIFIER_ID} RED: a parseable partition whose allow-view is EMPTY -> cutover exit 2 (an empty allow-list is a truncated one)`, () => {
  H.withFixture({}, (fx) => {
    const empty = {
      $question: "What must NOT be rewritten (fixture: every allow entry stripped).",
      generatedViews: [{ path: ".claude/paths.json", class: 1, warrant: "fixture generated view" }],
      pathGlobs: [{ pattern: "history/**", class: 2, writeProtected: true, warrant: "operator-gated, not an allow entry" }],
      occurrencePins: [],
      futureEntries: [],
    };
    empty.$freeze = { baselineKeys: H.LOADER.entryKeys(empty), amendments: [] };
    fx.writePartition(empty);
    const cut = fx.runCutover([]);
    assert.strictEqual(cut.status, 2, cut.out);
    assert.match(cut.stderr, /EMPTY/);
  });
});
