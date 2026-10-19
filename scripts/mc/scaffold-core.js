#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SKELETON_DIRS = [
  "_requirements/_audits", "_requirements/_index", "_requirements/_shared",
  "_requirements/_standards", "_requirements/00-canonical",
  "_requirements/01-design-system", "_requirements/02-copy-system",
  "_requirements/03-architecture", "_requirements/04-features",
  "_requirements/05-operations", "_requirements/06-security",
  "_requirements/07-testing", "_requirements/08-automation",
  "_docs", "_docs/briefs", "_docs/clones",
];

function scaffoldProduct({ target, mcRoot, log }) {
  const TARGET = target;
  const MC = mcRoot;
  let installed = 0;

  const pathsFile = path.join(TARGET, ".claude/paths.json");
  const registryFile = path.join(TARGET, "framework", "paths.registry.json");
  let _registry = null;
  try {
    _registry = JSON.parse(fs.readFileSync(registryFile, "utf8"));
  } catch {
  }
  const _regEntries = _registry ? _registry.paths || _registry : null;
  if (_regEntries) {
    const buildScript = path.join(TARGET, "scripts", "paths", "build.js");
    let built = false;
    if (fs.existsSync(buildScript)) {
      const r = spawnSync(process.execPath, [buildScript], { cwd: TARGET, encoding: "utf8" });
      if (r.status === 0) {
        built = true;
        log("ok", "Generated paths.json via scripts/paths/build.js (canonical generator)");
        installed++;
      } else {
        log("warn", `paths/build.js exited ${r.status} — inline fallback. stderr: ${(r.stderr || "").trim().slice(0, 200)}`);
      }
    }
    if (!built) {
      const flat = { $schema: "mc/paths/v5", version: 5 };
      for (const [key, entry] of Object.entries(_regEntries)) {
        if (entry && typeof entry === "object" && typeof entry.path === "string" && !entry.removedIn) {
          flat[key] = entry.path;
        }
      }
      if (!fs.existsSync(pathsFile)) {
        fs.writeFileSync(pathsFile, JSON.stringify(flat, null, 2) + "\n");
        log("ok", `Created paths.json (inline fallback, ${Object.keys(flat).length} keys)`);
        installed++;
      } else {
        const existing = JSON.parse(fs.readFileSync(pathsFile, "utf8"));
        let added = 0;
        for (const [k, v] of Object.entries(flat)) {
          if (!(k in existing)) {
            existing[k] = v;
            added++;
          }
        }
        if (added > 0) {
          fs.writeFileSync(pathsFile, JSON.stringify(existing, null, 2) + "\n");
          log("ok", `Backfilled paths.json inline fallback (+${added} keys)`);
        }
      }
    }
    for (const entry of Object.values(_regEntries)) {
      if (entry && typeof entry === "object" && entry.kind === "dir" && typeof entry.path === "string") {
        try {
          fs.mkdirSync(path.join(TARGET, entry.path), { recursive: true });
        } catch {
        }
      }
    }
  } else if (!fs.existsSync(pathsFile)) {
    const paths = {
      version: 3,
      events: ".claude/project/events",
      memory: ".claude/project/memory",
      reference: ".claude/project/reference",
      runtime: ".claude/runtime",
      agents: ".claude/agents",
      commands: ".claude/commands",
      manifest: ".claude/manifest.json",
      settings: ".claude/settings.json",
      eventsFile: ".claude/project/events/events.jsonl",
      learningsFile: ".claude/project/memory/learnings.jsonl",
    };
    fs.writeFileSync(pathsFile, JSON.stringify(paths, null, 2) + "\n");
    log("warn", "Created minimal paths.json (registry not found)");
    installed++;
  }

  let _skeletonNew = 0;
  for (const d of SKELETON_DIRS) {
    const abs = path.join(TARGET, d);
    try {
      if (!fs.existsSync(abs)) _skeletonNew++;
      fs.mkdirSync(abs, { recursive: true });
      const keep = path.join(abs, ".gitkeep");
      if (!fs.existsSync(keep)) fs.writeFileSync(keep, "");
    } catch {
    }
  }
  log("ok", `Skeleton zones ensured (_requirements/*, _docs/; ${_skeletonNew} created this run)`);

  try {
    const { populateSeedProvenance } = require("./views/populate-seed-provenance");
    populateSeedProvenance({
      targetRoot: TARGET,
      mcRoot: MC,
      zones: SKELETON_DIRS,
      log,
    });
  } catch (err) {
    log("warn", `Seed-zone provenance skipped (${err.message}) — zones still seeded, markers missing`);
  }

  try {
    const rmGen = path.join(MC, "scripts", "mc", "generate-roadmap-scaffold.js");
    if (fs.existsSync(rmGen)) {
      const r = spawnSync("node", [rmGen, TARGET], { encoding: "utf8" });
      if (r.status === 0) log("ok", "ROADMAP.md scaffold ensured");
      else log("warn", `ROADMAP scaffold skipped: ${(r.stderr || "").trim().slice(0, 80)}`);
    }
  } catch {
  }

  const projectMdFile = path.join(TARGET, "PROJECT.md");
  if (!fs.existsSync(projectMdFile)) {
    const projectMd = [
      `# ${path.basename(TARGET)} — Project Context`,
      "",
      "> Product-specific context for this project. For the framework instructions an",
      "> agent operates under, see [CLAUDE.md](CLAUDE.md). For the agent system router,",
      "> see [AGENTS.md](AGENTS.md). MC will never overwrite this file — it's yours.",
      "",
      "> **Founding brief:** see `_docs/briefs/` — the brief this product was scaffolded from (if one was provided).",
      "",
      "## Product",
      "",
      "_What is this product? One or two sentences: what it does and who it's for._",
      "",
      "## Stack",
      "",
      "_Languages, frameworks, key dependencies, hosting / deployment target._",
      "",
      "## Goals",
      "",
      "_What does success look like? Near-term objectives and the bar for \"done\"._",
      "",
      "## JTBD",
      "",
      "_Jobs To Be Done — the concrete jobs a user hires this product to do._",
      "",
    ].join("\n");
    fs.writeFileSync(projectMdFile, projectMd + "\n");
    log("ok", "Created PROJECT.md template (fill in Product/Stack/Goals/JTBD)");
    installed++;
  } else {
    log("ok", "PROJECT.md already present — leaving it alone");
  }

  try {
    const mapsDir = path.join(TARGET, ".claude", "project", "maps");
    fs.mkdirSync(mapsDir, { recursive: true });
    const mapsReadme = path.join(mapsDir, "README.md");
    if (!fs.existsSync(mapsReadme)) {
      const readme = [
        "# Project Maps",
        "",
        "> **These maps are not yours yet.** A fresh MC install ships the",
        "> framework's OWN canonical relationship maps (skills, hooks, tools, memory,",
        "> systems, enforcements, architecture) as placeholders in this directory.",
        "> They describe MC itself — not this product.",
        "",
        "## Generate maps for THIS product",
        "",
        "Open the project in Claude Code and run:",
        "",
        "```",
        "/maps:all",
        "```",
        "",
        "That regenerates every map by walking THIS project's `.claude/` and source",
        "tree (no LLM synthesis — deterministic file walks), replacing the shipped",
        "MC placeholders with your real inventory.",
        "",
        "Until you do, treat any pre-existing `*.jsonl` / `*.md` / `inventory-*.json`",
        "in this directory as framework defaults, not project truth.",
        "",
      ].join("\n");
      fs.writeFileSync(mapsReadme, readme + "\n");
      log("ok", "Wrote maps/README.md nudge (run /maps:all to generate product maps)");
      installed++;
    } else {
      log("ok", "maps/README.md already present — leaving it alone");
    }
  } catch {
  }

  try {
    const runtimeDir = path.join(TARGET, ".claude", "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const runtimePkg = path.join(runtimeDir, "package.json");
    if (!fs.existsSync(runtimePkg)) {
      fs.writeFileSync(
        runtimePkg,
        JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
      );
      log("ok", 'Wrote .claude/runtime/package.json ({"type":"commonjs"} — insulates runtime .js helpers from ESM product roots)');
      installed++;
    } else {
      log("ok", ".claude/runtime/package.json already present — leaving it alone");
    }
  } catch {
  }

  try {
    const scriptsDir = path.join(TARGET, "scripts");
    if (fs.existsSync(scriptsDir)) {
      const scriptsPkg = path.join(scriptsDir, "package.json");
      if (!fs.existsSync(scriptsPkg)) {
        fs.writeFileSync(
          scriptsPkg,
          JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
        );
        log("ok", 'Wrote scripts/package.json ({"type":"commonjs"} — insulates framework scripts+hooks from ESM product roots)');
        installed++;
      }
    }
  } catch {
  }

  return { installedDelta: installed };
}

function populateMcMirror({ target, mcRoot, shipManifest, log, HEADER = "", RESET = "" }) {
  const TARGET = target;
  const MC = mcRoot;
  let installed = 0;

  {
    console.log(`\n${HEADER}  FRAMEWORK SOURCE MIRROR (_mc/)${RESET}`);
    const populateScript = path.join(
      MC,
      "scripts",
      "mc",
      "views",
      "populate-source.js",
    );
    try {
      const { populateSource } = require(populateScript);
      const pr = populateSource({
        targetRoot: TARGET,
        mcRoot: MC,
        shipManifest,
      });
      if (!pr.ok && pr.code === 2) {
        log("warn", `_mc/ mirror skipped: ${pr.error}`);
      } else {
        log(
          "ok",
          `_mc/ source mirror: ${pr.copied.length} copied, ${pr.unchanged.length} unchanged (${pr.mirroredCount} view files mirrored)`,
        );
        installed += pr.copied.length;
        if (pr.missingSource.length > 0) {
          log(
            "warn",
            `_mc/ mirror: ${pr.missingSource.length} source(s) declared by manifest but missing in clone (first 3): ${pr.missingSource
              .slice(0, 3)
              .map((m) => m.src)
              .join(", ")}`,
          );
        }
        if (pr.failed.length > 0) {
          log(
            "warn",
            `_mc/ mirror: ${pr.failed.length} copy failure(s) (first 3): ${pr.failed
              .slice(0, 3)
              .map((f) => `${f.mirror} (${f.reason})`)
              .join("; ")}`,
          );
        }
      }
    } catch (err) {
      log("warn", `_mc/ mirror failed (${err.message}) — install continues; regenerate.js stays inert until re-run`);
    }
  }

  return { installedDelta: installed };
}

function regenerateMcManifest({ target, mcRoot, log }) {
  const mcZone = path.join(target, "_mc");
  if (!fs.existsSync(mcZone)) {
    log("info", "_mc/ not present — skipping manifest regeneration (legacy install layout)");
    return { ok: false, skipped: true, status: null, stderr: "" };
  }
  const buildScript = path.join(mcRoot, "scripts/mc/manifest/build.js");
  if (!fs.existsSync(buildScript)) {
    log("warn", `manifest build.js not found at ${buildScript} — _mc/MANIFEST.json not regenerated`);
    return { ok: false, skipped: true, status: null, stderr: "" };
  }
  const res = spawnSync(
    process.execPath,
    [buildScript, "--root", target, "--source-prefix", "_mc"],
    { encoding: "utf8" },
  );
  if (res.status !== 0) {
    log("warn", `manifest build.js exited ${res.status} — _mc/MANIFEST.json may be missing/stale. stderr: ${(res.stderr || "").trim().slice(0, 200)}`);
    return { ok: false, skipped: false, status: res.status, stderr: res.stderr || "" };
  }
  log("ok", "_mc/MANIFEST.json regenerated (--source-prefix _mc)");
  return { ok: true, skipped: false, status: 0, stderr: "" };
}

function resolveMcVersion(override) {
  if (override && typeof override === "string") return override;
  try {
    const vj = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "..", "..", "version.json"), "utf8"),
    );
    if (vj && typeof vj.version === "string" && vj.version) return vj.version;
  } catch {
  }
  return "0.0.0";
}

