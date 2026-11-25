#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");

const ROOT = path.resolve(__dirname, "..", "..");
const { scanSource, buildRequireGraph } = require("../maps/require-graph");
const { touchpointClosure, dynamicHintMatches } = require("./touchpoint");

let passes = 0;
let failures = 0;
const skips = [];
const SKIP = (reason) => Object.assign(new Error(reason), { isSkip: true });
function t(name, fn) {
  try {
    fn();
    passes++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    if (e && e.isSkip) {
      skips.push(`${name}: ${e.message}`);
      console.log(`  SKIP ${name}\n       ${e.message}`);
      return;
    }
    failures++;
    console.log(`  FAIL ${name}\n       ${(e && e.message) || e}`);
  }
}

console.log("lexer");
t("literal relative requires are captured; comments/strings/templates are not", () => {
  const src = [
    'const a = require("./a");',
    "// const b = require('./b');",
    "/* require('./c') */",
    'const s = "require(\'./d\')";',
    "const tpl = `require('./e') ${1}`;",
    "const f = require( './f' ); const g = obj.require('./g');",
    "const h = require.resolve('./h');",
  ].join("\n");
  const { requires } = scanSource(src);
  assert.deepStrictEqual(requires.map((r) => r.spec), ["./a", "./f"]);
});
t("dynamic require sites are recorded with expr + line, never resolved", () => {
  const src = 'const x = 1;\nconst m = require(path.join(root, "scripts", "x"));\nconst n = require(`./mod/${name}`);\n';
  const { requires } = scanSource(src);
  assert.strictEqual(requires.length, 2);
  assert.ok(requires.every((r) => r.kind === "dynamic"));
  assert.strictEqual(requires[0].line, 2);
  assert.ok(requires[0].expr.includes('"scripts"'));
  assert.strictEqual(requires[1].line, 3);
});
t("a quote inside a regex literal does not swallow a following require", () => {
  const src = 'const re = /["\']/g;\nconst a = require("./after");\n';
  const { requires } = scanSource(src);
  assert.deepStrictEqual(requires.map((r) => r.spec), ["./after"]);
});
t("PATHS.<key> in a comment is not present in the code view", () => {
  const { code } = scanSource("// PATHS.ghostKey\nconst k = PATHS.realKey;\n");
  assert.ok(!code.includes("ghostKey"));
  assert.ok(code.includes("realKey"));
});

console.log("real-repo graph");
const graph = buildRequireGraph(ROOT);
const reqEdge = (from, to) => graph.edges.some((e) => e.kind === "require" && e.from === from && e.to === to);

t("every static relative require resolves (missing[] empty)", () => {
  const unexpected = graph.missing.filter((m) => !/(^|\/)open-source\/[^/]+$/.test(String(m.spec)));
  assert.strictEqual(unexpected.length, 0, JSON.stringify(unexpected.slice(0, 3)));
  assert.ok(graph.counts.filesScanned > 500, `scanned ${graph.counts.filesScanned}`);
});
t("5 known require edges", () => {
  assert.ok(reqEdge("scripts/sprint/epsilon-runtime.js", "scripts/sprint/hook-points.js"));
  assert.ok(reqEdge("scripts/sprint/hook-points.js", "scripts/hooks/lib/paths.js"));
  assert.ok(reqEdge("scripts/sprint/full.js", "scripts/sprint/hook-points.js"));
  assert.ok(reqEdge("scripts/sprint/hook-consult.js", "scripts/sprint/hook-points.js"));
  assert.ok(reqEdge("scripts/sprint/full.js", "scripts/sprint/epsilon-runtime.js"));
});
t("edges are not invented (hook-points does not require full)", () => {
  assert.ok(!reqEdge("scripts/sprint/hook-points.js", "scripts/sprint/full.js"));
});
t("epsilon-runtime's dynamic registry-roles require is in unresolved[]", () => {
  const hit = graph.unresolved.find(
    (u) => u.file === "scripts/sprint/epsilon-runtime.js" && /registry-roles/.test(u.expr) && /path\.join/.test(u.expr),
  );
  assert.ok(hit, "registry-roles dynamic site missing from unresolved[]");
  assert.ok(hit.line > 0);
});
t("paths-consumer edge — PATHS.sprintHookPoints user points at the registry file", () => {
  assert.ok(
    graph.edges.some(
      (e) =>
        e.kind === "paths-consumer" &&
        e.from === "scripts/sprint/hook-points.js" &&
        e.to === ".claude/agents/_org/sprint-hook-points.json" &&
        e.key === "sprintHookPoints",
    ),
  );
});
t("hook-wiring edges come from the hooks registry to the script", () => {
  const w = graph.edges.filter((e) => e.kind === "hook-wiring");
  assert.ok(w.length > 10, `only ${w.length} hook-wiring edges`);
  assert.ok(w.every((e) => e.from === "framework/hooks.registry.json"));
  assert.ok(w.some((e) => e.to === "scripts/hooks/session-start.js"));
});
t("skill calls / called_by imported from the skills map", () => {
  if (!graph.sources.skillsMap) throw SKIP("requires the instance skills map (.claude/project/maps/skills.jsonl) — skipped on a fresh install");
  const s = graph.edges.filter((e) => e.kind === "skill-call");
  assert.ok(s.length > 0, "no skill-call edges (skills.jsonl missing?)");
  assert.ok(s.some((e) => e.from.startsWith(".claude/commands/") && e.to.startsWith(".claude/commands/")));
});
t("freshness fields generatedAt + head are present", () => {
  assert.ok(!Number.isNaN(Date.parse(graph.generatedAt)));
  assert.ok(/^[0-9a-f]{40}$/.test(graph.head), `head=${graph.head}`);
  assert.strictEqual(graph.schema, "mc/require-graph/v1");
});

