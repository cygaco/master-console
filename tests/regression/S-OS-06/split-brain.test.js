#!/usr/bin/env node
"use strict";
/**
 * split-brain — S-OS-06 AC-3.2 (T3 part 4a/4c/5): the SHIPPED read-both helper (scripts/hooks/lib/mc-env.js)
 * diagnoses every dual state deterministically through the ONE rule in scripts/hooks/lib/split-brain-core.js,
 * and the split-brain CLI re-exports that same rule (no second copy).
 *
 *   node --test tests/regression/S-OS-06/split-brain.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const H = require("./falsifier-harness");

const LIB = path.join(H.REAL_ROOT, "scripts", "hooks", "lib");
const core = require(path.join(LIB, "split-brain-core.js"));
const mcEnv = require(path.join(LIB, "mc-env.js"));
const cli = require(path.join(H.REAL_ROOT, "scripts", "open-source", "split-brain.js"));

const SUFFIX = "SOS06_SPLIT_BRAIN_FIXTURE";
const CUR = `MC_${SUFFIX}`;
const LEG = `${H.SLUG.toUpperCase()}_${SUFFIX}`;

test("dual-state-diagnosed: the CLI and the shipped helper share ONE decision core", () => {
  assert.strictEqual(cli.diagnose, core.diagnose);
  assert.strictEqual(cli.diagnoseEnv, core.diagnoseEnv);
  assert.strictEqual(cli.diagnoseDir, core.diagnoseDir);
  assert.deepStrictEqual(mcEnv.envNames(SUFFIX), { current: CUR, legacy: LEG });
});

test("dual-state-diagnosed: env — legacy-only / new-only / dual-identical / dual-conflicting, deterministic", () => {
  const cases = [
    [{}, "absent", true, null],
    [{ [LEG]: "old" }, "legacy-only", true, "old"],
    [{ [CUR]: "new" }, "new-only", true, "new"],
    [{ [CUR]: "same", [LEG]: "same" }, "dual-identical", true, "same"],
    [{ [CUR]: "new", [LEG]: "old" }, "dual-conflicting", false, "new"],
  ];
  for (const [env, state, ok, resolved] of cases) {
    const d = mcEnv.diagnoseEnvVar(SUFFIX, env);
    assert.deepStrictEqual([d.state, d.ok, d.resolved], [state, ok, resolved], JSON.stringify(env));
    assert.strictEqual(JSON.stringify(mcEnv.diagnoseEnvVar(SUFFIX, { ...env })), JSON.stringify(d), "same state -> byte-identical diagnosis");
  }
  const conflict = mcEnv.diagnoseEnvVar(SUFFIX, { [LEG]: "old", [CUR]: "new" });
  assert.deepStrictEqual(conflict.divergence, { current: { name: CUR, value: "new" }, legacy: { name: LEG, value: "old" } });
  assert.strictEqual(conflict.source, "current", "canonical precedence is NAMED even while the state is diagnosed");
});

test("dual-state-diagnosed: directories — the same four states through the shared core, order-independent", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sos06-sb-core-"));
  try {
    const cur = path.join(base, "cur");
    const leg = path.join(base, "leg");
    const put = (dir, rel, body) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), body);
    };
    assert.strictEqual(core.diagnoseDir(cur, leg).state, "absent");
    put(leg, "a.json", "1");
    assert.strictEqual(core.diagnoseDir(cur, leg).state, "legacy-only");
    put(cur, "a.json", "1");
    assert.strictEqual(core.diagnoseDir(cur, leg).state, "dual-identical");
    put(cur, "sub/b.json", "new");
    put(leg, "sub/b.json", "old");
    const d1 = core.diagnoseDir(cur, leg);
    assert.deepStrictEqual([d1.state, d1.ok, d1.divergence.counts], ["dual-conflicting", false, { onlyInCurrent: 0, onlyInLegacy: 0, differing: 1 }]);
    assert.strictEqual(JSON.stringify(core.diagnoseDir(cur, leg)), JSON.stringify(d1));
    fs.rmSync(leg, { recursive: true, force: true });
    assert.strictEqual(core.diagnoseDir(cur, leg).state, "new-only");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
