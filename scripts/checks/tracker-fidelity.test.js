"use strict";

const test = require("node:test");
const assert = require("node:assert");
const tf = require("./tracker-fidelity.js");

function fakeSnapshot(activeSprint, existingPaths = []) {
  const set = new Set(existingPaths);
  return { activeSprint, ts: "T", exists: (rel) => set.has(rel) };
}

test("checkAuthority active-sprint: matches active id -> ok, mismatch -> reason", () => {
  const snap = fakeSnapshot("SP-A");
  assert.strictEqual(tf.checkAuthority("active-sprint", "SP-A", snap), null);
  assert.match(tf.checkAuthority("active-sprint", "SP-B", snap), /active sprint is "SP-A"/);
});

test("checkAuthority disk: existing path -> ok, missing -> reason", () => {
  const snap = fakeSnapshot("SP-A", ["a/exists.md"]);
  assert.strictEqual(tf.checkAuthority("disk", "a/exists.md", snap), null);
  assert.match(tf.checkAuthority("disk", "a/gone.md", snap), /does NOT exist/);
});

test("checkAuthority disk-script: flags only the missing scripts token in prose", () => {
  const snap = fakeSnapshot("SP-A", ["scripts/here.js"]);
  assert.strictEqual(tf.checkAuthority("disk-script", "here check (scripts/here.js) — GREEN", snap), null);
  assert.match(
    tf.checkAuthority("disk-script", "gone check (scripts/gone.js) — GREEN", snap),
    /scripts\/gone\.js/,
  );
  assert.strictEqual(tf.checkAuthority("disk-script", "some human note, no path", snap), null);
});

test("checkAuthority unknown authority is fail-closed", () => {
  assert.match(tf.checkAuthority("bogus", "x", fakeSnapshot("SP-A")), /unknown authority/);
});

test("evaluate PASSES when every mapped field agrees with ground truth", () => {
  const trackers = {
    current: {
      id: "SP-A",
      plan_contract: "plan.md",
      requirements: { prd: "prd.md", build_spec: "bs.md" },
    },
    progress: { active_files: ["a.js"], modified_files: [], checks_passing: ["ran scripts/ok.js"] },
  };
  const snap = fakeSnapshot("SP-A", ["plan.md", "prd.md", "bs.md", "a.js", "scripts/ok.js"]);
  const r = tf.evaluate(trackers, snap);
  assert.strictEqual(r.ok, true, JSON.stringify(r.violations));
});

test("evaluate FLAGS a wrong sprint id, a missing requirement path, and a phantom passing-check script", () => {
  const trackers = {
    current: { id: "SP-WRONG", plan_contract: "plan.md", requirements: { prd: "gone.md" } },
    progress: { checks_passing: ["scripts/phantom.js green"] },
  };
  const snap = fakeSnapshot("SP-A", ["plan.md"]);
  const r = tf.evaluate(trackers, snap);
  assert.strictEqual(r.ok, false);
  assert.ok(r.violations.some((v) => /current\.id.*active sprint is "SP-A"/.test(v)), "sprint-id drift");
  assert.ok(r.violations.some((v) => /current\.requirements\.prd.*does NOT exist/.test(v)), "missing prd");
  assert.ok(r.violations.some((v) => /checks_passing.*phantom\.js/.test(v)), "phantom passing-check script");
});

test("evaluate is fail-closed when the active sprint cannot be resolved", () => {
  const r = tf.evaluate({ current: {}, progress: {} }, fakeSnapshot(null));
  assert.strictEqual(r.ok, false);
  assert.ok(r.violations.some((v) => /no active sprint resolvable/.test(v)));
});

test("run() returns code 2 (fail-closed) when trackers are absent", () => {
  const r = tf.run("SP-DOES-NOT-EXIST-XYZ", { activeSprint: "SP-A" });
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.ok, false);
});
