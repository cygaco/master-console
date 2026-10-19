#!/usr/bin/env node
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
        { leg: 2, name: "manual_mc_setup", ran: true, ok: true, asserts: [] },
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
  "test-upgrade-current-to-new.js": {
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      from_version: "0.16.0",
      to_version: "0.17.0",
      ran: true,
      ps_available: true,
      asserts: [
        { name: "previous_version_resolved", ok: true, detail: "", loadBearing: true },
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

const KNOWN_HEAVY_OR_UNRELATED = [
  "path_coherence",
  "framework_manifest",
  "ship_coverage",
  "config_paths_resolve",
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

for (const name of ["fresh_scaffold_all_ways", "install_matrix", "upgrade_current_to_new"]) {
  const r = byName.get(name);
  ok(`${name} is present in GATES`, !!r, `not found in results: ${[...byName.keys()].join(", ")}`);
  ok(`${name} actually RAN (severity !== "skipped")`, !!r && r.severity !== "skipped", r && `severity=${r.severity}`);
  ok(`${name} ran GREEN against the canned success payload (wiring reaches the real gate logic)`, !!r && r.severity === "green", r && `severity=${r.severity} message=${r.message}`);
}

for (const name of ["fresh_install_fixture", "customized_install_fixture"]) {
  ok(`${name} is RETIRED (absent from GATES entirely)`, !byName.has(name), `still present with severity=${byName.get(name) && byName.get(name).severity}`);
}

{
  const r = byName.get("update_fixture_from_previous");
  ok("update_fixture_from_previous is RETIRED (upgraded into upgrade_current_to_new — not present)", !r, `still present with severity=${r && r.severity}`);
}

CANNED["test-scaffold-all-ways.js"].stdout = JSON.stringify({
  ok: false,
  incomplete: false,
  ps_available: true,
  legs: [
    { leg: 1, name: "portfolio_new", ran: true, ok: true, asserts: [] },
    { leg: 2, name: "manual_mc_setup", ran: true, ok: true, asserts: [] },
    { leg: 3, name: "shipped_install_ps1", ran: true, ok: false, asserts: [{ name: "_mc/MANIFEST.json present (COMPLETE install)", status: "fail" }] },
  ],
  sandbox_isolation: { no_delta: true, onlyBefore: [], onlyAfter: [] },
});
{
  const ga = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("fresh_scaffold_all_ways");
  ok("report-only: a real-install LEG failure is YELLOW (reported, NON-blocking), not red", ga && ga.severity === "yellow", ga && `severity=${ga.severity}`);
  ok("report-only: the message names the flip-trigger", ga && /FLIP-TRIGGER/.test(ga.message), ga && ga.message);
}
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
CANNED["test-scaffold-all-ways.js"].stdout = JSON.stringify({
  ok: false,
  incomplete: true,
  ps_available: false,
  legs: [{ leg: 1, name: "portfolio_new", ran: true, ok: false, asserts: [{ name: "canonical no-delta", status: "fail" }] }],
  sandbox_isolation: { no_delta: false, onlyBefore: [], onlyAfter: ["../leaked-sibling-repo"] },
});
{
  const ga = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("fresh_scaffold_all_ways");
  ok("a no-PS host (incomplete) WITH a leak is RED, never softened to degraded (leak check is FIRST)", ga && ga.severity === "red", ga && `severity=${ga.severity}`);
}
CANNED["test-scaffold-all-ways.js"].stdout = JSON.stringify({
  ok: false,
  incomplete: true,
  ps_available: false,
  legs: [
    { leg: 1, name: "portfolio_new", ran: true, ok: true, asserts: [] },
    { leg: 2, name: "manual_mc_setup", ran: true, ok: true, asserts: [] },
  ],
  sandbox_isolation: { no_delta: true, onlyBefore: [], onlyAfter: [] },
});
{
  const ga = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("fresh_scaffold_all_ways");
  ok("no-PS incomplete (no leak) is DEGRADED during the report-only ramp — not a pass, non-blocking", ga && ga.severity === "degraded", ga && `severity=${ga.severity}`);
}
CANNED["test-install-matrix.js"].stdout = JSON.stringify({
  ok: false,
  scenarios: [{ id: "1", name: "clean_install", status: "fail", assertions: [{ name: "_mc/MANIFEST.json present", status: "fail" }] }],
  totals: { pass: 0, fail: 1 },
});
{
  const im = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("install_matrix");
  ok("install_matrix report-only message names the flip-trigger", im && /FLIP-TRIGGER/.test(im.message), im && im.message);
}

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
  ok("upgrade gate: a sandbox-isolation NO-DELTA violation is RED (blocks unconditionally)", gb && gb.severity === "red", gb && `severity=${gb.severity}`);
  ok("upgrade gate leak message names SANDBOX-ISOLATION", gb && /SANDBOX-ISOLATION/.test(gb.message), gb && gb.message);
}
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
  ok("upgrade gate: ps_available=false is RED (INCOMPLETE, not a silent pass — skip-loud)", gb && gb.severity === "red", gb && `severity=${gb.severity}`);
  ok("upgrade gate incomplete message names INCOMPLETE", gb && /INCOMPLETE/.test(gb.message), gb && gb.message);
}
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
  ok("upgrade gate: a load-bearing conformance assert failure (e.g. 3c parity) is RED", gb && gb.severity === "red", gb && `severity=${gb.severity}`);
}
CANNED["test-upgrade-current-to-new.js"] = { status: 2, stdout: "", stderr: "FATAL: engine crashed" };
{
  const gb = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("upgrade_current_to_new");
  ok("upgrade gate: an engine crash (no parseable payload) is fail-closed RED, never a clean pass", gb && gb.severity === "red", gb && `severity=${gb.severity}`);
}
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
  ok("upgrade gate: INCOMPLETE-B (no unreleased cut) is severity:manual — skip-loud, NOT red, NOT green", gb && gb.severity === "manual", gb && `severity=${gb.severity}`);
  ok("upgrade gate: INCOMPLETE-B never greens release (severity !== green)", gb && gb.severity !== "green", gb && `severity=${gb.severity}`);
  ok("upgrade gate: INCOMPLETE-B message names the ceremony", gb && /ceremony/i.test(gb.message), gb && gb.message);
}

