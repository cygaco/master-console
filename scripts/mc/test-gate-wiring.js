#!/usr/bin/env node
/**
 * scripts/mc/test-gate-wiring.js
 *
 * GATE-A wiring test (SP-20260721-001 D-4 INC-2 — verified_by "gate-wiring
 * test"). Proves the release-gates.js wiring itself, cheaply (no real installs):
 *
 *   1. `fresh_scaffold_all_ways` is IN the GATES array AND actually RUNS
 *      (not silently excluded the way the orphaned test-install-matrix.js
 *      was before this build).
 *   2. `install_matrix` is IN the GATES array AND actually RUNS.
 *   3. The two retired cosmetic gates (`fresh_install_fixture`,
 *      `customized_install_fixture`) are GONE — not present, not skipped,
 *      just absent.
 *   4. (SP-20260721-001 D-4 INC-3 — GATE-B) `upgrade_current_to_new` is IN
 *      the GATES array AND actually RUNS (same canned-spawnSync technique as
 *      #1/#2 — the real engine does 2 real installs and must never run inside
 *      a wiring test). `update_fixture_from_previous` (the classifier-only
 *      dry-run it upgrades/replaces) is GONE — not present, not skipped, just
 *      absent.
 *
 * "Actually runs" is verified by observing each gate's OWN severity is never
 * "skipped" when NOT explicitly passed via --skip (i.e. the gate function
 * itself was invoked, whatever verdict it returned) — the wiring test does
 * not re-verify the engines' own correctness (test-scaffold-all-ways.js
 * --self-test and test-install-matrix.js already do that); it verifies the
 * release-gates.js GATES array composition and invocation, cheaply and fast.
 *
 * To keep this FAST (a wiring test should not itself run 3 real installs +
 * a 7-scenario matrix), it monkeypatches `require("child_process").spawnSync`
 * so `runScript()` inside release-gates.js never actually shells out — it
 * returns a canned {status:0, stdout:'{"ok":true, ...}'} for the two gates
 * under test, so the ONLY thing under test is whether the gate function is
 * reachable in the GATES array and gets invoked as part of run().
 *
 * Exit 0 = wiring intact. Exit 1 = a wiring regression.
 */
"use strict";

