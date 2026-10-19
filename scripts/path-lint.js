#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const { PATHS } = (() => {
  try {
    return require("./hooks/lib/paths");
  } catch {
    return { PATHS: {} };
  }
})();

const GENERATED_RULES = (() => {
  try {
    return require("./path-lint.rules.generated.json");
  } catch {
    return null;
  }
})();

const PROJECT = path.resolve(process.env.CLAUDE_PROJECT_DIR || ".");
const argv = process.argv.slice(2);
const FLAGS = {
  json: argv.includes("--json"),
  strict: argv.includes("--strict"),
  fixIndex: argv.includes("--fix-index"),
};
const scopeGlob = argv.find((a) => !a.startsWith("--"));

const CRITICAL = [
  {
    re: /\.claude\/events\/[^/\s"'`)\]]/g,
    suggestion: ".claude/project/events/ (or PATHS.events)",
    why: "path moved under .claude/project/ in v2 layout",
  },
  {
    re: /\.claude\/memory\/[^/\s"'`)\]]/g,
    suggestion: ".claude/project/memory/ (or PATHS.memory)",
    why: "path moved under .claude/project/ in v2 layout",
  },
  {
    re: /\.claude\/maps\/[^/\s"'`)\]]/g,
    suggestion: ".claude/project/maps/ (or PATHS.maps)",
    why: "path moved under .claude/project/ in v2 layout",
  },
  {
    re: /\.claude\/handoffs\//g,
    suggestion: ".claude/runtime/handoffs/ (or PATHS.handoffs)",
    why: "handoffs moved under .claude/runtime/",
  },
  {
    re: /\.claude\/logs\//g,
    suggestion: ".claude/runtime/logs/ (or PATHS.logs)",
    why: "logs moved under .claude/runtime/",
  },
  {
    re: /\.claude\/plans\//g,
    suggestion: ".claude/runtime/plans/ (or PATHS.plans)",
    why: "plans moved under .claude/runtime/",
  },
  {
    re: /context-enhancer\.js/g,
    suggestion: "smart-context.js",
    why: "renamed",
  },
  {
    re: /prompt-enhancer\.js/g,
    suggestion: "smart-context.js",
    why: "merged into smart-context.js",
  },
  {
    re: /\.claude\/agents\/\.system\/oneshot\/store\.json/g,
    suggestion: ".claude/agents/store.json (or PATHS.store)",
    why: "wrong path — no .system/oneshot/ dir",
  },
  {
    re: /\bbeta-persona\.md\b/g,
    suggestion: "judgement-model.md (or PATHS.judgmentModel)",
    why: "renamed to judgement-model.md",
  },
  {
    re: /\.beta-mining-recommendations\.md/g,
    suggestion: "judgement-model-recommendations.md",
    why: "renamed to judgement-model-recommendations.md",
  },
];

const WARN = [
  {
    re: /\.claude\/project\/events\/events\.jsonl/g,
    key: "eventsFile",
  },
  {
    re: /\.claude\/project\/events\/tools\.jsonl/g,
    key: "toolsFile",
  },
  {
    re: /\.claude\/project\/events\/requirements\.jsonl/g,
    key: "requirementsFile",
  },
  {
    re: /\.claude\/project\/events\/requirements-staged\.jsonl/g,
    key: "requirementsStagedFile",
  },
  {
    re: /\.claude\/project\/memory\/learnings\.jsonl/g,
    key: "learningsFile",
  },
  {
    re: /\.claude\/project\/memory\/traces\.jsonl/g,
    key: "tracesFile",
  },
  {
    re: /\.claude\/project\/memory\/systems\.jsonl/g,
    key: "systemsFile",
  },
  {
    re: /\.claude\/agents\/president\/\.system\/beta\/judgement-model\.md/g,
    key: "judgmentModel",
  },
  {
    re: /\.claude\/agents\/president\/\.system\/beta\/judgement-model-recommendations\.md/g,
    key: "judgmentRecommendations",
  },
  {
    re: /\.claude\/agents\/president\/\.system\/beta\/events\.jsonl/g,
    key: "betaEvents",
  },
  {
    re: /\.claude\/agents\/president\/\.system\/beta\/beta-source-data\.md/g,
    key: "betaSourceData",
  },
  {
    re: /\.claude\/agents\/president\/\.system\/lexicon\.md/g,
    key: "lexicon",
  },
  {
    re: /scripts\/hooks\/lib\/paths\.js/g,
    key: "pathsLib",
  },
  {
    re: /scripts\/hooks\/lib\/logger\.js/g,
    key: "loggerLib",
  },
  {
    re: /\.claude\/runtime\/handoff\.md/g,
    key: "handoffLatest",
  },
  {
    re: /\.claude\/agents\/store\.json/g,
    key: "store",
  },
];

if (GENERATED_RULES) {
  for (const r of GENERATED_RULES.critical || []) {
    if (!r.match) continue;
    try {
      CRITICAL.push({
        re: new RegExp(r.match, "g"),
        suggestion: r.suggestion || "",
        why: r.why || "registry rule",
      });
    } catch {
    }
  }
  for (const r of GENERATED_RULES.warn || []) {
    if (!r.match || !r.key) continue;
    try {
      WARN.push({
        re: new RegExp(r.match, "g"),
        key: r.key,
      });
    } catch {
    }
  }
}

const EXTENSIONS = new Set([
  ".md",
  ".js",
  ".cjs",
  ".mjs",
  ".json",
  ".ts",
  ".tsx",
  ".sh",
  ".ps1",
  ".yml",
  ".yaml",
]);

const ALLOW_MARKER = "path-literal-allowed";
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "out",
  "build",
  "coverage",
  ".worktrees",
]);
const SKIP_SUBSTRINGS = [
  ".claude/runtime/",
  ".claude/project/events/",
  ".claude/project/memory/",
  ".claude/project/maps/",
  "framework/paths.registry.json",
  ".claude/project/sprint/",
  "_requirements/_audits/",
  "_docs/",
  ".claude/paths.json",
  "scripts/path-lint.js",
  "scripts/hooks/path-guard.js",
  "/scan/references.md",
  "_requirements/03-architecture/PATH_KEYS.md",
  ".claude/dreams/",
  ".claude/agents/president/_system/oneshot/retros/",
  ".claude/agents/.system/dispatch-backups/",
  "backups/",
  "ROADMAP.md",
  ".claude/.session-checkpoint.json",
  ".claude/.last-checkpoint",
  ".claude/.agent-result-hashes.json",
  "CHANGELOG.md",
  "scripts/hooks/team-guard.js",
  "framework/paths.registry.json",
  "scripts/path-lint.rules.generated.json",
  "schemas/paths.schema.json",
  "_requirements/03-architecture/PATH_KEYS.md",
  "framework/releases/",
  ".mc/",
];

const LOCAL_SKIPS_FILE = path.join(PROJECT, ".claude", "project", "memory", "path-lint.local.json");
const LOCAL_SKIPS = (() => {
  let raw;
  try {
    raw = fs.readFileSync(LOCAL_SKIPS_FILE, "utf8").replace(/^\uFEFF/, "");
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    console.error("path-lint: instance-local skip file unreadable");
    process.exit(2);
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch {
    cfg = null;
  }
  if (!cfg || !Array.isArray(cfg.skipSubstrings) || cfg.skipSubstrings.some((s) => typeof s !== "string" || !s)) {
    console.error("path-lint: instance-local skip file malformed (expected { \"skipSubstrings\": [\"…\"] })");
    process.exit(2);
  }
  return cfg.skipSubstrings;
})();
if (LOCAL_SKIPS) SKIP_SUBSTRINGS.push(...LOCAL_SKIPS);

const critical = [];
const warnings = [];
let filesScanned = 0;

function shouldSkip(rel) {
  return rel.startsWith("runtime/") || SKIP_SUBSTRINGS.some((s) => rel.includes(s));
}

function lintContent(rel, content) {
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    for (const rule of CRITICAL) {
      const m = line.match(rule.re);
      if (m) {
        for (const hit of m) {
          critical.push({
            file: rel,
            line: i + 1,
            match: hit,
            suggestion: rule.suggestion,
            why: rule.why,
          });
        }
      }
    }
    for (const rule of WARN) {
      const m = line.match(rule.re);
      if (m) {
        for (const hit of m) {
          warnings.push({
            file: rel,
            line: i + 1,
            match: hit,
            key: rule.key,
            suggestion: `PATHS.${rule.key}`,
          });
        }
      }
    }
  });
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full);
      continue;
    }
    if (!EXTENSIONS.has(path.extname(entry.name))) continue;
    const rel = path.relative(PROJECT, full).replace(/\\/g, "/");
    if (shouldSkip(rel)) continue;
    if (scopeGlob && !rel.includes(scopeGlob)) continue;
    filesScanned++;
    try {
      const content = fs.readFileSync(full, "utf8");
      lintContent(rel, content);
    } catch {
    }
  }
}

