#!/usr/bin/env node
"use strict";
/**
 * env-read-both — S-OS-06 AC-3.1 (precedence) + AC-3.3 (no raw env read outside the helper), T3 part 4.
 *
 * AC-3.1  scripts/hooks/lib/mc-env.js#readEnv: MC_X wins; only the legacy name set -> fall back with ONE
 *         deprecation warning per process; both set and different -> MC_X plus a divergence line; set sites
 *         emit both names.
 * AC-3.3  every tracked LIVE JS file (Class 1/2, not write-protected) is scanned by ./raw-env-scan.js; a raw
 *         `process.env.<MC|legacy>_*` access outside the helper FAILS.
 *
 * RATCHET (T3 4b): PENDING_RAW_ENV_FILES lists the files that still carried a raw read when the helper landed
 * (4a). Each 4b directory batch deletes its entries. The list may only shrink: a raw read in an UNLISTED file
 * fails, and a listed file with NO raw read left fails too (stale entry — delete it). Empty list == AC-3.3's
 * end state with no allowance at all.
 *
 *   node --test tests/regression/S-OS-06/env-read-both.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const H = require("./falsifier-harness");
const scan = require("./raw-env-scan");

const HELPER = path.join(H.REAL_ROOT, "scripts", "hooks", "lib", "mc-env.js");
const mcEnv = require(HELPER);
const LEG = `${H.SLUG.toUpperCase()}_`;

// prettier-ignore
const PENDING_RAW_ENV_FILES = [
  // 4b batch scripts/dispatch — DONE (T3 part 4b batch scripts/dispatch)
  // 4b batch scripts/hooks — DONE (T3 part 4b-2)
  // 4b batch scripts/sprint
  "scripts/sprint/design.js",
  "scripts/sprint/epsilon-runtime.js",
  "scripts/sprint/execute.js",
  "scripts/sprint/full.js",
  "scripts/sprint/hunter-producer.test.js",
  "scripts/sprint/paths.js",
  "scripts/sprint/plan.js",
  "scripts/sprint/release.js",
  "scripts/sprint/retrospective.js",
  "scripts/sprint/test-regression-seed-gate.js",
  "scripts/sprint/test-sprint-full.js",
  // 4b batch scripts/checks
  "scripts/checks/adhoc-team-hygiene.js",
  "scripts/checks/cert-attest-panel.test.js",
  "scripts/checks/cert-attest.js",
  "scripts/checks/coverage-gate-scan.js",
  "scripts/checks/dispatch-timeout-sanity.test.js",
  "scripts/checks/doc-ref-integrity.js",
  "scripts/checks/duplicate-doc-drift.js",
  "scripts/checks/ed060-sunset.js",
  "scripts/checks/epsilon-liveness.js",
  "scripts/checks/epsilon-paired-waiter.test.js",
  "scripts/checks/framework-purity.js",
  "scripts/checks/mc-install-baseline.js",
  "scripts/checks/mc-staleness.js",
  "scripts/checks/mode-lifecycle-hooks-coverage.js",
  "scripts/checks/provider-api-policy.js",
  "scripts/checks/security-pass-count.js",
  "scripts/checks/security-pass-count.test.js",
  "scripts/checks/sprint-beta-honesty.js",
  "scripts/checks/sprint-hook-coverage.js",
  "scripts/checks/sprint-manager-consult.js",
  // 4b batch rest
  "scripts/decisions/ledger.js",
  "scripts/dispatch-agent.js",
  "scripts/dispatch-claude.js",
  "scripts/dispatch-review.js",
  "scripts/events/events-compact.js",
  "scripts/events/events-compact.test.js",
  "scripts/generate-skill-catalog.js",
  "scripts/generate-steps-maps.js",
  "scripts/mc/lib/update-events.js",
  "scripts/mc/lifecycle-stage.js",
  "scripts/mc/release-canonical.js",
  "scripts/mc/repo-role.js",
  "scripts/mc/test-repo-role.js",
  "scripts/mc/test-scaffold-all-ways.js",
  "scripts/mc/test-upgrade-current-to-new.js",
  "scripts/one-off/smoke-dispatch.js",
  "scripts/one-off/smoke-spawn.js",
  "scripts/one-off/smoke-status.js",
  "scripts/one-off/smoke-sync.js",
  "scripts/panel/roadmap-gui.js",
  "scripts/panel/roadmap.js",
  "scripts/portfolio/registry-path.test.js",
  "scripts/portfolio/registry.js",
  "scripts/skill-adherence-report.js",
  "scripts/skill-description-audit.js",
  "scripts/skills-bench.js",
  "scripts/skills-test.js",
  "scripts/teams/lifecycle.js",
  "scripts/teams/signal-board.js",
  "scripts/test-dispatch-agent-resolution.js",
  "scripts/turbo/apply.js",
  "tests/regression/SP-20260615-002/gui-lifecycle.test.js",
  "tests/regression/SP-20260616-001/wrapper-door.test.js",
];

const FIXTURE_RE = /^(?:MC|[A-Z]+)_SOS06_/;

function runChild(env) {
  const clean = {};
  for (const [k, v] of Object.entries(process.env)) if (!FIXTURE_RE.test(k)) clean[k] = v;
  delete clean.NODE_TEST_CONTEXT;
  const code =
    `const m = require(${JSON.stringify(HELPER)});` +
    `const out = { a: m.readEnv("SOS06_A"), b: m.readEnv("SOS06_B"), a2: m.readEnv("SOS06_A") };` +
    `process.stdout.write(JSON.stringify(out, (k, v) => (v === undefined ? "<undefined>" : v)));`;
  const r = spawnSync(process.execPath, ["-e", code], { encoding: "utf8", env: { ...clean, ...env }, timeout: 60000 });
  if (r.error) throw new Error(`spawn failed: ${r.error.message}`);
  if (r.status === null) throw new Error(`child killed by ${r.signal}`);
  assert.strictEqual(r.status, 0, r.stderr);
  return { out: JSON.parse(r.stdout), stderr: r.stderr, count: (re) => (r.stderr.match(re) || []).length };
}

test("env-read-both-precedence: MC_X wins over the legacy name; a divergence is diagnosed once per name, no deprecation", () => {
  const r = runChild({ MC_SOS06_A: "new", [`${LEG}SOS06_A`]: "old" });
  assert.strictEqual(r.out.a, "new");
  assert.strictEqual(r.out.a2, "new");
  assert.strictEqual(r.count(/ENV DIVERGENCE/g), 1, r.stderr);
  assert.strictEqual(r.count(/DEPRECATION/g), 0, r.stderr);
  assert.doesNotMatch(r.stderr, /\bnew\b|\bold\b/, "divergence line never prints values");
});

test("env-read-both-precedence: only the legacy name set -> falls back, exactly ONE deprecation warning per process", () => {
  const r = runChild({ [`${LEG}SOS06_A`]: "oldA", [`${LEG}SOS06_B`]: "oldB" });
  assert.deepStrictEqual(r.out, { a: "oldA", b: "oldB", a2: "oldA" });
  assert.strictEqual(r.count(/DEPRECATION/g), 1, r.stderr);
  assert.match(r.stderr, /MC_SOS06_A/);
});

test("env-read-both-precedence: MC-only / dual-identical are silent; neither set -> undefined", () => {
  const onlyNew = runChild({ MC_SOS06_A: "new" });
  assert.deepStrictEqual([onlyNew.out.a, onlyNew.out.b, onlyNew.stderr], ["new", "<undefined>", ""]);
  const same = runChild({ MC_SOS06_A: "same", [`${LEG}SOS06_A`]: "same" });
  assert.deepStrictEqual([same.out.a, same.stderr], ["same", ""]);
});

test("env-read-both-precedence: set sites emit BOTH names; unset/snapshot/restore are exact", () => {
  const env = { KEEP: "k" };
  mcEnv.setEnv("SOS06_S", 7, env);
  assert.deepStrictEqual(env, { KEEP: "k", MC_SOS06_S: "7", [`${LEG}SOS06_S`]: "7" });
  assert.deepStrictEqual(mcEnv.envPair("SOS06_S", "1"), { MC_SOS06_S: "1", [`${LEG}SOS06_S`]: "1" });
  assert.deepStrictEqual(mcEnv.envPair("SOS06_S", undefined), {});
  const snap = mcEnv.snapshotEnv(["SOS06_S", "SOS06_T"], env);
  mcEnv.setEnv("SOS06_T", "t", env);
  mcEnv.unsetEnv("SOS06_S", env);
  assert.deepStrictEqual(env, { KEEP: "k", MC_SOS06_T: "t", [`${LEG}SOS06_T`]: "t" });
  mcEnv.restoreEnv(snap);
  assert.deepStrictEqual(env, { KEEP: "k", MC_SOS06_S: "7", [`${LEG}SOS06_S`]: "7" });
});

test("env-read-both-precedence: a prefixed or malformed name is refused (never a silent MC_MC_X read)", () => {
  assert.throws(() => mcEnv.readEnv("MC_X", {}), TypeError);
  assert.throws(() => mcEnv.readEnv(`${LEG}X`, {}), TypeError);
  assert.throws(() => mcEnv.readEnv("", {}), TypeError);
});

test("no-raw-env-read-outside-helper: the scanner catches every raw shape and nothing else (planted)", () => {
  const planted = [
    "const a = process.env.MC_X;",
    `const b = process.env.${LEG}Y || "d";`,
    `const c = process.env["${LEG}Z"];`,
    `const d = process.env[\`${LEG}TOOL_\${id}_PATH\`];`,
    `const { ${LEG}Q } = process.env;`,
    'const ok1 = mcEnv.readEnv("X");',
    "const ok2 = process.env.HOME;",
    "const ok3 = env.MC_X;",
  ].join("\n");
  const hits = scan.findRawEnvReads(planted);
  assert.deepStrictEqual(hits.map((h) => [h.line, h.id]), [[1, "dot"], [2, "dot"], [3, "bracket"], [4, "bracket"], [5, "destructure"]]);
  assert.deepStrictEqual(scan.findRawEnvReads(fs.readFileSync(HELPER, "utf8")), [], "the helper itself needs no raw read (its exemption is not load-bearing)");
});

test("no-raw-env-read-outside-helper", () => {
  const { scanned, offenders } = scan.scanRawEnvReads();
  assert.ok(scanned >= 200, `fail-closed: only ${scanned} live JS files scanned`);
  assert.strictEqual(new Set(PENDING_RAW_ENV_FILES).size, PENDING_RAW_ENV_FILES.length, "duplicate ratchet entry");
  const pending = new Set(PENDING_RAW_ENV_FILES);
  const unlisted = Object.keys(offenders)
    .filter((f) => !pending.has(f))
    .map((f) => offenders[f].map((h) => `${f}:${h.line} ${h.text}`))
    .flat();
  assert.deepStrictEqual(unlisted, [], "raw process.env.<MC|legacy>_ access outside scripts/hooks/lib/mc-env.js — use mcEnv.readEnv/setEnv/unsetEnv/envPair");
  const stale = PENDING_RAW_ENV_FILES.filter((f) => !offenders[f]);
  assert.deepStrictEqual(stale, [], "stale ratchet entry: the file no longer carries a raw read — delete it from PENDING_RAW_ENV_FILES");
});