const path = require("path");
const cp = require("child_process");
const { runTooth: runJsonLoudFailTooth } = require("./test-update-json-loud-fail");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELEASE_GATES_PATH = path.join(REPO_ROOT, "scripts", "mc", "release-gates.js");

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    process.stdout.write(`  ok  ${name}\n`);
    pass++;
  } else {
    process.stderr.write(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}\n`);
    fail++;
  }
}

// ── Monkeypatch spawnSync so the two heavy gates under test return instantly ──
// Every OTHER gate is skipped explicitly, so their spawnSync calls never fire
// in practice — this patch is a defensive belt-and-suspenders so a wiring
// test can never accidentally shell out to a real install.
const realSpawnSync = cp.spawnSync;
const CANNED = {
  "test-scaffold-all-ways.js": {
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      incomplete: false,
      ps_available: true,
      legs: [
        { leg: 1, name: "portfolio_new", ran: true, ok: true, asserts: [] },
        { leg: 2, name: "manual_warp_setup", ran: true, ok: true, asserts: [] },
        { leg: 3, name: "shipped_install_ps1", ran: true, ok: true, asserts: [] },
      ],
      sandbox_isolation: { no_delta: true, onlyBefore: [], onlyAfter: [] },
    }),
    stderr: "",
  },
  "test-install-matrix.js": {
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      scenarios: [{ id: "1", name: "clean_install", status: "pass", assertions: [] }],
      totals: { pass: 1, fail: 0 },
    }),
    stderr: "",
  },
  // GATE-B upgrade_current_to_new (SP-20260721-001 D-4 INC-3) — canned shape
  // matches test-upgrade-current-to-new.js's real --json payload:
  // {ok, from_version, to_version, ran, ps_available, asserts, sandbox_isolation}.
  // Assert names MUST match the engine's ACTUAL emitted names (qa
  // TRACE-TEETH-COVERAGE flagged a prior drift here: "scan_install_green" /
  // "fresh_vs_upgraded_parity" do not exist — the real names are
  // scan_install_green_3b / fresh_n_parity_pathset_3c /
  // fresh_n_parity_type_3c / fresh_n_parity_symlink_target_3c /
  // fresh_n_parity_content_3c (the type/symlink-target pair added by R3-2/
  // R3-3, gauntlet-r3)) — release-gates.js's F2 named-evidence check requires
  // the REAL names, so a stale fixture here would false-red this suite's own
  // "ran GREEN against the canned success payload" test.
  "test-upgrade-current-to-new.js": {
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      from_version: "0.16.0",
      to_version: "0.17.0",
      ran: true,
      ps_available: true,
      asserts: [
        { name: "n1_resolved", ok: true, detail: "", loadBearing: true },
        { name: "apply_committed", ok: true, detail: "", loadBearing: true },
        { name: "version_sanity_NON_LOAD_BEARING", ok: true, detail: "", loadBearing: false },
        { name: "scan_install_green_3b", ok: true, detail: "", loadBearing: true },
        { name: "fresh_n_parity_pathset_3c", ok: true, detail: "", loadBearing: true },
        { name: "fresh_n_parity_type_3c", ok: true, detail: "", loadBearing: true },
        { name: "fresh_n_parity_symlink_target_3c", ok: true, detail: "", loadBearing: true },
        { name: "fresh_n_parity_content_3c", ok: true, detail: "", loadBearing: true },
        { name: "dirty_set_content_unchanged", ok: true, detail: "", loadBearing: true },
      ],
      sandbox_isolation: { no_delta: true, onlyBefore: [], onlyAfter: [], dirty_set_content_unchanged: true, dirty_set_changed_files: [] },
    }),
    stderr: "",
  },
};
const HEAVY_SCRIPT_NAMES = ["test-scaffold-all-ways.js", "test-install-matrix.js", "test-upgrade-current-to-new.js"];
cp.spawnSync = function patchedSpawnSync(cmd, args, opts) {
  const scriptArg = (args || []).find((a) => typeof a === "string" && HEAVY_SCRIPT_NAMES.some((n) => a.includes(n)));
  if (scriptArg) {
    const key = HEAVY_SCRIPT_NAMES.find((n) => scriptArg.includes(n));
    return CANNED[key];
  }
  return realSpawnSync.apply(this, arguments);
};

delete require.cache[RELEASE_GATES_PATH];
const { run } = require(RELEASE_GATES_PATH);

// Skip every OTHER gate so this test stays fast and hermetic — only the
// three gates under test (fresh_scaffold_all_ways, install_matrix,
// upgrade_current_to_new — all canned via spawnSync above) + cheap
// presence-only gates are left unskipped by the explicit include-list below.
const KNOWN_HEAVY_OR_UNRELATED = [
  "path_coherence",
  "framework_manifest",
  "ship_coverage",
  "version_coherence",
  "hook_fixture_tests",
  "runtime_leak_scan",
  "version_consistency",
  "production_baseline",
  "contract_versioning",
  "pattern_library",
  "path_usage",
  "regression_seed",
  "sealed_capsule_contract",
];

const summary = run({ skip: KNOWN_HEAVY_OR_UNRELATED });
const byName = new Map(summary.results.map((r) => [r.name, r]));

// ── 1+2: present AND actually invoked (severity !== "skipped") ──
for (const name of ["fresh_scaffold_all_ways", "install_matrix", "upgrade_current_to_new"]) {
  const r = byName.get(name);
  ok(`${name} is present in GATES`, !!r, `not found in results: ${[...byName.keys()].join(", ")}`);
  ok(`${name} actually RAN (severity !== "skipped")`, !!r && r.severity !== "skipped", r && `severity=${r.severity}`);
  ok(`${name} ran GREEN against the canned success payload (wiring reaches the real gate logic)`, !!r && r.severity === "green", r && `severity=${r.severity} message=${r.message}`);
}

// ── 3: the two retired gates are GONE ──
for (const name of ["fresh_install_fixture", "customized_install_fixture"]) {
  ok(`${name} is RETIRED (absent from GATES entirely)`, !byName.has(name), `still present with severity=${byName.get(name) && byName.get(name).severity}`);
}

// ── 4: update_fixture_from_previous is GONE (SP-20260721-001 D-4 INC-3 —
// upgraded/renamed into upgrade_current_to_new / GATE-B, asserted above) ──
{
  const r = byName.get("update_fixture_from_previous");
  ok("update_fixture_from_previous is RETIRED (upgraded into upgrade_current_to_new / GATE-B — not present)", !r, `still present with severity=${r && r.severity}`);
}

// ── 5: report-only ramp behavior (SP-20260721-001 INC-2 — the ratified option-(b) teeth) ──
// A real-install LEG failure REPORTS (yellow, non-blocking) and names the flip-trigger — report-only ≠ silent.
CANNED["test-scaffold-all-ways.js"].stdout = JSON.stringify({
  ok: false,
  incomplete: false,
  ps_available: true,
  legs: [
    { leg: 1, name: "portfolio_new", ran: true, ok: true, asserts: [] },
    { leg: 2, name: "manual_warp_setup", ran: true, ok: true, asserts: [] },
    { leg: 3, name: "shipped_install_ps1", ran: true, ok: false, asserts: [{ name: "_mc/MANIFEST.json present (COMPLETE install)", status: "fail" }] },
  ],
  sandbox_isolation: { no_delta: true, onlyBefore: [], onlyAfter: [] },
});
{
  const ga = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("fresh_scaffold_all_ways");
  ok("report-only: a real-install LEG failure is YELLOW (reported, NON-blocking), not red", ga && ga.severity === "yellow", ga && `severity=${ga.severity}`);
  ok("report-only: the message names the flip-trigger (ED-249)", ga && /ED-249/.test(ga.message) && /FLIP-TRIGGER/.test(ga.message), ga && ga.message);
}
// A SANDBOX-ISOLATION leak BLOCKS unconditionally (red), even during the report-only ramp — the load-bearing property is never softened.
CANNED["test-scaffold-all-ways.js"].stdout = JSON.stringify({
  ok: false,
  incomplete: false,
  ps_available: true,
  legs: [{ leg: 1, name: "portfolio_new", ran: true, ok: false, asserts: [{ name: "canonical no-delta", status: "fail" }] }],
  sandbox_isolation: { no_delta: false, onlyBefore: [], onlyAfter: ["../leaked-sibling-repo"] },
});
{
  const ga = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("fresh_scaffold_all_ways");
  ok("report-only NEVER softens a leak: a sandbox-isolation NO-DELTA violation is RED (blocks)", ga && ga.severity === "red", ga && `severity=${ga.severity}`);
  ok("leak message names the SANDBOX-ISOLATION violation", ga && /SANDBOX-ISOLATION/.test(ga.message), ga && ga.message);
}
// ── 6: the branch-ORDER BLOCKER fix — a no-PS host (incomplete) with a LEAK still reds (leak check FIRST) ──
CANNED["test-scaffold-all-ways.js"].stdout = JSON.stringify({
  ok: false,
  incomplete: true, // no PowerShell → Leg 3 did not run
  ps_available: false,
  legs: [{ leg: 1, name: "portfolio_new", ran: true, ok: false, asserts: [{ name: "canonical no-delta", status: "fail" }] }],
  sandbox_isolation: { no_delta: false, onlyBefore: [], onlyAfter: ["../leaked-sibling-repo"] }, // a Leg-1/2 leak
});
{
  const ga = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("fresh_scaffold_all_ways");
  ok("BLOCKER-fix: a no-PS host (incomplete) WITH a leak is RED, never softened to degraded (leak check is FIRST)", ga && ga.severity === "red", ga && `severity=${ga.severity}`);
}
// incomplete WITHOUT a leak, during the report-only ramp → degraded (non-blocking, but NOT a pass).
CANNED["test-scaffold-all-ways.js"].stdout = JSON.stringify({
  ok: false,
  incomplete: true,
  ps_available: false,
  legs: [
    { leg: 1, name: "portfolio_new", ran: true, ok: true, asserts: [] },
    { leg: 2, name: "manual_warp_setup", ran: true, ok: true, asserts: [] },
  ],
  sandbox_isolation: { no_delta: true, onlyBefore: [], onlyAfter: [] },
});
{
  const ga = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("fresh_scaffold_all_ways");
  ok("no-PS incomplete (no leak) is DEGRADED during the report-only ramp — not a pass, non-blocking", ga && ga.severity === "degraded", ga && `severity=${ga.severity}`);
}
// ── 7: install_matrix shares GATE-A's ED-249 report-only window — a failing scenario is YELLOW, not red ──
CANNED["test-install-matrix.js"].stdout = JSON.stringify({
  ok: false,
  scenarios: [{ id: "1", name: "clean_install", status: "fail", assertions: [{ name: "_mc/MANIFEST.json present", status: "fail" }] }],
  totals: { pass: 0, fail: 1 },
});
{
  const im = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("install_matrix");
  ok("install_matrix report-only: a scenario failure → YELLOW (non-blocking) during the ED-249 window", im && im.severity === "yellow", im && `severity=${im.severity}`);
  ok("install_matrix report-only message names the ED-249 flip-trigger", im && /ED-249/.test(im.message) && /FLIP-TRIGGER/.test(im.message), im && im.message);
}

// ── 8: GATE-B branch order — a sandbox-isolation leak BLOCKS unconditionally
// (checked FIRST, before green/incomplete), same load-bearing property as
// GATE-A (#5/#6 above), the isolation-first lesson those tests already prove. ──
CANNED["test-upgrade-current-to-new.js"].stdout = JSON.stringify({
  ok: false,
  from_version: "0.16.0",
  to_version: "0.17.0",
  ran: true,
  ps_available: true,
  asserts: [{ name: "apply_committed", ok: true, detail: "", loadBearing: true }],
  sandbox_isolation: { no_delta: false, onlyBefore: [], onlyAfter: ["../leaked-sibling-repo"] },
});
{
  const gb = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("upgrade_current_to_new");
  ok("GATE-B: a sandbox-isolation NO-DELTA violation is RED (blocks unconditionally)", gb && gb.severity === "red", gb && `severity=${gb.severity}`);
  ok("GATE-B leak message names SANDBOX-ISOLATION", gb && /SANDBOX-ISOLATION/.test(gb.message), gb && gb.message);
}
// ── 9: GATE-B INCOMPLETE (no PowerShell) is RED, not a silent pass — GATE-B
// has no report-only ramp, so incomplete BLOCKS (distinctly flagged from a
// genuine conformance failure via the message text). ──
CANNED["test-upgrade-current-to-new.js"].stdout = JSON.stringify({
  ok: false,
  from_version: "0.16.0",
  to_version: "0.17.0",
  ran: false,
  ps_available: false,
  asserts: [{ name: "ps_available", ok: false, detail: "no PowerShell found on this host", loadBearing: true }],
  sandbox_isolation: { no_delta: true, onlyBefore: [], onlyAfter: [] },
});
{
  const gb = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("upgrade_current_to_new");
  ok("GATE-B: ps_available=false is RED (INCOMPLETE, not a silent pass — R2 skip-loud)", gb && gb.severity === "red", gb && `severity=${gb.severity}`);
  ok("GATE-B incomplete message names INCOMPLETE", gb && /INCOMPLETE/.test(gb.message), gb && gb.message);
}
// ── 10: GATE-B a load-bearing conformance assert fails (e.g. 3c parity) → RED ──
CANNED["test-upgrade-current-to-new.js"].stdout = JSON.stringify({
  ok: false,
  from_version: "0.16.0",
  to_version: "0.17.0",
  ran: true,
  ps_available: true,
  asserts: [
    { name: "apply_committed", ok: true, detail: "", loadBearing: true },
    { name: "scan_install_green_3b", ok: true, detail: "", loadBearing: true },
    { name: "fresh_n_parity_pathset_3c", ok: true, detail: "", loadBearing: true },
    { name: "fresh_n_parity_content_3c", ok: false, detail: "content drift outside normalization", loadBearing: true },
  ],
  sandbox_isolation: { no_delta: true, onlyBefore: [], onlyAfter: [], dirty_set_content_unchanged: true, dirty_set_changed_files: [] },
});
{
  const gb = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("upgrade_current_to_new");
  ok("GATE-B: a load-bearing conformance assert failure (e.g. 3c parity) is RED", gb && gb.severity === "red", gb && `severity=${gb.severity}`);
}
// ── 11: GATE-B errored — no parseable payload → fail-closed RED, never a pass ──
CANNED["test-upgrade-current-to-new.js"] = { status: 2, stdout: "", stderr: "FATAL: engine crashed" };
{
  const gb = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("upgrade_current_to_new");
  ok("GATE-B: an engine crash (no parseable payload) is fail-closed RED, never a clean pass", gb && gb.severity === "red", gb && `severity=${gb.severity}`);
}
// ── 12: GATE-B INCOMPLETE-B skip-loud (no UNRELEASED capsule to upgrade TO,
// mid-dev steady state where every capsule is a shipped/tagged frozen release)
// → severity:manual — NOT red, NOT green. The full upgrade->conformance path
// runs at the CEREMONY when a fresh capsule is cut from the current tree.
// DISTINCT from the ps-unavailable INCOMPLETE (§9) which RED-blocks. ──
CANNED["test-upgrade-current-to-new.js"] = {
  status: 0,
  stdout: JSON.stringify({
    ok: null,
    incomplete: true,
    incomplete_reason: "no unreleased capsule cut (newest shipped/tagged=0.17.0); the full path runs at the ceremony when a fresh capsule is cut from the current tree",
    from_version: null,
    to_version: null,
    ran: false,
    ps_available: null,
    asserts: [{ name: "upgrade_target_available", ok: false, detail: "INCOMPLETE (skip-loud)", loadBearing: false }],
    sandbox_isolation: { no_delta: true, onlyBefore: [], onlyAfter: [] },
  }),
};
{
  const gb = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("upgrade_current_to_new");
  ok("GATE-B: INCOMPLETE-B (no unreleased cut) is severity:manual — skip-loud, NOT red, NOT green", gb && gb.severity === "manual", gb && `severity=${gb.severity}`);
  ok("GATE-B: INCOMPLETE-B never greens release (severity !== green)", gb && gb.severity !== "green", gb && `severity=${gb.severity}`);
  ok("GATE-B: INCOMPLETE-B message names the ceremony", gb && /ceremony/i.test(gb.message), gb && gb.message);
}

// ── 13: GATE-B named-evidence requirement (SP-20260721-001 D-4 INC-3
// gauntlet-r1 F2 — qa FUNC-PAYLOAD-TRUST). A status-0 payload that SAYS
// ok:true/ran:true but is MISSING the named load-bearing 3b/3c evidence (and
// has no isolation evidence at all) must NEVER be treated as green — the
// gate must not blindly trust `payload.ok`. ──
CANNED["test-upgrade-current-to-new.js"] = {
  status: 0,
  stdout: JSON.stringify({
    ok: true, // the engine SAYS ok:true — the gate must not blindly trust this alone
    from_version: "0.16.0",
    to_version: "0.17.0",
    ran: true,
    ps_available: true,
    asserts: [{ name: "n1_resolved", ok: true, detail: "", loadBearing: true }],
    sandbox_isolation: {}, // no isolation evidence at all
  }),
  stderr: "",
};
{
  const gb = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("upgrade_current_to_new");
  ok(
    "GATE-B: payload.ok:true but MISSING named 3b/3c evidence + isolation evidence is NEVER green (F2 named-evidence trust fix)",
    gb && gb.severity !== "green",
    gb && `severity=${gb.severity}`,
  );
}
// A payload that HAS isolation evidence but is still missing the named 3c
// content-parity assert (only pathset present, not content) must also not green.
CANNED["test-upgrade-current-to-new.js"].stdout = JSON.stringify({
  ok: true,
  from_version: "0.16.0",
  to_version: "0.17.0",
  ran: true,
  ps_available: true,
  asserts: [
    { name: "apply_committed", ok: true, detail: "", loadBearing: true },
    { name: "scan_install_green_3b", ok: true, detail: "", loadBearing: true },
    { name: "fresh_n_parity_pathset_3c", ok: true, detail: "", loadBearing: true },
    // fresh_n_parity_content_3c deliberately absent
  ],
  sandbox_isolation: { no_delta: true, onlyBefore: [], onlyAfter: [], dirty_set_content_unchanged: true, dirty_set_changed_files: [] },
});
{
  const gb = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("upgrade_current_to_new");
  ok(
    "GATE-B: payload missing ONLY fresh_n_parity_content_3c (partial named evidence) is still NEVER green",
    gb && gb.severity !== "green",
    gb && `severity=${gb.severity}`,
  );
}
// A payload missing ONLY the R3-2/R3-3 type-or-symlink-target named evidence
// (pathset + content present, type/symlink-target absent) must also not
// green — the named-evidence requirement covers the FULL R3-3 typed-entry
// judgment, not just the pre-existing pathset/content pair.
CANNED["test-upgrade-current-to-new.js"].stdout = JSON.stringify({
  ok: true,
  from_version: "0.16.0",
  to_version: "0.17.0",
  ran: true,
  ps_available: true,
  asserts: [
    { name: "apply_committed", ok: true, detail: "", loadBearing: true },
    { name: "scan_install_green_3b", ok: true, detail: "", loadBearing: true },
    { name: "fresh_n_parity_pathset_3c", ok: true, detail: "", loadBearing: true },
    // fresh_n_parity_type_3c / fresh_n_parity_symlink_target_3c deliberately absent
    { name: "fresh_n_parity_content_3c", ok: true, detail: "", loadBearing: true },
  ],
  sandbox_isolation: { no_delta: true, onlyBefore: [], onlyAfter: [], dirty_set_content_unchanged: true, dirty_set_changed_files: [] },
});
{
  const gb = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("upgrade_current_to_new");
  ok(
    "GATE-B: payload missing the R3-2/R3-3 type/symlink-target named evidence is still NEVER green",
    gb && gb.severity !== "green",
    gb && `severity=${gb.severity}`,
  );
}

// ── 14: GATE-B F6 dirty-set content-hash control BLOCKS unconditionally,
// same load-bearing priority as the no-delta check (SP-20260721-001 D-4
// INC-3 gauntlet-r1 F6 — qa FUNC-ISOLATION-FALSE-GREEN). ──
CANNED["test-upgrade-current-to-new.js"] = {
  status: 0,
  stdout: JSON.stringify({
    ok: false,
    from_version: "0.16.0",
    to_version: "0.17.0",
    ran: true,
    ps_available: true,
    asserts: [{ name: "dirty_set_content_unchanged", ok: false, detail: "already-dirty file content changed", loadBearing: true }],
    sandbox_isolation: {
      no_delta: true, // the porcelain-line diff did NOT catch it — that's the whole point of the control
      onlyBefore: [],
      onlyAfter: [],
      dirty_set_content_unchanged: false,
      dirty_set_changed_files: ["scripts/foo.js"],
    },
  }),
  stderr: "",
};
{
  const gb = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("upgrade_current_to_new");
  ok("GATE-B: a dirty-set content-hash violation is RED (blocks unconditionally, even though no_delta itself held)", gb && gb.severity === "red", gb && `severity=${gb.severity}`);
  ok("GATE-B dirty-set message names DIRTY-SET CONTENT CHANGED", gb && /DIRTY-SET CONTENT CHANGED/.test(gb.message), gb && gb.message);
}

cp.spawnSync = realSpawnSync;

// ── 15: BC-16 --json loud-fail regression tooth (SP-20260721-001 D-4 INC-3
// F7 — qa INT-TEST-REACH). test-update-json-loud-fail.js was present in the
// manifest but had no discovered invocation from any committed test/gate —
// invoked HERE so it fires continuously as part of this committed suite, not
// only when run standalone. Runs AFTER `cp.spawnSync` is restored to the
// real implementation — it shells out to a real (cheap, fast — preflight
// fail-fast, no full install) `update.js` subprocess, and its script name
// never matches HEAVY_SCRIPT_NAMES above regardless. ──
{
  const jr = runJsonLoudFailTooth();
  ok(
    `test-update-json-loud-fail.js tooth suite is GREEN (BC-16 --json loud-fail fix; pass=${jr.pass} fail=${jr.fail})`,
    jr.fail === 0,
    `pass=${jr.pass} fail=${jr.fail}`,
  );
}

process.stdout.write(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
