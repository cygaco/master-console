#!/usr/bin/env node
"use strict";
/**
 * F1 falsify-live-warpos-off-allowlist (BLOCKING tier) — S-OS-06 T2, AC-7.2 / AC-7.3.
 *
 * Plants the legacy slug in a LIVE (Class-1, unpinned, non-derived) path of a fixture repo
 * that brings its own partition, forces framework-purity's detector ON (fixture
 * package.json at 2.0.0, or --enforce), and asserts exit 1. GREEN companions prove the
 * red is caused by the plant: the clean fixture exits 0, and an allow-listed plant only
 * moves the emitted suppressed NUMBER.
 *
 *   node --test tests/regression/S-OS-06/falsify-live-warpos-off-allowlist.test.js
 */
const FALSIFIER_ID = "F1";

const test = require("node:test");
const assert = require("node:assert");
const H = require("./falsifier-harness");

function plantLeak(fx) {
  fx.write("src/leak.js", `module.exports = "~/.${H.SLUG}/state";\n`);
  fx.git(["add", "src/leak.js"]); // staged adds are tracked: the gate must see them before a commit
}

test(`${FALSIFIER_ID} GREEN: clean frozen fixture at 2.0.0 — purity ENFORCING exits 0 and prints its suppressed counts`, () => {
  H.withFixture({ version: "2.0.0" }, (fx) => {
    const r = fx.runPurity(["--json"]);
    assert.strictEqual(r.status, 0, r.out);
    const j = H.json(r);
    assert.strictEqual(j.legacy_slug.enforce, true, "2.0.0 must switch the detector ON");
    assert.strictEqual(j.legacy_slug.live_unallowed, 0);
    assert.strictEqual(j.legacy_slug.pinned, 1, "the pinned compat literal is counted as pinned");
    assert.ok(j.legacy_slug.suppressed >= 2, `Class-3/4 data must be counted as suppressed: ${j.legacy_slug.suppressed}`);
    assert.ok(j.legacy_slug.derived >= 1, "the generated view is counted as derived");

    const human = fx.runPurity([]);
    assert.strictEqual(human.status, 0, human.out);
    assert.match(human.stdout, /suppressed counts/);
    assert.match(human.stdout, /class-4 history\/\*\*/);
    assert.match(human.stdout, /legacy_slug:\s+0\s+\[ENFORCING/);
  });
});

test(`${FALSIFIER_ID} RED: a planted live slug in a Class-1 path makes purity exit 1 at 2.0.0 and names the file`, () => {
  H.withFixture({ version: "2.0.0" }, (fx) => {
    plantLeak(fx);
    const r = fx.runPurity(["--json"]);
    assert.strictEqual(r.status, 1, r.out);
    const j = H.json(r);
    assert.strictEqual(j.summary.legacy_slug, 1);
    assert.deepStrictEqual(j.findings.legacy_slug.map((f) => f.path), ["src/leak.js"]);
    assert.strictEqual(j.summary.client_slug + j.summary.abs_path + j.summary.promote_relic, 0, "the ONLY violation is the planted slug");

    const human = fx.runPurity([]);
    assert.strictEqual(human.status, 1, human.out);
    assert.match(human.stdout, /LEGACY_SLUG:[\s\S]*src\/leak\.js/);
  });
});

test(`${FALSIFIER_ID} RED: a second slug in the PINNED file, off the pinned line, still fails — a pin binds (file, matchText), not the file`, () => {
  H.withFixture({ version: "2.0.0" }, (fx) => {
    fx.write("src/paths.js", fx.read("src/paths.js") + `// docs: ~/.${H.SLUG}/portfolio.json\n`);
    const r = fx.runPurity(["--json"]);
    assert.strictEqual(r.status, 1, r.out);
    const j = H.json(r);
    assert.deepStrictEqual(j.findings.legacy_slug.map((f) => f.path), ["src/paths.js"]);
    assert.strictEqual(j.legacy_slug.pinned, 1, "the pinned line itself stays pinned");
  });
});

test(`${FALSIFIER_ID} GREEN (on-switch): the same planted leak below 2.0.0 is REPORT-ONLY — exit 0 with the pending count printed`, () => {
  H.withFixture({ version: "1.2.0" }, (fx) => {
    plantLeak(fx);
    const r = fx.runPurity(["--json"]);
    assert.strictEqual(r.status, 0, r.out);
    const j = H.json(r);
    assert.strictEqual(j.legacy_slug.enforce, false);
    assert.strictEqual(j.summary.legacy_slug, 1, "the pending count is still computed and reported");
    assert.deepStrictEqual(j.findings.legacy_slug, [], "report-only never raises a violation");
    const human = fx.runPurity([]);
    assert.strictEqual(human.status, 0, human.out);
    assert.match(human.stdout, /legacy_slug:\s+1\s+\[REPORT-ONLY/);
  });
});

test(`${FALSIFIER_ID} RED (forced on): --enforce below 2.0.0 makes the planted leak exit 1`, () => {
  H.withFixture({ version: "1.2.0" }, (fx) => {
    plantLeak(fx);
    const r = fx.runPurity(["--enforce", "--json"]);
    assert.strictEqual(r.status, 1, r.out);
    assert.strictEqual(H.json(r).legacy_slug.enforce, true);
  });
});

test(`${FALSIFIER_ID} RED (fail closed into enforcement): an unparseable package.json version enforces`, () => {
  H.withFixture({ version: "next" }, (fx) => {
    plantLeak(fx);
    const r = fx.runPurity(["--json"]);
    assert.strictEqual(r.status, 1, r.out);
    const j = H.json(r);
    assert.strictEqual(j.legacy_slug.enforce, true);
    assert.match(j.legacy_slug.reason, /unparseable/);
  });
});

test(`${FALSIFIER_ID} GREEN (lever): a slug planted inside an allow-listed Class-4 path stays green but moves the suppressed NUMBER`, () => {
  H.withFixture({ version: "2.0.0" }, (fx) => {
    const before = H.json(fx.runPurity(["--json"])).legacy_slug.suppressed;
    fx.write("history/more.md", `${H.SLUG} and ${H.SLUG} again\n`);
    fx.git(["add", "history/more.md"]);
    const r = fx.runPurity(["--json"]);
    assert.strictEqual(r.status, 0, r.out);
    assert.strictEqual(H.json(r).legacy_slug.suppressed, before + 2, "an exemption's count must jump visibly, never silently");
  });
});
