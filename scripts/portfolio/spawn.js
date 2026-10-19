"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const { findBySlug } = require("./registry");

const EXIT_OK = 0;
const EXIT_UNKNOWN_SLUG = 1;
const EXIT_REPO_PATH_MISSING = 1;
const EXIT_USAGE = 2;

const CODE_ENTRY = {
  name: "code",
  probe: process.platform === "win32" ? "where" : "which",
  probeArgs: ["code"],
  buildSpawn: spawnCodeNewWindow,
  requiresEnv: { TERM_PROGRAM: "vscode" },
};

const PLATFORM_BINARIES = {
  win32: [
    CODE_ENTRY,
    { name: "wt", probe: "where", probeArgs: ["wt"], buildSpawn: spawnWt },
    {
      name: "powershell",
      probe: "where",
      probeArgs: ["powershell"],
      buildSpawn: spawnPowershell,
    },
    { name: "cmd", probe: "where", probeArgs: ["cmd"], buildSpawn: spawnCmd },
  ],
  darwin: [
    CODE_ENTRY,
    {
      name: "iterm",
      probe: "osascript",
      probeArgs: ["-e", 'tell application "iTerm" to version'],
      buildSpawn: spawnITerm,
    },
    {
      name: "terminal.app",
      probe: "osascript",
      probeArgs: ["-e", 'tell application "Terminal" to version'],
      buildSpawn: spawnTerminalApp,
    },
  ],
  linux: [
    CODE_ENTRY,
    {
      name: "gnome-terminal",
      probe: "which",
      probeArgs: ["gnome-terminal"],
      buildSpawn: spawnGnomeTerminal,
    },
    { name: "xterm", probe: "which", probeArgs: ["xterm"], buildSpawn: spawnXterm },
  ],
};

function envSatisfies(requiresEnv, env) {
  if (!requiresEnv) return true;
  const source = env || process.env;
  for (const key of Object.keys(requiresEnv)) {
    if (source[key] !== requiresEnv[key]) return false;
  }
  return true;
}

function probeBinary(probe, probeArgs, requiresEnv, env) {
  if (!envSatisfies(requiresEnv, env)) return false;
  try {
    const r = spawnSync(probe, probeArgs, { stdio: ["ignore", "pipe", "pipe"] });
    return r.status === 0;
  } catch {
    return false;
  }
}

