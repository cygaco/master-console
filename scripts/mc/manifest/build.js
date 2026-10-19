#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { isFrameworkViewDest } = require("../views/populate-source");

const SCHEMA_ID = "mc/manifest/v1";

function parseArgs(argv) {
  const out = {
    root: process.cwd(),
    outPath: null,
    sourcePrefix: "framework",
    mcVersion: null,
    dryRun: false,
    json: false,
    allowUnclassified: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--root") out.root = path.resolve(argv[++i]);
    else if (a === "--out") out.outPath = argv[++i];
    else if (a === "--source-prefix") out.sourcePrefix = argv[++i];
    else if (a === "--mc-version") out.mcVersion = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--json") out.json = true;
    else if (a === "--allow-unclassified") out.allowUnclassified = true;
  }
  return out;
}

function printHelp() {
  process.stdout.write(`
scripts/mc/manifest/build.js — produce _mc/MANIFEST.json

Usage:
  node scripts/mc/manifest/build.js [flags]

Flags:
  --root <dir>            walk this dir (default: cwd)
  --out <file>            manifest destination (default: <root>/_mc/MANIFEST.json)
  --source-prefix <dir>   framework source dir (default: framework; products use _mc)
  --mc-version <v>    pin manifest's mcVersion (default: read version.json)
  --dry-run               print to stdout, no write
  --json                  emit summary as JSON
  --allow-unclassified    write manifest even with unclassified paths (NOT RECOMMENDED)
  --help, -h              show this message

Schema: schemas/mc-manifest.schema.json (v1)
`);
}

