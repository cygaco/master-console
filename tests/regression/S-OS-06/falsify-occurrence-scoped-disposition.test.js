#!/usr/bin/env node
"use strict";
/**
 * SEC-F1 falsify-occurrence-scoped-disposition (BLOCKING tier) — S-OS-06 security fix-cycle r2, finding F1 (HIGH).
 *
 * A pin / compat occurrence covers a legacy-slug OCCURRENCE only when that occurrence's character index lies inside
 * a span of the entry's matchText on the line — occurrence-scoped, never line-scoped. Before the fix a pin or compat
 * match on a line credited EVERY slug hit on that line to pinned/compat, so an extra live slug planted beside a
 * registered occurrence was masked (verified: pending=0, compat=2 on a same-line double).
 *
 * RED:   an extra live slug on the PINNED line, outside the pin's matchText -> framework-purity exit 1 naming the file,
 *        pinned stays 1, and the codemod ledger dispositions the extra occurrence `rewritten` (not pinned);
 *        an extra live slug on a registered COMPAT occurrence's line, outside its matchText -> exit 1, compat stays 1.
 * GREEN: the clean fixture, and a compat line whose only slug is inside the matchText -> exit 0.
 *
 *   node --test tests/regression/S-OS-06/falsify-occurrence-scoped-disposition.test.js
 */
const FALSIFIER_ID = "SEC-F1";

const test = require("node:test");
const assert = require("node:assert");
const H = require("./falsifier-harness");

const LEG = H.SLUG;
const PIN_FILE = "src/paths.js";
const PINNED_LINE = `const LEGACY_HOME_SEGMENT = ".${LEG}";`;
const PIN_DOUBLE_LINE = `${PINNED_LINE} // extra live ~/.${LEG}/x`;

const SETTINGS = "src/settings.js";
const COMPAT_MATCH = `${LEG.toUpperCase()}_DISPATCH_BACKGROUND=1`;
const COMPAT_LINE = `  "Bash(${COMPAT_MATCH} node run.js *)",`;
const COMPAT_DOUBLE_LINE = `  "Bash(${COMPAT_MATCH} node run.js --state ~/.${LEG}/x *)",`;

function registerCompat(p) {
  p.compatWindows = [
    {
      surface: "env-set-both",
      expires: "2.1.0",
      warrant: "fixture legacy env allow-rule twin kept for one release",
      occurrences: [{ file: SETTINGS, matchText: COMPAT_MATCH, anchor: "Bash(" }],
    },
  ];
}

function settingsFile(line) {
  return `module.exports = [\n  "Bash(MC_DISPATCH_BACKGROUND=1 node run.js *)",\n${line}\n];\n`;
}

function withCompatLine(line, fn) {
  return H.withFixture({ version: "2.0.0", extraFiles: { [SETTINGS]: settingsFile(line) }, partition: H.basePartition({ mutate: registerCompat }) }, fn);
}

/** The codemod dry-run's per-occurrence disposition counts (the ledger consumer of the same choke-point). */
function dryCounts(fx) {
  const dry = fx.runCodemod(["--dry-run"]);
  const m = dry.stdout.match(/disposition counts: rewritten=(\d+) pinned=(\d+) compat=(\d+) derived=(\d+)/);
  assert.ok(m, `the dry-run must print its disposition counts: ${dry.out.slice(0, 1500)}`);
  return { status: dry.status, rewritten: Number(m[1]), pinned: Number(m[2]), compat: Number(m[3]), derived: Number(m[4]), out: dry.out };
}

test(`${FALSIFIER_ID} unit: dispositionAt credits only the occurrence inside the matchText span`, () => {
  const partition = H.LOADER.buildPartition(H.basePartition({ mutate: registerCompat }));
  assert.strictEqual(typeof partition.dispositionAt, "function", "the partition API exposes the occurrence-scoped choke-point");

  const first = PIN_DOUBLE_LINE.indexOf(LEG);
  const second = PIN_DOUBLE_LINE.indexOf(LEG, first + 1);
  assert.ok(first >= 0 && second > first, "the planted line carries two slugs");
  const atFirst = partition.dispositionAt(PIN_FILE, PIN_DOUBLE_LINE, first);
  assert.strictEqual(atFirst && atFirst.kind, "pinned", "the slug inside the pin's matchText is pinned");
  assert.strictEqual(partition.dispositionAt(PIN_FILE, PIN_DOUBLE_LINE, second), null, "the extra slug outside the matchText is NOT pinned");
  assert.strictEqual(partition.dispositionAt("src/other.js", PIN_DOUBLE_LINE, first), null, "a pin never covers another file");

  const cFirst = COMPAT_DOUBLE_LINE.toLowerCase().indexOf(LEG);
  const cSecond = COMPAT_DOUBLE_LINE.toLowerCase().indexOf(LEG, cFirst + 1);
  const atCompat = partition.dispositionAt(SETTINGS, COMPAT_DOUBLE_LINE, cFirst);
  assert.strictEqual(atCompat && atCompat.kind, "compat", "the slug inside the compat matchText is compat");
  assert.strictEqual(atCompat.window.surface, "env-set-both");
  assert.strictEqual(partition.dispositionAt(SETTINGS, COMPAT_DOUBLE_LINE, cSecond), null, "the extra slug outside the compat matchText is NOT compat");
});

