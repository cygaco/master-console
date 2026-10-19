#!/usr/bin/env node
"use strict";

const FALSIFIER_ID = "GAUNTLET-PACKAGE";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const { spawnSync } = cp;

const { home: EVENTS_HOME } = require("../lib/hermetic-events-home").pin({ realRoot: path.resolve(__dirname, "..", ".."), prefix: "gp-events-home-" });

const gp = require("./gauntlet-package");
const touchpoint = require("./touchpoint");
const hookPoints = require("./hook-points");

const REAL_ROOT = path.resolve(__dirname, "..", "..");
const LG_CASES = {"fourth-sprint":{"context.json":{"sprint":"SP-FIXTURE-FOURTH-SPRINT","sprintOrdinal":8,"composition":{"unit_types":["backend"],"max_risk":"low","domains":[]}},"diff-files.json":{"base":"aaaaaaa","head":"bbbbbbb","files":["scripts/sprint/status.js"],"tests":[]},"expected.json":{"package":"full","reasons_include":["fourth_sprint_full:ordinal=8","package=full"]},"golden-paths.json":{"schema":"mc/golden-paths/v1","features":[],"security_surface_globs":[]},"require-graph.json":{"schema":"mc/require-graph/v1","generatedAt":"2099-12-31T00:00:00.000Z","head":"bbbbbbb","nodes":["scripts/sprint/status.js"],"edges":[],"unresolved":[]},"trailer.json":{"change":"bugfix","blast":"minor","risks":["none"],"source":"ticket"}},"golden-entry":{"context.json":{"sprint":"SP-FIXTURE-GOLDEN-ENTRY","sprintOrdinal":5,"composition":{"unit_types":["backend"],"max_risk":"low","domains":[]}},"diff-files.json":{"base":"aaaaaaa","head":"bbbbbbb","files":["scripts/sprint/full.js"],"tests":[]},"expected.json":{"package":"touchpoint","cross_provider":false,"golden_touched":true,"trailer_overridden":"blast_upgraded:golden_entry","smoke_files":["scripts/sprint/test-sprint-full.js"],"reasons_include":["blast_upgraded:golden_entry","golden_touched:sprint-lifecycle","package=touchpoint"]},"golden-paths.json":{"schema":"mc/golden-paths/v1","features":[{"id":"sprint-lifecycle","name":"Sprint lifecycle","entry":["scripts/sprint/full.js","scripts/sprint/epsilon-runtime.js"],"golden_path":"plan to retro with beta at the four boundaries.","smoke_tests":["scripts/sprint/test-sprint-full.js"],"security_surface":false}],"security_surface_globs":[]},"require-graph.json":{"schema":"mc/require-graph/v1","generatedAt":"2099-12-31T00:00:00.000Z","head":"bbbbbbb","nodes":["scripts/sprint/full.js"],"edges":[],"unresolved":[]},"trailer.json":{"change":"bugfix","blast":"minor","risks":["none"],"source":"ticket"}},"major-release":{"context.json":{"sprint":"SP-FIXTURE-MAJOR-RELEASE","sprintOrdinal":5,"composition":{"unit_types":["backend","frontend"],"max_risk":"high","domains":[]}},"diff-files.json":{"base":"aaaaaaa","head":"bbbbbbb","files":["scripts/mc/release-build.js","framework/paths.registry.json",".claude/commands/mc/release.md","scripts/mc/manifest/build.js","scripts/generate-framework-manifest.js","scripts/mc/snapshot-installed.js",".claude/manifest.json"],"tests":["scripts/mc/test-cross-version-replay.js"]},"expected.json":{"package":"full","cross_provider":false,"roster_stage4_roles":["frontend-reviewer","backend-reviewer","qa-reviewer","security-reviewer","visual-review","design-quality"],"security_deep_present":true,"stages":[0,1,2,3,4,5],"budget":{"wall_ms":14400000},"sanity_is_full_suite":true,"reasons_include":["change=release","package=full"]},"golden-paths.json":{"schema":"mc/golden-paths/v1","features":[{"id":"install-update","name":"Install / update the framework","entry":["scripts/mc/release-build.js"],"golden_path":"A product repo installs mc, updates and /mc:doctor reports green.","smoke_tests":["scripts/mc/test-cross-version-replay.js"],"security_surface":false}],"security_surface_globs":[".claude/settings.json","framework/hooks.registry.json"]},"require-graph.json":{"schema":"mc/require-graph/v1","generatedAt":"2099-12-31T00:00:00.000Z","head":"bbbbbbb","nodes":["scripts/mc/release-build.js","framework/paths.registry.json",".claude/commands/mc/release.md","scripts/mc/manifest/build.js","scripts/generate-framework-manifest.js","scripts/mc/snapshot-installed.js",".claude/manifest.json","scripts/mc/test-cross-version-replay.js"],"edges":[],"unresolved":[]},"trailer.json":{"change":"release","blast":"major","risks":["release-pipeline","paths-registry"],"source":"ticket"},"trailer.txt":"release(mc): cut the release build\n\nChange: release\nBlast: major\nRisks: release-pipeline,paths-registry\n"},"minor-bugfix":{"context.json":{"sprint":"SP-FIXTURE-MINOR-BUGFIX","sprintOrdinal":5,"composition":{"unit_types":["backend"],"max_risk":"low","domains":[]}},"diff-files.json":{"base":"aaaaaaa","head":"bbbbbbb","files":["scripts/sprint/status.js"],"tests":["scripts/sprint/test-status-lag-fix.js"]},"expected.json":{"package":"combined-focused","cross_provider":false,"roster_stage4":[{"role":"backend-reviewer","passes":["primary"]}],"security_deep_present":false,"security_hit":false,"trailer_overridden":null,"budget":{"wall_ms":900000,"dispatches":1},"focused_tests":1,"reasons_include":["change=bugfix","blast=minor","package=combined-focused"]},"golden-paths.json":{"schema":"mc/golden-paths/v1","features":[{"id":"sprint-lifecycle","name":"Sprint lifecycle","entry":["scripts/sprint/full.js","scripts/sprint/epsilon-runtime.js"],"golden_path":"plan to retro with beta at the four boundaries.","smoke_tests":["scripts/sprint/test-sprint-full.js"],"security_surface":false}],"security_surface_globs":["scripts/dispatch/**"]},"require-graph.json":{"schema":"mc/require-graph/v1","generatedAt":"2099-12-31T00:00:00.000Z","head":"bbbbbbb","nodes":["scripts/sprint/status.js","scripts/sprint/test-status-lag-fix.js"],"edges":[{"from":"scripts/sprint/test-status-lag-fix.js","to":"scripts/sprint/status.js","kind":"require"}],"unresolved":[]},"trailer.json":{"change":"bugfix","blast":"minor","risks":["none"],"source":"ticket"},"trailer.txt":"fix(sprint): status lag on closed tickets\n\nOne-line body.\n\nChange: bugfix\nBlast: minor\nRisks: none\n\n\n"},"mutation-demo":{"add.js":"\"use strict\";\n// mutation-demo unit (synthetic mutation demo): a one-line target the mutation demo plants a\n// break in, to prove the selector's Focused test actually distinguishes GREEN from RED.\nfunction add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n","add.test.js":"\"use strict\";\nconst test = require(\"node:test\");\nconst assert = require(\"node:assert\");\nconst { add } = require(\"./add\");\n\ntest(\"add(2,3) === 5\", () => {\n  assert.strictEqual(add(2, 3), 5);\n});\n"},"no-trailer":{"diff-files.json":{"base":"aaaaaaa","head":"bbbbbbb","files":["scripts/sprint/status.js"],"tests":[]},"trailer.json":{"change":"bogus","blast":"minor","risks":["none"]},"trailer.txt":"chore: tidy a comment\n\nNo classification trailer on purpose.\n"},"security-touch":{"context.json":{"sprint":"SP-FIXTURE-SECURITY-TOUCH","sprintOrdinal":5,"composition":{"unit_types":["backend"],"max_risk":"low","domains":[]}},"diff-files.json":{"base":"aaaaaaa","head":"bbbbbbb","files":["scripts/dispatch/attest-signing.js"],"tests":["scripts/dispatch/attest-signing.test.js"]},"expected.json":{"package":"combined-focused","cross_provider":false,"roster_stage4":[{"role":"backend-reviewer","passes":["primary"]},{"role":"security-reviewer","passes":["primary","second_pass","third_pass"]}],"security_deep_present":true,"security_hit":true,"security_by":["path:scripts/dispatch/attest-signing.js","path:scripts/dispatch/attest-signing.test.js"],"trailer_overridden":null,"budget":{"wall_ms":2400000,"dispatches":4},"reasons_include":["change=bugfix","blast=minor","package=combined-focused"]},"golden-paths.json":{"schema":"mc/golden-paths/v1","features":[],"security_surface_globs":["scripts/dispatch/**","scripts/dispatch-*.js"]},"require-graph.json":{"schema":"mc/require-graph/v1","generatedAt":"2099-12-31T00:00:00.000Z","head":"bbbbbbb","nodes":["scripts/dispatch/attest-signing.js","scripts/dispatch/attest-signing.test.js"],"edges":[{"from":"scripts/dispatch/attest-signing.test.js","to":"scripts/dispatch/attest-signing.js","kind":"require"}],"unresolved":[]},"trailer.json":{"change":"bugfix","blast":"minor","risks":["none"],"source":"ticket"},"trailer.txt":"fix(dispatch): attest-signing key handling\n\nChange: bugfix\nBlast: minor\nRisks: none\n"},"size-upgrade":{"context.json":{"sprint":"SP-FIXTURE-SIZE-UPGRADE","sprintOrdinal":5,"composition":{"unit_types":["backend"],"max_risk":"low","domains":[]}},"diff-files.json":{"base":"aaaaaaa","head":"bbbbbbb","files":["scripts/sprint/f0.js","scripts/sprint/f1.js","scripts/sprint/f2.js","scripts/sprint/f3.js","scripts/sprint/f4.js","scripts/sprint/f5.js","scripts/sprint/f6.js","scripts/sprint/f7.js","scripts/sprint/f8.js","scripts/sprint/f9.js","scripts/sprint/f10.js","scripts/sprint/f11.js","scripts/sprint/f12.js","scripts/sprint/f13.js"],"tests":[]},"expected.json":{"package":"touchpoint","cross_provider":false,"trailer_overridden":"blast_upgraded:size","reasons_include":["blast_upgraded:size","package=touchpoint"]},"golden-paths.json":{"schema":"mc/golden-paths/v1","features":[],"security_surface_globs":[]},"require-graph.json":{"schema":"mc/require-graph/v1","generatedAt":"2099-12-31T00:00:00.000Z","head":"bbbbbbb","nodes":["scripts/sprint/f0.js","scripts/sprint/f1.js","scripts/sprint/f2.js","scripts/sprint/f3.js","scripts/sprint/f4.js","scripts/sprint/f5.js","scripts/sprint/f6.js","scripts/sprint/f7.js","scripts/sprint/f8.js","scripts/sprint/f9.js","scripts/sprint/f10.js","scripts/sprint/f11.js","scripts/sprint/f12.js","scripts/sprint/f13.js"],"edges":[],"unresolved":[]},"trailer.json":{"change":"bugfix","blast":"minor","risks":["none"],"source":"ticket"}},"stale-map":{"context.json":{"sprint":"SP-FIXTURE-STALE-MAP","sprintOrdinal":5,"composition":{"unit_types":["backend"],"max_risk":"low","domains":[]},"simulateMapStale":true},"diff-files.json":{"base":"aaaaaaa","head":"bbbbbbb","files":["scripts/sprint/status.js"],"tests":[]},"expected.json":{"package":"touchpoint","cross_provider":false,"reasons_include":["map_stale_fallback","package=touchpoint"]},"golden-paths.json":{"schema":"mc/golden-paths/v1","features":[],"security_surface_globs":[]},"require-graph.json":{"schema":"mc/require-graph/v1","generatedAt":"2026-01-01T00:00:00.000Z","head":"stale-head-does-not-match","nodes":["scripts/sprint/status.js"],"edges":[],"unresolved":[]},"trailer.json":{"change":"bugfix","blast":"minor","risks":["none"],"source":"ticket"}},"unmapped-escalation":{"context.json":{"sprint":"SP-FIXTURE-UNMAPPED","sprintOrdinal":5,"composition":{"unit_types":[],"max_risk":"","domains":[]}},"diff-files.json":{"base":"aaaaaaa","head":"bbbbbbb","files":["scripts/x/mystery-new-file.js"],"tests":[]},"expected.json":{"package":"full","never_empty_stages":true,"reasons_include":["unmapped_escalation:scripts/x/mystery-new-file.js","package=full"]},"golden-paths.json":{"schema":"mc/golden-paths/v1","features":[],"security_surface_globs":[]},"require-graph.json":{"schema":"mc/require-graph/v1","generatedAt":"2099-12-31T00:00:00.000Z","head":"bbbbbbb","nodes":["scripts/sprint/status.js"],"edges":[],"unresolved":[]},"trailer.json":{"change":"bugfix","blast":"minor","risks":["none"],"source":"ticket"}}};
const LG_REPLAY = {"schema":"mc/gauntlet-package/v1","sprint":"SP-99999999-REPLAY","run_id":"run-9999999999999","base":"cccccccc","head":"dddddddd","trailer":{"change":"update","blast":"major","risks":["release-pipeline"],"source":"synthetic trailer","overridden":null},"package":"full","cross_provider":false,"stages":[{"stage":0,"name":"trailer","kind":"mechanical","stop_on_fail":true},{"stage":1,"name":"sanity","kind":"tests","files":"FULL_SUITE","stop_on_fail":true},{"stage":2,"name":"smoke","kind":"tests","files":["scripts/checks/leak-denylist.test.js","scripts/checks/leak-gate.test.js","scripts/checks/mc-install-baseline.ship-coverage.test.js"],"stop_on_fail":true},{"stage":3,"name":"security-shallow","kind":"mechanical","cmds":["scripts/checks/leak-gate.js","scripts/checks/brand-leak-scan.js"],"stop_on_fail":true},{"stage":4,"name":"review","kind":"agents","roster":[{"role":"qa-reviewer","passes":"all","scope":"full","mode":"block","matched_via":"always","files":[]},{"role":"security-reviewer","passes":"all","scope":"full","mode":"block","matched_via":"always","files":[]}],"stop_on_fail":true},{"stage":5,"name":"security-deep","kind":"agents","roster":[{"role":"security-reviewer","passes":["primary","second_pass","third_pass"],"scope":"focused+touchpoint"}],"present":true}],"focused":{"files":43,"tests":37,"list":[]},"touchpoint":{"files":411,"tests":127,"depth":1,"map_generated_at":"2099-01-01T00:00:00.000Z","unresolved_hits":25},"graph_integrity":{"poisoned":false,"reasons":[]},"roster_attribution":[{"role":"qa-reviewer","matched_via":"always"},{"role":"security-reviewer","matched_via":"always"}],"security":{"hit":true,"by":["path:.claude/agents/_org/role-registry.json","path:.claude/agents/engineering/backend/backend-lead.md","path:.claude/agents/engineering/backend/builder.md"]},"golden_touched":false,"budget":{"wall_ms":14400000,"dispatches":2},"reasons":["change=update","blast=major","security_hit:path:.claude/agents/_org/role-registry.json,path:.claude/agents/engineering/backend/backend-lead.md,path:.claude/agents/engineering/backend/builder.md,path:.claude/agents/engineering/backend/fixer.md,path:.claude/agents/engineering/director-of-engineering.md,path:.claude/agents/engineering/frontend/builder.md,path:.claude/agents/engineering/frontend/fixer.md,path:.claude/agents/engineering/frontend/frontend-lead.md,path:.claude/agents/engineering/security/builder.md,path:.claude/agents/engineering/security/fixer.md,path:.claude/agents/engineering/security/security-lead.md,path:.claude/agents/engineering/skeleton-builder.md,path:.claude/agents/growth/conversion-lead.md,path:.claude/agents/growth/copy-lead.md,path:.claude/agents/growth/director-of-growth.md,path:.claude/agents/growth/marketing-lead.md,path:.claude/agents/president/_system/policy/provider-fallback.json,path:.claude/agents/president/_system/policy/sprint-routing.json,path:.claude/agents/president/alpha.md,path:.claude/agents/president/beta.md,path:.claude/agents/president/cabinet.md,path:.claude/agents/president/delta.md,path:.claude/agents/president/epsilon.md,path:.claude/agents/president/gamma.md,path:.claude/agents/president/ops-analyst.md,path:.claude/agents/product/design-lead.md,path:.claude/agents/product/director-of-product.md,path:.claude/agents/product/product-lead.md,path:.claude/agents/product/quality-lead.md,path:.claude/agents/product/quality/test-runner.md,path:.claude/framework-installed.json,path:.claude/framework-manifest.json,path:.claude/manifest.json,path:_mc/MANIFEST.json,path:scripts/checks/acceptance-read-choke-point.test.js,path:scripts/checks/all-writers-route-recordCompletion.test.js,path:scripts/checks/authority-pollution-scan.test.js,path:scripts/checks/beta-verdict-citation-receipt.test.js,path:scripts/checks/brand-leak-scan.js,path:scripts/checks/cert-attest-panel.test.js,path:scripts/checks/cert-attest.test.js,path:scripts/checks/change-trailer.js,path:scripts/checks/change-trailer.test.js,path:scripts/checks/chief-coherence-enforcer.test.js,path:scripts/checks/conformance-matrix-core2-live.test.js,path:scripts/checks/conformance-matrix.test.js,path:scripts/checks/consult-roster-no-dispatch.test.js,path:scripts/checks/contract-lint.test.js,path:scripts/checks/cutover-completeness.test.js,path:scripts/checks/design-quality-gate.test.js,path:scripts/checks/dispatch-readiness.test.js,path:scripts/checks/dispatch-routing-parity.test.js,path:scripts/checks/dispatch-timeout-sanity.test.js,path:scripts/checks/doc-ref-integrity.test.js,path:scripts/checks/duplicate-doc-drift.test.js,path:scripts/checks/ed-register-reality-drift.test.js,path:scripts/checks/agy-liveness-close-gate.test.js,path:scripts/checks/entry-preamble-parity.test.js,path:scripts/checks/epsilon-liveness.test.js,path:scripts/checks/epsilon-paired-waiter.test.js,path:scripts/checks/falsifier-liveness.test.js,path:scripts/checks/file-usage-trace.test.js,path:scripts/checks/framework-purity-gate.test.js,path:scripts/checks/framework-purity.js,path:scripts/checks/framework-purity.test.js,path:scripts/checks/gate-failclosed-audit.test.js,path:scripts/checks/gate-failclosed-enforcer.test.js,path:scripts/checks/golden-paths-validate.js,path:scripts/checks/golden-paths-validate.test.js,path:scripts/checks/greek-office-parity.test.js,path:scripts/checks/higgsfield-spend-gate.test.js,path:scripts/checks/hook-registration-parity.test.js,path:scripts/checks/install-git-hooks-commit-msg.test.js,path:scripts/checks/integration-seam-gate.test.js,path:scripts/checks/knowledge-coverage.test.js,path:scripts/checks/leak-denylist.js,path:scripts/checks/leak-denylist.test.js,path:scripts/checks/leak-gate.js,path:scripts/checks/leak-gate.test.js,path:scripts/checks/license-match.test.js,path:scripts/checks/liveness-read-choke-point.test.js,path:scripts/checks/log-sink-caps.test.js,path:scripts/checks/main-write-broker-completeness.js,path:scripts/checks/main-write-broker-completeness.test.js,path:scripts/checks/maps-coverage.test.js,path:scripts/checks/mc-install-baseline.ship-coverage.test.js,path:scripts/checks/mc-tracked-transients.js,path:scripts/checks/mc-tracked-transients.test.js,path:scripts/checks/memory-apply.test.js,path:scripts/checks/memory-integrity.test.js,path:scripts/checks/meta-lockstep.test.js,path:scripts/checks/model-chain.test.js,path:scripts/checks/no-dead-team-tools.test.js,path:scripts/checks/no-legacy-gemini-cli.test.js,path:scripts/checks/no-nul-bytes.test.js,path:scripts/checks/operator-contract-scan.test.js,path:scripts/checks/pinned-checker-bundle-manifest.test.js,path:scripts/checks/pl-build-spec-enforcer.test.js,path:scripts/checks/provenance-invariants.test.js,path:scripts/checks/provider-agent-tool-parity.test.js,path:scripts/checks/provider-api-policy.test.js,path:scripts/checks/provider-invocation-parity.test.js,path:scripts/checks/reader-discipline.test.js,path:scripts/checks/readme-drift.js,path:scripts/checks/readme-drift.test.js,path:scripts/checks/reasoned-consult-honesty.test.js,path:scripts/checks/resonance-runner.test.js,path:scripts/checks/role-parity.test.js,path:scripts/checks/run-tests.js,path:scripts/checks/run-tests.test.js,path:scripts/checks/scan-coverage.test.js,path:scripts/checks/security-binding-lane.test.js,path:scripts/checks/security-pass-count.test.js,path:scripts/checks/skill-catalog-says.test.js,path:scripts/checks/skill-hook-coverage.test.js,path:scripts/checks/skill-says-lint.test.js,path:scripts/checks/sprint-hook-coverage.js,path:scripts/checks/taste-gate-presence.test.js,path:scripts/checks/tracker-fidelity.test.js,path:scripts/checks/tracker-reality-drift.test.js,path:scripts/checks/transport-record-trust-guard.test.js,path:scripts/checks/trusted-enforcement-scope.test.js,path:scripts/checks/voice-router-fixtures.test.js,path:scripts/dispatch-agent.js,path:scripts/dispatch-claude.js,path:scripts/dispatch/beta-consult.test.js,path:scripts/dispatch/catalog.js,path:scripts/dispatch/cli-preview.js,path:scripts/dispatch/gui.js,path:scripts/dispatch/harness-spawn-model.test.js,path:scripts/dispatch/provider-breaker.test.js,path:scripts/dispatch/save.js,path:scripts/dispatch/state.js,path:scripts/hooks/authorization-gate.js,path:scripts/hooks/change-trailer-guard.js,path:scripts/hooks/protected-ref-transaction.js,path:scripts/hooks/secret-guard.js,path:scripts/sprint/hook-points.js,risk:release-pipeline","dynamic_require_widened","unmapped_escalation:.claude/framework-installed.json,.claude/framework-manifest.json,_mc/MANIFEST.json,synthetic/deferred.patch","fourth_sprint_full:ordinal=36","package=full"],"selector_version":"1.0.0"};

