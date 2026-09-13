"use strict";

/**
 * scripts/portfolio/spawn.js
 *
 * /portfolio:open <slug> --spawn launcher (T-20260521-171).
 *
 * Sources of truth (do not paraphrase here — keep this file thin):
 *   - Dispatch table:        ESD-20260521-009 (binaries_probed_at_invocation)
 *   - Active-CWD warning:    requirements/SP-20260521-001/copy.md C-6
 *   - PATH-fallback copy:    requirements/SP-20260521-001/copy.md C-7
 *   - Telemetry payload:     requirements/SP-20260521-001/trace.md TR-6
 *   - Acceptance criteria:   requirements/SP-20260521-001/acceptance-criteria.md AC-4.1..4.3
 *   - Plan-contract intent:  PC-20260521-0021, sprint SP-20260521-001
 *
 * Contract notes captured from those sources:
 *   - Spawn argv-array only (never exec with shell concat) per redteam T-4 +
 *     ticket description.
 *   - Active-CWD warning skips spawn unless --force is passed (AC-4.2,
 *     Beta DEC-006 addendum).
 *   - PATH-missing branch prints C-7 copyable line and exits 0 (AC-4.3,
 *     graceful degradation).
 *   - Detached + unref so the MC terminal returns immediately.
 *   - macOS path goes through osascript; the AppleScript string interpolates
 *     repo_path via "quoted form" so paths with spaces survive.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const { findBySlug } = require("./registry");

const EXIT_OK = 0;
const EXIT_UNKNOWN_SLUG = 1;
const EXIT_REPO_PATH_MISSING = 1;
const EXIT_USAGE = 2;

// T-20260522-186: VS Code 'code -n' preference. When the user invokes
// /portfolio:open --spawn from inside VS Code's integrated terminal,
// TERM_PROGRAM=vscode is set by VS Code itself. We honor that as a signal
// to keep the new pane inside the same VS Code workspace via `code -n`
// instead of yanking them out to wt / iTerm / gnome-terminal.
// requiresEnv = { TERM_PROGRAM: 'vscode' } on the entry — probeBinary
// short-circuits to false when the env predicate doesn't hold, so the
// entry falls through to the next-priority terminal binary for
// non-vscode contexts (i.e. no behavior change outside VS Code).
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
  // `code -n <path>` opens the repo in a NEW VS Code window so the existing
  // workspace the maintainer was in remains untouched. argv-array form (no
  // shell concat) per the redteam contract at the top of this file.
  // Windows note: `code` is a .cmd shim, which child_process.spawn needs
  // either shell:true (we refuse) OR an explicit shim resolution. Using
  // `cmd /c code -n` keeps shell:false while still resolving the .cmd.
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
    // fail-open — telemetry never blocks launcher
  }
}

function printCopyableFallback(repoPath, slug, out) {
  // C-7 copy verbatim. The copyable line is on its own row so operators can
  // double-click + copy without selecting the explanatory sentence.
  out.write(
    `No supported terminal binary found on PATH (looked for: code, wt, iTerm, Terminal.app, gnome-terminal, xterm). Copy/paste this to open ${slug} manually:\n`,
  );
  out.write(`  cd ${repoPath} && claude\n`);
}

function printActiveCwdWarning(slug, out) {
  // C-6 copy verbatim.
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

/**
 * spawnForSlug — programmatic entry point.
 * Used by the /portfolio:open skill body and by tests.
 *
 * @param {object} opts
 * @param {string} opts.slug             — registry slug
 * @param {boolean} [opts.force]         — override active-CWD warning
 * @param {boolean} [opts.dryRun]        — probe + decide, do not actually spawn
 * @param {Writable} [opts.stdout]       — defaults to process.stdout
 * @param {Writable} [opts.stderr]       — defaults to process.stderr
 * @returns {object} { exitCode, terminal, status, warned, fallback }
 */
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

  // AC-4.2 / C-6 active-CWD guard (Beta DEC-006 addendum).
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

  // From here on, no warning will be printed for this invocation (we either
  // already returned above, or --force was passed). TR-6's
  // active_cwd_warning_emitted field tracks the printout, not the detection.
  const warningEmitted = false;

  // Platform dispatch.
  const platform = process.platform;
  const binaries = PLATFORM_BINARIES[platform] || [];
  if (binaries.length === 0) {
    // Unknown platform — graceful degradation per AC-4.3.
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

  // Probe binaries in priority order; first hit wins.
  // opts.env (optional) lets tests inject a TERM_PROGRAM value without
  // mutating process.env globally; production callers omit it.
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
      // A binary that probed positively but failed to spawn: log, fall through
      // to the next binary. Do NOT abort — graceful degradation is the
      // contract.
      stderr.write(`spawn ${bin.name} failed: ${err.message}; trying next\n`);
      continue;
    }
  }

  // AC-4.3 / C-7 fallback: no binary worked.
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
  // exported for unit tests:
  PLATFORM_BINARIES,
  probeBinary,
  envSatisfies,
  pathsEqual,
  printActiveCwdWarning,
  printCopyableFallback,
};
