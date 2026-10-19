"use strict";
const assert = require("assert");
const { evaluate } = require("./enforcer-selftest-coverage");

let pass = 0, fail = 0;
function t(desc, fn) {
  try { fn(); console.log("  PASS  " + desc); pass++; }
  catch (e) { console.error("  FAIL  " + desc + "\n        " + e.message); fail++; }
}

t("enforcer with a self-test carrying a planted-violation -> no finding", () => {
  const r = evaluate({ items: [
    { rel: "scripts/checks/a.js", isEnforcer: true, hasTest: true, testText: "planted violation -> RED; assert(findings.length, 1)" },
  ] });
  assert.strictEqual(r.hard.length, 0);
  assert.strictEqual(r.soft.length, 0);
  assert.strictEqual(r.enforcerCount, 1);
});

t("enforcer with no sibling test -> hard finding", () => {
  const r = evaluate({ items: [{ rel: "scripts/enforcement/b.js", isEnforcer: true, hasTest: false, testText: "" }] });
  assert.strictEqual(r.hard.length, 1);
  assert.strictEqual(r.hard[0].enforcer, "scripts/enforcement/b.js");
});

t("enforcer whose test has no failing-case assertion -> soft advisory", () => {
  const r = evaluate({ items: [
    { rel: "scripts/checks/c.js", isEnforcer: true, hasTest: true, testText: "assert.ok(true); console.log('all good');" },
  ] });
  assert.strictEqual(r.hard.length, 0);
  assert.strictEqual(r.soft.length, 1);
});

t("non-enforcer item -> not judged (no finding, not counted)", () => {
  const r = evaluate({ items: [{ rel: "scripts/checks/lib/x.js", isEnforcer: false, hasTest: false, testText: "" }] });
  assert.strictEqual(r.hard.length, 0);
  assert.strictEqual(r.enforcerCount, 0);
});

t("mixed set -> counts hard/soft/total correctly", () => {
  const r = evaluate({ items: [
    { rel: "scripts/checks/ok.js", isEnforcer: true, hasTest: true, testText: "-> RED planted" },
    { rel: "scripts/checks/notest.js", isEnforcer: true, hasTest: false, testText: "" },
    { rel: "scripts/checks/weaktest.js", isEnforcer: true, hasTest: true, testText: "assert.ok(true)" },
    { rel: "scripts/checks/helper.js", isEnforcer: false, hasTest: false, testText: "" },
  ] });
  assert.strictEqual(r.enforcerCount, 3);
  assert.strictEqual(r.hard.length, 1);
  assert.strictEqual(r.soft.length, 1);
});

t("planted-violation signal variants (findings.length / must fail / violation / -> fail) recognized", () => {
  for (const sig of ["expect findings.length === 1", "this must fail", "a planted violation", "input -> fail", "hard.length, 1"]) {
    const r = evaluate({ items: [{ rel: "scripts/checks/s.js", isEnforcer: true, hasTest: true, testText: sig }] });
    assert.strictEqual(r.soft.length, 0, "signal not recognized: " + sig);
  }
});

t("CONTROL: live enforcer dirs (real gather) — HARD findings truly have neither test convention", () => {
  const fs = require("fs"), path = require("path");
  const root = path.join(__dirname, "..", "..");
  const { evaluate: ev, gatherItems } = require("./enforcer-selftest-coverage");
  const { items } = gatherItems();
  const r = ev({ items });
  for (const f of r.hard) {
    const dotAbs = path.join(root, f.enforcer.replace(/\.(js|cjs|mjs)$/, ".test.$1"));
    const dir = path.dirname(path.join(root, f.enforcer));
    const dashAbs = path.join(dir, "test-" + path.basename(f.enforcer));
    assert.ok(!fs.existsSync(dotAbs) && !fs.existsSync(dashAbs), `HARD finding ${f.enforcer} actually HAS a test (dot or dash convention) — false positive`);
  }
  console.log("        (live: " + r.enforcerCount + " enforcers, " + r.hard.length + " no-test, " + r.soft.length + " weak-test)");
});