function materializeLeanGauntlet() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-lean-gauntlet-"));
  for (const [name, files] of Object.entries(LG_CASES)) {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
    for (const [file, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name, file), typeof body === "string" ? body : JSON.stringify(body, null, 2));
    }
  }
  fs.writeFileSync(path.join(dir, "integration-flips-selection.json"), JSON.stringify({ decision: LG_REPLAY }, null, 2));
  process.on("exit", () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { } });
  return dir;
}
const FIXTURES = materializeLeanGauntlet();

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadFixtureInput(name) {
  const dir = path.join(FIXTURES, name);
  const trailerRaw = readJSON(path.join(dir, "trailer.json"));
  const trailer = gp.readTrailer(trailerRaw);
  const diff = readJSON(path.join(dir, "diff-files.json"));
  const context = fs.existsSync(path.join(dir, "context.json")) ? readJSON(path.join(dir, "context.json")) : {};
  const goldenPaths = fs.existsSync(path.join(dir, "golden-paths.json")) ? readJSON(path.join(dir, "golden-paths.json")) : { features: [], security_surface_globs: [] };
  const graph = fs.existsSync(path.join(dir, "require-graph.json")) ? readJSON(path.join(dir, "require-graph.json")) : null;

  const focused = { files: diff.files || [], tests: diff.tests || [] };
  let tp = touchpoint.touchpointClosure(focused.files, { graph, depth: 1, root: REAL_ROOT });
  tp = touchpoint.widenForDynamicHints(tp, { root: REAL_ROOT });
  if (context.simulateMapStale) tp.map_stale = true;

  const allTouched = [...new Set([...focused.files, ...tp.files])];
  const security = touchpoint.securitySurfaceHit({ files: allTouched, risks: trailer.risks, goldenPaths });
  const touchedFeatures = gp.goldenFeaturesTouched(focused.files, goldenPaths);
  const goldenTouched = { touched: touchedFeatures.length > 0, features: touchedFeatures.map((f) => f.id) };

  const composition = context.composition || { unit_types: [], max_risk: "", domains: [] };
  const fullRoster = hookPoints.agentsForStep("gauntlet", {
    ...composition,
    change: "release",
    blast: "major",
    surfaces: [...new Set([...(composition.surfaces || []), "security"])],
  });

  return {
    trailer,
    composition,
    focused,
    touchpoint: tp,
    security,
    goldenTouched,
    goldenSmokeFloor: gp.goldenSmokeFloor(goldenPaths),
    sprintOrdinal: context.sprintOrdinal === undefined ? null : context.sprintOrdinal,
    sprint: context.sprint || name,
    run_id: `run-fixture-${name}`,
    base: diff.base,
    head: diff.head,
    fullRoster,
  };
}

function fixtureNames() {
  return fs.readdirSync(FIXTURES, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(FIXTURES, e.name, "expected.json"))).map((e) => e.name);
}