console.log("touchpointClosure");
t("depth-1 closure of hook-points.js includes epsilon-runtime, full, hook-consult", () => {
  const r = touchpointClosure(["scripts/sprint/hook-points.js"], { depth: 1, graph });
  assert.strictEqual(r.unmapped, false);
  for (const f of ["scripts/sprint/epsilon-runtime.js", "scripts/sprint/full.js", "scripts/sprint/hook-consult.js"]) {
    assert.ok(r.files.includes(f), `${f} missing from ${r.files.length} files`);
  }
  assert.ok(!r.files.includes("scripts/sprint/hook-points.js"), "changed file must not be listed as touched");
  assert.ok(r.tests.every((f) => /test/.test(f)));
  assert.ok(r.edges_used.some((e) => e.kind === "require" && e.to === "scripts/sprint/hook-points.js"));
});
t("default depth is 1; depth 0 reaches nothing; depth 2 reaches strictly more", () => {
  const d1 = touchpointClosure(["scripts/sprint/hook-points.js"], { graph });
  const d0 = touchpointClosure(["scripts/sprint/hook-points.js"], { depth: 0, graph });
  const d2 = touchpointClosure(["scripts/sprint/hook-points.js"], { depth: 2, graph });
  assert.strictEqual(d1.depth, 1);
  assert.deepStrictEqual(d0.files, []);
  assert.strictEqual(d0.unmapped, false, "empty closure for a KNOWN file is not unmapped");
  assert.ok(d2.files.length > d1.files.length);
  for (const f of d1.files) assert.ok(d2.files.includes(f));
});
t("changing the registry file reaches its PATHS consumer", () => {
  const r = touchpointClosure([".claude/agents/_org/sprint-hook-points.json"], { graph });
  assert.strictEqual(r.unmapped, false);
  assert.ok(r.files.includes("scripts/sprint/hook-points.js"));
  assert.ok(r.edges_used.some((e) => e.kind === "paths-consumer" && e.key === "sprintHookPoints"));
});
t("changing a hook script reaches the hooks registry; changing the registry reaches its scripts", () => {
  const a = touchpointClosure(["scripts/hooks/session-start.js"], { graph });
  assert.ok(a.files.includes("framework/hooks.registry.json"));
  const b = touchpointClosure(["framework/hooks.registry.json"], { graph });
  assert.ok(b.files.includes("scripts/hooks/session-start.js"));
});
t("a called skill's closure includes its caller", () => {
  if (!graph.sources.skillsMap) throw SKIP("requires the instance skills map (.claude/project/maps/skills.jsonl) — skipped on a fresh install");
  const e = graph.edges.find((x) => x.kind === "skill-call" && x.to.endsWith(".md"));
  assert.ok(e, "no skill→skill edge");
  const r = touchpointClosure([e.to], { graph });
  assert.ok(r.files.includes(e.from));
});
t("closure result carries the map freshness (map_generated_at, map_head)", () => {
  const r = touchpointClosure(["scripts/sprint/hook-points.js"], { graph });
  assert.strictEqual(r.map_generated_at, graph.generatedAt);
  assert.strictEqual(r.map_head, graph.head);
  assert.strictEqual(r.graph_ok, true);
});
t("dynamic require hint: changing registry-roles.js surfaces epsilon-runtime's dynamic site", () => {
  const r = touchpointClosure(["scripts/dispatch/registry-roles.js"], { graph });
  const hint = r.unresolved_hits.find((h) => h.reason === "name-match" && h.file === "scripts/sprint/epsilon-runtime.js");
  assert.ok(hint, "name-match hit for the registry-roles dynamic site missing");
  assert.ok(r.files.includes("scripts/sprint/epsilon-runtime.js"));
  assert.ok(r.edges_used.some((e) => e.kind === "dynamic-hint"));
});
t("dynamicHintMatches needs the parent dir, so a generic basename cannot match", () => {
  assert.ok(dynamicHintMatches('path.join(agentRoot(), "scripts", "dispatch", "registry-roles")', "scripts/dispatch/registry-roles.js"));
  assert.ok(!dynamicHintMatches('path.join(root, "paths")', "scripts/hooks/lib/paths.js"));
  assert.ok(!dynamicHintMatches("require(name)", "scripts/dispatch/registry-roles.js"));
});

