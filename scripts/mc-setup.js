#!/usr/bin/env node

const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const {
  scaffoldProduct,
  populateMcMirror,
  regenerateMcManifest,
  writeProductManifest,
  writeAgentStore,
  writeProductSettings,
} = require("./mc/scaffold-core");

const OK = "\x1b[32m  ✓  \x1b[0m";
const WARN = "\x1b[33m  !  \x1b[0m";
const FAIL = "\x1b[31m  ✗  \x1b[0m";
const INFO = "\x1b[36m  →  \x1b[0m";
const HEADER = "\x1b[1m";
const RESET = "\x1b[0m";

function log(status, msg, detail) {
  const icon =
    status === "ok"
      ? OK
      : status === "warn"
        ? WARN
        : status === "fail"
          ? FAIL
          : INFO;
  console.log(`${icon} ${msg}`);
  if (detail) console.log(`       ${detail}`);
}

function cmdExists(cmd) {
  try {
    execSync(`which ${cmd} 2>/dev/null || where ${cmd} 2>NUL`, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return 0;
  let count = 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyDir(srcPath, destPath);
    } else {
      if (fs.existsSync(destPath)) {
        log("warn", `Skipped (exists): ${path.relative(TARGET, destPath)}`);
      } else {
        fs.copyFileSync(srcPath, destPath);
        count++;
      }
    }
  }
  return count;
}

if (process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  console.log(
    [
      "Usage: node scripts/mc-setup.js [target-project-path] [flags]",
      "",
      "Installs MC into the target project (default: the current directory).",
      "",
      "Flags:",
      "  --dry-run              print the install plan instead of installing",
      "  --skip-backup          do not back up existing config to .mc-backup/",
      "  --skip-manifest-check  skip the post-install manifest-coverage check",
      "  --strict-manifest      exit non-zero when the manifest-coverage check has findings",
      "  --help, -h             print this help and exit without installing",
    ].join("\n"),
  );
  process.exit(0);
}
const argv = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const TARGET = path.resolve(argv[0] || ".");
const MC = path.resolve(__dirname, "..");
const YES = flags.has("--yes") || flags.has("-y");
const DRY_RUN = flags.has("--dry-run");
const SKIP_BACKUP = flags.has("--skip-backup");
const SKIP_MANIFEST_CHECK = flags.has("--skip-manifest-check");
const STRICT_MANIFEST = flags.has("--strict-manifest");

if (!fs.existsSync(TARGET)) {
  console.error(`Target directory does not exist: ${TARGET}`);
  process.exit(1);
}