test(`${FALSIFIER_ID} GREEN: the clean fixture — purity exits 0 with exactly one pinned occurrence; the codemod pins it`, () => {
  H.withFixture({ version: "2.0.0" }, (fx) => {
    const r = fx.runPurity(["--json"]);
    assert.strictEqual(r.status, 0, r.out);
    const j = H.json(r);
    assert.strictEqual(j.legacy_slug.live_unallowed, 0);
    assert.strictEqual(j.legacy_slug.pinned, 1);
    const d = dryCounts(fx);
    assert.strictEqual(d.status, 0, d.out);
    assert.strictEqual(d.pinned, 1);
    assert.strictEqual(d.rewritten, 0);
  });
});

test(`${FALSIFIER_ID} RED: an extra live slug on the PINNED line, outside the pin's matchText -> purity exit 1, pinned stays 1`, () => {
  H.withFixture({ version: "2.0.0" }, (fx) => {
    fx.write(PIN_FILE, `${PIN_DOUBLE_LINE}\nmodule.exports = { LEGACY_HOME_SEGMENT };\n`);
    const r = fx.runPurity(["--json"]);
    assert.strictEqual(r.status, 1, r.out);
    const j = H.json(r);
    assert.ok(j.legacy_slug.live_unallowed >= 1, `the extra occurrence must be live-unallowed: ${JSON.stringify(j.legacy_slug)}`);
    assert.strictEqual(j.legacy_slug.pinned, 1, "the pin covers only the occurrence inside its matchText");
    assert.deepStrictEqual(j.findings.legacy_slug.map((f) => f.path), [PIN_FILE]);
    const d = dryCounts(fx);
    assert.strictEqual(d.pinned, 1, `the codemod ledger must not pin the extra occurrence: ${d.out.slice(0, 800)}`);
    assert.strictEqual(d.rewritten, 1, "the extra occurrence is dispositioned rewritten, never absorbed by the pin");
  });
});

test(`${FALSIFIER_ID} --apply is occurrence-scoped (finding 1): the pinned span survives, the same-line extra live slug is rewritten`, () => {
  H.withFixture({ version: "2.0.0" }, (fx) => {
    fx.write(PIN_FILE, `${PIN_DOUBLE_LINE}\nmodule.exports = { LEGACY_HOME_SEGMENT };\n`);
    const apply = fx.runCodemod(["--apply"]);
    assert.strictEqual(apply.status, 0, apply.out);
    const after = fx.read(PIN_FILE);
    // The pinned literal ".warpos" (inside the pin's matchText) is preserved byte-for-byte; the extra
    // comment slug ~/.warpos/x (outside the span) is rewritten to ~/.mc/x. Line-scoped --apply would
    // have rewritten BOTH — the F5 defect mechanism.
    assert.ok(after.includes(`".${LEG}"`), `the pinned literal must survive --apply: ${after}`);
    assert.ok(after.includes("~/.mc/x") && !after.includes(`~/.${LEG}/x`), `the same-line extra live slug must be rewritten: ${after}`);
  });
});

test(`${FALSIFIER_ID} GREEN (compat): a registered compat line whose only slug is inside the matchText -> exit 0, compat 1`, () => {
  withCompatLine(COMPAT_LINE, (fx) => {
    const r = fx.runPurity(["--json"]);
    assert.strictEqual(r.status, 0, r.out);
    const j = H.json(r);
    assert.strictEqual(j.legacy_slug.live_unallowed, 0);
    assert.strictEqual(j.legacy_slug.compat, 1);
    const d = dryCounts(fx);
    assert.strictEqual(d.compat, 1);
    assert.strictEqual(d.rewritten, 0);
  });
});

test(`${FALSIFIER_ID} RED (compat): a second live slug on the registered compat occurrence's line -> purity exit 1, compat stays 1`, () => {
  withCompatLine(COMPAT_DOUBLE_LINE, (fx) => {
    const r = fx.runPurity(["--json"]);
    assert.strictEqual(r.status, 1, r.out);
    const j = H.json(r);
    assert.ok(j.legacy_slug.live_unallowed >= 1, `the extra occurrence must be live-unallowed: ${JSON.stringify(j.legacy_slug)}`);
    assert.strictEqual(j.legacy_slug.compat, 1, "the compat window covers only the occurrence inside its matchText");
    assert.deepStrictEqual(j.findings.legacy_slug.map((f) => f.path), [SETTINGS]);
    const d = dryCounts(fx);
    assert.strictEqual(d.compat, 1, `the codemod ledger must not credit the extra occurrence to compat: ${d.out.slice(0, 800)}`);
    assert.strictEqual(d.rewritten, 1);
  });
});