console.log("unmapped fail-safe");
t("an unknown changed file is flagged unmapped:true, never a silent empty closure", () => {
  const r = touchpointClosure(["scripts/this/file/does-not-exist.js"], { graph });
  assert.strictEqual(r.unmapped, true);
  assert.deepStrictEqual(r.unmapped_files, ["scripts/this/file/does-not-exist.js"]);
  assert.deepStrictEqual(r.files, []);
});
t("known + unknown mixed: unmapped:true, known file's closure still computed", () => {
  const r = touchpointClosure(["scripts/sprint/hook-points.js", "weird/unknown.bin"], { graph });
  assert.strictEqual(r.unmapped, true);
  assert.deepStrictEqual(r.unmapped_files, ["weird/unknown.bin"]);
  assert.ok(r.files.includes("scripts/sprint/full.js"));
});
t("absolute and backslash paths normalise to the same mapped file", () => {
  const abs = path.join(ROOT, "scripts", "sprint", "hook-points.js");
  const r = touchpointClosure([abs, "scripts\\sprint\\hook-points.js"], { graph });
  assert.deepStrictEqual(r.changed, ["scripts/sprint/hook-points.js"]);
  assert.strictEqual(r.unmapped, false);
});
t("empty change list is unmapped (caller error is loud)", () => {
  const r = touchpointClosure([], { graph });
  assert.strictEqual(r.unmapped, true);
});
t("malformed graph (explicitly injected) marks EVERY file unmapped with graph_ok:false", () => {
  for (const bad of [{ nodes: "x" }, { edges: [] }]) {
    const r = touchpointClosure(["scripts/sprint/hook-points.js"], { graph: bad });
    assert.strictEqual(r.graph_ok, false);
    assert.strictEqual(r.unmapped, true);
    assert.deepStrictEqual(r.unmapped_files, ["scripts/sprint/hook-points.js"]);
  }
});
t("no graph passed + no map file on disk -> builds one IN-PROCESS (require-graph.json is untracked)", () => {
  const withScripts = fs.mkdtempSync(path.join(os.tmpdir(), "tp-nograph-withscripts-"));
  try {
    fs.mkdirSync(path.join(withScripts, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(withScripts, "scripts", "known.js"), "module.exports = 1;\n");
    const known = touchpointClosure(["scripts/known.js"], { root: withScripts });
    assert.strictEqual(known.graph_ok, true, JSON.stringify(known));
    assert.strictEqual(known.unmapped, false, JSON.stringify(known));
    const unknown = touchpointClosure(["scripts/does-not-exist.js"], { root: withScripts });
    assert.strictEqual(unknown.graph_ok, true, JSON.stringify(unknown));
    assert.strictEqual(unknown.unmapped, true, JSON.stringify(unknown));
  } finally {
    fs.rmSync(withScripts, { recursive: true, force: true });
  }
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "tp-nograph-bare-"));
  try {
    const r = touchpointClosure(["scripts/a.js"], { root: bare });
    assert.strictEqual(r.graph_ok, true, JSON.stringify(r));
    assert.strictEqual(r.unmapped, true, JSON.stringify(r));
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});
t("a touchpoint file's sibling test IS associated into the closure (R-5 touchpoint-consumer: the consumer's test is one reverse-hop beyond the consumer)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tp-consumer-test-"));
  try {
    fs.mkdirSync(path.join(root, "scripts", "lib"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts", "app"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/lib/qz-normalize.js"), '"use strict";\nmodule.exports = { normalize: (s) => String(s).trim() };\n');
    fs.writeFileSync(path.join(root, "scripts/app/report.js"), '"use strict";\nconst { normalize } = require("../lib/qz-normalize");\nmodule.exports = { report: (n) => "Report: " + normalize(n) };\n');
    fs.writeFileSync(path.join(root, "scripts/app/report.test.js"), '"use strict";\nconst { report } = require("./report");\nreport("x");\n');
    const r = touchpointClosure(["scripts/lib/qz-normalize.js"], { root, depth: 1 });
    assert.ok(r.files.includes("scripts/app/report.js"), "the consumer file is reached by the reverse edge");
    assert.ok(r.tests.includes("scripts/app/report.test.js"), "the consumer's sibling test is associated (the fix)");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
t("a touchpoint file with NO sibling test on disk adds nothing (fail-safe: the association is existence-checked, never fabricated)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tp-consumer-notest-"));
  try {
    fs.mkdirSync(path.join(root, "scripts", "lib"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts", "app"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/lib/qz-normalize.js"), '"use strict";\nmodule.exports = { normalize: (s) => String(s).trim() };\n');
    fs.writeFileSync(path.join(root, "scripts/app/report.js"), '"use strict";\nconst { normalize } = require("../lib/qz-normalize");\nmodule.exports = { report: (n) => normalize(n) };\n');
    const r = touchpointClosure(["scripts/lib/qz-normalize.js"], { root, depth: 1 });
    assert.ok(r.files.includes("scripts/app/report.js"));
    assert.deepStrictEqual(r.tests, [], "no sibling test exists on disk → none fabricated");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
t("GRAPH REACH: a consumer test that is NOT sibling-named is still selected (the load-bearing generality proof)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tp-reach-nonsibling-"));
  try {
    fs.mkdirSync(path.join(root, "scripts", "lib"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts", "app"), { recursive: true });
    fs.mkdirSync(path.join(root, "tests"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/lib/qz-normalize.js"), '"use strict";\nmodule.exports = { normalize: (s) => String(s).trim() };\n');
    fs.writeFileSync(path.join(root, "scripts/app/report.js"), '"use strict";\nconst { normalize } = require("../lib/qz-normalize");\nmodule.exports = { report: (n) => normalize(n) };\n');
    fs.writeFileSync(path.join(root, "tests/report-check.js"), '"use strict";\nconst { report } = require("../scripts/app/report");\nreport("x");\n');
    const r = touchpointClosure(["scripts/lib/qz-normalize.js"], { root, depth: 1 });
    assert.ok(r.tests.includes("tests/report-check.js"), `graph reach must select the NON-sibling consumer test; got ${JSON.stringify(r.tests)}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
t("STRICTLY WIDENING: base.tests ⊇ every test in base.files — the sibling fallback is never dropped", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tp-reach-superset-"));
  try {
    fs.mkdirSync(path.join(root, "scripts", "lib"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts", "app"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts/lib/qz-normalize.js"), '"use strict";\nmodule.exports = { normalize: (s) => String(s).trim() };\n');
    fs.writeFileSync(path.join(root, "scripts/app/report.js"), '"use strict";\nconst { normalize } = require("../lib/qz-normalize");\nmodule.exports = { report: (n) => normalize(n) };\n');
    fs.writeFileSync(path.join(root, "scripts/app/report.test.js"), '"use strict";\nconst { report } = require("./report");\nreport("x");\n');
    const r = touchpointClosure(["scripts/lib/qz-normalize.js"], { root, depth: 1 });
    for (const tf of r.files.filter((f) => /\.test\.js$/.test(f))) {
      assert.ok(r.tests.includes(tf), `base.tests must include every test in base.files (sibling fallback kept): ${tf}`);
    }
    assert.ok(r.tests.includes("scripts/app/report.test.js"), JSON.stringify(r.tests));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
t("an in-process build that THROWS still fails closed (unmapped:true, never a silent empty-green)", () => {
  const requireGraph = require("../maps/require-graph");
  const originalBuild = requireGraph.buildRequireGraph;
  try {
    requireGraph.buildRequireGraph = () => {
      throw new Error("planted build failure");
    };
    const noMap = fs.mkdtempSync(path.join(os.tmpdir(), "tp-buildfail-"));
    try {
      const built = requireGraph.loadOrBuildRequireGraph(noMap);
      assert.strictEqual(built, null, "a failed build with nothing on disk must return null, never a fabricated graph");
      const r = touchpointClosure(["scripts/a.js"], { root: noMap });
      assert.strictEqual(r.graph_ok, false, JSON.stringify(r));
      assert.strictEqual(r.unmapped, true, JSON.stringify(r));
    } finally {
      fs.rmSync(noMap, { recursive: true, force: true });
    }
  } finally {
    requireGraph.buildRequireGraph = originalBuild;
  }
});
t("paths registry source change is mapped, flagged broad, and reaches the PATHS loader", () => {
  const r = touchpointClosure(["framework/paths.registry.json"], { graph });
  assert.strictEqual(r.unmapped, false);
  assert.strictEqual(r.broad, true);
  assert.ok(r.files.includes("scripts/hooks/lib/paths.js"));
});
t("object-form call {files, graph, depth} works on a synthetic graph", () => {
  const g = {
    generatedAt: "2026-01-01T00:00:00.000Z",
    head: "a".repeat(40),
    nodes: ["a.js", "b.js", "c.js", "lone.js"],
    edges: [
      { from: "b.js", to: "a.js", kind: "require" },
      { from: "c.js", to: "b.js", kind: "require" },
    ],
    unresolved: [],
  };
  const d1 = touchpointClosure({ files: ["a.js"], graph: g, depth: 1 });
  assert.deepStrictEqual(d1.files, ["b.js"]);
  const d2 = touchpointClosure({ files: ["a.js"], graph: g, depth: 2 });
  assert.deepStrictEqual(d2.files, ["b.js", "c.js"]);
  const lone = touchpointClosure({ files: ["lone.js"], graph: g });
  assert.deepStrictEqual(lone.files, []);
  assert.strictEqual(lone.unmapped, false);
});

t("every named risk token forces a security-surface hit", () => {
  const { securitySurfaceHit, SECURITY_RISK_TOKENS } = require("./touchpoint");
  const goldenPaths = { security_surface_globs: [] };
  for (const tok of ["hooks", "paths-registry", "release-pipeline", "ci", "secrets", "auth", "dispatch", "leak-gate"]) {
    assert.ok(SECURITY_RISK_TOKENS.has(tok), `SECURITY_RISK_TOKENS must contain "${tok}"`);
    const r = securitySurfaceHit({ files: [], risks: [tok], goldenPaths });
    assert.strictEqual(r.hit, true, `risk:"${tok}" must force a security-surface hit, got ${JSON.stringify(r)}`);
    assert.ok(r.by.includes(`risk:${tok}`), JSON.stringify(r));
  }
});

t("regression guard: an UNrecognized risk token does NOT force a hit on its own", () => {
  const { securitySurfaceHit } = require("./touchpoint");
  const r = securitySurfaceHit({ files: [], risks: ["release-pipeline-but-not-exactly"], goldenPaths: { security_surface_globs: [] } });
  assert.strictEqual(r.hit, false, JSON.stringify(r));
});

function mkRoot(graphObj) {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), "tp-mapstale-"));
  fs.mkdirSync(path.join(r, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(r, "scripts", "a.js"), "module.exports = 1;\n");
  if (graphObj) {
    const gp = path.join(r, ".claude", "project", "maps", "require-graph.json");
    fs.mkdirSync(path.dirname(gp), { recursive: true });
    fs.writeFileSync(gp, JSON.stringify(graphObj));
  }
  return r;
}
function withBuildThrow(fn) {
  const rg = require("../maps/require-graph");
  const orig = rg.buildRequireGraph;
  rg.buildRequireGraph = () => {
    throw new Error("planted build failure");
  };
  try {
    return fn(rg);
  } finally {
    rg.buildRequireGraph = orig;
  }
}
const staleGraph = {
  generatedAt: "2000-01-01T00:00:00.000Z",
  head: "b".repeat(40),
  nodes: ["scripts/a.js", "scripts/stale-target.js"],
  edges: [{ from: "scripts/a.js", to: "scripts/stale-target.js", kind: "require" }],
  unresolved: [],
};
t("R-4(a) stale on-disk graph + build throw → null / map_stale closure, stale edges never used", () => {
  const root = mkRoot(staleGraph);
  try {
    withBuildThrow((rg) => {
      assert.strictEqual(rg.loadOrBuildRequireGraph(root), null);
      const res = rg.loadOrBuildRequireGraphResult(root);
      assert.strictEqual(res.graph, null);
      assert.strictEqual(res.map_stale, true);
      assert.match(res.reason, /^build_failed:/);
      const r = touchpointClosure(["scripts/stale-target.js"], { root });
      assert.strictEqual(r.graph_ok, false, JSON.stringify(r));
      assert.strictEqual(r.unmapped, true);
      assert.strictEqual(r.map_stale, true);
      assert.match(r.map_stale_reason, /^build_failed:/);
      assert.deepStrictEqual(r.files, []);
      assert.deepStrictEqual(r.edges_used, [], "stale edge must not surface");
      assert.ok(!r.files.includes("scripts/a.js"));
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
t("R-4(b) that closure reaches package:full via the existing unmapped rule (map_stale marker + unmapped_escalation)", () => {
  const root = mkRoot(staleGraph);
  try {
    withBuildThrow(() => {
      const tp = touchpointClosure(["scripts/stale-target.js"], { root });
      const { selectPackage } = require("./gauntlet-package");
      const hookPoints = require("./hook-points");
      const fullRoster = hookPoints.agentsForStep("gauntlet", { change: "release", blast: "major", surfaces: ["security"], unit_types: [], max_risk: "", domains: [] });
      const d = selectPackage({ trailer: { change: "bugfix", blast: "minor", risks: [] }, touchpoint: tp, fullRoster });
      assert.strictEqual(d.package, "full", JSON.stringify(d));
      assert.ok(d.reasons.includes("map_stale_fallback"), JSON.stringify(d.reasons));
      assert.ok(d.reasons.some((x) => /^unmapped_escalation:/.test(x)), JSON.stringify(d.reasons));
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
t("R-4(c) fresh on-disk graph + build throw → graph returned, map_stale:false", () => {
  const fresh = { ...staleGraph, generatedAt: new Date(Date.now() + 3600e3).toISOString() };
  const root = mkRoot(fresh);
  try {
    withBuildThrow((rg) => {
      const res = rg.loadOrBuildRequireGraphResult(root);
      assert.ok(res.graph && res.graph.nodes.includes("scripts/stale-target.js"));
      assert.strictEqual(res.map_stale, false);
      assert.strictEqual(res.reason, null);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
t("R-4(d) no on-disk graph + build ok → map_stale:false; supplied opts.graph → map_stale:false/null", () => {
  const root = mkRoot(null);
  try {
    const rg = require("../maps/require-graph");
    const res = rg.loadOrBuildRequireGraphResult(root);
    assert.ok(res.graph);
    assert.strictEqual(res.map_stale, false);
    const r = touchpointClosure(["scripts/a.js"], { root });
    assert.strictEqual(r.map_stale, false);
    assert.strictEqual(r.map_stale_reason, null);
    const r2 = touchpointClosure(["scripts/a.js"], { graph: staleGraph });
    assert.strictEqual(r2.map_stale, false);
    assert.strictEqual(r2.map_stale_reason, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

if (skips.length) console.log(`\n${skips.length} skipped:\n${skips.map((s) => `  - ${s}`).join("\n")}`);
console.log(`\n${passes} passed, ${failures} failed, ${skips.length} skipped`);
process.exit(failures ? 1 : 0);