CANNED["test-upgrade-current-to-new.js"] = {
  status: 0,
  stdout: JSON.stringify({
    ok: true,
    from_version: "0.16.0",
    to_version: "0.17.0",
    ran: true,
    ps_available: true,
    asserts: [{ name: "previous_version_resolved", ok: true, detail: "", loadBearing: true }],
    sandbox_isolation: {},
  }),
  stderr: "",
};
{
  const gb = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("upgrade_current_to_new");
  ok(
    "upgrade gate: payload.ok:true but MISSING named 3b/3c evidence + isolation evidence is NEVER green",
    gb && gb.severity !== "green",
    gb && `severity=${gb.severity}`,
  );
}
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
  ],
  sandbox_isolation: { no_delta: true, onlyBefore: [], onlyAfter: [], dirty_set_content_unchanged: true, dirty_set_changed_files: [] },
});
{
  const gb = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("upgrade_current_to_new");
  ok(
    "upgrade gate: payload missing ONLY fresh_n_parity_content_3c (partial named evidence) is still NEVER green",
    gb && gb.severity !== "green",
    gb && `severity=${gb.severity}`,
  );
}
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
    { name: "fresh_n_parity_content_3c", ok: true, detail: "", loadBearing: true },
  ],
  sandbox_isolation: { no_delta: true, onlyBefore: [], onlyAfter: [], dirty_set_content_unchanged: true, dirty_set_changed_files: [] },
});
{
  const gb = new Map(run({ skip: KNOWN_HEAVY_OR_UNRELATED }).results.map((r) => [r.name, r])).get("upgrade_current_to_new");
  ok(
    "upgrade gate: payload missing the type/symlink-target named evidence is still NEVER green",
    gb && gb.severity !== "green",
    gb && `severity=${gb.severity}`,
  );
}

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
      no_delta: true,
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
  ok("upgrade gate: a dirty-set content-hash violation is RED (blocks unconditionally, even though no_delta itself held)", gb && gb.severity === "red", gb && `severity=${gb.severity}`);
  ok("upgrade gate dirty-set message names DIRTY-SET CONTENT CHANGED", gb && /DIRTY-SET CONTENT CHANGED/.test(gb.message), gb && gb.message);
}

cp.spawnSync = realSpawnSync;

{
  const jr = runJsonLoudFailTooth();
  ok(
    `test-update-json-loud-fail.js tooth suite is GREEN (--json loud-fail fix; pass=${jr.pass} fail=${jr.fail})`,
    jr.fail === 0,
    `pass=${jr.pass} fail=${jr.fail}`,
  );
}

process.stdout.write(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