for (const name of fixtureNames()) {
  test(`${FALSIFIER_ID} fixture "${name}" matches its expected.json`, () => {
    const dir = path.join(FIXTURES, name);
    const expected = readJSON(path.join(dir, "expected.json"));
    const input = loadFixtureInput(name);
    const decision = gp.selectPackage(input);

    if (expected.halt_reason) {
      assert.strictEqual(decision.halt_reason, expected.halt_reason, JSON.stringify(decision));
      return;
    }
    assert.ok(!decision.halt_reason, `fixture "${name}" unexpectedly halted: ${decision.error}`);
    if (expected.package !== undefined) assert.strictEqual(decision.package, expected.package, `fixture "${name}": package`);
    if (expected.cross_provider !== undefined) assert.strictEqual(decision.cross_provider, expected.cross_provider, `fixture "${name}": cross_provider`);
    if (expected.trailer_overridden !== undefined) assert.strictEqual(decision.trailer.overridden, expected.trailer_overridden, `fixture "${name}": trailer.overridden`);
    if (expected.security_hit !== undefined) assert.strictEqual(decision.security.hit, expected.security_hit, `fixture "${name}": security.hit`);
    if (expected.security_by !== undefined) assert.deepStrictEqual(decision.security.by, expected.security_by, `fixture "${name}": security.by`);
    if (expected.golden_touched !== undefined) assert.strictEqual(decision.golden_touched, expected.golden_touched, `fixture "${name}": golden_touched`);
    if (expected.budget !== undefined) {
      for (const k of Object.keys(expected.budget)) assert.strictEqual(decision.budget[k], expected.budget[k], `fixture "${name}": budget.${k}`);
    }
    if (expected.focused_tests !== undefined) assert.strictEqual(decision.focused.tests, expected.focused_tests, `fixture "${name}": focused.tests`);
    if (expected.security_deep_present !== undefined) {
      const s5 = decision.stages.find((s) => s.stage === 5);
      assert.strictEqual(Boolean(s5 && s5.present), expected.security_deep_present, `fixture "${name}": stage 5 present`);
    }
    if (expected.stages !== undefined) assert.deepStrictEqual(decision.stages.map((s) => s.stage), expected.stages, `fixture "${name}": stage id list`);
    if (expected.roster_stage4 !== undefined) {
      const roster = decision.stages.find((s) => s.stage === 4).roster.map((r) => ({ role: r.role, passes: r.passes }));
      assert.deepStrictEqual(roster, expected.roster_stage4, `fixture "${name}": stage 4 roster`);
    }
    if (expected.roster_stage4_roles !== undefined) {
      const roles = decision.stages.find((s) => s.stage === 4).roster.map((r) => r.role);
      assert.deepStrictEqual(roles, expected.roster_stage4_roles, `fixture "${name}": stage 4 roster roles`);
    }
    if (expected.smoke_files !== undefined) {
      const s2 = decision.stages.find((s) => s.stage === 2);
      assert.deepStrictEqual(s2.files, expected.smoke_files, `fixture "${name}": stage 2 smoke files`);
    }
    if (expected.sanity_is_full_suite) {
      const s1 = decision.stages.find((s) => s.stage === 1);
      assert.strictEqual(s1.files, "FULL_SUITE", `fixture "${name}": stage 1 must run the full suite for a "full" package`);
    }
    if (expected.never_empty_stages) {
      assert.ok(decision.stages.length > 0, `fixture "${name}": stages must never be empty`);
      const s4 = decision.stages.find((s) => s.stage === 4);
      assert.ok(s4 && s4.roster.length > 0, `fixture "${name}": an escalated-to-full package must still carry a non-empty review roster`);
    }
    if (Array.isArray(expected.reasons_include)) {
      for (const r of expected.reasons_include) assert.ok(decision.reasons.includes(r), `fixture "${name}": reasons[] missing "${r}" — got ${JSON.stringify(decision.reasons)}`);
    }
  });
}

test(`${FALSIFIER_ID} (no-trailer): an invalid trailer halts with change_trailer_missing and selectPackage never computes a package`, () => {
  const input = loadFixtureInput("no-trailer");
  const decision = gp.selectPackage(input);
  assert.strictEqual(decision.halt_reason, "change_trailer_missing");
  assert.ok(!decision.package, "a halted decision must carry no package");
});

test(`${FALSIFIER_ID}: a literally ABSENT trailer file (readTrailerFile) also halts with change_trailer_missing`, () => {
  const t = gp.readTrailerFile(path.join(os.tmpdir(), "mc-does-not-exist-" + Date.now() + ".json"));
  assert.ok(t.error && t.error.startsWith("change_trailer_missing"), t.error);
  const decision = gp.selectPackage({ trailer: t });
  assert.strictEqual(decision.halt_reason, "change_trailer_missing");
});

test(`${FALSIFIER_ID}: readTrailer accepts a CSV risks string and rejects an empty/invalid risks list`, () => {
  assert.deepStrictEqual(gp.readTrailer({ change: "bugfix", blast: "minor", risks: "ci, hooks " }).risks, ["ci", "hooks"]);
  assert.ok(gp.readTrailer({ change: "bugfix", blast: "minor", risks: "none, ci " }).error, '"none" + another token must be rejected by the ONE validator');
  assert.ok(gp.readTrailer({ change: "bugfix", blast: "minor", risks: [] }).error);
  assert.ok(gp.readTrailer({ change: "bugfix", blast: "minor", risks: "" }).error);
});

test(`${FALSIFIER_ID} (never-empty property): across every matrix row, an empty Focused+Touchpoint still yields a non-empty stage list AND a non-empty review roster`, () => {
  const matrixRows = [
    { change: "bugfix", blast: "minor" },
    { change: "bugfix", blast: "major" },
    { change: "update", blast: "minor" },
    { change: "update", blast: "major" },
    { change: "release", blast: "major" },
  ];
  for (const row of matrixRows) {
    const decision = gp.selectPackage({
      sprint: "SP-PROP",
      trailer: { change: row.change, blast: row.blast, risks: ["none"] },
      composition: { unit_types: [], max_risk: "", domains: [] },
      focused: { files: [], tests: [] },
      touchpoint: { files: [], tests: [], depth: 1, unmapped: false, unmapped_files: [], unresolved_hits: [] },
      security: { hit: false, by: [] },
      goldenTouched: { touched: false, features: [] },
      goldenSmokeFloor: [],
      sprintOrdinal: 1,
      fullRoster: [{ role: "backend-reviewer", mode: "block" }],
    });
    assert.ok(!decision.halt_reason, `row ${JSON.stringify(row)} unexpectedly halted`);
    assert.ok(decision.stages.length > 0, `row ${JSON.stringify(row)}: stages must never be empty`);
    const review = decision.stages.find((s) => s.stage === 4);
    assert.ok(review && review.roster.length > 0, `row ${JSON.stringify(row)}: review roster must never be empty — an empty selection is a vacuous green`);
  }
});

test(`${FALSIFIER_ID}: an unmapped file ALWAYS escalates to full, regardless of how minor the trailer declares the change`, () => {
  const decision = gp.selectPackage({
    sprint: "SP-PROP2",
    trailer: { change: "bugfix", blast: "minor", risks: ["none"] },
    composition: { unit_types: [], max_risk: "", domains: [] },
    focused: { files: ["scripts/x/unknown.js"], tests: [] },
    touchpoint: { files: [], tests: [], depth: 1, unmapped: true, unmapped_files: ["scripts/x/unknown.js"], unresolved_hits: [] },
    security: { hit: false, by: [] },
    goldenTouched: { touched: false, features: [] },
    goldenSmokeFloor: [],
    sprintOrdinal: 1,
    fullRoster: [{ role: "backend-reviewer", mode: "block" }],
  });
  assert.strictEqual(decision.package, "full");
});

test(`${FALSIFIER_ID}: emitSelected REFUSES a malformed decision and writes nothing`, () => {
  const bad = { schema: "wrong-schema", sprint: "SP", trailer: { change: "bugfix", blast: "minor" }, package: "combined-focused", stages: [{ stage: 0 }], budget: { wall_ms: 1 }, reasons: ["x"], selector_version: "1.0.0" };
  const before = process.stderr.write;
  let captured = "";
  process.stderr.write = (s) => {
    captured += s;
    return true;
  };
  let res;
  try {
    res = gp.emitSelected(bad);
  } finally {
    process.stderr.write = before;
  }
  assert.strictEqual(res.ok, false);
  assert.ok(res.problems.length > 0);
  assert.match(captured, /REFUSED to emit a malformed/);
});

test(`${FALSIFIER_ID}: a well-formed decision passes validateDecision with zero problems`, () => {
  const good = loadFixtureInput("minor-bugfix");
  const decision = gp.selectPackage(good);
  assert.deepStrictEqual(gp.validateDecision(decision), []);
});

test(`${FALSIFIER_ID}: stagesFor() returns exactly the decision's own stage list, in order`, () => {
  const decision = gp.selectPackage(loadFixtureInput("minor-bugfix"));
  assert.deepStrictEqual(gp.stagesFor(decision), decision.stages);
  assert.deepStrictEqual(gp.stagesFor(decision).map((s) => s.stage), [0, 1, 2, 3, 4]);
});

test(`${FALSIFIER_ID}: unitReviewerRole resolves backend/frontend, and falls back to null (qa-reviewer alone) when neither resolves`, () => {
  assert.strictEqual(gp.unitReviewerRole({ unit_types: ["backend"] }), "backend-reviewer");
  assert.strictEqual(gp.unitReviewerRole({ unit_types: ["frontend"] }), "frontend-reviewer");
  assert.strictEqual(gp.unitReviewerRole({ unit_types: [] }), null);
  assert.strictEqual(gp.unitReviewerRole({}), null);
});

test(`${FALSIFIER_ID} checkGraphIntegrity: a clean build (no loaded graph yet, or counts agree) is never poisoned`, () => {
  assert.deepStrictEqual(gp.checkGraphIntegrity({ focusedFiles: ["scripts/x.js"], loaded: null, built: { counts: { nodes: 10 } }, head: "h" }), { poisoned: false, reasons: [] });
  assert.deepStrictEqual(
    gp.checkGraphIntegrity({ focusedFiles: ["scripts/x.js"], loaded: { head: "other", counts: { nodes: 10 } }, built: { counts: { nodes: 10 } }, head: "h" }),
    { poisoned: false, reasons: [] },
  );
});

test(`${FALSIFIER_ID} checkGraphIntegrity: a change to scripts/maps/** (the graph builder itself) is ALWAYS flagged`, () => {
  const r = gp.checkGraphIntegrity({ focusedFiles: ["scripts/maps/require-graph.js"], loaded: null, built: { counts: { nodes: 10 } }, head: "h" });
  assert.strictEqual(r.poisoned, true);
  assert.ok(r.reasons.includes("graph_builder_changed"), JSON.stringify(r));
});

test(`${FALSIFIER_ID} checkGraphIntegrity: a graph build failure is flagged (never silently trusted)`, () => {
  const r = gp.checkGraphIntegrity({ focusedFiles: [], loaded: { head: "h", counts: { nodes: 50 } }, built: null, head: "h" });
  assert.strictEqual(r.poisoned, true);
  assert.ok(r.reasons.includes("graph_build_failed"), JSON.stringify(r));
});

test(`${FALSIFIER_ID} checkGraphIntegrity: a >20% node-count collapse vs the last-known on-disk graph is flagged`, () => {
  const r = gp.checkGraphIntegrity({ focusedFiles: [], loaded: { head: "old", counts: { nodes: 100 } }, built: { counts: { nodes: 70 } }, head: "h" });
  assert.strictEqual(r.poisoned, true);
  assert.ok(r.reasons.some((x) => x.startsWith("node_count_drop:")), JSON.stringify(r));
});

test(`${FALSIFIER_ID} checkGraphIntegrity: a <20% drop vs an OLDER (different-head) loaded graph is NOT flagged — only a genuine collapse is`, () => {
  const r = gp.checkGraphIntegrity({ focusedFiles: [], loaded: { head: "old", counts: { nodes: 100 } }, built: { counts: { nodes: 90 } }, head: "h" });
  assert.deepStrictEqual(r, { poisoned: false, reasons: [] });
});

test(`${FALSIFIER_ID} checkGraphIntegrity: an on-disk graph that CLAIMS the current head but a real rebuild of that head disagrees ("poisoned cache" case) is flagged`, () => {
  const r = gp.checkGraphIntegrity({ focusedFiles: [], loaded: { head: "h", counts: { nodes: 100 } }, built: { counts: { nodes: 99 } }, head: "h" });
  assert.strictEqual(r.poisoned, true);
  assert.ok(r.reasons.some((x) => x.startsWith("head_claim_mismatch:")), JSON.stringify(r));
});

const mkRoot = (goldenPathsText) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-security-root-"));
  if (goldenPathsText !== undefined) {
    fs.mkdirSync(path.join(dir, "_planning"), { recursive: true });
    fs.writeFileSync(path.join(dir, "_planning", "golden-paths.json"), goldenPathsText);
  }
  return dir;
};
const SECURITY_ROOT = mkRoot();

test(`${FALSIFIER_ID} every leak-gate.js GATES script is on the security surface`, () => {
  const leakGate = require("../checks/leak-gate");
  const goldenPaths = gp.loadGoldenPaths(SECURITY_ROOT);
  const matchers = (goldenPaths.security_surface_globs || []).map((g) => touchpoint.globToRegExp(g));
  const uncovered = leakGate.GATES.map((g) => g.args[0]).filter((script) => !matchers.some((re) => re.test(script)));
  assert.deepStrictEqual(uncovered, [], `leak-gate.js gate script(s) not on the security surface: ${uncovered.join(", ")}`);
});

