#!/usr/bin/env node
"use strict";
/**
 * F10 falsify-compat-outside-register (BLOCKING tier, beside F8) — S-OS-06 T5, β r3b (msg a2e6f83b) conditions 1-4.
 *
 * The FIFTH disposition `compat` is closed by REGISTRATION: an occurrence is compat IFF it sits inside a registered
 * compat window of the partition (compatWindows: enumerated EXACT member paths + anchored occurrences), and every
 * window carries its OWN `expires` version (per entry, never a global switch).
 *
 * RED:   a compat-looking literal OUTSIDE the register (a new alias file shaped exactly like a registered member; a
 *        second legacy literal in the registered occurrence's file, off the registered line) -> framework-purity exit 1;
 *        a registered window whose expiry the tree version reached -> exit 1 (and the codemod dry-run reports
 *        compatExpired and exits non-zero); per-entry: at a version between two windows' expiries ONLY the expired
 *        window reds; the register is under the F8 freeze (a silent compat addition, or a silently extended expiry, is
 *        an F8 problem); a member that also holds another disposition, a glob member, a stale member -> cutover exit 1.
 * GREEN: the registered surfaces at a version below their expiry -> exit 0 with the compat count EMITTED per surface.
 *
 *   node --test tests/regression/S-OS-06/falsify-compat-outside-register.test.js
 */
const FALSIFIER_ID = "F10";

const test = require("node:test");
const assert = require("node:assert");
const H = require("./falsifier-harness");

const LEG = H.SLUG;
const LEG_ENV = `${LEG.toUpperCase()}_`;
const ALIAS = `cmds/scan/${LEG}-staleness.md`; // a registered alias member (legacy name AND legacy content)
const ALIAS_LOOKALIKE = `cmds/scan/${LEG}-doctor.md`; // same shape, NOT registered
const SETTINGS = "src/settings.js";
const SETTINGS_LINE = `  "Bash(${LEG_ENV}DISPATCH_BACKGROUND=1 node run.js *)",`;

function compatFiles() {
  return {
    [ALIAS]: `# /scan:${LEG}-staleness (deprecated alias)\nRuns /scan:mc-staleness. The ${LEG} name is removed in 2.1.0.\n`,
    [SETTINGS]: `module.exports = [\n  "Bash(MC_DISPATCH_BACKGROUND=1 node run.js *)",\n${SETTINGS_LINE}\n];\n`,
  };
}

function registerCompat(p, { aliasExpires = "2.1.0", settingsExpires = "2.1.0" } = {}) {
  p.compatWindows = [
    { surface: "alias-skills", expires: aliasExpires, warrant: "fixture deprecated alias skills kept for one release", members: [ALIAS] },
    {
      surface: "env-set-both",
      expires: settingsExpires,
      warrant: "fixture legacy env allow-rule twin kept for one release",
      occurrences: [{ file: SETTINGS, matchText: `${LEG_ENV}DISPATCH_BACKGROUND=1`, anchor: "Bash(" }],
    },
  ];
}

function withCompat(opts, fn) {
  return H.withFixture(
    { version: opts.version || "2.0.0", extraFiles: { ...compatFiles(), ...(opts.extraFiles || {}) }, partition: H.basePartition({ mutate: (p) => registerCompat(p, opts) }) },
    fn
  );
}

