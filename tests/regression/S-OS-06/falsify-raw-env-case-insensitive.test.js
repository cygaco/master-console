#!/usr/bin/env node
"use strict";
/**
 * falsify-raw-env-case-insensitive — S-OS-06 security gauntlet F3 (HIGH), AC-3.3.
 *
 * On Windows `process.env` is case-insensitive: `process.env.<slug>_home` reads the same variable as
 * `process.env.<SLUG>_HOME`. A raw-env scanner whose prefix alternation is case-sensitive therefore lets a
 * lowercase (or mixed-case) raw read bypass the mc-env helper unseen. ./raw-env-scan.js must flag all three
 * raw shapes — dot, bracket, destructure — whatever the case of the MC_ / legacy prefix, and must still not
 * flag a lowercase slug token that is not an env read.
 *
 * Every planted slug is composed from the harness SLUG, never written literally here.
 *
 *   node --test tests/regression/S-OS-06/falsify-raw-env-case-insensitive.test.js
 */
const FALSIFIER_ID = "RAW-ENV-CASE";

const test = require("node:test");
const assert = require("node:assert");
const H = require("./falsifier-harness");
const scan = require("./raw-env-scan");

const leg = H.SLUG.toLowerCase();
const mixedLeg = leg.charAt(0).toUpperCase() + leg.slice(1);

function idsByLine(text) {
  return scan.findRawEnvReads(text).map((h) => [h.line, h.id]);
}

test(`${FALSIFIER_ID} RED (lowercase legacy prefix): dot, bracket and destructure raw reads are each flagged`, () => {
  const planted = [
    `const a = process.env.${leg}_home;`,
    `const b = process.env["${leg}_x"];`,
    `const { ${leg}_y } = process.env;`,
  ].join("\n");
  const hits = scan.findRawEnvReads(planted);
  assert.ok(hits.length >= 3, `expected >= 3 raw-env hits, got ${hits.length}: ${JSON.stringify(hits)}`);
  const ids = new Set(hits.map((h) => h.id));
  for (const id of ["dot", "bracket", "destructure"]) assert.ok(ids.has(id), `lowercase ${id} shape not flagged: ${JSON.stringify(hits)}`);
  assert.deepStrictEqual(idsByLine(planted), [[1, "dot"], [2, "bracket"], [3, "destructure"]]);
});

test(`${FALSIFIER_ID} RED (lowercase / mixed-case MC_ and mixed-case legacy prefix): every shape is flagged`, () => {
  const planted = [
    "const a = process.env.mc_home;",
    "const b = process.env['Mc_x'];",
    "const { mc_y } = process.env;",
    `const c = process.env.${mixedLeg}_Home;`,
    `const d = process.env[\`${mixedLeg}_TOOL_\${id}\`];`,
    `const { ${mixedLeg}_Z } = process.env;`,
  ].join("\n");
  assert.deepStrictEqual(idsByLine(planted), [
    [1, "dot"],
    [2, "bracket"],
    [3, "destructure"],
    [4, "dot"],
    [5, "bracket"],
    [6, "destructure"],
  ]);
});

test(`${FALSIFIER_ID} GREEN (non-env lowercase slug token): a comment or a non-process.env property is not a raw-env hit`, () => {
  const benign = [`// ${leg} era`, `const note = "the ${leg} era";`, `const cfg = settings.${leg}_home;`, "const home = process.env.HOME;"].join("\n");
  assert.deepStrictEqual(scan.findRawEnvReads(benign), []);
});