function writeProductManifest({ target, interview = {}, stack = "unknown", framework = "unknown", mcVersion, log }) {
  const TARGET = target;
  let installed = 0;

  const manifestFile = path.join(TARGET, ".claude/manifest.json");
  if (!fs.existsSync(manifestFile)) {
    const projectName = interview.projectName || path.basename(TARGET);
    const manifest = {
      $schema: "mc/manifest/v1",
      project: {
        name: projectName,
        slug: projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        description: interview.pitch || "",
        techStack: [stack],
        framework: framework,
      },
      git: {
        mainBranch: interview.mainBranch,
      },
      mc: {
        version: resolveMcVersion(mcVersion),
        installed: true,
        source: interview.mcSource,
        features: ["agents", "hooks", "skills", "memory", "maps", "events"],
      },
      agents: {
        team: {
          name: "alex",
          identity: "Alex",
          members: {
            alpha: { symbol: "α", role: "orchestrator" },
            beta: { symbol: "β", role: "judgment" },
            gamma: { symbol: "γ", role: "adhoc builder" },
            delta: { symbol: "δ", role: "oneshot builder" },
          },
        },
        modes: ["adhoc", "oneshot", "solo"],
        build: [
          "builder",
          "evaluator",
          "compliance",
          "auditor",
          "qa",
          "redteam",
          "fixer",
        ],
      },
      source_dirs: stack === "node" ? ["src/"] : [],
      build: { features: [], phases: [] },
      providers: {
        claude: {
          cli: "claude",
          default_model: "sonnet",
          invocation: "native",
        },
        openai: {
          cli: "codex",
          default_model: "gpt-6.1-sol",
          fallback: "claude",
          syntax: "codex exec --sandbox workspace-write -m {model} -",
        },
        antigravity: {
          cli: "agy",
          default_model: "gemini-3.1-pro-high",
          fallback: "openai",
          syntax: "agy --model {model} --print-timeout 90s -p",
        },
      },
      agentProviders: {
        alpha: "claude",
        beta: "claude",
        gamma: "claude",
        delta: "claude",
        builder: "claude",
        fixer: "claude",
        evaluator: "openai",
        compliance: "openai",
        auditor: "openai",
        qa: "openai",
        redteam: "openai",
      },
      buildCommands: {},
      fileOwnership: { foundation: [] },
    };

    if (fs.existsSync(path.join(TARGET, "package.json"))) {
      try {
        const pkg = JSON.parse(
          fs.readFileSync(path.join(TARGET, "package.json"), "utf8"),
        );
        const scripts = pkg.scripts || {};
        if (scripts.build) manifest.buildCommands.build = "npm run build";
        if (scripts.test) manifest.buildCommands.test = "npm run test";
        if (scripts.lint) manifest.buildCommands.lint = "npm run lint";
      } catch {
      }
    }

    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
    log("ok", `Created manifest.json for "${projectName}"`);
    installed++;
  } else {
    try {
      const existing = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
      const want = resolveMcVersion(mcVersion);
      if (
        existing &&
        existing.mc &&
        typeof existing.mc === "object" &&
        existing.mc.version !== want
      ) {
        existing.mc.version = want;
        fs.writeFileSync(manifestFile, JSON.stringify(existing, null, 2) + "\n");
        log("ok", `Restamped manifest.json mc.version → ${want}`);
        installed++;
      }
    } catch (e) {
      log("warn", `manifest.json restamp skipped (${e.message})`);
    }
  }

  return { installedDelta: installed };
}