t("SELF-COVERING: the meta-gate includes itself in its enumeration and passes its own check", () => {
  const { gatherItems, evaluate: ev } = require("./enforcer-selftest-coverage");
  const { items } = gatherItems();
  const self = items.find((it) => /enforcer-selftest-coverage\.js$/.test(it.rel));
  assert.ok(self, "the meta-gate must appear in its own enumeration");
  assert.strictEqual(self.isEnforcer, true, "the meta-gate is itself a CLI enforcer");
  assert.strictEqual(self.hasTest, true, "the meta-gate must carry its own self-test (this file)");
  const r = ev({ items });
  assert.ok(!r.hard.some((f) => /enforcer-selftest-coverage\.js$/.test(f.enforcer)), "the meta-gate must not be its own uncovered HARD finding");
});

t("gatherItems fail-closed contract — real tree: both dirs seen, zero unreadable-source errors", () => {
  const { gatherItems } = require("./enforcer-selftest-coverage");
  const g = gatherItems();
  assert.ok(Array.isArray(g.items) && Array.isArray(g.errors) && typeof g.dirsSeen === "number" && typeof g.dirsRequired === "number");
  assert.strictEqual(g.dirsSeen, g.dirsRequired, "every required enforcer dir must be readable");
  assert.strictEqual(g.errors.length, 0, "no present-but-unreadable source on the real tree");
});

t("evaluate sees a planted violation anywhere in the concatenated test text (order-independent)", () => {
  const happyThenPlanted = "assert.ok(true); // happy path\n// --- other convention ---\nassert.strictEqual(r.findings.length, 1);";
  const r = evaluate({ items: [{ rel: "scripts/checks/x.js", isEnforcer: true, hasTest: true, testText: happyThenPlanted }] });
  assert.strictEqual(r.soft.length, 0, "a planted violation in the concatenated text must be recognized");
});

t("PLANTED_RE is linear on a hostile 'not'-heavy fixture with no 'clean' (completes fast, is SOFT)", () => {
  const hostile = "not ".repeat(50000);
  const start = Date.now();
  const r = evaluate({ items: [{ rel: "scripts/checks/h.js", isEnforcer: true, hasTest: true, testText: hostile }] });
  const ms = Date.now() - start;
  assert.ok(ms < 1000, `evaluate must be fast on hostile input (took ${ms}ms)`);
  assert.strictEqual(r.soft.length, 1, "hostile happy-path-only text has no planted violation -> SOFT");
});
t("a real bounded 'not … clean' phrase IS recognized as a planted signal", () => {
  const r = evaluate({ items: [{ rel: "scripts/checks/c.js", isEnforcer: true, hasTest: true, testText: "expect result is not clean" }] });
  assert.strictEqual(r.soft.length, 0, "'not clean' within the window is a recognized planted signal");
});

t("an EACCES-throwing readdir -> a fail-closed error + dirsSeen < required", () => {
  const { gatherItems } = require("./enforcer-selftest-coverage");
  const io = {
    readdirSync: () => { const e = new Error("EACCES"); e.code = "EACCES"; throw e; },
    statSync: () => ({ isFile: () => true }),
    readFileSync: () => "",
  };
  const g = gatherItems(io);
  assert.ok(g.errors.length >= 1, "an unreadable enforcer dir must be a fail-closed error");
  assert.ok(g.dirsSeen < g.dirsRequired, "a dir that failed readdir was not counted as seen");
});
t("an unreadable SOURCE file (EACCES on read) -> a fail-closed error", () => {
  const { gatherItems } = require("./enforcer-selftest-coverage");
  const io = {
    readdirSync: () => ["someenforcer.js"],
    statSync: () => ({ isFile: () => true }),
    readFileSync: () => { const e = new Error("EACCES"); e.code = "EACCES"; throw e; },
  };
  const g = gatherItems(io);
  assert.ok(g.errors.some((x) => /someenforcer\.js/.test(x.path)), "an unreadable source is a fail-closed error");
});
t("ENOENT on a source (race) -> skipped, NOT an error", () => {
  const { gatherItems } = require("./enforcer-selftest-coverage");
  const io = {
    readdirSync: () => ["gone.js"],
    statSync: () => { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; },
    readFileSync: () => "",
  };
  const g = gatherItems(io);
  assert.strictEqual(g.errors.length, 0, "a vanished (ENOENT) source is a benign skip, not fail-closed");
});

console.log("");
console.log(pass + "/" + (pass + fail) + " passed" + (fail ? " (" + fail + " FAILED)" : ""));
process.exit(fail ? 1 : 0);
