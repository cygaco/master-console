#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, ".claude", "framework-manifest.json");

const MANIFEST_SCHEMA_VERSION = "mc/framework-manifest/v2";

const EXCLUDE_RELATIVE_PREFIXES = [
  ".claude/agents/.system/dispatch-backups/",
  "scripts/enforcement/builder-right-size",
  ".claude/agents/president/_system/oneshot/retros/",
  ".claude/agents/president/_system/oneshot/store.json",
  ".claude/agents/president/_system/oneshot/store.json.prev-run-backup.json",
  ".claude/runtime/",
  ".claude/project/events/",
  ".claude/project/memory/",
  ".claude/runtime/dispatch/",
  ".claude/runtime/handoffs/",
  ".claude/runtime/notes/",
  ".claude/runtime/logs/",
  ".claude/.agent-result-hashes.json",
  ".claude/.last-checkpoint",
  ".claude/.session-checkpoint.json",
  ".claude/scheduled_tasks.lock",
  ".claude/agents/store.json",
  ".claude/.session_index.json",
  "migrations/",
];

function isExcluded(relPath) {
  if (
    /^mc\/releases\/[^/]+\/(framework-manifest|checksums)\.json$/.test(
      relPath,
    )
  ) {
    return true;
  }
  if (/(^|\/)(events|tools|skill-usage)\.jsonl$/.test(relPath)) {
    return true;
  }
  return EXCLUDE_RELATIVE_PREFIXES.some(
    (p) => relPath === p || relPath.startsWith(p),
  );
}

const DEFAULT_MERGE_STRATEGY = {
  agent: "three_way_markdown",
  skill: "three_way_markdown",
  reference: "three_way_markdown",
  maps_baseline: "regenerate",
  hook: "replace_if_unmodified",
  hook_lib: "replace_if_unmodified",
  tool: "replace_if_unmodified",
  top_script: "replace_if_unmodified",
  requirement: "keep_local",
  pattern: "three_way_markdown",
  framework_doc: "three_way_markdown",
  kernel: "replace_if_unmodified",
};

const DEFAULT_OWNER_BY_KIND = {
  agent: "framework",
  skill: "framework",
  reference: "framework",
  maps_baseline: "generated",
  hook: "framework",
  hook_lib: "framework",
  tool: "framework",
  top_script: "framework",
  requirement: "project",
  pattern: "framework",
  framework_doc: "framework",
  kernel: "framework",
};

const cHash = require("./mc/lib/content-hash");

function sha256OfFile(absPath, destPath) {
  if (cHash.isTextAsset(destPath || absPath)) {
    return cHash.contentHash(absPath, { text: true });
  }
  return cHash.rawHash(absPath);
}