function buildRules(sourcePrefix) {
  return [
    {
      name: "runtime-session-files",
      match: (rel) =>
        /^\.claude\/\.(session-id|session-prompts\.log|session-tracking\.jsonl|session-checkpoint\.json|session-start-commit|store-lock|agent-result-hashes\.json|last-checkpoint)$/.test(
          rel,
        ),
      entry: () => ({ owner: "runtime", managed: false }),
    },
    {
      name: "runtime-agent-events",
      match: (rel) =>
        rel.startsWith(".claude/agents/") &&
        (rel.endsWith("/events.jsonl") ||
          rel.endsWith("/.system/events.jsonl")),
      entry: () => ({
        owner: "runtime",
        managed: false,
        kind: "jsonl",
      }),
    },
    {
      name: "runtime-agent-workspace",
      match: (rel) => /^\.claude\/agents\/[^\/]+\/\.workspace\//.test(rel),
      entry: () => ({ owner: "runtime", managed: false, kind: "dir" }),
    },
    {
      name: "runtime-claude-buckets",
      match: (rel) =>
        rel.startsWith(".claude/runtime/") ||
        rel.startsWith(".claude/content/") ||
        rel.startsWith(".claude/project/events/") ||
        rel.startsWith(".claude/project/memory/") ||
        rel.startsWith(".claude/project/builds/") ||
        rel.startsWith(".claude/project/decisions/") ||
        rel.startsWith(".claude/project/maps/") ||
        rel.startsWith(".claude/project/sprint/") ||
        rel.startsWith(".claude/project/etc/") ||

        rel.startsWith(".claude/logs/") || // manifest classifier matches this prefix by design; path-literal-allowed
        rel.startsWith(".claude/handoffs/") || // manifest classifier matches this prefix by design; path-literal-allowed
        rel === ".claude/handoff.md",
      entry: () => ({ owner: "runtime", managed: false }),
    },
    {
      name: "runtime-mc-transactions",
      match: (rel) => rel.startsWith(".mc/"),
      entry: () => ({ owner: "runtime", managed: false }),
    },
    {
      name: "runtime-install-backup",
      match: (rel) => rel.startsWith(".mc-backup/"),
      entry: () => ({
        owner: "runtime",
        managed: false,
        _note: "Pre-install backup written by scripts/mc-setup.js; /mc:uninstall restores from it. Not a framework view.",
      }),
    },
    {
      name: "runtime-build-store",
      match: (rel) => rel === ".claude/agents/store.json",
      entry: () => ({
        owner: "runtime",
        managed: false,
        kind: "json",
        _note: "Build-mode state — created/mutated by mc-setup.js + dispatch. Not a framework view.",
      }),
    },
    {
      name: "project-decision-policy",
      match: (rel) =>
        rel ===
        ".claude/agents/president/_system/policy/decision-policy.md",
      entry: () => ({
        owner: "project",
        managed: false,
        seeded_from: ".claude/agents/president/_system/policy/decision-policy.md",
        class: "fillable",
      }),
    },
    {
      name: "project-requirements",
      match: (rel) => rel.startsWith("_requirements/"),
      entry: (rel) => ({
        owner: "project",
        managed: false,
        seeded_from: rel,
        class: "fillable",
      }),
    },
    {
      name: "project-docs",
      match: (rel) =>
        rel.startsWith("_docs/") &&
        !rel.startsWith("_docs/briefs/") &&
        !rel.startsWith("_docs/clones/") &&
        !rel.startsWith("_docs/imports/"),
      entry: () => ({
        owner: "project",
        managed: false,
        class: "reference",
      }),
    },
    {
      name: "project-portfolio-output",
      match: (rel) =>
        rel.startsWith("_docs/briefs/") ||
        rel.startsWith("_docs/clones/") ||
        rel.startsWith("_docs/imports/"),
      entry: () => ({
        owner: "project",
        managed: false,
        class: "data",
      }),
    },

    {
      name: "generated-settings",
      match: (rel) => rel === ".claude/settings.json",
      entry: () => ({
        owner: "generated",
        managed: false,
        compiled_from: [
          `${sourcePrefix}/settings/defaults.json`,
          ".claude/settings.local.json",
        ],
        compiler: "scripts/mc/settings/compile.js",
        kind: "json",
      }),
    },
    {
      name: "generated-paths-json",
      match: (rel) => rel === ".claude/paths.json",
      entry: () => ({
        owner: "generated",
        managed: false,
        compiled_from: [`${sourcePrefix}/paths.registry.json`],
        compiler: "scripts/paths/build.js",
        kind: "json",
      }),
    },
    {
      name: "generated-framework-manifest-legacy",
      match: (rel) => rel === ".claude/framework-manifest.json",
      entry: () => ({
        owner: "generated",
        managed: false,
        compiled_from: [`${sourcePrefix}/`],
        compiler: "scripts/generate-framework-manifest.js",
        kind: "json",
        _note: "Legacy v0.x manifest. Will be superseded by _mc/MANIFEST.json in v1.0.",
      }),
    },
    {
      name: "generated-framework-installed",
      match: (rel) => rel === ".claude/framework-installed.json",
      entry: () => ({
        owner: "generated",
        managed: false,
        compiled_from: [".claude/framework-manifest.json"],
        compiler: "scripts/mc-setup.js",
        kind: "json",
        _note: "Per-install snapshot of what was copied to this project at /mc:setup time. Will be folded into _mc/MANIFEST.json#paths.*.installedSha in v1.0.",
      }),
    },
    {
      name: "generated-project-manifest",
      match: (rel) => rel === ".claude/manifest.json",
      entry: () => ({
        owner: "generated",
        managed: false,
        compiled_from: ["scripts/dispatch/providers.js"],
        compiler: "scripts/mc-setup.js",
        kind: "json",
        _note: "Project identity card — metadata, features, providers. Seeded at install with DEFAULT_AGENT_PROVIDERS.",
      }),
    },
    {
      name: "project-settings-local",
      match: (rel) => rel === ".claude/settings.local.json",
      entry: () => ({
        owner: "project",
        managed: false,
        class: "config",
        _note: "Per-project override layer for the three-layer settings compiler. Edit THIS file; .claude/settings.json is generated.",
      }),
    },

    {
      name: "framework-claude-command",
      match: (rel) =>
        rel.startsWith(".claude/commands/") && rel.endsWith(".md"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source:
          sourcePrefix === "framework"
            ? rel
            : `${sourcePrefix}/${rel.replace(/^\.claude\//, "")}`,
        kind: "md",
      }),
    },
    {
      name: "framework-claude-agent",
      match: (rel) =>
        rel.startsWith(".claude/agents/") &&
        rel.endsWith(".md") &&
        !rel.includes("/.system/policy/decision-policy.md"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source:
          sourcePrefix === "framework"
            ? rel
            : `${sourcePrefix}/${rel.replace(/^\.claude\//, "")}`,
        kind: "md",
      }),
    },
    {
      name: "framework-manager-data",
      match: (rel) =>
        /^\.claude\/agents\/_(org|principles|evals)\//.test(rel),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source:
          sourcePrefix === "framework"
            ? rel
            : `${sourcePrefix}/${rel.replace(/^\.claude\//, "")}`,
        kind: rel.endsWith(".json") ? "json" : "md",
      }),
    },
    {
      name: "framework-agent-system-data",
      match: (rel) =>
        /^\.claude\/agents\/.+\/_system\//.test(rel) && rel.endsWith(".json"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source:
          sourcePrefix === "framework"
            ? rel
            : `${sourcePrefix}/${rel.replace(/^\.claude\//, "")}`,
        kind: "json",
      }),
    },

    {
      name: "framework-source",
      match: (rel) => rel.startsWith(`${sourcePrefix}/`) && rel !== "_mc/MANIFEST.json",
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source: rel,
      }),
    },
    {
      name: "framework-guides-dir",
      match: (rel) => rel.startsWith("_guides/"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source: rel,
      }),
    },
    {
      name: "framework-knowledge-dir",
      match: (rel) => rel.startsWith("_knowledge/"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source: rel,
      }),
    },
    {
      name: "framework-canonical-dir",
      match: (rel) => rel.startsWith("framework/"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source: rel,
      }),
    },
    {
      name: "framework-scripts",
      match: (rel) =>
        rel.startsWith("scripts/") && !rel.startsWith("scripts/one-off/"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source: rel,
      }),
    },
    {
      name: "framework-schemas",
      match: (rel) => rel.startsWith("schemas/"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source: rel,
      }),
    },
    {
      name: "framework-root-doc",
      match: (rel) =>
        rel === "CLAUDE.md" ||
        rel === "AGENTS.md" ||
        rel === "AGENT-STRUCTURE.md" ||
        rel === "CODEX.md" ||
        rel === "ANTIGRAVITY.md" ||
        rel === "PROJECT.md" ||
        rel === "README.md" ||
        rel === "USER_GUIDE.md" ||
        rel === "DICTIONARY.md" ||
        rel === "RELEASES.md" ||
        rel === ".gitignore" ||
        rel === ".gitattributes" ||
        rel === "LICENSE" ||
        rel === "version.json",
      entry: () => ({
        owner: "framework",
        managed: true,
        source: null,
        _note: "Root document — source path same as destination (canonical-side).",
      }),
    },
    {
      name: "framework-misc",
      match: (rel) =>
        rel === "package.json" ||
        rel === "package-lock.json" ||
        rel === "install.ps1" ||
        rel === "install.sh" ||
        rel.startsWith("tests/") ||
        rel.startsWith(".github/") ||
        rel.startsWith("migrations/") ||
        rel.startsWith("patterns/") ||
        rel.startsWith("fixtures/") ||
        rel.startsWith("scripts/one-off/") ||
        rel.endsWith(".env.example"),
      entry: () => ({
        owner: "framework",
        managed: true,
        source: null,
      }),
    },
    {
      name: "runtime-root-issues-ledger",
      match: (rel) => rel === "issues.md",
      entry: () => ({
        owner: "runtime",
        managed: false,
        kind: "md",
        _note: "paths.sprintIssuesLedger — auto-managed by scripts/sprint/issue.js",
      }),
    },
    {
      name: "runtime-working-doc",
      match: (rel) =>
        rel === "DUMP.md" ||
        rel === "TRACKER.md" ||
        rel === "UNTRACKED_WORK.md" ||
        rel === "REGRESSIONS.md" ||
        rel === "GRAPH.md",
      entry: () => ({ owner: "runtime", managed: false }),
    },
    {
      name: "repo-instance-doc",
      match: (rel) => rel === "ROADMAP.md",
      entry: () => ({
        owner: "project",
        managed: false,
        class: "reference",
        _note: "Operator instance roadmap — project-owned, not shipped to consumers.",
      }),
    },
    {
      name: "repo-community-doc",
      match: (rel) =>
        rel === "CONTRIBUTING.md" ||
        rel === "SECURITY.md" ||
        rel === "CODE_OF_CONDUCT.md" ||
        rel === "CHANGELOG.md" ||
        rel.startsWith("docs/"),
      entry: () => ({
        owner: "project",
        managed: false,
        class: "reference",
        _note: "Canonical-repo community/provenance doc — describes this repo, not shipped to consumers.",
      }),
    },
    {
      name: "framework-trackers-templates",
      match: (rel) => rel.startsWith("trackers/templates/"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source: rel,
        kind: rel.endsWith(".md") ? "md" : undefined,
      }),
    },
    {
      name: "runtime-trackers-tree",
      match: (rel) => rel.startsWith("trackers/"),
      entry: () => ({ owner: "runtime", managed: false }),
    },
    {
      name: "framework-claude-reference",
      match: (rel) => rel.startsWith(".claude/project/reference/"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source:
          sourcePrefix === "framework"
            ? rel
            : `${sourcePrefix}/${rel.replace(/^\.claude\//, "")}`,
        kind: rel.endsWith(".md") ? "md" : undefined,
      }),
    },
    {
      name: "framework-claude-agent-system",
      match: (rel) =>
        rel.startsWith(".claude/agents/") &&
        (rel.endsWith(".json") || rel.endsWith(".schema.json")) &&
        rel.includes("/.system/"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source:
          sourcePrefix === "framework"
            ? rel
            : `${sourcePrefix}/${rel.replace(/^\.claude\//, "")}`,
        kind: "json",
      }),
    },
    {
      name: "framework-kernel",
      match: (rel) => rel.startsWith(".claude/kernel/"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source:
          sourcePrefix === "framework"
            ? rel
            : `${sourcePrefix}/${rel.replace(/^\.claude\//, "")}`,
        kind: rel.endsWith(".md")
          ? "md"
          : rel.endsWith(".json")
            ? "json"
            : undefined,
      }),
    },
    {
      name: "framework-claude-schemas",
      match: (rel) => rel.startsWith(".claude/schemas/"),
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source:
          sourcePrefix === "framework"
            ? rel
            : `${sourcePrefix}/${rel.replace(/^\.claude\//, "")}`,
        kind: rel.endsWith(".json") ? "json" : undefined,
      }),
    },
    {
      name: "project-dreams",
      match: (rel) => rel.startsWith(".claude/dreams/"),
      entry: () => ({
        owner: "project",
        managed: false,
        class: "guide",
        _note: "Operator's dream journal — written by /sleep:* skills + manual edits. Project-owned; never overwritten.",
      }),
    },
    {
      name: "generated-mc-manifest",
      match: (rel) => rel === "_mc/MANIFEST.json",
      entry: () => ({
        owner: "generated",
        managed: false,
        compiled_from: ["framework/"],
        compiler: "scripts/mc/manifest/build.js",
        kind: "json",
        _note: "Per-install ownership manifest. Regenerated on /mc:setup and /mc:update.",
      }),
    },
    {
      name: "mc-generated-view-mirror",
      skip: true,
      match: (rel) =>
        sourcePrefix === "framework" &&
        rel.startsWith("_mc/") &&
        rel !== "_mc/MANIFEST.json" &&
        !!isFrameworkViewDest(".claude/" + rel.slice("_mc/".length)),
    },
    {
      name: "framework-mc-zone",
      match: (rel) => rel.startsWith("_mc/") && rel !== "_mc/MANIFEST.json",
      entry: (rel) => ({
        owner: "framework",
        managed: true,
        source: rel,
        _note: "_mc/ is the framework source-of-truth zone in installed products.",
      }),
    },
  ];
}