function backupExisting() {
  if (SKIP_BACKUP) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(TARGET, ".mc-backup", ts);
  const backupTargets = [
    "CLAUDE.md",
    "AGENTS.md",
    ".gitignore",
    ".claude",
    "scripts/hooks",
  ];
  let backedUp = 0;
  for (const rel of backupTargets) {
    const src = path.join(TARGET, rel);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(backupRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      const copyDirRecursive = (s, d) => {
        fs.mkdirSync(d, { recursive: true });
        for (const entry of fs.readdirSync(s, { withFileTypes: true })) {
          const sp = path.join(s, entry.name);
          const dp = path.join(d, entry.name);
          if (entry.isDirectory()) copyDirRecursive(sp, dp);
          else fs.copyFileSync(sp, dp);
        }
      };
      copyDirRecursive(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
    backedUp++;
  }
  if (backedUp > 0) {
    fs.writeFileSync(
      path.join(backupRoot, "BACKUP_MANIFEST.json"),
      JSON.stringify(
        {
          created: new Date().toISOString(),
          files_backed_up: backedUp,
          mc_version: MC,
        },
        null,
        2,
      ),
    );
    log(
      "ok",
      `Backed up ${backedUp} pre-install file(s) to .mc-backup/${ts}/`,
    );
    log("info", "/mc:uninstall restores from this backup.");
  }
  return backupRoot;
}

function ask(rl, question, defaultValue) {
  return new Promise((resolve) => {
    const suffix = defaultValue ? `\x1b[2m [${defaultValue}]\x1b[0m` : "";
    rl.question(`  ${question}${suffix} > `, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

function detectMainBranch(targetDir) {
  try {
    const head = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      cwd: targetDir,
      stdio: ["pipe", "pipe", "pipe"],
    })
      .toString()
      .trim();
    const m = head.match(/origin\/(.+)$/);
    if (m) return m[1];
  } catch {
  }
  try {
    const branches = execSync("git branch --list main master", {
      cwd: targetDir,
      stdio: ["pipe", "pipe", "pipe"],
    })
      .toString()
      .trim();
    if (branches.includes("main")) return "main";
    if (branches.includes("master")) return "master";
  } catch {
  }
  return "main";
}

function detectTool(tool) {
  try {
    execSync(`${tool} --version`, { stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
  }
  try {
    const localBin = path.join(TARGET, "node_modules", ".bin", tool);
    if (fs.existsSync(localBin) || fs.existsSync(localBin + ".cmd")) {
      return true;
    }
  } catch {
  }
  return false;
}

console.log(`\n${HEADER}  MC Setup${RESET}`);
console.log(`  Installing into: ${TARGET}`);
console.log(`  From: ${MC}`);
console.log(`  ${"─".repeat(50)}\n`);

let errors = 0;
let warnings = 0;
let installed = 0;

console.log(`${HEADER}  PREREQUISITES${RESET}`);

const major = parseInt(process.version.slice(1));
if (major >= 18) {
  log("ok", `Node.js ${process.version}`);
} else {
  log("fail", `Node.js ${process.version} — need 18 or newer`);
  log("info", "Download from https://nodejs.org");
  errors++;
}

if (cmdExists("git")) {
  log("ok", "Git installed");
} else {
  log(
    "fail",
    "Git not found — required for version control and builder isolation",
  );
  errors++;
}

if (fs.existsSync(path.join(TARGET, ".git"))) {
  log("ok", "Target is a git repo");
} else {
  log("warn", "Target is not a git repo — some features need git");
  log("info", "Run: git init");
  warnings++;
}

if (process.platform !== "win32") {
  log(
    "warn",
    "MC is Windows-only for now. Some features may not work on this platform.",
  );
  warnings++;
}

if (errors > 0) {
  console.log(`\n${FAIL} ${errors} prerequisite(s) failed. Fix them first.`);
  process.exit(1);
}

console.log(`\n${HEADER}  PROJECT DETECTION${RESET}`);

const hasPackageJson = fs.existsSync(path.join(TARGET, "package.json"));
const hasTsConfig = fs.existsSync(path.join(TARGET, "tsconfig.json"));
const hasRequirementsTxt = fs.existsSync(path.join(TARGET, "requirements.txt"));
const hasGoMod = fs.existsSync(path.join(TARGET, "go.mod"));
const hasCargoToml = fs.existsSync(path.join(TARGET, "Cargo.toml"));

let stack = "unknown";
let framework = "unknown";
if (hasPackageJson) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(TARGET, "package.json"), "utf8"),
    );
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.next) {
      stack = "node";
      framework = "next.js";
    } else if (deps.react) {
      stack = "node";
      framework = "react";
    } else if (deps.express) {
      stack = "node";
      framework = "express";
    } else if (deps.vue) {
      stack = "node";
      framework = "vue";
    } else {
      stack = "node";
      framework = "node.js";
    }
  } catch {
    stack = "node";
  }
} else if (hasRequirementsTxt) {
  stack = "python";
  framework = "python";
} else if (hasGoMod) {
  stack = "go";
  framework = "go";
} else if (hasCargoToml) {
  stack = "rust";
  framework = "rust";
}

log("ok", `Stack: ${stack}, Framework: ${framework}`);
if (hasTsConfig) log("ok", "TypeScript detected");

log(
  "info",
  `Project name: ${path.basename(TARGET)}`,
);

const projectNameDefault = path.basename(TARGET);
const mainBranchDefault = detectMainBranch(TARGET);
const mcSourceDefault = "https://github.com/cygaco/master-console.git";

const interview = {
  projectName: projectNameDefault,
  pitch: "",
  mainBranch: mainBranchDefault,
  mcSource: mcSourceDefault,
};

async function runInterview() {
  if (YES || !flags.has("--interactive")) return;
  if (!process.stdin.isTTY) return;
  console.log(`\n${HEADER}  INTERVIEW${RESET}`);
  console.log(`  (5 questions — press Enter to accept defaults)\n`);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  interview.projectName = await ask(rl, "Project name", projectNameDefault);
  interview.pitch = await ask(rl, "One-line pitch", "");
  interview.mainBranch = await ask(rl, "Main branch", mainBranchDefault);
  interview.mcSource = await ask(
    rl,
    "MC repo URL (for /mc:sync, /mc:check)",
    mcSourceDefault,
  );
  rl.close();
}

const hookTools = {
  prettier: detectTool("prettier") || detectTool("npx prettier"),
  tsc: hasTsConfig && (detectTool("tsc") || detectTool("npx tsc")),
  eslint: detectTool("eslint") || detectTool("npx eslint"),
};

console.log(`\n${HEADER}  BACKUP${RESET}`);
let backupPath = null;
if (DRY_RUN) {
  log(
    "info",
    "[dry-run] Would back up pre-install files to .mc-backup/<ts>/",
  );
} else {
  backupPath = backupExisting();
  if (!backupPath)
    log("info", "No pre-install files to back up (clean target).");
}

if (DRY_RUN) {
  console.log(`\n${HEADER}  [dry-run] CREATING STRUCTURE — skipped${RESET}`);
} else console.log(`\n${HEADER}  CREATING STRUCTURE${RESET}`);

const dirs = [
  ".claude",
  ".claude/project/events",
  ".claude/project/memory",
  ".claude/project/maps",
  ".claude/project/reference",
  ".claude/runtime",
  ".claude/runtime/handoffs",
  ".claude/runtime/logs",
  ".claude/agents",
  ".claude/commands",
  ".claude/content",
  ".claude/dreams",
  "scripts/hooks/lib",
];

if (!DRY_RUN) {
  for (const dir of dirs) {
    const abs = path.join(TARGET, dir);
    if (!fs.existsSync(abs)) {
      fs.mkdirSync(abs, { recursive: true });
      log("info", `Created: ${dir}/`);
      installed++;
    }
  }
}

console.log(`\n${HEADER}  INSTALLING FRAMEWORK${RESET}`);

const manifestPath = path.join(MC, ".claude", "framework-manifest.json");
let shipManifest = null;
try {
  shipManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch (e) {
  log(
    "fail",
    `Could not read ship-manifest at ${manifestPath} — cannot install.`,
  );
  log(
    "info",
    "Run `node scripts/generate-framework-manifest.js` in the MC repo first.",
  );
  process.exit(1);
}
log(
  "info",
  `Using ship-manifest v${shipManifest.version} (${shipManifest.total} assets + ${shipManifest.generated_files.length} generated)`,
);

const installedSnapshotPath = path.join(
  TARGET,
  ".claude",
  "framework-installed.json",
);
const currentAssetPaths = new Set();
for (const entries of Object.values(shipManifest.assets)) {
  for (const e of entries) currentAssetPaths.add(e.dest);
}
let ghostList = [];
if (fs.existsSync(installedSnapshotPath)) {
  try {
    const prior = JSON.parse(fs.readFileSync(installedSnapshotPath, "utf8"));
    const priorPaths = prior.installed_files || [];
    ghostList = priorPaths.filter(
      (p) => !currentAssetPaths.has(p) && fs.existsSync(path.join(TARGET, p)),
    );
    if (ghostList.length > 0) {
      log(
        "warn",
        `Found ${ghostList.length} ghost files from prior install (renamed/removed upstream):`,
      );
      for (const g of ghostList.slice(0, 10)) console.log(`         - ${g}`);
      if (ghostList.length > 10)
        console.log(`         ... and ${ghostList.length - 10} more`);
      if (flags.has("--clean-ghosts")) {
        let cleaned = 0;
        for (const g of ghostList) {
          try {
            fs.unlinkSync(path.join(TARGET, g));
            cleaned++;
          } catch {
          }
        }
        log("ok", `Cleaned ${cleaned} ghost files (--clean-ghosts)`);
      } else {
        log(
          "info",
          "Run with --clean-ghosts to delete them, or remove manually.",
        );
      }
    } else {
      log("ok", "No ghost files from prior install");
    }
  } catch {
  }
}

if (DRY_RUN) {
  console.log(`\n${HEADER}  DRY-RUN PLAN${RESET}`);
  console.log(
    `  Would install ${shipManifest.total} assets across these kinds:`,
  );
  for (const [kind, entries] of Object.entries(shipManifest.counts).sort(
    (a, b) => b[1] - a[1],
  )) {
    let existing = 0;
    const kindEntries = shipManifest.assets[kind] || [];
    for (const e of kindEntries) {
      if (fs.existsSync(path.join(TARGET, e.dest))) existing++;
    }
    console.log(
      `    ${kind.padEnd(18, " ")} ${entries} total; ${existing} already exist (would skip)`,
    );
  }
  console.log(
    `\n  Would generate ${shipManifest.generated_files.length} files:`,
  );
  for (const g of shipManifest.generated_files) {
    const exists = fs.existsSync(path.join(TARGET, g.dest));
    console.log(
      `    ${g.dest.padEnd(44, " ")} via ${g.builder}${exists ? " [exists]" : ""}`,
    );
  }
  if (ghostList.length > 0) {
    console.log(
      `\n  Would detect ${ghostList.length} ghost files. Add --clean-ghosts to remove.`,
    );
  }
  console.log(
    `\n  No files were written. Re-run without --dry-run to install.\n`,
  );
  process.exit(0);
}

const SKIP_KINDS = new Set(["framework_doc"]);

const installedByKind = {};
let installedThisRun = 0;
for (const [kind, entries] of Object.entries(shipManifest.assets)) {
  if (SKIP_KINDS.has(kind)) continue;
  let n = 0;
  for (const entry of entries) {
    const src = path.join(MC, entry.src);
    const dest = path.join(TARGET, entry.dest);
    if (!fs.existsSync(src)) continue;
    if (fs.existsSync(dest)) {
      log("warn", `Skipped (exists): ${entry.dest}`);
      warnings++;
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    n++;
  }
  if (n > 0) {
    installedByKind[kind] = n;
    installedThisRun += n;
  }
}
for (const [kind, n] of Object.entries(installedByKind).sort(
  (a, b) => b[1] - a[1],
)) {
  log("ok", `${kind}: ${n} files installed`);
}
installed += installedThisRun;

{
  const { installedDelta } = scaffoldProduct({
    target: TARGET,
    mcRoot: MC,
    log,
  });
  installed += installedDelta;
}

// ── 6. Create manifest.json ─────────────────────────────
{
  const { installedDelta } = writeProductManifest({
    target: TARGET,
    interview,
    stack,
    framework,
    log,
  });
  installed += installedDelta;
}

{
  const { installedDelta } = writeAgentStore({ target: TARGET, log });
  installed += installedDelta;
}

const memoryFiles = [
  ".claude/project/events/events.jsonl",
  ".claude/project/memory/learnings.jsonl",
  ".claude/project/memory/traces.jsonl",
];

for (const file of memoryFiles) {
  const abs = path.join(TARGET, file);
  if (!fs.existsSync(abs)) {
    fs.writeFileSync(abs, "");
    log("info", `Created empty: ${file}`);
    installed++;
  }
}

const systemsFile = path.join(TARGET, ".claude/project/memory/systems.jsonl");
if (!fs.existsSync(systemsFile)) {
  const now = new Date().toISOString();
  const seed = [
    {
      id: "identity",
      name: "Alex identity",
      category: "identity",
      files: ["CLAUDE.md", "AGENTS.md"],
      status: "active",
      created: now,
    },
    {
      id: "agents",
      name: "Agent team + build chains",
      category: "agents",
      dir: ".claude/agents",
      status: "active",
      created: now,
    },
    {
      id: "skills",
      name: "Skills",
      category: "capability",
      dir: ".claude/commands",
      status: "active",
      created: now,
    },
    {
      id: "hooks",
      name: "Hooks",
      category: "automation",
      dir: "scripts/hooks",
      status: "active",
      created: now,
    },
    {
      id: "memory",
      name: "Memory stores",
      category: "memory",
      keys: [
        "eventsFile",
        "learningsFile",
        "tracesFile",
        "systemsFile",
        "betaEvents",
      ],
      status: "active",
      created: now,
    },
    {
      id: "maps",
      name: "Relationship maps",
      category: "infrastructure",
      key: "maps",
      status: "active",
      created: now,
    },
    {
      id: "paths-registry",
      name: "Paths registry",
      category: "infrastructure",
      path: ".claude/paths.json",
      status: "active",
      created: now,
    },
    {
      id: "manifest",
      name: "Project manifest",
      category: "infrastructure",
      key: "manifest",
      status: "active",
      created: now,
    },
    {
      id: "settings",
      name: "Hook settings",
      category: "infrastructure",
      key: "settings",
      status: "active",
      created: now,
    },
    {
      id: "store",
      name: "Build store",
      category: "orchestration",
      key: "store",
      status: "active",
      created: now,
    },
    {
      id: "spec-graph",
      name: "Spec dependency graph",
      category: "infrastructure",
      key: "specGraph",
      status: "active",
      created: now,
    },
    {
      id: "reference-docs",
      name: "Reference documentation",
      category: "knowledge",
      key: "reference",
      status: "active",
      created: now,
    },
    {
      id: "patterns",
      name: "Engineering patterns library",
      category: "knowledge",
      key: "patterns",
      status: "active",
      created: now,
    },
    {
      id: "requirements-templates",
      name: "Requirements spec templates",
      category: "product",
      key: "requirements",
      status: "active",
      created: now,
    },
    {
      id: "installer",
      name: "Installer",
      category: "product",
      files: ["scripts/mc-setup.js", "install.ps1", "version.json"],
      status: "active",
      created: now,
    },
    {
      id: "linters",
      name: "Lint suite",
      category: "quality",
      files: ["scripts/path-lint.js"],
      status: "active",
      created: now,
    },
  ];
  const content = seed.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(systemsFile, content);
  log("ok", `Seeded systems.jsonl with 16 canonical tiers`);
  installed++;
}

const gitignorePath = path.join(TARGET, ".gitignore");
const GITIGNORE_START = "# >>> MC runtime (managed, do not edit) >>>";
const GITIGNORE_END = "# <<< MC runtime <<<";
const runtimeBlock = [
  GITIGNORE_START,
  ".claude/runtime/",
  ".claude/content/",
  ".mc/",
  ".claude/project/events/",
  ".claude/project/memory/",
  ".claude/project/builds/",
  ".claude/project/decisions/provider-trace.jsonl",
  ".claude/agents/*/.workspace/",
  ".claude/agents/**/events.jsonl",
  ".claude/.session-id",
  ".claude/.session-prompts.log",
  ".claude/.session-tracking.jsonl",
  ".claude/.session-checkpoint.json",
  ".claude/.session-start-commit",
  ".claude/.store-lock",
  GITIGNORE_END,
].join("\n");

let gitignoreContent = "";
try {
  gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
} catch {
}

if (gitignoreContent.includes(GITIGNORE_START)) {
  const before = gitignoreContent.split(GITIGNORE_START)[0];
  const after =
    gitignoreContent.split(GITIGNORE_END)[1] !== undefined
      ? gitignoreContent.split(GITIGNORE_END)[1]
      : "";
  const updated = before + runtimeBlock + after;
  if (updated !== gitignoreContent) {
    fs.writeFileSync(gitignorePath, updated);
    log("ok", "Updated .gitignore runtime block");
  } else {
    log("ok", ".gitignore runtime block up to date");
  }
} else {
  const sep =
    gitignoreContent && !gitignoreContent.endsWith("\n") ? "\n\n" : "\n";
  fs.writeFileSync(gitignorePath, gitignoreContent + sep + runtimeBlock + "\n");
  log("ok", "Appended runtime block to .gitignore");
  installed++;
}

// ── 8. Merge settings.json ──────────────────────────────
{
  const { installedDelta } = writeProductSettings({
    target: TARGET,
    mcRoot: MC,
    hookTools,
    log,
    HEADER,
    RESET,
  });
  installed += installedDelta;
}

console.log(`\n${HEADER}  FRAMEWORK DOCS${RESET}`);

const claudeMdTarget = path.join(TARGET, "CLAUDE.md");
const claudeMdSource = path.join(MC, "CLAUDE.md");
const ALEX_MARKER = "You are **Alex α**";
if (!fs.existsSync(claudeMdTarget) && fs.existsSync(claudeMdSource)) {
  fs.copyFileSync(claudeMdSource, claudeMdTarget);
  log("ok", "Created CLAUDE.md with Alex identity");
  installed++;
} else if (fs.existsSync(claudeMdTarget) && fs.existsSync(claudeMdSource)) {
  const userContent = fs.readFileSync(claudeMdTarget, "utf8");
  if (userContent.includes(ALEX_MARKER)) {
    log("ok", "CLAUDE.md already has Alex identity — no merge needed");
  } else {
    const alexContent = fs.readFileSync(claudeMdSource, "utf8");
    const separator = userContent.endsWith("\n") ? "\n---\n\n" : "\n\n---\n\n";
    fs.writeFileSync(claudeMdTarget, userContent + separator + alexContent);
    log(
      "ok",
      "Merged Alex framework into your existing CLAUDE.md (appended below your content)",
    );
    log(
      "info",
      "Revert: copy .mc-backup/<ts>/CLAUDE.md back over CLAUDE.md",
    );
    installed++;
  }
}

const agentsMdTarget = path.join(TARGET, "AGENTS.md");
const agentsMdSource = path.join(MC, "AGENTS.md");
const AGENTS_MARKER = "Alex identity card";
if (!fs.existsSync(agentsMdTarget) && fs.existsSync(agentsMdSource)) {
  fs.copyFileSync(agentsMdSource, agentsMdTarget);
  log("ok", "Created AGENTS.md with MC agent system");
  installed++;
} else if (fs.existsSync(agentsMdTarget) && fs.existsSync(agentsMdSource)) {
  const userAgents = fs.readFileSync(agentsMdTarget, "utf8");
  if (userAgents.includes(AGENTS_MARKER)) {
    log("ok", "AGENTS.md already has MC agent system — no merge needed");
  } else {
    const mcAgents = fs.readFileSync(agentsMdSource, "utf8");
    const sep = userAgents.endsWith("\n") ? "\n---\n\n" : "\n\n---\n\n";
    fs.writeFileSync(agentsMdTarget, userAgents + sep + mcAgents);
    log(
      "ok",
      "Merged MC agent system into your existing AGENTS.md (appended below your content)",
    );
    installed++;
  }
}

try {
  const cryptoMod = require("crypto");
  function sha256OfFile(absPath) {
    if (!absPath || !fs.existsSync(absPath)) return null;
    return cryptoMod
      .createHash("sha256")
      .update(fs.readFileSync(absPath))
      .digest("hex")
      .slice(0, 12);
  }

  let installedCommit = null;
  try {
    installedCommit = execSync("git rev-parse HEAD", {
      cwd: MC,
      stdio: ["pipe", "pipe", "pipe"],
    })
      .toString()
      .trim();
  } catch {
  }

  const installedFiles = [];
  const perAsset = [];
  for (const [kind, entries] of Object.entries(shipManifest.assets)) {
    for (const e of entries) {
      installedFiles.push(e.dest);
      const srcAbs = path.join(MC, e.src);
      const destAbs = path.join(TARGET, e.dest);
      perAsset.push({
        id: e.id || null,
        kind,
        src: e.src,
        dest: e.dest,
        installedHash: e.sha256 || sha256OfFile(srcAbs),
        currentHashAtInstall: sha256OfFile(destAbs),
        owner: e.owner || "framework",
        mergeStrategy: e.mergeStrategy || "replace_if_unmodified",
        introducedIn: e.introducedIn || null,
      });
    }
  }

  const generated = [];
  for (const g of shipManifest.generated_files || []) {
    const destAbs = path.join(TARGET, g.dest);
    generated.push({
      dest: g.dest,
      builder: g.builder,
      idempotent: !!g.idempotent,
      hashAtInstall: sha256OfFile(destAbs),
    });
  }

  const snapshot = {
    $schema: "mc/framework-installed/v2",
    manifest_version: shipManifest.version,
    manifest_schema: shipManifest.$schema || "mc/framework-manifest/v2",
    installedVersion: shipManifest.version,
    installedCommit,
    installedAt: new Date().toISOString(),
    source: interview.mcSource || "https://github.com/cygaco/master-console.git",
    counts: shipManifest.counts,
    installed_files: installedFiles.sort(),
    assets: perAsset.sort((a, b) => a.dest.localeCompare(b.dest)),
    generated: generated.sort((a, b) => a.dest.localeCompare(b.dest)),
  };
  fs.writeFileSync(
    installedSnapshotPath,
    JSON.stringify(snapshot, null, 2) + "\n",
  );
  log(
    "ok",
    `Wrote .claude/framework-installed.json (schema v2: ${perAsset.length} assets + ${generated.length} generated)`,
  );
} catch (e) {
  log("warn", `Could not write framework-installed.json: ${e.message}`);
}

{
  const { installedDelta } = populateMcMirror({
    target: TARGET,
    mcRoot: MC,
    shipManifest,
    log,
    HEADER,
    RESET,
  });
  installed += installedDelta;
}

const codexPresent = cmdExists("codex");
const agyPresent = cmdExists("agy");

console.log(`\n${"─".repeat(54)}`);
console.log(`${HEADER}  SETUP COMPLETE${RESET}\n`);
console.log(`  ${OK} ${installed} files installed`);
if (warnings > 0)
  console.log(`  ${WARN} ${warnings} warnings (existing files kept)`);

console.log(`\n${HEADER}  PROVIDER CLIs${RESET}`);
console.log(
  `  MC routes review/security agents through other AI providers`,
);
console.log(
  `  for model diversity. Same-model review is blind to shared failure`,
);
console.log(`  modes — so review/compliance/qa run on OpenAI, and the`);
console.log(
  `  security reviewer's Gemini lab runs through Antigravity (agy).`,
);
console.log(`  Without these CLIs, agents fall back to`);
console.log(`  Claude (still works, just loses the diversity benefit).\n`);

if (codexPresent) {
  console.log(`  ${OK} Codex CLI detected (review agents will use OpenAI)`);
} else {
  console.log(
    `  ${WARN} Codex CLI missing — review agents will fall back to Claude`,
  );
  console.log(`       Install:  npm i -g @openai/codex`);
  console.log(`       Auth:     codex login   (or set OPENAI_API_KEY)`);
}
if (agyPresent) {
  console.log(`  ${OK} Antigravity CLI (agy) detected (security reviewer's Gemini lab)`);
} else {
  console.log(
    `  ${WARN} Antigravity CLI (agy) missing — the Gemini security lab will fall back to Claude`,
  );
  console.log(`       Install:  the standalone Antigravity 'agy' CLI (not npm)`);
  console.log(`       Auth:     sign in to Antigravity so its ~/.gemini keyring carries a session`);
}

if (!SKIP_MANIFEST_CHECK) {
  console.log(`\n${HEADER}  MANIFEST COVERAGE${RESET}`);
  const mcZone = path.join(TARGET, "_mc");
  if (!fs.existsSync(mcZone)) {
    log("info", "_mc/ not present in target — skipping manifest coverage (legacy install layout)");
  } else {
    const validateScript = path.join(MC, "scripts/mc/manifest/validate.js");
    let coverageExitCode = 0;
    let coverageSummary = null;
    try {
      const { spawnSync } = require("child_process");
      const buildRes = regenerateMcManifest({ target: TARGET, mcRoot: MC, log });
      if (!buildRes.ok) {
      } else {
        const valRes = spawnSync(
          process.execPath,
          [validateScript, "--root", TARGET, "--json"],
          { encoding: "utf8" },
        );
        try {
          const parsed = JSON.parse(valRes.stdout);
          coverageSummary = parsed;
          const f = parsed.findings || {};
          const totals = {
            missing: (f.missing || []).length,
            drift: (f.drift || []).length,
            unmanifested: (f.unmanifested || []).length,
            user_modified: (f.user_modified || []).length,
            schema_violation: (f.schema_violation || []).length,
          };
          const total = Object.values(totals).reduce((a, b) => a + b, 0);
          const oc = parsed.ownerCounts || {};
          log("ok", `manifest: ${parsed.pathCount || "?"} paths; framework=${oc.framework || 0} generated=${oc.generated || 0} project=${oc.project || 0} runtime=${oc.runtime || 0}`);
          if (total === 0) {
            log("ok", "manifest coverage: CLEAN (no findings)");
          } else {
            log("warn", `manifest coverage: ${total} finding(s) — missing=${totals.missing} drift=${totals.drift} unmanifested=${totals.unmanifested} user_modified=${totals.user_modified} schema_violation=${totals.schema_violation}`);
            if (totals.unmanifested > 0) {
              log("warn", `  unmanifested (first 5): ${(f.unmanifested || []).slice(0, 5).join(", ")}`);
            }
            if (STRICT_MANIFEST) {
              coverageExitCode = 1;
              log("error", "--strict-manifest set — refusing install completion with findings");
            } else {
              log("info", "Run with --strict-manifest to refuse install on findings. Or re-run /mc:setup --skip-manifest-check to silence.");
            }
          }
        } catch (e) {
          log("warn", `manifest validate.js output not parseable JSON: ${e.message}`);
        }
      }
    } catch (err) {
      log("warn", `manifest coverage check failed (${err.message}) — install continues`);
    }
    if (coverageExitCode !== 0) {
      console.log(`\n${HEADER}  INSTALL REFUSED (strict manifest)${RESET}`);
      process.exit(coverageExitCode);
    }
  }
}

const BOX_TOP =
  "\x1b[33m╔══════════════════════════════════════════════════════════════════╗\x1b[0m";
const BOX_MID = "\x1b[33m║\x1b[0m";
const BOX_BOT =
  "\x1b[33m╚══════════════════════════════════════════════════════════════════╝\x1b[0m";
console.log(`\n${BOX_TOP}`);
console.log(
  `${BOX_MID}  \x1b[1;33mNEXT: OPEN CLAUDE CODE IN THIS PROJECT\x1b[0m                            ${BOX_MID}`,
);
console.log(
  `${BOX_MID}                                                                  ${BOX_MID}`,
);
console.log(
  `${BOX_MID}  \x1b[1mAlready have it open?\x1b[0m  Close it entirely and reopen — Claude    ${BOX_MID}`,
);
console.log(
  `${BOX_MID}  Code only reads \x1b[1msettings.json\x1b[0m at launch, so hooks won't fire     ${BOX_MID}`,
);
console.log(
  `${BOX_MID}  until you restart.                                              ${BOX_MID}`,
);
console.log(
  `${BOX_MID}                                                                  ${BOX_MID}`,
);
console.log(
  `${BOX_MID}  \x1b[1mNot open yet?\x1b[0m  Just open it — you're good. No restart needed.   ${BOX_MID}`,
);
console.log(
  `${BOX_MID}                                                                  ${BOX_MID}`,
);
console.log(
  `${BOX_MID}  \x1b[2mEither way:\x1b[0m first prompt should be \x1b[1m/mc:health\x1b[0m              ${BOX_MID}`,
);
console.log(`${BOX_BOT}\n`);
console.log(`  First skill to run in Claude Code:`);
console.log(
  `    \x1b[1m/mc:setup\x1b[0m           confirms install state + guides you from here`,
);
console.log(``);
console.log(`  Other useful skills (after /mc:setup gives the green light):`);
console.log(`    \x1b[1m/mc:health\x1b[0m          verify every subsystem`);
console.log(
  `    \x1b[1m/maps:all\x1b[0m             generate relationship maps (powers smart-context enrichment)`,
);
console.log(`    \x1b[1m/scan:system\x1b[0m         manifest vs disk`);
console.log(`    \x1b[1m/scan:environment\x1b[0m    provider CLIs + auth`);
console.log(`    \x1b[1m/discover:systems\x1b[0m     6-angle system inventory`);
console.log(`    \x1b[1m/mc:tour\x1b[0m            guided walkthrough`);
console.log(
  `    \x1b[1m/mc:uninstall\x1b[0m       if something is wrong, revert cleanly\n`,
);
