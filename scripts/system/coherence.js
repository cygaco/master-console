#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const GRAPH_REL = path.join(".claude", "project", "maps", "system-coherence.graph.json");
const GRAPH = path.join(ROOT, GRAPH_REL);

const DRIFT_TYPES = [
  "spec",
  "path",
  "mode",
  "agent",
  "decision",
  "provider",
  "hook",
  "memory",
  "config",
  "install",
  "security",
  "test",
  "runtime",
  "pattern",
  "version",
];

function exists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

function readJson(root, rel, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
  } catch {
    return fallback;
  }
}

function runNode(root, args) {
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  return {
    status: r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    ok: r.status === 0,
  };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function tail(r, n) {
  return (r.stdout + r.stderr).split(/\r?\n/).slice(-n);
}

function sev(status, message, details) {
  return { status, message, details: details || [] };
}

function withoutGeneratedAt(graph) {
  const copy = { ...graph };
  delete copy.generatedAt;
  return copy;
}

function checkSpec(root = ROOT) {
  const r = runNode(root, ["scripts/requirements/gate.js", "--json"]);
  const out = parseJson(r.stdout);
  const results = out && Array.isArray(out.results) ? out.results : null;
  if (r.status === 0) return sev("green", "requirements freshness gate passes");
  if (r.status === 1) {
    const warn = results ? results.filter((x) => x.severity === "yellow") : [];
    return sev(
      "yellow",
      warn.length > 0 ? `requirements gate has warnings: ${warn[0].message}` : "requirements gate has warnings",
      warn.length > 0 ? warn.map((x) => `${x.name}: ${x.message}`) : tail(r, 6),
    );
  }
  const bad = results ? results.filter((x) => x.severity === "red") : [];
  return sev("red", "requirements gate failed", bad.length > 0 ? bad.map((x) => `${x.name}: ${x.message}`) : tail(r, 8));
}

function checkPath(root = ROOT) {
  const r = runNode(root, ["scripts/paths/gate.js", "--json"]);
  const out = parseJson(r.stdout);
  if (!out || !Array.isArray(out.findings)) return sev("red", "path coherence gate output unreadable", tail(r, 8));
  const fmt = (f) => `[${f.area}]${f.file ? ` ${f.file}${f.line ? `:${f.line}` : ""}` : ""}  ${f.message}`;
  if (r.status !== 0 || out.ok !== true) {
    const bad = out.findings.filter((f) => f.severity !== "warn");
    return sev("red", "path coherence gate failed", (bad.length > 0 ? bad.map(fmt) : tail(r, 8)).slice(0, 8));
  }
  const warn = out.findings.filter((f) => f.severity === "warn");
  if (warn.length > 0) return sev("yellow", warn.map((f) => f.message).join("; "), warn.map(fmt));
  return sev("green", "path registry and generated artifacts are coherent");
}

function checkMode(root = ROOT) {
  const mode = readJson(root, ".claude/runtime/mode.json", null);
  if (!mode) return sev("yellow", "mode marker missing; run node scripts/mode-set.js adhoc --by alpha");
  if (mode.$schema !== "mc/mode-marker/v2") return sev("red", "mode marker schema is not v2");
  return sev("green", `mode marker present: ${mode.mode}`);
}

function checkAgent(root = ROOT) {
  const gamma = fs.readFileSync(path.join(root, ".claude", "agents", "president", "gamma.md"), "utf8");
  const stale = [".claude/agents/.system/agent-system.md", ".claude/agents/.system/adhoc/protocol.md"].filter((s) => gamma.includes(s));
  if (stale.length > 0) return sev("red", "Gamma still references stale agent-system paths", stale);
  return sev("green", "agent startup paths and canonical dispatch callouts are current");
}

function checkDecision(root = ROOT) {
  const r = runNode(root, ["scripts/decisions/ledger.js", "--json"]);
  const out = parseJson(r.stdout);
  const findings = out && Array.isArray(out.findings) ? out.findings : null;
  if (r.status === 0) return sev("green", "decision ledger has valid Class B/C entries");
  if (r.status === 1 && findings && findings.length > 0 && findings.every((f) => f.severity === "yellow")) {
    return sev("yellow", findings[0].message, findings.map((f) => f.message));
  }
  const bad = findings ? findings.filter((f) => f.severity !== "yellow").map((f) => f.message) : [];
  return sev("red", "decision ledger check failed", bad.length > 0 ? bad.slice(0, 8) : tail(r, 8));
}

function checkProvider(root = ROOT) {
  const r = runNode(root, ["scripts/agents/provider-trace.js"]);
  const out = parseJson(r.stdout);
  if (r.status === 0) return sev("green", "provider diversity policy includes OpenAI and Gemini");
  if (r.status === 1 && out && Array.isArray(out.warnings) && out.warnings.length > 0) {
    const via = Array.isArray(out.expectedProviders) ? out.expectedProviders.join(", ") : "unknown";
    return sev("yellow", `provider diversity is reduced: ${out.warnings.join("; ")} (review providers: ${via})`, out.warnings);
  }
  return sev("red", "provider diversity check failed", out && Array.isArray(out.findings) && out.findings.length > 0 ? out.findings : tail(r, 8));
}

function checkHook(root = ROOT) {
  const r = runNode(root, ["scripts/hooks/test.js", "--all", "--json"]);
  if (r.status === 0) return sev("green", "all registered hooks have fixture tests");
  return sev("red", "hook fixture test gate failed", tail(r, 12));
}

function checkMemory(root = ROOT) {
  const r = runNode(root, ["scripts/memory/provenance.js", "--json"]);
  if (r.status === 0) return sev("green", "memory provenance check has no red findings");
  return sev("red", "memory provenance has invalid JSON", r.stdout.split(/\r?\n/).slice(-8));
}

function checkConfig(root = ROOT) {
  const r = runNode(root, ["scripts/schemas/validate.js", "--strict"]);
  return r.status === 0 ? sev("green", "config schemas validate") : sev("red", "config schema validation failed", tail(r, 8));
}

function checkInstall(root = ROOT) {
  if (!exists(root, "install.ps1") || !exists(root, "version.json")) return sev("red", "install.ps1 or version.json missing");
  if (!exists(root, ".claude/framework-installed.json") && exists(root, ".claude/framework-manifest.json")) {
    return sev("yellow", "installed snapshot not built yet (.claude/framework-installed.json); run node scripts/mc/snapshot-installed.js");
  }
  const r = runNode(root, ["scripts/mc/snapshot-installed.js", "--check"]);
  return r.status === 0 ? sev("green", "installer, version, and installed snapshot are present") : sev("red", "installed snapshot check failed", tail(r, 8));
}

function checkSecurity(root = ROOT) {
  const r = runNode(root, ["scripts/security/permissions.js", "--check"]);
  return r.status === 0 ? sev("green", "permission model classifies sensitive actions") : sev("red", "permission model check failed", r.stdout.split(/\r?\n/).slice(-8));
}

function checkTest(root = ROOT) {
  const pkg = readJson(root, "package.json", {});
  const scripts = pkg.scripts || {};
  if (!scripts.test) return sev("red", "package.json has no test script");
  const notes = [];
  if (!scripts.build) notes.push("package.json has no build script (add one if the project has a compile step)");
  if (!exists(root, ".github/workflows/test.yml")) notes.push(".github/workflows/test.yml not found");
  if (notes.length > 0) return sev("yellow", `${notes.join("; ")}; the local test script exists`, notes);
  return sev("green", "local build/test scripts and CI parity workflow exist");
}

function checkRuntime(root = ROOT) {
  const r = runNode(root, ["scripts/runtime/governance.js", "--json"]);
  if (r.status === 0) return sev("green", "runtime governance policy is declared");
  return sev("red", "runtime governance has red findings", r.stdout.split(/\r?\n/).slice(-8));
}

function checkPattern(root = ROOT) {
  if (!exists(root, "patterns/README.md")) return sev("red", "patterns/README.md missing");
  if (!exists(root, "patterns/ADMISSION.md")) return sev("yellow", "pattern admission policy (patterns/ADMISSION.md) is not written yet");
  const patternDir = path.join(root, "patterns");
  const content = fs
    .readdirSync(patternDir)
    .filter((f) => f.endsWith(".md") && !["README.md", "ADMISSION.md"].includes(f));
  if (content.length < 3) return sev("yellow", "pattern library has admission policy but not enough canonical content");
  return sev("green", `pattern library has admission policy and ${content.length} canonical patterns`);
}

function checkVersion(root = ROOT) {
  const version = readJson(root, "version.json", {});
  const manifest = readJson(root, ".claude/framework-manifest.json", {});
  const disagree = (release) =>
    sev("red", "version.json, framework manifest, and release capsule disagree", [
      `version.json: ${version.version}`,
      `framework manifest: ${manifest.version}`,
      `release capsule: ${release}`,
    ]);
  if (!version.version || version.version !== manifest.version) return disagree("not compared");
  const capsule = `framework/releases/${version.version}/release.json`;
  if (!exists(root, capsule)) {
    return sev("yellow", `version.json and the framework manifest agree on ${version.version}; no release capsule for it yet (${capsule}); /mc:release creates it`);
  }
  const release = readJson(root, capsule, {});
  if (release.version !== version.version) return disagree(release.version);
  return sev("green", `version sources agree on ${version.version}`);
}

const checks = {
  spec: checkSpec,
  path: checkPath,
  mode: checkMode,
  agent: checkAgent,
  decision: checkDecision,
  provider: checkProvider,
  hook: checkHook,
  memory: checkMemory,
  config: checkConfig,
  install: checkInstall,
  security: checkSecurity,
  test: checkTest,
  runtime: checkRuntime,
  pattern: checkPattern,
  version: checkVersion,
};

function buildGraph(opts = {}) {
  const root = opts.root || ROOT;
  const graphFile = path.join(root, GRAPH_REL);
  const results = {};
  for (const type of DRIFT_TYPES) results[type] = checks[type](root);
  const nodes = DRIFT_TYPES.map((type) => ({ id: type, type: "driftType", ...results[type] }));
  const red = nodes.filter((n) => n.status === "red").length;
  const yellow = nodes.filter((n) => n.status === "yellow").length;
  const graph = {
    $schema: "mc/system-coherence-graph/v1",
    generatedAt: new Date().toISOString(),
    driftTypes: DRIFT_TYPES,
    summary: { green: nodes.length - red - yellow, yellow, red, ok: red === 0 },
    nodes,
    edges: [
      { from: "path", to: "config", relation: "feeds" },
      { from: "hook", to: "security", relation: "enforces" },
      { from: "decision", to: "agent", relation: "guides" },
      { from: "runtime", to: "install", relation: "excluded-from-release" },
    ],
  };
  if (fs.existsSync(graphFile)) {
    try {
      const previous = JSON.parse(fs.readFileSync(graphFile, "utf8"));
      if (
        JSON.stringify(withoutGeneratedAt(previous)) ===
        JSON.stringify(withoutGeneratedAt(graph))
      ) {
        graph.generatedAt = previous.generatedAt || graph.generatedAt;
      }
    } catch {
    }
  }
  fs.mkdirSync(path.dirname(graphFile), { recursive: true });
  const body = JSON.stringify(graph, null, 2) + "\n";
  if (!fs.existsSync(graphFile) || fs.readFileSync(graphFile, "utf8") !== body) {
    fs.writeFileSync(graphFile, body, "utf8");
  }
  return graph;
}

function main() {
  const args = process.argv.slice(2);
  const graph = buildGraph();
  if (args.includes("--json")) console.log(JSON.stringify(graph, null, 2));
  else {
    for (const node of graph.nodes) {
      const tag = node.status === "red" ? "RED" : node.status === "yellow" ? "YEL" : "GRN";
      console.log(`[${tag}] ${node.id}: ${node.message}`);
      for (const d of (node.details || []).slice(0, 4)) console.log(`      ${d}`);
    }
    console.log(`Summary: ${graph.summary.green} green, ${graph.summary.yellow} yellow, ${graph.summary.red} red`);
  }
  process.exit(graph.summary.red === 0 ? 0 : 2);
}

if (require.main === module) main();

module.exports = { buildGraph, checks, DRIFT_TYPES, GRAPH };