function spawnCodeNewWindow(repoPath) {
  if (process.platform === "win32") {
    const child = spawn("cmd", ["/c", "code", "-n", repoPath], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.unref();
    return child;
  }
  const child = spawn("code", ["-n", repoPath], {
    detached: true,
    stdio: "ignore",
    shell: false,
  });
  child.unref();
  return child;
}

function spawnWt(repoPath) {
  const child = spawn("wt", ["-d", repoPath, "claude"], {
    detached: true,
    stdio: "ignore",
    shell: false,
  });
  child.unref();
  return child;
}

function spawnPowershell(repoPath) {
  const child = spawn(
    "powershell",
    [
      "-NoExit",
      "-Command",
      `Set-Location -LiteralPath '${repoPath.replace(/'/g, "''")}'; claude`,
    ],
    { detached: true, stdio: "ignore", shell: false },
  );
  child.unref();
  return child;
}

function spawnCmd(repoPath) {
  const child = spawn(
    "cmd",
    ["/c", "start", "cmd", "/k", `cd /d "${repoPath}" && claude`],
    { detached: true, stdio: "ignore", shell: false },
  );
  child.unref();
  return child;
}

function spawnITerm(repoPath) {
  const script = [
    'tell application "iTerm"',
    "  create window with default profile",
    "  tell current session of current window",
    `    write text "cd " & quoted form of "${escapeAppleScript(repoPath)}" & " && claude"`,
    "  end tell",
    "  activate",
    "end tell",
  ].join("\n");
  const child = spawn("osascript", ["-e", script], {
    detached: true,
    stdio: "ignore",
    shell: false,
  });
  child.unref();
  return child;
}

function spawnTerminalApp(repoPath) {
  const script = [
    'tell application "Terminal"',
    `  do script "cd " & quoted form of "${escapeAppleScript(repoPath)}" & " && claude"`,
    "  activate",
    "end tell",
  ].join("\n");
  const child = spawn("osascript", ["-e", script], {
    detached: true,
    stdio: "ignore",
    shell: false,
  });
  child.unref();
  return child;
}

function spawnGnomeTerminal(repoPath) {
  const child = spawn(
    "gnome-terminal",
    [`--working-directory=${repoPath}`, "--", "claude"],
    { detached: true, stdio: "ignore", shell: false },
  );
  child.unref();
  return child;
}

function spawnXterm(repoPath) {
  const child = spawn("xterm", ["-e", "claude"], {
    detached: true,
    stdio: "ignore",
    shell: false,
    cwd: repoPath,
  });
  child.unref();
  return child;
}

function escapeAppleScript(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function pathsEqual(a, b) {
  const A = path.resolve(a);
  const B = path.resolve(b);
  if (process.platform === "win32") {
    return A.toLowerCase() === B.toLowerCase();
  }
  return A === B;
}

function emitTrace(payload) {
  try {
    const loggerPath = path.resolve(__dirname, "..", "hooks", "lib", "logger.js");
    const { log } = require(loggerPath);
    log("portfolio", Object.assign({ type: "portfolio_spawn" }, payload));
  } catch {
  }
}

function printCopyableFallback(repoPath, slug, out) {
  out.write(
    `No supported terminal binary found on PATH (looked for: code, wt, iTerm, Terminal.app, gnome-terminal, xterm). Copy/paste this to open ${slug} manually:\n`,
  );
  out.write(`  cd ${repoPath} && claude\n`);
}

function printActiveCwdWarning(slug, out) {
  out.write(
    `${slug}'s repo is your current working directory. Opening a new Claude session here would duplicate the one you're already in. Pass --force to spawn anyway, or just keep working in this terminal.\n`,
  );
}

function parseArgs(argv) {
  const out = { slug: null, force: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--slug") out.slug = argv[++i];
    else if (a === "--force") out.force = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (!out.slug && !a.startsWith("--")) out.slug = a;
  }
  return out;
}

function spawnForSlug(opts) {
  const stdout = opts.stdout || process.stdout;
  const stderr = opts.stderr || process.stderr;
  const slug = opts.slug;

  if (!slug) {
    stderr.write("usage: --slug <s> [--force] [--dry-run]\n");
    return { exitCode: EXIT_USAGE, terminal: null, status: "usage", warned: false };
  }

  const entry = findBySlug(slug);
  if (!entry) {
    stderr.write(`unknown slug: ${slug}\n`);
    return {
      exitCode: EXIT_UNKNOWN_SLUG,
      terminal: null,
      status: "unknown_slug",
      warned: false,
    };
  }

  const repoPath = entry.repo_path;
  if (!repoPath || !fs.existsSync(repoPath)) {
    stderr.write(`repo_not_found_on_disk: ${repoPath || "(missing)"}\n`);
    emitTrace({
      slug,
      repo_path: repoPath || null,
      terminal_used: null,
      active_cwd_warning_emitted: false,
      spawn_status: "failed",
    });
    return {
      exitCode: EXIT_REPO_PATH_MISSING,
      terminal: null,
      status: "repo_path_missing",
      warned: false,
    };
  }

  const activeCwdMatch = pathsEqual(repoPath, process.cwd());
  if (activeCwdMatch && !opts.force) {
    printActiveCwdWarning(slug, stdout);
    emitTrace({
      slug,
      repo_path: repoPath,
      terminal_used: null,
      active_cwd_warning_emitted: true,
      spawn_status: "ok",
    });
    return {
      exitCode: EXIT_OK,
      terminal: null,
      status: "active_cwd_skipped",
      warned: true,
    };
  }

  const warningEmitted = false;

  const platform = process.platform;
  const binaries = PLATFORM_BINARIES[platform] || [];
  if (binaries.length === 0) {
    printCopyableFallback(repoPath, slug, stdout);
    emitTrace({
      slug,
      repo_path: repoPath,
      terminal_used: "fallback_copyable",
      active_cwd_warning_emitted: warningEmitted,
      spawn_status: "binary_missing",
    });
    return {
      exitCode: EXIT_OK,
      terminal: "fallback_copyable",
      status: "fallback_copyable",
      warned: warningEmitted,
    };
  }

  for (const bin of binaries) {
    if (!probeBinary(bin.probe, bin.probeArgs, bin.requiresEnv, opts.env)) {
      continue;
    }
    if (opts.dryRun) {
      emitTrace({
        slug,
        repo_path: repoPath,
        terminal_used: bin.name,
        active_cwd_warning_emitted: warningEmitted,
        spawn_status: "ok",
      });
      return {
        exitCode: EXIT_OK,
        terminal: bin.name,
        status: "ok",
        warned: warningEmitted,
        dryRun: true,
      };
    }
    try {
      bin.buildSpawn(repoPath);
      emitTrace({
        slug,
        repo_path: repoPath,
        terminal_used: bin.name,
        active_cwd_warning_emitted: warningEmitted,
        spawn_status: "ok",
      });
      return {
        exitCode: EXIT_OK,
        terminal: bin.name,
        status: "ok",
        warned: warningEmitted,
      };
    } catch (err) {
      stderr.write(`spawn ${bin.name} failed: ${err.message}; trying next\n`);
      continue;
    }
  }

  printCopyableFallback(repoPath, slug, stdout);
  emitTrace({
    slug,
    repo_path: repoPath,
    terminal_used: "fallback_copyable",
    active_cwd_warning_emitted: warningEmitted,
    spawn_status: "binary_missing",
  });
  return {
    exitCode: EXIT_OK,
    terminal: "fallback_copyable",
    status: "fallback_copyable",
    warned: warningEmitted,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const r = spawnForSlug(args);
  return r.exitCode;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  spawnForSlug,
  PLATFORM_BINARIES,
  probeBinary,
  envSatisfies,
  pathsEqual,
  printActiveCwdWarning,
  printCopyableFallback,
};