function writeAgentStore({ target, log }) {
  const TARGET = target;
  let installed = 0;

  const storeFile = path.join(TARGET, ".claude/agents/store.json");
  if (!fs.existsSync(storeFile)) {
    const store = {
      features: {},
      tasks: [],
      bugDataset: [],
      conflictDataset: [],
      cycle: 0,
      circuitBreaker: "closed",
      consecutiveFailures: 0,
      totalFailures: 0,
      lastCooldownMs: 0,
      evolution: [],
      heartbeat: {
        cycle: 0,
        phase: 0,
        feature: "",
        agent: "",
        status: "idle",
        cycleStep: null,
        workstream: null,
        timestamp: new Date().toISOString(),
      },
      compliance: {
        command: "codex",
        fallback: "claude",
        model: "gpt-5.6-sol",
        syntax: "codex exec --model gpt-5.6-sol",
        note: "Deprecated — use manifest.providers + manifest.agentProviders instead. Kept for backwards compat.",
      },
      snapshots: { features: {}, interfaces: {}, datasets: {} },
      knownStubs: [],
      points: { configs: {} },
      runLog: { runId: null, startedAt: null, entries: [], finalStatus: null },
      sharedFiles: {},
    };
    fs.mkdirSync(path.dirname(storeFile), { recursive: true });
    fs.writeFileSync(storeFile, JSON.stringify(store, null, 2) + "\n");
    log("ok", "Created store.json (build system state)");
    installed++;
  }

  return { installedDelta: installed };
}