test(`${FALSIFIER_ID} every gauntlet-package.js stage-3 (security-shallow) mechanical command is on the security surface`, () => {
  const goldenPaths = gp.loadGoldenPaths(SECURITY_ROOT);
  const matchers = (goldenPaths.security_surface_globs || []).map((g) => touchpoint.globToRegExp(g));
  const decision = gp.selectPackage({
    sprint: "SP-SECSURF-STAGE3",
    trailer: { change: "release", blast: "major", risks: ["none"] },
    composition: { unit_types: [], max_risk: "", domains: [] },
    focused: { files: [], tests: [] },
    touchpoint: { files: [], tests: [], depth: 1, unmapped: false, unmapped_files: [], unresolved_hits: [] },
    security: { hit: false, by: [] },
    goldenTouched: { touched: false, features: [] },
    goldenSmokeFloor: [],
    sprintOrdinal: 1,
    fullRoster: [{ role: "qa-reviewer", mode: "block" }],
  });
  const stage3 = decision.stages.find((s) => s.stage === 3);
  assert.ok(stage3 && Array.isArray(stage3.cmds) && stage3.cmds.length > 0, "stage 3 must carry mechanical cmds to derive from");
  const uncovered = stage3.cmds.filter((cmd) => !matchers.some((re) => re.test(cmd)));
  assert.deepStrictEqual(uncovered, [], `gauntlet-package.js stage-3 command(s) not on the security surface: ${uncovered.join(", ")}`);
});

test(`${FALSIFIER_ID} run-tests.js itself (stage 1, runs before any reviewer) is on the security surface`, () => {
  const goldenPaths = gp.loadGoldenPaths(SECURITY_ROOT);
  const matchers = (goldenPaths.security_surface_globs || []).map((g) => touchpoint.globToRegExp(g));
  assert.ok(matchers.some((re) => re.test("scripts/checks/run-tests.js")), "scripts/checks/run-tests.js must be on the security surface");
});

test(`${FALSIFIER_ID} every gate script's OWN .test.js sibling is also on the security surface`, () => {
  const leakGate = require("../checks/leak-gate");
  const goldenPaths = gp.loadGoldenPaths(SECURITY_ROOT);
  const matchers = (goldenPaths.security_surface_globs || []).map((g) => touchpoint.globToRegExp(g));
  const decision = gp.selectPackage({
    sprint: "SP-SECSURF-SIBLING",
    trailer: { change: "release", blast: "major", risks: ["none"] },
    composition: { unit_types: [], max_risk: "", domains: [] },
    focused: { files: [], tests: [] },
    touchpoint: { files: [], tests: [], depth: 1, unmapped: false, unmapped_files: [], unresolved_hits: [] },
    security: { hit: false, by: [] },
    goldenTouched: { touched: false, features: [] },
    goldenSmokeFloor: [],
    sprintOrdinal: 1,
    fullRoster: [{ role: "qa-reviewer", mode: "block" }],
  });
  const stage3 = decision.stages.find((s) => s.stage === 3);
  const gateScripts = [...new Set([...leakGate.GATES.map((g) => g.args[0]), ...(stage3 ? stage3.cmds : [])])];
  const withExistingTestFile = gateScripts.filter((script) => fs.existsSync(path.join(REAL_ROOT, script.replace(/\.js$/, ".test.js"))));
  assert.ok(withExistingTestFile.length > 0, "at least one gate script must have a real .test.js sibling to exercise this check");
  const uncovered = withExistingTestFile.map((s) => s.replace(/\.js$/, ".test.js")).filter((testFile) => !matchers.some((re) => re.test(testFile)));
  assert.deepStrictEqual(uncovered, [], `gate script test file(s) not on the security surface: ${uncovered.join(", ")}`);
});

function cleanEnv(root) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_") || k === "NODE_TEST_CONTEXT") delete env[k];
  if (root) env.CLAUDE_PROJECT_DIR = root;
  return env;
}

const SKIP_ALL_RECORDS = path.join(EVENTS_HOME, "skip-all-stage-records.json");
fs.writeFileSync(
  SKIP_ALL_RECORDS,
  JSON.stringify({ stages: Object.fromEntries([0, 1, 2, 3, 4, 5].map((n) => [String(n), { skip: "test fixture: this test exercises the close's budget and differential behaviour, not its stage records", operator_ack: "alpha ruling (test fixture): waived for CLI budget/differential tests" }])) }),
);

test(`${FALSIFIER_ID} hermetic events home: this file's events land under the temp project, in-process AND in every CLI child`, () => {
  const inside = (p) => path.resolve(p).toLowerCase().startsWith(path.resolve(EVENTS_HOME).toLowerCase() + path.sep);
  const { LOG_FILE } = require("../hooks/lib/logger");
  assert.ok(inside(LOG_FILE), `in-process events file escaped the temp project: ${LOG_FILE}`);
  const child = spawnSync(process.execPath, ["-e", 'process.stdout.write(require("./scripts/hooks/lib/logger").LOG_FILE)'], { cwd: REAL_ROOT, env: cleanEnv(), encoding: "utf8" });
  assert.strictEqual(child.status, 0, child.stderr);
  assert.ok(inside(child.stdout), `a CLI child's events file escaped the temp project: ${child.stdout}`);
});

function seedHookRegistry(root) {
  const dir = path.join(root, ".claude", "agents", "_org");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "sprint-hook-points.json"),
    JSON.stringify({ rows: [{ role: "qa-reviewer", step: "gauntlet", condition: "always", mode: "block", order: 10 }] }),
  );
}