walk(PROJECT);

if (FLAGS.json) {
  console.log(
    JSON.stringify(
      {
        filesScanned,
        instanceSkips: LOCAL_SKIPS ? LOCAL_SKIPS.length : "none (no instance-local skip file)",
        critical,
        warnings,
      },
      null,
      2,
    ),
  );
} else {
  console.log(`\nPath lint — ${filesScanned} files scanned (instance-local skips: ${LOCAL_SKIPS ? LOCAL_SKIPS.length : "none, no local file"})\n`);
  if (critical.length === 0 && warnings.length === 0) {
    console.log("  ✓ No hardcoded paths found.\n");
  } else {
    console.log(
      `  CRITICAL: ${critical.length}  WARN: ${warnings.length}  INFO: 0\n`,
    );

    if (critical.length > 0) {
      console.log("  === CRITICAL (must fix) ===\n");
      const byFile = {};
      for (const f of critical) {
        byFile[f.file] = byFile[f.file] || [];
        byFile[f.file].push(f);
      }
      for (const [file, fs] of Object.entries(byFile).sort(
        (a, b) => b[1].length - a[1].length,
      )) {
        console.log(`  ${file}  (${fs.length})`);
        for (const f of fs.slice(0, 5)) {
          console.log(`    :${f.line}  ${f.match}  →  ${f.suggestion}`);
        }
        if (fs.length > 5) console.log(`    … and ${fs.length - 5} more`);
      }
    }

    if (warnings.length > 0) {
      console.log("\n  === WARN (dedicated paths.json key exists) ===\n");
      const byKey = {};
      for (const w of warnings) {
        byKey[w.key] = byKey[w.key] || [];
        byKey[w.key].push(w);
      }
      for (const [key, items] of Object.entries(byKey).sort(
        (a, b) => b[1].length - a[1].length,
      )) {
        console.log(`  paths.${key}  (${items.length} hardcoded uses)`);
        const topFiles = {};
        for (const i of items) topFiles[i.file] = (topFiles[i.file] || 0) + 1;
        const sorted = Object.entries(topFiles)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3);
        for (const [f, n] of sorted) console.log(`    ${f} (${n})`);
      }
    }

    console.log("");
  }
}

const shouldFail = critical.length > 0 || (FLAGS.strict && warnings.length > 0);
process.exit(shouldFail ? 1 : 0);