function classify(rel, rules) {
  for (const rule of rules) {
    if (rule.match(rel)) {
      if (rule.skip) return { rule: rule.name, skip: true };
      const e = rule.entry(rel);
      return { rule: rule.name, entry: e };
    }
  }
  return null;
}

const { WALK_SKIP_DIRS, WALK_SKIP_FILES } = require("./walk-skip");

function* walk(rootAbs) {
  const stack = [rootAbs];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (WALK_SKIP_DIRS.has(ent.name)) continue;
      if (WALK_SKIP_FILES.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (ent.isFile()) {
        yield full;
      }
    }
  }
}

function sha256OfFile(file) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

function relPath(rootAbs, fullPath) {
  return path
    .relative(rootAbs, fullPath)
    .split(path.sep)
    .join("/");
}

function build(opts) {
  const root = path.resolve(opts.root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { ok: false, code: 2, error: `--root not a directory: ${root}` };
  }

  let mcVersion = opts.mcVersion;
  if (!mcVersion) {
    try {
      const vj = JSON.parse(
        fs.readFileSync(path.join(root, "version.json"), "utf8"),
      );
      mcVersion = vj.version || "0.0.0";
    } catch {
      mcVersion = "0.0.0";
    }
  }

  const rules = buildRules(opts.sourcePrefix);
  const paths = {};
  const unclassified = [];
  const ruleHits = Object.create(null);

  for (const full of walk(root)) {
    const rel = relPath(root, full);
    if (!rel || rel.startsWith("..")) continue;
    const classification = classify(rel, rules);
    if (!classification) {
      unclassified.push(rel);
      continue;
    }
    if (classification.skip) {
      ruleHits[classification.rule] = (ruleHits[classification.rule] || 0) + 1;
      continue;
    }
    const entry = { ...classification.entry };
    if (entry.owner === "framework") {
      try {
        const sha = sha256OfFile(full);
        entry.sha256 = sha;
        entry.installedSha = sha;
      } catch {
      }
    }
    paths[rel] = entry;
    ruleHits[classification.rule] =
      (ruleHits[classification.rule] || 0) + 1;
  }

  if (unclassified.length > 0 && !opts.allowUnclassified) {
    return {
      ok: false,
      code: 1,
      error: `${unclassified.length} unclassified path(s); add a rule or pass --allow-unclassified`,
      unclassified,
      ruleHits,
    };
  }

  const outPath =
    opts.outPath || path.join(root, "_mc", "MANIFEST.json");

  const selfRel = relPath(root, path.resolve(outPath));
  if (!opts.dryRun && selfRel && !selfRel.startsWith("..") && !paths[selfRel]) {
    const self = classify(selfRel, rules);
    if (self && self.entry && self.entry.owner !== "framework") {
      paths[selfRel] = { ...self.entry };
      ruleHits[self.rule] = (ruleHits[self.rule] || 0) + 1;
    }
  }

  const manifest = {
    $schema: SCHEMA_ID,
    version: 1,
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: "scripts/mc/manifest/build.js",
    mcVersion,
    migrations: [],
    paths,
  };

  if (opts.dryRun) {
    return {
      ok: true,
      code: 0,
      dryRun: true,
      outPath,
      ruleHits,
      pathCount: Object.keys(paths).length,
      unclassifiedCount: unclassified.length,
      manifestPreview: { ...manifest, paths: undefined, _pathCount: Object.keys(paths).length },
    };
  }

  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
  } catch (err) {
    return {
      ok: false,
      code: 2,
      error: `write failed: ${err.message}`,
      outPath,
    };
  }

  return {
    ok: true,
    code: 0,
    outPath,
    ruleHits,
    pathCount: Object.keys(paths).length,
    unclassifiedCount: unclassified.length,
  };
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    printHelp();
    return 0;
  }
  const r = build(opts);
  if (opts.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  } else if (!r.ok) {
    process.stderr.write(`manifest build failed: ${r.error}\n`);
    if (r.unclassified) {
      process.stderr.write(
        `unclassified (showing first 10):\n${r.unclassified.slice(0, 10).map((p) => "  " + p).join("\n")}\n`,
      );
      if (r.unclassified.length > 10) {
        process.stderr.write(
          `  ... and ${r.unclassified.length - 10} more\n`,
        );
      }
    }
  } else {
    process.stdout.write(
      `manifest written: ${r.outPath}\n  paths: ${r.pathCount}\n  rules hit: ${Object.keys(r.ruleHits).length}\n`,
    );
    if (r.dryRun)
      process.stdout.write(`  (dry-run — no file was written)\n`);
  }
  return r.code;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { build, buildRules, classify, sha256OfFile };
