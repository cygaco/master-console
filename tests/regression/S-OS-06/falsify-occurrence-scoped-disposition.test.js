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

test(`${FALSIFIER_ID} R2: two rewritable occurrences on ONE line both transform (--apply spans, no line->rule collapse)`, () => {
  H.withFixture({ version: "2.0.0" }, (fx) => {
    // Two unprotected slugs on one line: --apply must rewrite BOTH (genericSlugRewriteScoped over every
    // unprotected span), and the dry-run ledger must carry TWO rewritten rows — not one collapsed by line.
    fx.write("src/two.js", `// ${H.SLUG} one and ${H.SLUG} two on one line\nmodule.exports = 1;\n`);
    fx.git(["add", "src/two.js"]); // the codemod scans git-tracked files
    const d = dryCounts(fx);
    assert.ok(d.rewritten >= 2, `both occurrences must be dispositioned rewritten (no collapse): ${d.out.slice(0, 800)}`);
    const apply = fx.runCodemod(["--apply"]);
    assert.strictEqual(apply.status, 0, apply.out);
    const after = fx.read("src/two.js");
    assert.ok(!/warpos/i.test(after.split("\n")[0]), `both occurrences on the line must be rewritten: ${after}`);
    assert.match(after, /\/\/ mc one and mc two on one line/, `both spans rewritten to mc: ${after}`);
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

// ── S-OS-06 r4 B3: the category delta is measured per OCCURRENCE on compat lines too ─────────────────────────────
// rename-mc.js used to skip a WHOLE LINE from the structural delta when the compat matcher hit it, so an unprotected
// occurrence sharing a compat line escaped BOTH the rewrite (an odd-case mix is outside the four case forms) and the
// detection (the delta never looked). The plant sits exactly there; the swept population is the codemod's own emitted
// `categorized` total, which must count the compat line's occurrences.

// "WarPos": a case mix outside WARPOS / WarpOS / Warpos / warpos, built from the slug so this file plants no literal.
const ODD_CASE = `${LEG[0].toUpperCase()}${LEG.slice(1, 3)}${LEG[3].toUpperCase()}${LEG.slice(4)}`;
const COMPAT_ODD_LINE = `  "Bash(${COMPAT_MATCH} node run.js --home ~/.${ODD_CASE}/x *)",`;

/** The codemod dry-run's structural-delta frame: exit, total categorized (the swept occurrence population), total delta. */
function deltaFrame(fx) {
  const dry = fx.runCodemod(["--dry-run"]);
  const line = dry.stdout.split(/\r?\n/).find((l) => l.includes("per-category delta ("));
  assert.ok(line, `the dry-run must print its per-category delta: ${dry.out.slice(0, 1500)}`);
  const categorized = [...line.matchAll(/categorized=(\d+)/g)].reduce((a, m) => a + Number(m[1]), 0);
  const pinned = [...line.matchAll(/ pinned=(\d+)/g)].reduce((a, m) => a + Number(m[1]), 0);
  const total = dry.stdout.match(/categoryDeltaTotal=(\d+) uncomputableCategoryLines=(\d+)/);
  assert.ok(total, dry.out.slice(0, 1500));
  const tracked = dry.stdout.match(/rename-mc --dry-run: (\d+) tracked files/);
  return { status: dry.status, categorized, pinned, delta: Number(total[1]), uncomputable: Number(total[2]), tracked: tracked ? Number(tracked[1]) : null, line, out: dry.out };
}

test(`${FALSIFIER_ID} r4 B3 unit: the odd-case plant is outside the rewriter's case forms and is NOT compat-protected`, () => {
  assert.ok(!/WARPOS|WarpOS|Warpos|warpos/.test(ODD_CASE) && new RegExp(LEG, "i").test(ODD_CASE), "fixture sanity: an odd-case slug");
  const partition = H.LOADER.buildPartition(H.basePartition({ mutate: registerCompat }));
  assert.ok(partition.findCompatOccurrence(SETTINGS, COMPAT_ODD_LINE), "the plant line IS a registered compat line (the whole-line skip fired on it)");
  const occ = [...COMPAT_ODD_LINE.matchAll(new RegExp(LEG, "gi"))].map((m) => m.index);
  assert.strictEqual(occ.length, 2);
  assert.strictEqual(partition.dispositionAt(SETTINGS, COMPAT_ODD_LINE, occ[0]).kind, "compat", "the registered slug is compat");
  assert.strictEqual(partition.dispositionAt(SETTINGS, COMPAT_ODD_LINE, occ[1]), null, "the odd-case slug beside it is unprotected");
});

test(`${FALSIFIER_ID} r4 B3 TRIPLE: compat line with only its registered slug GREEN -> odd-case mix planted on it RED -> revert GREEN (categorized emitted)`, (t) => {
  withCompatLine(COMPAT_LINE, (fx) => {
    // (1) GREEN control: the compat line is INSIDE the delta population (its registered occurrence counts as pinned).
    const green = deltaFrame(fx);
    t.diagnostic(`control: exit=${green.status} delta=${green.delta} uncomputable=${green.uncomputable} over categorized=${green.categorized} (pinned=${green.pinned}) in ${green.tracked} tracked files`);
    assert.strictEqual(green.status, 0, green.out.slice(0, 1500));
    assert.strictEqual(green.delta, 0);
    assert.strictEqual(green.uncomputable, 0);
    assert.ok(green.categorized >= 2, `the compat line's registered occurrence must be categorized (population proof): ${green.line}`);

    // (2) RED plant: an odd-case slug on the SAME registered compat line — the old whole-line skip never measured it.
    fx.write(SETTINGS, settingsFile(COMPAT_ODD_LINE));
    const red = deltaFrame(fx);
    t.diagnostic(`plant: exit=${red.status} delta=${red.delta} uncomputable=${red.uncomputable} over categorized=${red.categorized} (pinned=${red.pinned}) in ${red.tracked} tracked files`);
    assert.strictEqual(red.status, 1, `an unprotected, untransformable occurrence on a compat line must fail the dry-run: ${red.out.slice(0, 1500)}`);
    assert.strictEqual(red.categorized, green.categorized + 1, "the plant is inside the swept population: exactly one more categorized occurrence");
    assert.strictEqual(red.pinned, green.pinned, "the plant is not protected by the compat entry");
    assert.strictEqual(red.delta, 1);
    assert.match(red.out, new RegExp(`untransformed ${SETTINGS.replace(/[.]/g, "\\.")}:\\d+`));
    const before = fx.read(SETTINGS);
    const apply = fx.runCodemod(["--apply"]);
    assert.notStrictEqual(apply.status, 0, `--apply must refuse on the delta: ${apply.out.slice(0, 800)}`);
    assert.match(apply.out, /refused \(β r3c structural delta\)/);
    assert.strictEqual(fx.read(SETTINGS), before, "a refused --apply touches nothing");

    // (3) revert the plant -> GREEN over the same population.
    fx.write(SETTINGS, settingsFile(COMPAT_LINE));
    const again = deltaFrame(fx);
    t.diagnostic(`reverted: exit=${again.status} delta=${again.delta} uncomputable=${again.uncomputable} over categorized=${again.categorized} (pinned=${again.pinned}) in ${again.tracked} tracked files`);
    assert.strictEqual(again.status, 0, again.out.slice(0, 1500));
    assert.strictEqual(again.delta, 0);
    assert.strictEqual(again.categorized, green.categorized);
  });
});