test(`${FALSIFIER_ID} GREEN: registered compat surfaces below their expiry -> purity exit 0, compat count EMITTED per surface`, () => {
  withCompat({}, (fx) => {
    const r = fx.runPurity(["--json"]);
    assert.strictEqual(r.status, 0, r.out);
    const ls = H.json(r).legacy_slug;
    assert.strictEqual(ls.live_unallowed, 0);
    assert.deepStrictEqual(ls.compat_by_surface, { "alias-skills (expires 2.1.0)": 2, "env-set-both (expires 2.1.0)": 1 });
    assert.strictEqual(ls.compat, 3);
    assert.strictEqual(ls.compat_expired, 0);
    assert.strictEqual(ls.dispositions.compat, 3, "compat is one of the five emitted dispositions");
    const human = fx.runPurity([]);
    assert.strictEqual(human.status, 0, human.out);
    assert.match(human.stdout, /compat alias-skills \(expires 2\.1\.0\)/);
    assert.match(human.stdout, /compat env-set-both \(expires 2\.1\.0\)/);
    assert.match(human.stdout, /dispositions \(5, each closed by a registered artifact\): .*compat=3/);
    const cut = fx.runCutover([]);
    assert.strictEqual(cut.status, 0, `the registered + frozen compat entries are hygiene-clean: ${cut.out}`);
    const dry = fx.runCodemod(["--dry-run"]);
    assert.strictEqual(dry.status, 0, dry.out);
    assert.match(dry.stdout, /disposition counts: .*compat=3 derived=\d+\s*$/m);
    assert.match(dry.stdout, /^\s*compatExpired=0\s*$/m);
  });
});

test(`${FALSIFIER_ID} RED: a compat-LOOKALIKE alias file outside the register -> purity exit 1 naming it; the compat count does not absorb it`, () => {
  withCompat({ extraFiles: { [ALIAS_LOOKALIKE]: `# /scan:${LEG}-doctor (deprecated alias)\nRuns /scan:mc-doctor.\n` } }, (fx) => {
    const r = fx.runPurity(["--json"]);
    assert.strictEqual(r.status, 1, r.out);
    const j = H.json(r);
    assert.deepStrictEqual(j.findings.legacy_slug.map((f) => f.path), [ALIAS_LOOKALIKE]);
    assert.strictEqual(j.legacy_slug.compat, 3, "a file that merely LOOKS like compat is never counted as compat");
  });
});

test(`${FALSIFIER_ID} RED: a second legacy literal in the registered occurrence's file, off the registered line -> exit 1`, () => {
  withCompat({ extraFiles: { [SETTINGS]: `${compatFiles()[SETTINGS]}// set ${LEG_ENV}DISPATCH_BACKGROUND=1 in CI\n` } }, (fx) => {
    const r = fx.runPurity(["--json"]);
    assert.strictEqual(r.status, 1, r.out);
    const j = H.json(r);
    assert.deepStrictEqual(j.findings.legacy_slug.map((f) => f.path), [SETTINGS]);
    assert.strictEqual(j.legacy_slug.compat_by_surface["env-set-both (expires 2.1.0)"], 1, "only the registered line is compat");
  });
});

test(`${FALSIFIER_ID} RED (expiry): the tree version reaches the windows' expiry -> purity exit 1 + codemod compatExpired`, () => {
  withCompat({ version: "2.1.0" }, (fx) => {
    const r = fx.runPurity(["--json"]);
    assert.strictEqual(r.status, 1, r.out);
    const j = H.json(r);
    assert.deepStrictEqual(j.findings.legacy_slug.map((f) => f.path).sort(), [ALIAS, SETTINGS].sort());
    assert.strictEqual(j.legacy_slug.compat, 0);
    assert.strictEqual(j.legacy_slug.compat_expired, 3);
    assert.match(fx.runPurity([]).stdout, /compat-EXPIRED alias-skills \(expires 2\.1\.0\)/);
    const dry = fx.runCodemod(["--dry-run"]);
    assert.notStrictEqual(dry.status, 0, dry.out);
    assert.match(dry.stdout, /^\s*compatExpired=3\s*$/m);
    assert.match(dry.stderr, /compat occurrence\(s\) sit in a window whose expiry/);
  });
});

test(`${FALSIFIER_ID} RED (per-entry expiry): between two windows' expiries ONLY the expired window reds`, () => {
  withCompat({ version: "2.5.0", aliasExpires: "3.0.0", settingsExpires: "2.1.0" }, (fx) => {
    const r = fx.runPurity(["--json"]);
    assert.strictEqual(r.status, 1, r.out);
    const j = H.json(r);
    assert.deepStrictEqual(j.findings.legacy_slug.map((f) => f.path), [SETTINGS], "the unexpired alias window stays compat");
    assert.deepStrictEqual(j.legacy_slug.compat_by_surface, { "alias-skills (expires 3.0.0)": 2 });
    assert.deepStrictEqual(j.legacy_slug.compat_expired_by_surface, { "env-set-both (expires 2.1.0)": 1 });
  });
});