function writeProductSettings({ target, mcRoot, hookTools = {}, log, HEADER = "", RESET = "" }) {
  const TARGET = target;
  const MC = mcRoot;
  let installed = 0;

  console.log(`\n${HEADER}  CONFIGURING HOOKS${RESET}`);

  const settingsFile = path.join(TARGET, ".claude/settings.json");
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  let settings = {};
  if (fs.existsSync(settingsFile)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    } catch {
      settings = {};
    }
  }

  if (!settings.env) settings.env = {};
  if (!settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS) {
    settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";
  }

  if (!settings.permissions) settings.permissions = {};
  if (!settings.permissions.allow) settings.permissions.allow = [];
  const requiredPerms = [
    "Bash(npm run *)",
    "Bash(node *)",
    "Bash(git *)",
    "Bash(ls *)",
    "Bash(pwd)",
    "Bash(which *)",
    "Bash(cat *)",
    "Bash(head *)",
    "Read",
    "Edit",
    "Write",
    "Glob",
    "Grep",
    "Agent",
  ];
  for (const perm of requiredPerms) {
    if (!settings.permissions.allow.includes(perm)) {
      settings.permissions.allow.push(perm);
    }
  }

  if (!settings.hooks) settings.hooks = {};

  const cmd = (script) => ({
    type: "command",
    command: `node "$CLAUDE_PROJECT_DIR/scripts/hooks/${script}"`,
  });

  const sessionStopEntry = [
    {
      matcher: "",
      hooks: [cmd("session-stop.js")],
    },
  ];

  const hookConfig = {
    SessionStart: [
      {
        matcher: "",
        hooks: [cmd("session-start.js")],
      },
    ],
    UserPromptSubmit: [
      {
        matcher: "",
        hooks: [cmd("smart-context.js"), cmd("prompt-logger.js")],
      },
    ],
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [
          cmd("merge-guard.js"),
          cmd("memory-guard.js"),
          cmd("framework-manifest-guard.js"),
        ],
      },
      {
        matcher: "Edit|Write",
        hooks: [
          cmd("secret-guard.js"),
          cmd("foundation-guard.js"),
          cmd("ownership-guard.js"),
          cmd("memory-guard.js"),
          cmd("store-validator.js"),
          cmd("path-guard.js"),
        ],
      },
      {
        matcher: "Agent",
        hooks: [cmd("team-guard.js")],
      },
    ],
    PostToolUse: [
      {
        matcher: "",
        hooks: [cmd("session-tracker.js")],
      },
      {
        matcher: "Edit|Write",
        hooks: [
          cmd("format.js"),
          cmd("typecheck.js"),
          cmd("lint.js"),
          cmd("edit-watcher.js"),
          cmd("systems-sync.js"),
          cmd("save-session-lint.js"),
          cmd("learning-validator.js"),
          cmd("ui-lint.js"),
          cmd("path-guard.js"),
        ],
      },
    ],
    PostCompact: [
      {
        matcher: "",
        hooks: [cmd("compact-saver.js")],
      },
    ],
    Stop: sessionStopEntry,
    SessionEnd: sessionStopEntry,
    StopFailure: sessionStopEntry,
  };

  function mcScriptPath(entry) {
    return typeof entry === "object" && entry?.command ? entry.command : null;
  }

  function mergeEventHooks(existing, incoming) {
    const result = Array.isArray(existing) ? [...existing] : [];

    for (const block of incoming) {
      const match = result.find(
        (b) => (b.matcher || "") === (block.matcher || ""),
      );
      if (match) {
        match.hooks = match.hooks || [];
        const existingCmds = new Set(match.hooks.map(mcScriptPath));
        for (const entry of block.hooks) {
          if (!existingCmds.has(mcScriptPath(entry))) {
            match.hooks.push(entry);
          }
        }
      } else {
        result.push(block);
      }
    }
    return result;
  }

  for (const [event, incomingBlocks] of Object.entries(hookConfig)) {
    const before = JSON.stringify(settings.hooks[event] || []);
    settings.hooks[event] = mergeEventHooks(
      settings.hooks[event],
      incomingBlocks,
    );
    const after = JSON.stringify(settings.hooks[event]);
    if (before === after) {
      log("ok", `${event}: MC hooks already registered (no-op, idempotent)`);
    } else if (before === "[]") {
      log("ok", `Registered MC hooks for ${event}`);
      installed++;
    } else {
      log(
        "ok",
        `Merged MC hooks into existing ${event} (user hooks preserved)`,
      );
      installed++;
    }
  }

  const missing = [];
  if (!hookTools.prettier) missing.push("prettier");
  if (!hookTools.tsc) missing.push("tsc (TypeScript)");
  if (!hookTools.eslint) missing.push("eslint");
  if (!fs.existsSync(path.join(TARGET, "_requirements/01-design-system")))
    missing.push("design-system docs (for ui-lint)");
  if (missing.length > 0) {
    log(
      "info",
      `All hooks wired. Tool(s) missing: ${missing.join(", ")} — related hooks self-skip until installed; no action needed.`,
    );
  }

  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n");

  const settingsDefaultsFile = path.join(TARGET, "_mc/settings/defaults.json");
  if (fs.existsSync(settingsDefaultsFile)) {
    const compileScript = path.join(MC, "scripts/mc/settings/compile.js");
    if (fs.existsSync(compileScript)) {
      const settingsLocalFile = path.join(TARGET, ".claude/settings.local.json");
      const compileArgs = [
        compileScript,
        "--defaults", settingsDefaultsFile,
        "--out", settingsFile,
      ];
      if (fs.existsSync(settingsLocalFile)) {
        compileArgs.push("--local", settingsLocalFile);
      }
      try {
        const cr = spawnSync(process.execPath, compileArgs, { encoding: "utf8" });
        if (cr.status === 0) {
          log("ok", `Compiled .claude/settings.json from _mc/settings/defaults.json + settings.local.json`);
        } else {
          log("warn", `compile.js exited ${cr.status} — kept inlined settings.json. stderr: ${(cr.stderr || "").slice(0, 200)}`);
        }
      } catch (err) {
        log("warn", `compile.js spawn failed: ${err.message} — kept inlined settings.json`);
      }
    }
  }

  return { installedDelta: installed };
}