function idForAsset(kind, srcRel, srcRoot) {
  const stripped = srcRel.replace(srcRoot + "/", "");
  const scope = stripped.replace(/\//g, ".");
  return `${kind}.${scope}`;
}

const ASSET_DIRS = [
  { src: ".claude/agents", kind: "agent" },
  { src: ".claude/commands", kind: "skill" },
  { src: ".claude/kernel", kind: "kernel" },
  { src: ".claude/project/reference", kind: "reference" },
  { src: ".claude/project/maps", kind: "maps_baseline" },
  { src: "scripts/hooks", kind: "hook" },
  { src: "scripts/tools", kind: "tool" },
  { src: "patterns", kind: "pattern" },
  { src: "fixtures/hooks", kind: "fixture" },
  { src: "fixtures/install-empty-next-app", kind: "fixture" },
  { src: "fixtures/update-from-0.0.0-clean", kind: "fixture" },
  { src: "fixtures/update-from-0.0.0-customized-claude-md", kind: "fixture" },
  { src: "fixtures/voice-router", kind: "fixture" },
  { src: "scripts/mc", kind: "mc_script" },
  { src: "scripts/checks", kind: "check_tool" },
  { src: "scripts/enforcement", kind: "check_tool" },
  { src: "scripts/agents", kind: "agent_tool" },
  { src: "scripts/decisions", kind: "decision_tool" },
  { src: "scripts/runtime", kind: "runtime_tool" },
  { src: "scripts/memory", kind: "memory_tool" },
  { src: "scripts/security", kind: "security_tool" },
  { src: "scripts/deps", kind: "dependency_tool" },
  { src: "scripts/timeline", kind: "timeline_tool" },
  { src: "scripts/budgets", kind: "budget_tool" },
  { src: "scripts/self-mod", kind: "self_mod_tool" },
  { src: "scripts/preflight", kind: "preflight_tool" },
  { src: "scripts/requirements", kind: "requirements_engine" },
  { src: "scripts/paths", kind: "paths_engine" },
  { src: "scripts/sprint", kind: "sprint_engine" },
  { src: "scripts/trackers", kind: "tracker_tool" },
  { src: "scripts/dispatch", kind: "dispatch_engine" },
  { src: "scripts/check", kind: "check_runner_tool" },
  { src: "scripts/docs", kind: "docs_tool" },
  { src: "scripts/events", kind: "events_tool" },
  { src: "scripts/state", kind: "state_tool" },
  { src: "scripts/fix-deep", kind: "fix_deep_tool" },
  { src: "scripts/learn", kind: "learn_tool" },
  { src: "scripts/skills", kind: "skills_tool" },
  { src: "scripts/knowledge", kind: "knowledge_tool" },
  { src: "scripts/lib", kind: "script_lib" },
  { src: "scripts/linters", kind: "linter_tool" },
  { src: "scripts/manifest", kind: "manifest_tool" },
  { src: "scripts/maps", kind: "maps_tool" },
  { src: "scripts/portfolio", kind: "portfolio_tool" },
  { src: "scripts/product", kind: "product_tool" },
  { src: "scripts/research", kind: "research_tool" },
  { src: "scripts/schemas", kind: "schema_tool" },
  { src: "scripts/system", kind: "system_tool" },
  { src: "scripts/turbo", kind: "turbo_tool" },
  { src: "scripts/teams", kind: "team_tool" },
  { src: "scripts/epic", kind: "epic_tool" },
  { src: "scripts/panel", kind: "panel_tool" },
  { src: "scripts/cockpit", kind: "cockpit_tool" },
  { src: "scripts/admin", kind: "admin_tool" },
  { src: "framework/panel-registry.json", kind: "panel_registry" },
  { src: "framework/admin-panel-registry.json", kind: "admin_panel_registry" },
  { src: "scripts/bootstrap", kind: "bootstrap_tool" },
  { src: "scripts/canon", kind: "canon_tool" },
  { src: "schemas", kind: "schema" },
  { src: ".claude/schemas", kind: "schema" },
  { src: "migrations", kind: "migration" },
  { src: "framework/releases", kind: "release_capsule" },
  { src: "framework/paths.registry.json", kind: "paths_registry" },
  { src: "_mc/templates", kind: "template" },
  { src: "trackers/templates", kind: "template" },
  { src: "framework/hooks.registry.json", kind: "hooks_registry" },
  { src: "_guides", kind: "guide" },
  { src: "_knowledge", kind: "knowledge" },
];

const TOP_LEVEL_SCRIPTS = [
  { src: "scripts/path-lint.js", kind: "top_script" },
  { src: "scripts/dispatch-agent.js", kind: "top_script" },
  { src: "scripts/generate-maps.js", kind: "top_script" },
  { src: "scripts/generate-steps-maps.js", kind: "top_script" },
  { src: "scripts/generate-framework-manifest.js", kind: "top_script" },
  { src: "scripts/mode-set.js", kind: "top_script" },
  { src: "scripts/materialize-decisions.js", kind: "top_script" },
  { src: "scripts/materialize-decisions.test.js", kind: "top_script" },
  { src: "scripts/dispatch-claude.js", kind: "top_script" },
  { src: "scripts/dispatch-skill.js", kind: "top_script" },
  { src: "scripts/dispatch-review.js", kind: "top_script" },
  { src: "scripts/dispatch-agent-model-semantics.test.js", kind: "top_script" },
];

const TOP_LEVEL_FRAMEWORK_FILES = [
  { src: "version.json", kind: "version_file" },
  { src: "install.ps1", kind: "installer_script" },
  { src: ".github/workflows/test.yml", kind: "ci_workflow" },
  { src: "scripts/package.json", kind: "module_scope" },
];

const FRAMEWORK_DOCS = [
  { src: "CLAUDE.md", dest: "CLAUDE.md", merge: "append-if-exists" },
  { src: "AGENTS.md", dest: "AGENTS.md", merge: "append-if-exists" },
  { src: "CODEX.md", dest: "CODEX.md", merge: "append-if-exists" },
  { src: "ANTIGRAVITY.md", dest: "ANTIGRAVITY.md", merge: "append-if-exists" },
  { src: "AGENT-STRUCTURE.md", dest: "AGENT-STRUCTURE.md", merge: "append-if-exists" },
];

const GENERATED_FILES = [
  { dest: ".claude/paths.json", builder: "paths-builder" },
  { dest: ".claude/manifest.json", builder: "manifest-builder" },
  { dest: ".claude/agents/store.json", builder: "store-builder" },
  { dest: ".claude/project/memory/events.jsonl", builder: "empty-file" },
  { dest: ".claude/project/memory/learnings.jsonl", builder: "empty-file" },
  { dest: ".claude/project/memory/traces.jsonl", builder: "empty-file" },
  { dest: ".claude/project/memory/systems.jsonl", builder: "systems-seeder" },
  {
    dest: ".claude/settings.json",
    builder: "settings-merger",
    idempotent: true,
  },
  { dest: ".gitignore", builder: "gitignore-block-appender", idempotent: true },
];

function refineKind(baseKind, relPath) {
  if (baseKind === "hook" && relPath.includes("scripts/hooks/lib/")) {
    return "hook_lib";
  }
  return baseKind;
}

function walkDir(absDir, relBase = "", srcRoot = "") {
  const out = [];
  if (!fs.existsSync(absDir)) return out;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    const rel = path.join(relBase, entry.name).replace(/\\/g, "/");
    const fullRel = srcRoot ? `${srcRoot}/${rel}` : rel;
    if (isExcluded(fullRel)) continue;
    if (entry.isDirectory()) {
      out.push(...walkDir(abs, rel, srcRoot));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

function decorateAsset(asset) {
  const kind = asset.kind;
  const absSrc = path.join(ROOT, asset.src);
  const id = idForAsset(
    kind,
    asset.src,
    asset.srcRoot || asset.src.split("/")[0],
  );
  const sha256 = fs.existsSync(absSrc)
    ? sha256OfFile(absSrc, asset.dest || asset.src)
    : null;
  const owner = asset.owner || DEFAULT_OWNER_BY_KIND[kind] || "framework";
  const mergeStrategy =
    asset.mergeStrategy ||
    asset.merge ||
    DEFAULT_MERGE_STRATEGY[kind] ||
    "replace_if_unmodified";
  return {
    id,
    src: asset.src,
    dest: asset.dest,
    kind,
    sha256,
    owner,
    mergeStrategy,
    introducedIn: asset.introducedIn || "0.0.0",
    removedIn: asset.removedIn || null,
    replaces: asset.replaces || null,
    ...(asset.merge ? { merge: asset.merge } : {}),
  };
}

function collectAssets() {
  const assets = [];
  for (const dir of ASSET_DIRS) {
    const abs = path.join(ROOT, dir.src);
    if (!fs.existsSync(abs)) continue;
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      if (isExcluded(dir.src)) continue;
      assets.push({
        src: dir.src,
        dest: dir.src,
        kind: refineKind(dir.kind, dir.src),
        srcRoot: path.posix.dirname(dir.src),
      });
      continue;
    }
    const files = walkDir(abs, "", dir.src);
    for (const f of files) {
      const fullRel = `${dir.src}/${f}`;
      if (isExcluded(fullRel)) continue;
      assets.push({
        src: fullRel,
        dest: fullRel,
        kind: refineKind(dir.kind, fullRel),
        srcRoot: dir.src,
      });
    }
  }
  for (const t of TOP_LEVEL_SCRIPTS) {
    if (fs.existsSync(path.join(ROOT, t.src))) {
      assets.push({
        src: t.src,
        dest: t.src,
        kind: t.kind,
        srcRoot: "scripts",
      });
    }
  }
  if (typeof TOP_LEVEL_FRAMEWORK_FILES !== "undefined") {
    for (const t of TOP_LEVEL_FRAMEWORK_FILES) {
      if (fs.existsSync(path.join(ROOT, t.src))) {
        assets.push({
          src: t.src,
          dest: t.src,
          kind: t.kind,
          srcRoot: "",
        });
      }
    }
  }
  for (const d of FRAMEWORK_DOCS) {
    if (fs.existsSync(path.join(ROOT, d.src))) {
      assets.push({
        src: d.src,
        dest: d.dest,
        kind: "framework_doc",
        merge: d.merge,
        srcRoot: "",
      });
    }
  }
  return assets.map(decorateAsset);
}

const RUNTIME_JSONL_PATTERN = /(^|[\\/])(events|tools|skill-usage)\.jsonl$/i;

module.exports = { isExcluded, RUNTIME_JSONL_PATTERN };

if (require.main === module) {
  const assets = collectAssets();

  const byKind = {};
  for (const a of assets) {
    (byKind[a.kind] = byKind[a.kind] || []).push(a);
  }
  for (const kind of Object.keys(byKind)) {
    byKind[kind].sort((x, y) => x.src.localeCompare(y.src));
  }

  const version = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8"))
        .version;
    } catch {
      return "0.0.0";
    }
  })();

  const manifest = {
    $schema: MANIFEST_SCHEMA_VERSION,
    version,
    generated_by: "scripts/generate-framework-manifest.js",
    counts: Object.fromEntries(
      Object.entries(byKind).map(([k, v]) => [k, v.length]),
    ),
    total: assets.length,
    assets: byKind,
    generated_files: GENERATED_FILES,
  };

  const CHECK_MODE = process.argv.includes("--check");
  const newJson = JSON.stringify(manifest, null, 2) + "\n";

  if (CHECK_MODE) {
    let existing = "";
    try {
      existing = fs.readFileSync(OUT, "utf8");
    } catch {
      console.error(
        `framework-manifest.json missing — run: node scripts/generate-framework-manifest.js`,
      );
      process.exit(1);
    }
    if (existing !== newJson) {
      console.error(
        `framework-manifest.json is stale — run: node scripts/generate-framework-manifest.js`,
      );
      process.exit(1);
    }
    console.log(`framework-manifest.json is current.`);
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  fs.writeFileSync(OUT, newJson);

  const pad = (s, n) => s.padEnd(n, " ");
  console.log(`\n  MC framework manifest written`);
  console.log(`  Output: .claude/framework-manifest.json`);
  console.log(`  Version: ${version}`);
  console.log(`  Schema: ${manifest.$schema}\n`);
  console.log(`  Asset counts by kind:`);
  for (const [k, v] of Object.entries(manifest.counts).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`    ${pad(k, 20)} ${v}`);
  }
  console.log(`    ${pad("TOTAL", 20)} ${manifest.total}`);
  console.log(`    ${pad("+ generated", 20)} ${GENERATED_FILES.length}\n`);
}