test(`${FALSIFIER_ID} RED (fail closed): an unparseable tree version reads every window as EXPIRED`, () => {
  withCompat({ version: "next" }, (fx) => {
    const r = fx.runPurity(["--json"]);
    assert.strictEqual(r.status, 1, r.out);
    assert.strictEqual(H.json(r).legacy_slug.compat_expired, 3);
  });
});

test(`${FALSIFIER_ID} RED (freeze): a compat member added after the freeze without an amendment -> cutover [F8]`, () => {
  withCompat({ extraFiles: { [ALIAS_LOOKALIKE]: `# alias\n/scan:${LEG}-doctor\n` } }, (fx) => {
    const p = fx.readPartition();
    p.compatWindows[0].members.push(ALIAS_LOOKALIKE);
    fx.writePartition(p);
    const r = fx.runCutover(["--json"]);
    assert.strictEqual(r.status, 1, r.out);
    const probs = H.json(r).partition.problems;
    assert.ok(probs.some((x) => x.id === "F8" && x.key === `compat|alias-skills|2.1.0|path|${ALIAS_LOOKALIKE}`), JSON.stringify(probs));
  });
});

test(`${FALSIFIER_ID} RED (freeze): silently EXTENDING a window's expiry is a new key -> cutover [F8]`, () => {
  withCompat({}, (fx) => {
    const p = fx.readPartition();
    p.compatWindows[0].expires = "9.0.0";
    fx.writePartition(p);
    const r = fx.runCutover(["--json"]);
    assert.strictEqual(r.status, 1, r.out);
    const probs = H.json(r).partition.problems;
    assert.ok(probs.some((x) => x.id === "F8" && x.key === `compat|alias-skills|9.0.0|path|${ALIAS}`), JSON.stringify(probs));
  });
});

test(`${FALSIFIER_ID} RED (schema): a member that also holds another disposition, a glob member, and a missing expiry -> cutover exit 1`, () => {
  const mutate = (p) => {
    registerCompat(p);
    p.compatWindows[0].members.push("history/2026-notes.md"); // also Class-4 history/**
    p.compatWindows.push({ surface: "globbed", expires: "2.1.0", warrant: "fixture glob member", members: ["cmds/scan/*.md"] });
    p.compatWindows.push({ surface: "no-expiry", warrant: "fixture window without its own expiry", members: ["src/app.js"] });
  };
  H.withFixture({ version: "2.0.0", extraFiles: compatFiles(), partition: H.basePartition({ mutate }) }, (fx) => {
    const r = fx.runCutover(["--json"]);
    assert.strictEqual(r.status, 1, r.out);
    const msgs = H.json(r).partition.problems.map((x) => `[${x.id}] ${x.message}`).join("\n");
    assert.match(msgs, /\[SCHEMA\] compat member 'history\/2026-notes\.md' is also path glob 'history\/\*\*'/);
    assert.match(msgs, /\[SCHEMA\] compat member 'cmds\/scan\/\*\.md' is a glob/);
    assert.match(msgs, /\[SCHEMA\] compat window 'no-expiry' needs its OWN expires version/);
  });
});

test(`${FALSIFIER_ID} RED (stale): a registered member that is not tracked -> cutover [F7]`, () => {
  H.withFixture({ version: "2.0.0", partition: H.basePartition({ mutate: (p) => registerCompat(p) }) }, (fx) => {
    const r = fx.runCutover(["--json"]);
    assert.strictEqual(r.status, 1, r.out);
    const msgs = H.json(r).partition.problems.map((x) => `[${x.id}] ${x.message}`).join("\n");
    assert.match(msgs, new RegExp(`\\[F7\\] stale compat member '${ALIAS.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}'`));
  });
});