module.exports = {
  SKELETON_DIRS,
  scaffoldProduct,
  populateMcMirror,
  regenerateMcManifest,
  writeProductManifest,
  writeAgentStore,
  writeProductSettings,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  let targetArg = null;
  let mcRootArg = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mc-root") {
      mcRootArg = argv[++i];
    } else if (a.startsWith("--mc-root=")) {
      mcRootArg = a.slice("--mc-root=".length);
    } else if (!targetArg && !a.startsWith("--")) {
      targetArg = a;
    }
  }
  if (!targetArg) {
    process.stderr.write(
      "usage: node scripts/mc/scaffold-core.js <target-dir> [--mc-root <canonical-clone>]\n",
    );
    process.exit(2);
  }
  const target = path.resolve(targetArg);
  if (!fs.existsSync(target)) {
    process.stderr.write(`target directory does not exist: ${target}\n`);
    process.exit(2);
  }
  const mcRoot = mcRootArg
    ? path.resolve(mcRootArg)
    : path.resolve(__dirname, "..", "..");

  const TAG = { ok: "[ ok ]", warn: "[warn]", fail: "[fail]", info: "[info]" };
  const log = (status, msg, detail) => {
    process.stdout.write(`${TAG[status] || "[info]"} ${msg}\n`);
    if (detail) process.stdout.write(`       ${detail}\n`);
  };

  let stack = "unknown";
  let framework = "unknown";
  if (fs.existsSync(path.join(target, "package.json"))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next) { stack = "node"; framework = "next.js"; }
      else if (deps.react) { stack = "node"; framework = "react"; }
      else if (deps.express) { stack = "node"; framework = "express"; }
      else if (deps.vue) { stack = "node"; framework = "vue"; }
      else { stack = "node"; framework = "node.js"; }
    } catch {
      stack = "node";
    }
  } else if (fs.existsSync(path.join(target, "requirements.txt"))) {
    stack = "python"; framework = "python";
  } else if (fs.existsSync(path.join(target, "go.mod"))) {
    stack = "go"; framework = "go";
  } else if (fs.existsSync(path.join(target, "Cargo.toml"))) {
    stack = "rust"; framework = "rust";
  }

  log("info", `scaffold-core: target=${target}`);
  log("info", `scaffold-core: mcRoot=${mcRoot}`);

  let total = 0;
  try {
    total += scaffoldProduct({ target, mcRoot, log }).installedDelta;

    total += writeProductManifest({ target, interview: {}, stack, framework, log }).installedDelta;
    total += writeAgentStore({ target, log }).installedDelta;

    total += writeProductSettings({ target, mcRoot, log }).installedDelta;

    const manifestPath = path.join(
      mcRoot,
      ".claude",
      "framework-manifest.json",
    );
    let shipManifest = null;
    try {
      shipManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch {
    }
    if (shipManifest) {
      total += populateMcMirror({
        target,
        mcRoot,
        shipManifest,
        log,
      }).installedDelta;
      regenerateMcManifest({ target, mcRoot, log });

      total += writeProductSettings({ target, mcRoot, log }).installedDelta;
    } else {
      log(
        "warn",
        `_mc/ mirror skipped — no readable framework-manifest at ${manifestPath}. Re-run /mc:setup or regenerate the manifest, then re-run this script.`,
      );
    }
    log("ok", `scaffold-core complete (${total} item(s) scaffolded)`);
    process.exit(0);
  } catch (err) {
    process.stderr.write(`scaffold-core failed: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}
