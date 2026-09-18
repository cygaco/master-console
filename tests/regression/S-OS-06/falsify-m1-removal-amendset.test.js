#!/usr/bin/env node
"use strict";
/**
 * M1 falsify-removal-amendset (S-OS-06 r4 gauntlet r5 fix brief, finding M1).
 *
 * checkFreeze()'s WORKING-TREE layer judges a post-freeze removal with:
 *   for (const k of baseSet) { if (!nowKeys.has(k) && !amendSet.has(k)) problems.push(...) }
 * `amendSet` is every amendment key regardless of shape — including a plain ADDITION-type
 * record (no `removed: true`). `removalSet` (computed one line above, used correctly by the
 * git-history layer at :1348) is the ONLY set that means "this key has a warranted removal
 * record". Before the fix, an addition-shaped amendment record sharing the removed key's name
 * silently "warrants" the removal it says nothing about — a fail-open on the entry-removal
 * predicate. After the fix, only a `{key, removed: true, warrant}` record can suppress it.
 *
 * RED:   the baseline pin is dropped from the working tree AND an addition-shaped amendment
 *        record for the SAME key is present (no removed:true) -> the working-tree removal
 *        check must still flag F8 (it must NOT be satisfied by the addition-shaped record).
 * GREEN control: the same drop with a proper {removed:true} record -> exit 0 (unchanged
 *        behaviour — the legitimate case must keep working).
 *
 *   node --test tests/regression/S-OS-06/falsify-m1-removal-amendset.test.js
 */
const FALSIFIER_ID = "M1";

const test = require("node:test");
const assert = require("node:assert");
const H = require("./falsifier-harness");

function pinKey(pin) {
  return `pin|${pin.file}|${pin.matchText}|${pin.anchor || ""}`;
}

/** Removes the base fixture's src/paths.js pin from the WORKING TREE (uncommitted) and returns its freeze key. */
function dropBasePinUncommitted(fx) {
  const p = fx.readPartition();
  const removed = p.occurrencePins.find((pin) => pin.file === "src/paths.js");
  assert.ok(removed, "the base fixture must carry the src/paths.js pin");
  const key = pinKey(removed);
  p.occurrencePins = p.occurrencePins.filter((pin) => pin !== removed);
  return { p, key };
}

test(`${FALSIFIER_ID} RED: a dropped baseline pin "warranted" only by an ADDITION-shaped amendment (same key, no removed:true) -> exit 1`, () => {
  H.withFixture({}, (fx) => {
    const { p, key } = dropBasePinUncommitted(fx);
    // An addition-shaped record for the SAME key — it warrants nothing about a removal, and
    // must not be able to suppress the working-tree removal finding (the r5 bug: it did,
    // because the check used `amendSet` — every amendment key — not `removalSet`).
    p.$freeze.amendments.push({ key, warrant: "unrelated addition-shaped record sharing the removed key's name" });
    fx.writePartition(p);
    const r = fx.runCutover(["--json"]);
    assert.strictEqual(r.status, 1, `an addition-shaped amendment must NOT warrant a removal: ${r.out}`);
    const j = H.json(r);
    assert.ok(
      j.partition.problems.some((prob) => prob.id === "F8" && prob.key === key && /post-freeze silent removal/.test(prob.message)),
      JSON.stringify(j.partition.problems)
    );
  });
});

test(`${FALSIFIER_ID} GREEN control: the same drop with a proper {removed:true} record -> exit 0`, () => {
  H.withFixture({}, (fx) => {
    const { p, key } = dropBasePinUncommitted(fx);
    p.$freeze.amendments.push({ key, removed: true, warrant: "the pinned literal was rewritten away; retired as a warranted removal" });
    fx.writePartition(p);
    const r = fx.runCutover(["--json"]);
    assert.strictEqual(r.status, 0, r.out);
  });
});