test(`${FALSIFIER_ID} CLI: select halts with exit 2 and no stdout decision when --trailer-json is invalid`, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpcli-"));
  try {
    for (const args of [["init", "-q"], ["add", "-A"]]) spawnSync("git", args, { cwd: dir, env: cleanEnv(dir) });
    spawnSync("git", ["-c", "user.name=x", "-c", "user.email=x@x", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "--allow-empty", "-m", "base"], { cwd: dir, env: cleanEnv(dir) });
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" }).stdout.trim();
    const trailerFile = path.join(dir, "trailer.json");
    fs.writeFileSync(trailerFile, JSON.stringify({ change: "nonsense", blast: "minor", risks: ["none"] }));
    const r = spawnSync(process.execPath, [path.join(REAL_ROOT, "scripts", "sprint", "gauntlet-package.js"), "select", "--sprint", "SP-CLI", "--diff", `${head}..${head}`, "--trailer-json", trailerFile, "--root", dir], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" });
    assert.strictEqual(r.status, 2, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /HALT — change_trailer_missing/, r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test(`${FALSIFIER_ID} CLI end-to-end: select/explain/close over a REAL git diff in a bare repo with NO pre-existing require-graph.json/golden-paths.json — self-heals via an in-place regen, never crashes, never a vacuous pass`, { timeout: 60 * 1000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpcli2-"));
  try {
    spawnSync("git", ["init", "-q"], { cwd: dir, env: cleanEnv(dir) });
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "scripts", "x.js"), "module.exports = 1;\n");
    spawnSync("git", ["add", "-A"], { cwd: dir, env: cleanEnv(dir) });
    spawnSync("git", ["-c", "user.name=x", "-c", "user.email=x@x", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", "base"], { cwd: dir, env: cleanEnv(dir) });
    const base = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" }).stdout.trim();
    fs.writeFileSync(path.join(dir, "scripts", "x.js"), "module.exports = 2;\n");
    spawnSync("git", ["add", "-A"], { cwd: dir, env: cleanEnv(dir) });
    spawnSync("git", ["-c", "user.name=x", "-c", "user.email=x@x", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", "change x"], { cwd: dir, env: cleanEnv(dir) });
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" }).stdout.trim();

    const trailerFile = path.join(dir, "trailer.json");
    fs.writeFileSync(trailerFile, JSON.stringify({ change: "bugfix", blast: "minor", risks: ["none"] }));
    const CLI = path.join(REAL_ROOT, "scripts", "sprint", "gauntlet-package.js");

    const sel = spawnSync(process.execPath, [CLI, "select", "--sprint", "SP-CLI2", "--diff", `${base}..${head}`, "--trailer-json", trailerFile, "--root", dir, "--json"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" });
    assert.strictEqual(sel.status, 0, `${sel.stdout}\n${sel.stderr}`);
    const decision = JSON.parse(sel.stdout);
    assert.strictEqual(decision.package, "combined-focused", JSON.stringify(decision.reasons));
    assert.ok(decision.stages.length > 0);
    assert.ok(!decision.reasons.some((r) => r.startsWith("unmapped_escalation:")), JSON.stringify(decision.reasons));

    const exp = spawnSync(process.execPath, [CLI, "explain", "--sprint", "SP-CLI2", "--diff", `${base}..${head}`, "--trailer-json", trailerFile, "--root", dir, "--json"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" });
    assert.strictEqual(exp.status, 0, `${exp.stdout}\n${exp.stderr}`);
    const explained = JSON.parse(exp.stdout);
    assert.ok(Array.isArray(explained.reasons) && explained.reasons.length > 0, exp.stdout);

    const clo = spawnSync(process.execPath, [CLI, "close", "--sprint", "SP-CLI2", "--actual-ms", "1000", "--actual-dispatches", "1", "--stage-records", SKIP_ALL_RECORDS, "--root", dir], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" });
    assert.strictEqual(clo.status, 0, `${clo.stdout}\n${clo.stderr}`);
    assert.match(clo.stdout, /gauntlet-package: closed "combined-focused"/, clo.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test(`${FALSIFIER_ID} CLI (security): a crafted on-disk require-graph.json claiming the real HEAD, with a collapsed node count, is NEVER trusted — the selector escalates to "full" and records graph_integrity`, { timeout: 60 * 1000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-poison-"));
  try {
    spawnSync("git", ["init", "-q"], { cwd: dir, env: cleanEnv(dir) });
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "scripts", "x.js"), "module.exports = 1;\n");
    spawnSync("git", ["add", "-A"], { cwd: dir, env: cleanEnv(dir) });
    spawnSync("git", ["-c", "user.name=x", "-c", "user.email=x@x", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", "base"], { cwd: dir, env: cleanEnv(dir) });
    const base = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" }).stdout.trim();
    fs.writeFileSync(path.join(dir, "scripts", "x.js"), "module.exports = 2;\n");
    spawnSync("git", ["add", "-A"], { cwd: dir, env: cleanEnv(dir) });
    spawnSync("git", ["-c", "user.name=x", "-c", "user.email=x@x", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", "change x"], { cwd: dir, env: cleanEnv(dir) });
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" }).stdout.trim();

    fs.mkdirSync(path.join(dir, ".claude", "project", "maps"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".claude", "project", "maps", "require-graph.json"),
      JSON.stringify({
        schema: "mc/require-graph/v1",
        generatedAt: new Date(Date.now() + 86400000).toISOString(),
        head,
        roots: ["scripts"],
        nodes: [],
        edges: [],
        unresolved: [],
        missing: [],
        sources: {},
        counts: { nodes: 1000, edges: 0, unresolved: 0, missing: 0, byKind: {}, filesScanned: 0, externalRequires: 0 },
      }),
    );

    const trailerFile = path.join(dir, "trailer.json");
    fs.writeFileSync(trailerFile, JSON.stringify({ change: "bugfix", blast: "minor", risks: ["none"] }));
    seedHookRegistry(dir);
    const CLI = path.join(REAL_ROOT, "scripts", "sprint", "gauntlet-package.js");
    const sel = spawnSync(process.execPath, [CLI, "select", "--sprint", "SP-POISON", "--diff", `${base}..${head}`, "--trailer-json", trailerFile, "--root", dir, "--json"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" });
    assert.strictEqual(sel.status, 0, `${sel.stdout}\n${sel.stderr}`);
    const decision = JSON.parse(sel.stdout);

    assert.strictEqual(decision.graph_integrity.poisoned, true, JSON.stringify(decision.graph_integrity));
    assert.ok(decision.graph_integrity.reasons.some((r) => r.startsWith("node_count_drop:") || r.startsWith("head_claim_mismatch:")), JSON.stringify(decision.graph_integrity));
    assert.strictEqual(decision.package, "full", `a poisoned graph must escalate to "full": ${JSON.stringify(decision.reasons)}`);
    assert.ok(decision.reasons.some((r) => r.startsWith("unmapped_escalation:")), JSON.stringify(decision.reasons));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test(`${FALSIFIER_ID} MUTATION DEMO: a GREEN baseline run, then a planted one-line break turns the Focused test RED`, { timeout: 2 * 60 * 1000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpmut-"));
  try {
    const srcDir = path.join(FIXTURES, "mutation-demo");
    const destDir = path.join(dir, "tests", "mutation-demo");
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(path.join(srcDir, "add.js"), path.join(destDir, "add.js"));
    fs.copyFileSync(path.join(srcDir, "add.test.js"), path.join(destDir, "add.test.js"));
    for (const args of [["init", "-q"], ["add", "-A"]]) spawnSync("git", args, { cwd: dir, env: cleanEnv(dir) });
    const c = spawnSync("git", ["-c", "user.name=x", "-c", "user.email=x@x", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", "base"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" });
    assert.strictEqual(c.status, 0, c.stderr || c.stdout);
    const base = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" }).stdout.trim();
    const runTestsDecl = require("../checks/run-tests");
    const q = { entries: [], $floor: 1, base, $normalizer: runTestsDecl.NORMALIZER_DECLARATION, $dropClass: runTestsDecl.DROP_CLASS_DECLARATION, $ceilings: runTestsDecl.CEILINGS };
    fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tests", "quarantine.json"), JSON.stringify(q, null, 2));

    const RUNNER = path.join(REAL_ROOT, "scripts", "checks", "run-tests.js");
    const runFocused = () => spawnSync(process.execPath, [RUNNER, "--root", dir, "--files", "tests/mutation-demo/add.test.js"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" });

    const baseline = runFocused();
    assert.strictEqual(baseline.status, 0, `GREEN baseline failed:\n${baseline.stdout}\n${baseline.stderr}`);

    const unitFile = path.join(destDir, "add.js");
    const original = fs.readFileSync(unitFile, "utf8");
    const mutated = original.replace("return a + b;", "return a - b;");
    assert.notStrictEqual(mutated, original, "the mutation did not apply — the plant string was not found");
    fs.writeFileSync(unitFile, mutated, "utf8");

    const afterMutation = runFocused();
    assert.notStrictEqual(afterMutation.status, 0, `the Focused test did not go RED after the planted break:\n${afterMutation.stdout}\n${afterMutation.stderr}`);
    assert.match(afterMutation.stdout, /add\(2,3\) === 5/, afterMutation.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

function makeCombinedFocusedDecision(sanityFiles) {
  return {
    package: "combined-focused",
    stages: [
      { stage: 1, name: "sanity", kind: "tests", files: sanityFiles },
      { stage: 2, name: "smoke", kind: "tests", files: [] },
    ],
  };
}

test(`${FALSIFIER_ID} --differential (RED): a full-suite file the package never named, that fails on its own, is a selector_miss`, () => {
  const decision = makeCombinedFocusedDecision(["scripts/sprint/x.test.js"]);
  const listFiles = () => ["scripts/sprint/x.test.js", "scripts/sprint/y.test.js"];
  const run = (bin, args) => ({ status: args.includes("scripts/sprint/y.test.js") ? 1 : 0, stdout: "" });
  const diff = gp.runDifferential(decision, { run, listFiles, quarantine: QUARANTINE_FIXTURE });
  assert.strictEqual(diff.ok, false, JSON.stringify(diff));
  assert.deepStrictEqual(diff.selector_miss, ["scripts/sprint/y.test.js"], JSON.stringify(diff));
});

test(`${FALSIFIER_ID} --differential (GREEN): every full-suite failure is already inside the package's own file set`, () => {
  const decision = makeCombinedFocusedDecision(["scripts/sprint/x.test.js"]);
  const listFiles = () => ["scripts/sprint/x.test.js", "scripts/sprint/y.test.js"];
  const run = (bin, args) => ({ status: args.includes("scripts/sprint/x.test.js") ? 1 : 0, stdout: "" });
  const diff = gp.runDifferential(decision, { run, listFiles, quarantine: QUARANTINE_FIXTURE });
  assert.strictEqual(diff.ok, true, JSON.stringify(diff));
  assert.deepStrictEqual(diff.selector_miss, [], JSON.stringify(diff));
  assert.deepStrictEqual(diff.full_failures, ["scripts/sprint/x.test.js"]);
});

test(`${FALSIFIER_ID} --differential: a "full" package decision is vacuously GREEN (nothing to diff against itself)`, () => {
  const decision = { package: "full", stages: [{ stage: 1, name: "sanity", kind: "tests", files: "FULL_SUITE" }, { stage: 2, name: "smoke", kind: "tests", files: [] }] };
  const run = () => { throw new Error("must never be called — a full package has nothing to differential against"); };
  const listFiles = () => { throw new Error("must never be called"); };
  const diff = gp.runDifferential(decision, { run, listFiles });
  assert.strictEqual(diff.ok, true, JSON.stringify(diff));
  assert.deepStrictEqual(diff.selector_miss, []);
});

const QUARANTINE_FIXTURE = (() => {
  const decl = require("../checks/run-tests");
  const entry = (file, cause, causeLines) => ({
    file, causeLines, failCount: 1, cause, filedUnder: "ED-999434", expiry: "SP-99999999-001 (synthetic cleanup)", expiryVersion: "99.0.0",
    observedOn: { platform: "win32", nodeMajor: 24, reporter: "tap" },
  });
  const register = {
    $question: "SYNTHETIC register generated for the differential x quarantine cases; not a register for npm test.",
    $policy: "Synthetic: header fields equal the runner's declarations so it passes loadQuarantine.",
    $normalizer: decl.NORMALIZER_DECLARATION,
    $dropClass: decl.DROP_CLASS_DECLARATION,
    $ceilings: decl.CEILINGS,
    base: "c".repeat(40),
    filedUnder: "ED-999434",
    recordedAt: "2099-01-01",
    $floor: 1,
    entries: [
      entry("tests/mc/lib/provider-rca.unit.test.js", "synthetic-cause-a", ["Error: synthetic quarantined failure A"]),
      entry("tests/regression/synthetic/coverage-gate-caller.test.js", "synthetic-cause-b", ["Error: synthetic quarantined failure B"]),
    ],
  };
  const file = path.join(FIXTURES, "quarantine.synthetic.json");
  fs.writeFileSync(file, JSON.stringify(register, null, 2));
  return file;
})();
const QUARANTINED_A = "tests/mc/lib/provider-rca.unit.test.js";
const QUARANTINED_B = "tests/regression/synthetic/coverage-gate-caller.test.js";

function seedQuarantineRegister(dir, text) {
  fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tests", "quarantine.json"), text === undefined ? fs.readFileSync(QUARANTINE_FIXTURE, "utf8") : text);
}

test(`${FALSIFIER_ID} --differential x quarantine (1): a quarantined still-failing file is NOT a selector_miss, is never run, and is reported as quarantined_excluded`, () => {
  const decision = makeCombinedFocusedDecision(["scripts/sprint/x.test.js"]);
  const listFiles = () => ["scripts/sprint/x.test.js", QUARANTINED_A, QUARANTINED_B];
  const ran = [];
  const run = (bin, args) => {
    ran.push(args.filter((a) => /\.test\.js$/.test(a)).join(","));
    return { status: args.includes(QUARANTINED_A) || args.includes(QUARANTINED_B) ? 1 : 0, stdout: "" };
  };
  const diff = gp.runDifferential(decision, { run, listFiles, quarantine: QUARANTINE_FIXTURE });
  assert.strictEqual(diff.ok, true, JSON.stringify(diff));
  assert.deepStrictEqual(diff.selector_miss, [], JSON.stringify(diff));
  assert.deepStrictEqual(diff.full_failures, [], JSON.stringify(diff));
  assert.deepStrictEqual(diff.quarantined_excluded, [QUARANTINED_A, QUARANTINED_B], "excluded files must be REPORTED, never silent: " + JSON.stringify(diff));
  assert.deepStrictEqual(diff.full_files, ["scripts/sprint/x.test.js"], "the full side is the file set run-tests' primary run would execute");
  assert.strictEqual(ran.length, 1, `a quarantined file must not be run by the oracle: ${JSON.stringify(ran)}`);
});

test(`${FALSIFIER_ID} --differential x quarantine (2): a NON-quarantined failing file outside the package is still a selector_miss`, () => {
  const decision = makeCombinedFocusedDecision(["scripts/sprint/x.test.js"]);
  const listFiles = () => ["scripts/sprint/x.test.js", "scripts/sprint/y.test.js", QUARANTINED_A];
  const run = (bin, args) => ({ status: args.includes("scripts/sprint/y.test.js") || args.includes(QUARANTINED_A) ? 1 : 0, stdout: "" });
  const diff = gp.runDifferential(decision, { run, listFiles, quarantine: QUARANTINE_FIXTURE });
  assert.strictEqual(diff.ok, false, JSON.stringify(diff));
  assert.deepStrictEqual(diff.selector_miss, ["scripts/sprint/y.test.js"], "only the non-quarantined failure is a miss: " + JSON.stringify(diff));
  assert.deepStrictEqual(diff.quarantined_excluded, [QUARANTINED_A]);
});

test(`${FALSIFIER_ID} --differential x quarantine (3): a malformed / unreadable register REFUSES (halt_reason quarantine_register_unreadable) — never "no quarantine"`, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpq-"));
  try {
    const good = fs.readFileSync(QUARANTINE_FIXTURE, "utf8");
    const bad = {
      "truncated JSON": good.slice(0, Math.floor(good.length / 2)),
      "not an object": "[]",
      "missing $floor": JSON.stringify({ ...JSON.parse(good), $floor: undefined }),
      "entries not an array": JSON.stringify({ ...JSON.parse(good), entries: {} }),
    };
    const decision = makeCombinedFocusedDecision(["scripts/sprint/x.test.js"]);
    const listFiles = () => ["scripts/sprint/x.test.js", QUARANTINED_A];
    const run = () => { throw new Error("must never be called — the register is read BEFORE any test file runs"); };
    for (const [label, text] of Object.entries(bad)) {
      const f = path.join(dir, `${label.replace(/\W+/g, "-")}.json`);
      fs.writeFileSync(f, text);
      assert.throws(
        () => gp.runDifferential(decision, { run, listFiles, quarantine: f }),
        (e) => e.halt_reason === "quarantine_register_unreadable" && /quarantine/.test(e.message),
        `${label}: must refuse with halt_reason quarantine_register_unreadable`,
      );
    }
    assert.throws(
      () => gp.runDifferential(decision, { run, listFiles, quarantine: path.join(dir, "does-not-exist.json") }),
      (e) => e.halt_reason === "quarantine_register_unreadable",
      "an absent register is unreadable, never an empty one",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test(`${FALSIFIER_ID} --differential x quarantine (3b): CLI "close --differential" with a malformed register exits non-zero and says quarantine_register_unreadable`, { timeout: 60 * 1000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpdiffq-"));
  try {
    const sprint = `SP-DIFFQ-${Date.now()}`;
    const CLI = path.join(REAL_ROOT, "scripts", "sprint", "gauntlet-package.js");
    spawnSync("git", ["init", "-q"], { cwd: dir, env: cleanEnv(dir) });
    seedQuarantineRegister(dir, "{ not json");
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "scripts", "x.js"), "module.exports = 1;\n");
    spawnSync("git", ["add", "-A"], { cwd: dir, env: cleanEnv(dir) });
    spawnSync("git", ["-c", "user.name=x", "-c", "user.email=x@x", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", "base"], { cwd: dir, env: cleanEnv(dir) });
    const base = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" }).stdout.trim();
    fs.writeFileSync(path.join(dir, "scripts", "x.js"), "module.exports = 2;\n");
    spawnSync("git", ["add", "-A"], { cwd: dir, env: cleanEnv(dir) });
    spawnSync("git", ["-c", "user.name=x", "-c", "user.email=x@x", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", "change x"], { cwd: dir, env: cleanEnv(dir) });
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" }).stdout.trim();
    const trailerFile = path.join(dir, "trailer.json");
    fs.writeFileSync(trailerFile, JSON.stringify({ change: "bugfix", blast: "minor", risks: ["none"] }));
    const sel = spawnSync(process.execPath, [CLI, "select", "--sprint", sprint, "--diff", `${base}..${head}`, "--trailer-json", trailerFile, "--root", dir, "--json"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" });
    assert.strictEqual(sel.status, 0, `${sel.stdout}\n${sel.stderr}`);
    const clo = spawnSync(process.execPath, [CLI, "close", "--sprint", sprint, "--actual-ms", "1000", "--actual-dispatches", "1", "--stage-records", SKIP_ALL_RECORDS, "--root", dir, "--differential"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" });
    assert.notStrictEqual(clo.status, 0, `a malformed register must not close green: ${clo.stdout}\n${clo.stderr}`);
    assert.match(clo.stdout, /quarantine_register_unreadable/, clo.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test(`${FALSIFIER_ID} selectPackage records roster_attribution, carrying agentsForStep's matched_via onto the "full" roster`, () => {
  const decision = gp.selectPackage({
    sprint: "SP-FIXTURE-001",
    trailer: { change: "bugfix", blast: "minor", risks: ["none"] },
    composition: { unit_types: [], max_risk: "", domains: [] },
    focused: { files: ["scripts/x/unknown.js"], tests: [] },
    touchpoint: { files: [], tests: [], depth: 1, unmapped: true, unmapped_files: ["scripts/x/unknown.js"], unresolved_hits: [] },
    security: { hit: false, by: [] },
    goldenTouched: { touched: false, features: [] },
    goldenSmokeFloor: [],
    sprintOrdinal: 1,
    fullRoster: [
      { role: "qa-reviewer", mode: "block", matched_via: "unknown-open" },
      { role: "backend-reviewer", mode: "block", matched_via: "value" },
    ],
  });
  assert.strictEqual(decision.package, "full");
  assert.deepStrictEqual(
    decision.roster_attribution,
    [
      { role: "qa-reviewer", matched_via: "unknown-open" },
      { role: "backend-reviewer", matched_via: "value" },
    ],
    JSON.stringify(decision.roster_attribution),
  );
});

test(`${FALSIFIER_ID} runDifferential flags an "unknown-open" roster row as a fail_open_roster_candidate, WARN by default (ok:true)`, () => {
  const decision = {
    package: "full",
    stages: [{ stage: 1, name: "sanity", kind: "tests", files: "FULL_SUITE" }, { stage: 2, name: "smoke", kind: "tests", files: [] }],
    roster_attribution: [{ role: "qa-reviewer", matched_via: "unknown-open" }, { role: "backend-reviewer", matched_via: "value" }],
  };
  const diff = gp.runDifferential(decision, {});
  assert.deepStrictEqual(diff.fail_open_roster_candidates, ["qa-reviewer"], JSON.stringify(diff));
  assert.strictEqual(diff.ok, true, "without --strict, a fail-open candidate WARNS but never gates: " + JSON.stringify(diff));
});

test(`${FALSIFIER_ID} runDifferential BLOCKS on an "unknown-open" roster row under --strict`, () => {
  const decision = {
    package: "full",
    stages: [{ stage: 1, name: "sanity", kind: "tests", files: "FULL_SUITE" }, { stage: 2, name: "smoke", kind: "tests", files: [] }],
    roster_attribution: [{ role: "qa-reviewer", matched_via: "unknown-open" }],
  };
  const diff = gp.runDifferential(decision, { strict: true });
  assert.strictEqual(diff.ok, false, JSON.stringify(diff));
  assert.deepStrictEqual(diff.fail_open_roster_candidates, ["qa-reviewer"]);
});

test(`${FALSIFIER_ID} a decision with NO fail-open candidates is unaffected by --strict`, () => {
  const decision = makeCombinedFocusedDecision(["scripts/sprint/x.test.js"]);
  decision.roster_attribution = [{ role: "backend-reviewer", matched_via: "value" }];
  const listFiles = () => ["scripts/sprint/x.test.js"];
  const run = () => ({ status: 0, stdout: "" });
  const diff = gp.runDifferential(decision, { run, listFiles, strict: true, quarantine: QUARANTINE_FIXTURE });
  assert.strictEqual(diff.ok, true, JSON.stringify(diff));
  assert.deepStrictEqual(diff.fail_open_roster_candidates, []);
});

test(`${FALSIFIER_ID} CLI "close --differential" (no flag) BLOCKS by default on a fail-open roster candidate`, () => {
  const sprint = `SP-FIXTURE-STRICT-${Date.now()}`;
  const decision = {
    schema: gp.SCHEMA,
    sprint,
    run_id: `run-${sprint}`,
    base: "base-sha",
    head: "head-sha",
    trailer: { change: "release", blast: "major", risks: ["none"] },
    package: "full",
    cross_provider: false,
    stages: [
      { stage: 1, name: "sanity", kind: "tests", files: "FULL_SUITE" },
      { stage: 2, name: "smoke", kind: "tests", files: [] },
      { stage: 4, name: "review", kind: "agents", roster: [{ role: "qa-reviewer", passes: "all", scope: "full", mode: "block" }] },
    ],
    focused: { files: 0, tests: 0, list: [] },
    touchpoint: { files: 0, tests: 0, depth: null, map_generated_at: null, unresolved_hits: 0 },
    security: { hit: false, by: [] },
    golden_touched: false,
    budget: { wall_ms: 1000, dispatches: 1 },
    reasons: ["strict-default-test"],
    roster_attribution: [{ role: "qa-reviewer", matched_via: "unknown-open" }],
    selector_version: gp.SELECTOR_VERSION,
  };
  const emitted = gp.emitSelected(decision);
  assert.ok(emitted.ok, JSON.stringify(emitted));

  const CLI = path.join(REAL_ROOT, "scripts", "sprint", "gauntlet-package.js");
  const clo = spawnSync(process.execPath, [CLI, "close", "--sprint", sprint, "--actual-ms", "100", "--actual-dispatches", "1", "--stage-records", SKIP_ALL_RECORDS, "--differential"], { cwd: REAL_ROOT, env: cleanEnv(), encoding: "utf8" });
  assert.strictEqual(clo.status, 1, `--differential with no flag must default to strict and BLOCK: ${clo.stdout}\n${clo.stderr}`);
  assert.match(clo.stdout, /close REFUSED — halt_reason fail_open_roster/, clo.stdout);
  assert.match(clo.stderr, /fail_open_roster_candidates/, clo.stderr);
  const kinds = eventKindsFor(sprint);
  assert.ok(!kinds.includes("gauntlet-package-closed"), `a differential-failed close writes NO closed event: ${kinds}`);
  assert.ok(kinds.includes("gauntlet-package-close-refused"), `the refusal is recorded: ${kinds}`);
});

test(`${FALSIFIER_ID} CLI "close --differential --lenient" opts OUT (warn-only, exit 0) and LOGS the opt-out`, () => {
  const sprint = `SP-FIXTURE-LENIENT-${Date.now()}`;
  const decision = {
    schema: gp.SCHEMA,
    sprint,
    run_id: `run-${sprint}`,
    base: "base-sha",
    head: "head-sha",
    trailer: { change: "release", blast: "major", risks: ["none"] },
    package: "full",
    cross_provider: false,
    stages: [
      { stage: 1, name: "sanity", kind: "tests", files: "FULL_SUITE" },
      { stage: 2, name: "smoke", kind: "tests", files: [] },
      { stage: 4, name: "review", kind: "agents", roster: [{ role: "qa-reviewer", passes: "all", scope: "full", mode: "block" }] },
    ],
    focused: { files: 0, tests: 0, list: [] },
    touchpoint: { files: 0, tests: 0, depth: null, map_generated_at: null, unresolved_hits: 0 },
    security: { hit: false, by: [] },
    golden_touched: false,
    budget: { wall_ms: 1000, dispatches: 1 },
    reasons: ["lenient-opt-out-test"],
    roster_attribution: [{ role: "qa-reviewer", matched_via: "unknown-open" }],
    selector_version: gp.SELECTOR_VERSION,
  };
  const emitted = gp.emitSelected(decision);
  assert.ok(emitted.ok, JSON.stringify(emitted));

  const CLI = path.join(REAL_ROOT, "scripts", "sprint", "gauntlet-package.js");
  const clo = spawnSync(process.execPath, [CLI, "close", "--sprint", sprint, "--actual-ms", "100", "--actual-dispatches", "1", "--stage-records", SKIP_ALL_RECORDS, "--differential", "--lenient", "--lenient-reason", "alpha ruling: opt-out test"], { cwd: REAL_ROOT, env: cleanEnv(), encoding: "utf8" });
  assert.strictEqual(clo.status, 0, `--lenient must opt OUT of the new default (warn-only): ${clo.stdout}\n${clo.stderr}`);
  assert.match(clo.stdout, /lenient warn-only/, clo.stdout);
  assert.match(clo.stderr, /--lenient/, clo.stderr);

  const { query } = require("../hooks/lib/logger");
  const rows = query({ cat: "audit", search: "gauntlet-differential-lenient", limit: 50 });
  const mine = rows.filter((r) => r && r.data && r.data.sprint === sprint);
  assert.ok(mine.length > 0, "the --lenient opt-out must be LOGGED, never silent");
  assert.strictEqual(mine[0].data.lenient_reason, "alpha ruling: opt-out test", "the reason is recorded on the lenient event");
  const closedRows = query({ cat: "audit", search: "gauntlet-package-closed", limit: 200 }).filter((r) => r && r.data && r.data.sprint === sprint);
  assert.strictEqual(closedRows.length, 1);
  assert.strictEqual(closedRows[0].data.lenient_reason, "alpha ruling: opt-out test", "the reason is recorded on the closed event");
  assert.ok(closedRows[0].data.skipped_stages.length > 0, "every skipped stage is stamped on the closed event");
});

test(`${FALSIFIER_ID} CLI: "close --differential --strict" is accepted and does not break a clean real run (no candidates → exit 0)`, { timeout: 60 * 1000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-cli-differential-"));
  try {
    spawnSync("git", ["init", "-q"], { cwd: dir, env: cleanEnv(dir) });
    seedQuarantineRegister(dir);
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "scripts", "x.js"), "module.exports = 1;\n");
    spawnSync("git", ["add", "-A"], { cwd: dir, env: cleanEnv(dir) });
    spawnSync("git", ["-c", "user.name=x", "-c", "user.email=x@x", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", "base"], { cwd: dir, env: cleanEnv(dir) });
    const base = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" }).stdout.trim();
    fs.writeFileSync(path.join(dir, "scripts", "x.js"), "module.exports = 2;\n");
    spawnSync("git", ["add", "-A"], { cwd: dir, env: cleanEnv(dir) });
    spawnSync("git", ["-c", "user.name=x", "-c", "user.email=x@x", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", "change x"], { cwd: dir, env: cleanEnv(dir) });
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" }).stdout.trim();

    const trailerFile = path.join(dir, "trailer.json");
    fs.writeFileSync(trailerFile, JSON.stringify({ change: "bugfix", blast: "minor", risks: ["none"] }));
    const CLI = path.join(REAL_ROOT, "scripts", "sprint", "gauntlet-package.js");
    const sel = spawnSync(process.execPath, [CLI, "select", "--sprint", "SP-FIXTURE-002", "--diff", `${base}..${head}`, "--trailer-json", trailerFile, "--root", dir, "--json"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" });
    assert.strictEqual(sel.status, 0, `${sel.stdout}\n${sel.stderr}`);
    const decision = JSON.parse(sel.stdout);
    assert.ok(Array.isArray(decision.roster_attribution), "decision carries roster_attribution");

    const clo = spawnSync(process.execPath, [CLI, "close", "--sprint", "SP-FIXTURE-002", "--actual-ms", "1000", "--actual-dispatches", "1", "--stage-records", SKIP_ALL_RECORDS, "--root", dir, "--differential", "--strict"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" });
    assert.strictEqual(clo.status, 0, `${clo.stdout}\n${clo.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test(`${FALSIFIER_ID} --differential CLI: "close --differential" exits non-zero and records selector_miss in the gauntlet-package-closed event when the package missed a planted failure`, { timeout: 60 * 1000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpdiff-"));
  try {
    spawnSync("git", ["init", "-q"], { cwd: dir, env: cleanEnv(dir) });
    seedQuarantineRegister(dir);
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "scripts", "x.js"), "module.exports = 1;\n");
    spawnSync("git", ["add", "-A"], { cwd: dir, env: cleanEnv(dir) });
    spawnSync("git", ["-c", "user.name=x", "-c", "user.email=x@x", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", "base"], { cwd: dir, env: cleanEnv(dir) });
    const base = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" }).stdout.trim();
    fs.writeFileSync(path.join(dir, "scripts", "x.js"), "module.exports = 2;\n");
    spawnSync("git", ["add", "-A"], { cwd: dir, env: cleanEnv(dir) });
    spawnSync("git", ["-c", "user.name=x", "-c", "user.email=x@x", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", "change x"], { cwd: dir, env: cleanEnv(dir) });
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" }).stdout.trim();

    const trailerFile = path.join(dir, "trailer.json");
    fs.writeFileSync(trailerFile, JSON.stringify({ change: "bugfix", blast: "minor", risks: ["none"] }));
    const CLI = path.join(REAL_ROOT, "scripts", "sprint", "gauntlet-package.js");
    const sel = spawnSync(process.execPath, [CLI, "select", "--sprint", "SP-DIFF", "--diff", `${base}..${head}`, "--trailer-json", trailerFile, "--root", dir, "--json"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" });
    assert.strictEqual(sel.status, 0, `${sel.stdout}\n${sel.stderr}`);

    const clo = spawnSync(process.execPath, [CLI, "close", "--sprint", "SP-DIFF", "--actual-ms", "1000", "--actual-dispatches", "1", "--stage-records", SKIP_ALL_RECORDS, "--root", dir, "--differential"], { cwd: dir, env: cleanEnv(dir), encoding: "utf8" });
    assert.strictEqual(clo.status, 0, `${clo.stdout}\n${clo.stderr}`);
    assert.match(clo.stdout, /differential: no miss/, clo.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

const REPLAY = JSON.parse(fs.readFileSync(path.join(FIXTURES, "integration-flips-selection.json"), "utf8")).decision;

test(`${FALSIFIER_ID} close property: the replayed integration selection with NO records has a gap at every scheduled stage`, () => {
  const { gaps, satisfied } = gp.stageRecordGaps(REPLAY, {});
  assert.deepStrictEqual(gaps.map((g) => g.stage), [0, 1, 2, 3, 4, 5], JSON.stringify(gaps));
  assert.deepStrictEqual(satisfied, []);
  assert.match(gaps.find((g) => g.stage === 4).why, /qa-reviewer \(no-record\), security-reviewer \(no-record\)/);
});

test(`${FALSIFIER_ID} close property: an agents stage is recorded only when EVERY roster role is satisfied`, () => {
  const roles = { "qa-reviewer": { satisfied: true, status: "ran" }, "security-reviewer": { satisfied: false, status: "failed" } };
  const { gaps } = gp.stageRecordGaps(REPLAY, { roles });
  const s4 = gaps.find((g) => g.stage === 4);
  assert.ok(s4 && /security-reviewer \(failed\)/.test(s4.why) && !/qa-reviewer/.test(s4.why), JSON.stringify(s4));
  assert.ok(gaps.some((g) => g.stage === 5), "stage 5 names security-reviewer too");
});

test(`${FALSIFIER_ID} close property: an explicit skip needs a non-empty reason; with one it is recorded and named`, () => {
  const blank = gp.stageRecordGaps(REPLAY, { stages: { 4: { skip: "  " } } });
  assert.match(blank.gaps.find((g) => g.stage === 4).why, /non-empty reason/);
  const given = gp.stageRecordGaps(REPLAY, { stages: { 4: { skip: "operator-waived: reason recorded", operator_ack: "alpha ruling X" } } });
  assert.ok(!given.gaps.some((g) => g.stage === 4));
  assert.strictEqual(given.satisfied.find((s) => s.stage === 4).by, "skip: operator-waived: reason recorded");
  assert.strictEqual(given.satisfied.find((s) => s.stage === 4).skipped, true);
});

test(`${FALSIFIER_ID} a skip of an AGENTS stage without operator_ack is a gap; a tests/mechanical skip needs only a reason; skips are flagged`, () => {
  const noAck = gp.stageRecordGaps(REPLAY, { stages: { 4: { skip: "trust me" }, 5: { skip: "trust me", operator_ack: "   " } } });
  assert.match(noAck.gaps.find((g) => g.stage === 4).why, /operator_ack/);
  assert.match(noAck.gaps.find((g) => g.stage === 5).why, /operator_ack/);
  const testsSkip = gp.stageRecordGaps(REPLAY, { stages: { 1: { skip: "fixture" } } });
  assert.ok(!testsSkip.gaps.some((g) => g.stage === 1), "a tests-stage skip needs only a reason");
  assert.strictEqual(testsSkip.satisfied.find((s) => s.stage === 1).skipped, true);
});

test(`${FALSIFIER_ID} CLI: a close skipping an agents stage with no operator_ack is REFUSED; with one it closes and stamps skipped_stages`, () => {
  const { sprint, dir } = replaySetup("SP-SKIP-AGENTS");
  try {
    const mk = (name, stage45) => {
      const stages = {};
      for (const n of [0, 1, 2, 3]) stages[String(n)] = { evidence: `stage-${n}.log`, exit: 0 };
      stages["4"] = stage45;
      stages["5"] = stage45;
      const f = path.join(dir, name);
      fs.writeFileSync(f, JSON.stringify({ stages }));
      return f;
    };
    const CLI = path.join(REAL_ROOT, "scripts", "sprint", "gauntlet-package.js");
    const run = (f) => spawnSync(process.execPath, [CLI, "close", "--sprint", sprint, "--actual-ms", "1", "--actual-dispatches", "0", "--stage-records", f], { cwd: REAL_ROOT, env: cleanEnv(), encoding: "utf8" });
    const refused = run(mk("noack.json", { skip: "waive review" }));
    assert.strictEqual(refused.status, 1, `${refused.stdout}\n${refused.stderr}`);
    assert.match(refused.stderr, /operator_ack/, refused.stderr);
    assert.ok(!eventKindsFor(sprint).includes("gauntlet-package-closed"));
    const ok = run(mk("ack.json", { skip: "waive review", operator_ack: "alpha ruling test" }));
    assert.strictEqual(ok.status, 0, `${ok.stdout}\n${ok.stderr}`);
    const { query } = require("../hooks/lib/logger");
    const closed = query({ cat: "audit", search: "gauntlet-package-closed", limit: 200 }).filter((r) => r && r.data && r.data.sprint === sprint);
    assert.strictEqual(closed.length, 1);
    assert.deepStrictEqual(closed[0].data.skipped_stages.map((s) => s.stage), [4, 5]);
    assert.strictEqual(closed[0].data.skipped_stages[0].operator_ack, "alpha ruling test");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test(`${FALSIFIER_ID} CLI: a close without --actual-ms / --actual-dispatches, or with negative/non-integer ones, is a usage error (exit 2)`, () => {
  const { sprint, dir, recordsFile } = replaySetup("SP-ACTUALS");
  try {
    const CLI = path.join(REAL_ROOT, "scripts", "sprint", "gauntlet-package.js");
    const run = (...a) => spawnSync(process.execPath, [CLI, "close", "--sprint", sprint, "--stage-records", recordsFile, ...a], { cwd: REAL_ROOT, env: cleanEnv(), encoding: "utf8" });
    for (const args of [[], ["--actual-ms", "5"], ["--actual-dispatches", "1"], ["--actual-ms", "-1", "--actual-dispatches", "1"], ["--actual-ms", "1.5", "--actual-dispatches", "1"], ["--actual-ms", "1", "--actual-dispatches", "x"]]) {
      const r = run(...args);
      assert.strictEqual(r.status, 2, `${JSON.stringify(args)} must be a usage error: ${r.stdout}\n${r.stderr}`);
      assert.match(r.stderr, /non-negative integer/, r.stderr);
    }
    assert.deepStrictEqual(eventKindsFor(sprint).filter((k) => /closed|refused/.test(k)), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test(`${FALSIFIER_ID} CLI: --lenient without --lenient-reason is refused (usage error), writes nothing`, () => {
  const { sprint, dir, recordsFile } = replaySetup("SP-LENIENT-NOREASON");
  try {
    const CLI = path.join(REAL_ROOT, "scripts", "sprint", "gauntlet-package.js");
    const r = spawnSync(process.execPath, [CLI, "close", "--sprint", sprint, "--actual-ms", "1", "--actual-dispatches", "0", "--stage-records", recordsFile, "--differential", "--lenient"], { cwd: REAL_ROOT, env: cleanEnv(), encoding: "utf8" });
    assert.strictEqual(r.status, 2, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /--lenient requires a non-empty --lenient-reason/, r.stderr);
    assert.deepStrictEqual(eventKindsFor(sprint).filter((k) => /closed|refused|lenient/.test(k)), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test(`${FALSIFIER_ID} MC_GAUNTLET_REQUIRE_SIG=0 does NOT let an unsigned completion record satisfy the close`, () => {
  const { sprint, dir, recordsFile } = replaySetup("SP-NOSIG-ENV");
  try {
    const { PATHS } = require("../hooks/lib/paths");
    fs.mkdirSync(path.dirname(PATHS.dispatchCompletionsFile), { recursive: true });
    for (const role of ["qa-reviewer", "security-reviewer"]) {
      fs.appendFileSync(PATHS.dispatchCompletionsFile, JSON.stringify({ role, ok: true, provider: "claude", sprint_id: sprint, completed_at: new Date().toISOString() }) + "\n");
    }
    const CLI = path.join(REAL_ROOT, "scripts", "sprint", "gauntlet-package.js");
    const env = cleanEnv();
    env.MC_GAUNTLET_REQUIRE_SIG = "0";
    const clo = spawnSync(process.execPath, [CLI, "close", "--sprint", sprint, "--actual-ms", "1", "--actual-dispatches", "2", "--stage-records", recordsFile], { cwd: REAL_ROOT, env, encoding: "utf8" });
    assert.strictEqual(clo.status, 1, `${clo.stdout}\n${clo.stderr}`);
    assert.match(clo.stdout, /stage_without_record/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test(`${FALSIFIER_ID} close property: a stage the DECISION left empty is satisfied by the decision, an unknown kind is a gap`, () => {
  const d = JSON.parse(JSON.stringify(REPLAY));
  d.stages = [
    { stage: 2, name: "smoke", kind: "tests", files: [] },
    { stage: 5, name: "security-deep", kind: "agents", roster: [] },
    { stage: 9, name: "mystery", kind: "telepathy" },
  ];
  const { gaps, satisfied } = gp.stageRecordGaps(d, {});
  assert.deepStrictEqual(satisfied.map((s) => s.by), ["decision: no test files scheduled", "decision: no agent scheduled (empty roster)"]);
  assert.deepStrictEqual(gaps.map((g) => [g.stage, g.why]), [[9, "unknown stage kind 'telepathy'"]]);
});

test(`${FALSIFIER_ID} close property: file evidence must exist, be non-empty and carry exit 0; the sha256 is recorded`, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-evidence-"));
  try {
    fs.writeFileSync(path.join(dir, "ok.log"), "run-tests: PASS\n");
    fs.writeFileSync(path.join(dir, "empty.log"), "");
    const s = { stage: 1, name: "sanity", kind: "tests", files: "FULL_SUITE" };
    assert.match(gp.fileEvidence(s, undefined, dir).why, /no stage record/);
    assert.match(gp.fileEvidence(s, { evidence: "ok.log", exit: 1 }, dir).why, /exit is 1, not 0/);
    assert.match(gp.fileEvidence(s, { evidence: "missing.log", exit: 0 }, dir).why, /unreadable/);
    assert.match(gp.fileEvidence(s, { evidence: "empty.log", exit: 0 }, dir).why, /empty/);
    const good = gp.fileEvidence(s, { evidence: "ok.log", exit: 0 }, dir);
    assert.strictEqual(good.ok, true);
    assert.match(good.by, /sha256 [0-9a-f]{64}/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

function replaySetup(label) {
  const sprint = `${label}-${Date.now()}`;
  const decision = { ...JSON.parse(JSON.stringify(REPLAY)), sprint, run_id: `run-${sprint}` };
  const emitted = gp.emitSelected(decision);
  assert.ok(emitted.ok, JSON.stringify(emitted));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-replay-"));
  const stages = {};
  for (const n of [0, 1, 2, 3]) {
    fs.writeFileSync(path.join(dir, `stage-${n}.log`), `stage ${n}: exit 0\n`);
    stages[String(n)] = { evidence: `stage-${n}.log`, exit: 0 };
  }
  const recordsFile = path.join(dir, "stage-records.json");
  fs.writeFileSync(recordsFile, JSON.stringify({ stages }));
  return { sprint, dir, recordsFile };
}

function eventKindsFor(sprint) {
  const { query } = require("../hooks/lib/logger");
  return query({ cat: "audit", search: sprint, limit: 200 })
    .filter((r) => r && r.data && r.data.sprint === sprint)
    .map((r) => r.data.kind);
}

test(`${FALSIFIER_ID} RED replay: the recorded integration selection, stages 0-3 recorded and 0 dispatches, is REFUSED at stages 4 and 5`, () => {
  const { sprint, dir, recordsFile } = replaySetup("SP-REPLAY-RED");
  try {
    const CLI = path.join(REAL_ROOT, "scripts", "sprint", "gauntlet-package.js");
    const clo = spawnSync(process.execPath, [CLI, "close", "--sprint", sprint, "--actual-ms", "75000", "--actual-dispatches", "0", "--stage-records", recordsFile], { cwd: REAL_ROOT, env: cleanEnv(), encoding: "utf8" });
    assert.strictEqual(clo.status, 1, `a close with unrecorded stages must refuse: ${clo.stdout}\n${clo.stderr}`);
    assert.match(clo.stdout, /close REFUSED — halt_reason stage_without_record: 2 of 6 scheduled stage\(s\) unrecorded \(stage 4, 5\)/, clo.stdout);
    assert.match(clo.stderr, /stage 4 \(review, agents\) has no record — no completion record for qa-reviewer \(no-record\), security-reviewer \(no-record\)/, clo.stderr);
    const kinds = eventKindsFor(sprint);
    assert.ok(!kinds.includes("gauntlet-package-closed"), `a refused close writes NO closed event: ${kinds}`);
    assert.ok(kinds.includes("gauntlet-package-close-refused"), `the refusal is recorded: ${kinds}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test(`${FALSIFIER_ID} GREEN replay: the same selection closes once signed completion records exist for every scheduled role`, () => {
  const { sprint, dir, recordsFile } = replaySetup("SP-REPLAY-GREEN");
  try {
    const { signRecord } = require("../dispatch/attest-signing");
    const { PATHS } = require("../hooks/lib/paths");
    const ledger = PATHS.dispatchCompletionsFile;
    assert.ok(require("../lib/hermetic-events-home").inside(EVENTS_HOME, ledger), `the completion ledger must be the temp project's: ${ledger}`);
    fs.mkdirSync(path.dirname(ledger), { recursive: true });
    for (const role of ["qa-reviewer", "security-reviewer"]) {
      const rec = { role, ok: true, provider: "claude", model: "claude-opus-5", sprint_id: sprint, completed_at: new Date().toISOString(), tool_id: "fixture", cmdline_checksum: "fixture" };
      rec.attest_sig = signRecord(rec);
      fs.appendFileSync(ledger, JSON.stringify(rec) + "\n");
    }
    const CLI = path.join(REAL_ROOT, "scripts", "sprint", "gauntlet-package.js");
    const clo = spawnSync(process.execPath, [CLI, "close", "--sprint", sprint, "--actual-ms", "75000", "--actual-dispatches", "2", "--stage-records", recordsFile], { cwd: REAL_ROOT, env: cleanEnv(), encoding: "utf8" });
    assert.strictEqual(clo.status, 0, `${clo.stdout}\n${clo.stderr}`);
    assert.match(clo.stdout, /closed "full" — within budget/, clo.stdout);
    const { query } = require("../hooks/lib/logger");
    const closed = query({ cat: "audit", search: "gauntlet-package-closed", limit: 200 }).filter((r) => r && r.data && r.data.sprint === sprint);
    assert.strictEqual(closed.length, 1);
    assert.deepStrictEqual(closed[0].data.stage_records.map((s) => s.stage), [0, 1, 2, 3, 4, 5]);
    assert.match(closed[0].data.stage_records.find((s) => s.stage === 4).by, /completion records: qa-reviewer, security-reviewer/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test(`${FALSIFIER_ID} close property: an UNSIGNED completion record does not satisfy a stage (the release gate's reader)`, () => {
  const { sprint, dir, recordsFile } = replaySetup("SP-REPLAY-UNSIGNED");
  try {
    const { PATHS } = require("../hooks/lib/paths");
    fs.mkdirSync(path.dirname(PATHS.dispatchCompletionsFile), { recursive: true });
    for (const role of ["qa-reviewer", "security-reviewer"]) {
      fs.appendFileSync(PATHS.dispatchCompletionsFile, JSON.stringify({ role, ok: true, provider: "claude", sprint_id: sprint, completed_at: new Date().toISOString() }) + "\n");
    }
    const CLI = path.join(REAL_ROOT, "scripts", "sprint", "gauntlet-package.js");
    const clo = spawnSync(process.execPath, [CLI, "close", "--sprint", sprint, "--actual-ms", "1", "--actual-dispatches", "2", "--stage-records", recordsFile], { cwd: REAL_ROOT, env: cleanEnv(), encoding: "utf8" });
    assert.strictEqual(clo.status, 1, `${clo.stdout}\n${clo.stderr}`);
    assert.match(clo.stdout, /stage_without_record/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test(`${FALSIFIER_ID} close property: a malformed --stage-records file REFUSES the close (never read as "no records")`, () => {
  const { sprint, dir } = replaySetup("SP-REPLAY-MALFORMED");
  try {
    const bad = path.join(dir, "bad.json");
    fs.writeFileSync(bad, JSON.stringify({ stages: [] }));
    const CLI = path.join(REAL_ROOT, "scripts", "sprint", "gauntlet-package.js");
    const clo = spawnSync(process.execPath, [CLI, "close", "--sprint", sprint, "--actual-ms", "1", "--actual-dispatches", "0", "--stage-records", bad], { cwd: REAL_ROOT, env: cleanEnv(), encoding: "utf8" });
    assert.strictEqual(clo.status, 1, `${clo.stdout}\n${clo.stderr}`);
    assert.match(clo.stderr, /stage records unreadable/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});


test(`${FALSIFIER_ID} floor: absent project file -> loadGoldenPaths returns exactly the FLOOR (and no features)`, () => {
  const g = gp.loadGoldenPaths(SECURITY_ROOT);
  assert.deepStrictEqual(g.security_surface_globs, [...gp.SECURITY_SURFACE_FLOOR]);
  assert.deepStrictEqual(g.features, []);
  assert.ok(g.security_surface_globs.length > 0);
});

const FORWARD_LOOKING = new Map([
  [".github/workflows/**", "CI workflows — populated only after operator CI activation; the un-activated public seed carries none"],
  ["tests/**", "top-level test/falsifier corpus — the public emit carries tests beside their scripts, no tests/ dir; arms if one appears"],
  [".claude/framework-installed.json", "install-state manifest — written by an install/update on a downstream project, not shipped in the emit"],
]);

test(`${FALSIFIER_ID} floor: every floor glob matches >= 1 file in THIS (emitted/clone) tree`, () => {
  const tracked = spawnSync("git", ["ls-files"], { cwd: REAL_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.strictEqual(tracked.status, 0, "git ls-files must work in the repo/clone root");
  const files = tracked.stdout.split(String.fromCharCode(10)).map((l) => l.trim()).filter(Boolean);
  const dead = gp.SECURITY_SURFACE_FLOOR.filter((g) => !FORWARD_LOOKING.has(g)).filter((g) => { const re = touchpoint.globToRegExp(g); return !files.some((f) => re.test(f)); });
  assert.deepStrictEqual(dead, [], `floor glob(s) matching zero files in the emitted tree: ${dead.join(", ")}`);
});

test(`${FALSIFIER_ID} floor: forward-looking globs STAY in the floor and are explicitly allowlisted`, () => {
  for (const [g, why] of FORWARD_LOOKING) {
    assert.ok(gp.SECURITY_SURFACE_FLOOR.includes(g), `forward-looking glob missing from floor: ${g}`);
    assert.ok(why && why.length > 10, `forward-looking glob needs a documented reason: ${g}`);
  }
});

test(`${FALSIFIER_ID} floor: completeness — each security-critical surface escalates with NO project file; control does not`, () => {
  const goldenPaths = gp.loadGoldenPaths(SECURITY_ROOT);
  for (const f of [".claude/agents/some-agent.md", ".claude/agents/_org/role-registry.json", "framework/paths.registry.json", "scripts/hooks/hook-manifest.json", ".gitignore", "tests/some/falsifier.test.js", ".github/workflows/ci.yml", ".claude/paths.json", ".claude/manifest.json", ".claude/framework-manifest.json", ".claude/framework-installed.json"]) {
    const r = touchpoint.securitySurfaceHit({ files: [f], risks: ["none"], goldenPaths });
    assert.strictEqual(r.hit, true, `${f} must be a securitySurfaceHit: ${JSON.stringify(r)}`);
  }
  assert.strictEqual(touchpoint.securitySurfaceHit({ files: ["docs/readme-note.md"], risks: ["none"], goldenPaths }).hit, false);
});

test(`${FALSIFIER_ID} floor: malformed feature ENTRIES and empty/non-string globs are REFUSED (depth) and the selector fails SAFE`, () => {
  const good = { id: "x", name: "X", entry: ["src/x.js"], golden_path: "x works.", smoke_tests: [], security_surface: false };
  const bads = [
    { features: [{}] }, { features: [{ id: 123 }] }, { features: [null] }, { features: ["x"] },
    { features: [{ ...good, id: "" }] }, { features: [{ ...good, name: undefined }] },
    { features: [{ ...good, entry: [] }] }, { features: [{ ...good, entry: [""] }] },
    { schema: "mc/golden-paths/v1", features: [{ ...good, smoke_tests: "a" }] }, { schema: "mc/golden-paths/v1", features: [{ ...good, security_surface: "no" }] },
    { schema: "mc/golden-paths/v1", security_surface_globs: [""] }, { schema: "mc/golden-paths/v1", security_surface_globs: [null] }, { schema: "mc/golden-paths/v1", security_surface_globs: [123] }, { schema: "mc/golden-paths/v1", security_surface_globs: ["  "] },
    { schema: "mc/golden-paths/v2", features: [] }, { schema: "other", features: [] }, { schema: 1, features: [] },
    { features: [] }, { features: [good] }, { security_surface_globs: [] },
    { schema: "mc/golden-paths/v1", security_surface_globs: ["/etc/**"] },
    { schema: "mc/golden-paths/v1", security_surface_globs: ["D:/data/**"] },
    { schema: "mc/golden-paths/v1", security_surface_globs: ["../outside/**"] },
    { schema: "mc/golden-paths/v1", security_surface_globs: ["a/../../b/**"] },
    { schema: "mc/golden-paths/v1", features: [{ ...good, entry: ["../src/x.js"] }] },
    { schema: "mc/golden-paths/v1", features: [{ ...good, entry: ["src/x.js", "../../etc/y.js"] }] },
    { schema: "mc/golden-paths/v1", features: [{ ...good, entry: ["/abs/x.js"] }] },
    { schema: "mc/golden-paths/v1", features: [{ ...good, entry: ["C:/win/x.js"] }] },
    { schema: "mc/golden-paths/v1", features: [{ ...good, smoke_tests: ["../tests/x.test.js"] }] },
    { schema: "mc/golden-paths/v1", features: [{ ...good, smoke_tests: ["a/../../b.test.js"] }] },
  ];
  for (const b of bads) {
    const root = mkRoot(JSON.stringify(b));
    assert.throws(() => gp.loadGoldenPaths(root), (e) => e instanceof gp.GoldenPathsMalformedError && e.code === "golden_paths_malformed", `not refused: ${JSON.stringify(b)}`);
    const r = require("./full").resolveGauntletDecision("SP-TEST-999", { unit_types: [], max_risk: "", domains: [] }, { root });
    assert.strictEqual(r.decision, null, `must fail safe: ${JSON.stringify(b)}`);
  }
  assert.doesNotThrow(() => gp.loadGoldenPaths(mkRoot(JSON.stringify({ schema: "mc/golden-paths/v1", features: [good] }))));
});

test(`${FALSIFIER_ID} floor: a fresh-install diff (no project file) touching a security glob IS a securitySurfaceHit`, () => {
  const goldenPaths = gp.loadGoldenPaths(SECURITY_ROOT);
  const r = touchpoint.securitySurfaceHit({ files: ["scripts/hooks/secret-guard.js"], risks: ["none"], goldenPaths });
  assert.strictEqual(r.hit, true, JSON.stringify(r));
  const miss = touchpoint.securitySurfaceHit({ files: ["docs/readme-note.md"], risks: ["none"], goldenPaths });
  assert.strictEqual(miss.hit, false, JSON.stringify(miss));
});

test(`${FALSIFIER_ID} floor: a project file that OMITS scripts/hooks/** cannot narrow below the floor (union)`, () => {
  const root = mkRoot(JSON.stringify({ schema: "mc/golden-paths/v1", features: [], security_surface_globs: ["only/this/**"] }));
  const goldenPaths = gp.loadGoldenPaths(root);
  assert.ok(goldenPaths.security_surface_globs.includes("only/this/**"), "project globs are added");
  for (const g of gp.SECURITY_SURFACE_FLOOR) assert.ok(goldenPaths.security_surface_globs.includes(g), `floor glob dropped: ${g}`);
  assert.strictEqual(touchpoint.securitySurfaceHit({ files: ["scripts/hooks/secret-guard.js"], risks: ["none"], goldenPaths }).hit, true);
  assert.strictEqual(touchpoint.securitySurfaceHit({ files: ["only/this/x.js"], risks: ["none"], goldenPaths }).hit, true);
});

test(`${FALSIFIER_ID} floor: a MALFORMED project file is REFUSED (named error) and the selector fails SAFE — never empty globs`, () => {
  for (const bad of ["{ not json", "[]", "null", JSON.stringify({ features: "x" }), JSON.stringify({ security_surface_globs: "scripts/**" }), JSON.stringify({ security_surface_globs: [1] })]) {
    const root = mkRoot(bad);
    assert.throws(() => gp.loadGoldenPaths(root), (e) => e instanceof gp.GoldenPathsMalformedError && e.name === "GoldenPathsMalformedError" && e.code === "golden_paths_malformed", `not refused: ${bad}`);
    assert.throws(() => gp.assembleInput({ root, trailer: { change: "bugfix", blast: "minor", risks: ["none"] }, base: "aaaaaaa", head: "bbbbbbb" }), (e) => e instanceof gp.GoldenPathsMalformedError);
  }
  const full = require("./full");
  const root = mkRoot("{ not json");
  const git = (...a) => cp.execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...a], { cwd: root, encoding: "utf8", windowsHide: true });
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(root, "a.txt"), "a\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "work");
  fs.writeFileSync(path.join(root, "b.txt"), "b\n");
  git("add", "b.txt");
  git("commit", "-q", "-m", "work\n\nChange: bugfix\nBlast: minor\nRisks: none");
  const r = full.resolveGauntletDecision("SP-TEST-999", { unit_types: [], max_risk: "", domains: [], change: "bugfix", blast: "minor", risks: ["none"] }, { root });
  assert.strictEqual(r.decision, null, "a malformed golden-paths must never yield a (narrower) decision");
  assert.match(String(r.error), /golden-paths\.json present but not valid JSON/, `must fail on the MALFORMED golden-paths cause, not a git/trailer failure: ${r.error}`);
  assert.doesNotMatch(String(r.error), /no_base|trailer|git|not a git repository/i, `a git/trailer failure means the malformed path was never reached: ${r.error}`);
});

test(`${FALSIFIER_ID} floor: the CLI select/explain on a MALFORMED golden-paths prints HALT on stdout + exits 2 (no stack trace)`, { timeout: 60 * 1000 }, () => {
  const root = mkRoot("{ not json");
  const trailerFile = path.join(root, "trailer.json");
  fs.writeFileSync(trailerFile, JSON.stringify({ change: "bugfix", blast: "minor", risks: ["none"] }));
  for (const cmd of ["select", "explain"]) {
    const res = cp.spawnSync(process.execPath, [path.join(__dirname, "gauntlet-package.js"), cmd, "--sprint", "SP-TEST-999", "--diff", "aaaaaaa..bbbbbbb", "--trailer-json", trailerFile, "--root", root], { encoding: "utf8", windowsHide: true });
    assert.strictEqual(res.status, 2, `${cmd}: exit 2 expected, got ${res.status}\n${res.stdout}\n${res.stderr}`);
    assert.match(res.stdout, /gauntlet-package: HALT — golden_paths_malformed/, `${cmd}: HALT line on stdout\n${res.stdout}`);
    assert.doesNotMatch(res.stderr, /\n\s+at /, `${cmd}: no stack trace`);
  }
});

test(`${FALSIFIER_ID} floor: the project file still governs FEATURES; the floor only adds to security_surface_globs`, () => {
  const feat = { id: "x-feature", name: "X", entry: ["src/x.js"], golden_path: "x works", smoke_tests: ["src/x.test.js"], security_surface: false };
  const root = mkRoot(JSON.stringify({ schema: "mc/golden-paths/v1", features: [feat], security_surface_globs: [] }));
  const g = gp.loadGoldenPaths(root);
  assert.deepStrictEqual(g.features, [feat]);
  assert.deepStrictEqual(g.security_surface_globs, [...gp.SECURITY_SURFACE_FLOOR]);
  assert.deepStrictEqual(gp.loadGoldenPaths(SECURITY_ROOT).features, []);
});
