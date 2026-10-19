#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const mcEnv = require("./lib/mc-env");

let lifecycle = null;
try {
  lifecycle = require("./lib/lifecycle-events");
} catch {
  lifecycle = null;
}

const KNOWN_MODES = new Set(["solo", "adhoc", "oneshot", "sprint"]);
const MARKER_OFF = ".mode-guard-off";
const MARKER_BOOTSTRAP = ".mode-guard-bootstrap";

function readStdinJson() {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(buf));
      } catch {
        resolve(null);
      }
    });
    process.stdin.on("error", () => resolve(null));
    if (process.stdin.isTTY) resolve(null);
  });
}

function extractModeTarget(event) {
  try {
    if (!event || !event.tool_input) return null;
    const ti = event.tool_input;
    let raw = null;
    if (typeof ti.command === "string") raw = ti.command;
    else if (typeof ti.skill === "string") raw = ti.skill;
    else if (typeof ti.name === "string") raw = ti.name;
    if (raw == null) return null;
    const m = String(raw)
      .trim()
      .match(/^\/?mode:([A-Za-z][A-Za-z0-9_-]*)/);
    if (!m) return null;
    return m[1].toLowerCase();
  } catch {
    return null;
  }
}

function killReason(projectDir, env) {
  try {
    const e = env || process.env;
    if (String(mcEnv.readEnv("DISABLE_MODE_GUARD", e) || "") === "1") return "env";
    const runtimeDir = path.join(projectDir, ".claude", "runtime");
    if (safeExists(path.join(runtimeDir, MARKER_OFF))) return "marker";
    if (safeExists(path.join(runtimeDir, MARKER_BOOTSTRAP))) return "bootstrap";
    if (!safeExists(path.join(projectDir, ".claude", "manifest.json")))
      return "bootstrap-no-manifest";
    return null;
  } catch {
    return null;
  }
}

function safeExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function attestModeGuardKillSwitch(reason, target) {
  if (reason !== "env" && reason !== "marker") return;
  const which =
    reason === "env" ? "env:MC_DISABLE_MODE_GUARD" : "marker:.mode-guard-off";
  const attestation = {
    guard: "mode-lifecycle-guard",
    bypass: "mode-guard-kill-switch",
    switch: which,
    target_mode: target || null,
    reason: "operator kill-switch active — mode-guard preflight/emit suppressed",
    ts: new Date().toISOString(),
  };
  try {
    const { log } = require("./lib/logger");
    log("audit", { type: "warn", action: "mode-guard-kill-switch", ...attestation });
  } catch {
  }
  try {
    process.stderr.write(
      `[mode-lifecycle-guard] ⚠ KILL-SWITCH BYPASS: the mode-guard was DISABLED ` +
        `via ${which} — ${attestation.reason}.\n`,
    );
  } catch {
  }
}

function resolvePrevMode(projectDir) {
  try {
    return require("./lib/mode").getMode() || "solo";
  } catch {
  }
  try {
    const p = path.join(projectDir, ".claude", "runtime", "mode.json");
    if (safeExists(p)) {
      const doc = JSON.parse(fs.readFileSync(p, "utf8"));
      if (typeof doc.mode === "string") return doc.mode.toLowerCase();
    }
  } catch {
  }
  return "solo";
}

function resolveSlug() {
  try {
    return String(require("./lib/project-config").getMcProduct() || "")
      .toLowerCase();
  } catch {
    return "";
  }
}

function resolveSessionId(projectDir) {
  try {
    const p = path.join(projectDir, ".claude", "runtime", ".session-id");
    if (safeExists(p)) return fs.readFileSync(p, "utf8").trim() || null;
  } catch {
  }
  return null;
}

function findActiveTeamForProject(slug, projectDir, homeDir) {
  try {
    const home = homeDir || process.env.HOME || process.env.USERPROFILE || "";
    if (!home) return null;
    const teamsRoot = path.join(home, ".claude", "teams");
    if (!safeExists(teamsRoot)) return null;
    const normProject = String(projectDir || "").replace(/\\/g, "/").toLowerCase();
    const s = String(slug || "").toLowerCase();
    let bestId = null;
    let bestMtime = -1;
    let dirs = [];
    try {
      dirs = fs.readdirSync(teamsRoot);
    } catch {
      return null;
    }
    for (const d of dirs) {
      const cfg = path.join(teamsRoot, d, "config.json");
      try {
        if (!safeExists(cfg)) continue;
        const mtime = fs.statSync(cfg).mtimeMs;
        const doc = JSON.parse(fs.readFileSync(cfg, "utf8"));
        const name = String(doc.name || d).toLowerCase();
        let belongs = false;
        if (s && (name === s || name.startsWith(s + "-"))) belongs = true;
        if (!belongs && Array.isArray(doc.members) && normProject) {
          belongs = doc.members.some((mem) => {
            const c = String((mem && mem.cwd) || "").replace(/\\/g, "/").toLowerCase();
            return c && (c === normProject || c.startsWith(normProject + "/"));
          });
        }
        if (belongs && mtime > bestMtime) {
          bestMtime = mtime;
          bestId = String(doc.name || d);
        }
      } catch {
      }
    }
    return bestId;
  } catch {
    return null;
  }
}

function gitLabels(cwd) {
  const out = { worktree: null, branch: null };
  try {
    out.worktree = path.basename(String(cwd || "")) || null;
  } catch {
  }
  try {
    let gitPath = path.join(cwd, ".git");
    if (!safeExists(gitPath)) return out;
    const stat = fs.statSync(gitPath);
    let gitDir = gitPath;
    if (stat.isFile()) {
      const ref = fs.readFileSync(gitPath, "utf8").trim();
      const m = ref.match(/^gitdir:\s*(.+)$/);
      if (m) gitDir = m[1].trim();
    }
    const headPath = path.join(gitDir, "HEAD");
    if (safeExists(headPath)) {
      const head = fs.readFileSync(headPath, "utf8").trim();
      const hm = head.match(/^ref:\s*refs\/heads\/(.+)$/);
      if (hm) out.branch = hm[1].trim();
    }
  } catch {
  }
  return out;
}

function turboLabel(projectDir, env) {
  try {
    const e = env || process.env;
    if (String(mcEnv.readEnv("TURBO", e) || "") === "1") return "on";
    if (safeExists(path.join(projectDir, ".claude", "runtime", ".turbo")))
      return "on";
    return "off";
  } catch {
    return "off";
  }
}

function makeCorrelationId() {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(16).slice(2, 6);
  return `modesw-${ts}-${rnd}`;
}

function run(event, opts) {
  const o = opts || {};
  const emit =
    typeof o.emit === "function"
      ? o.emit
      : lifecycle && typeof lifecycle.emit === "function"
        ? lifecycle.emit
        : () => false;
  const stdout =
    typeof o.stdout === "function"
      ? o.stdout
      : (s) => process.stdout.write(s);
  const env = o.env || process.env;
  const projectDir =
    o.projectDir ||
    env.CLAUDE_PROJECT_DIR ||
    (() => {
      try {
        return require("./lib/paths").PROJECT;
      } catch {
        return path.resolve(__dirname, "..", "..");
      }
    })();
  const cwd = o.cwd || process.cwd();

  const target = typeof o.target === "string" ? o.target : extractModeTarget(event);
  if (!target) return { action: "noop", decision: null };

  const kr = o.forceKill || killReason(projectDir, env);
  if (kr) {
    const attest =
      typeof o.attest === "function" ? o.attest : attestModeGuardKillSwitch;
    try {
      attest(kr, target);
    } catch {
    }
    return { action: "killed", decision: null, reason: kr };
  }

  const slug = o.slug != null ? o.slug : resolveSlug();
  const prevMode = o.prevMode != null ? o.prevMode : resolvePrevMode(projectDir);
  const sessionId =
    o.sessionId !== undefined ? o.sessionId : resolveSessionId(projectDir);
  const existingTeam =
    o.activeTeam !== undefined
      ? o.activeTeam
      : findActiveTeamForProject(slug, projectDir, o.homeDir);
  const requiredTeam =
    KNOWN_MODES.has(target) && (target === "sprint" || target === "adhoc")
      ? slug
        ? `${slug}-${target}`
        : target
      : null;
  const { branch, worktree } = gitLabels(cwd);
  const turbo = turboLabel(projectDir, env);
  const correlation_id = o.correlationId || makeCorrelationId();
  const ts = new Date().toISOString();
  const actor = o.actor || "alpha";

  const events = [];
  const reqPayload = {
    project_slug: slug || null,
    session_id: sessionId,
    prev_mode: prevMode,
    target_mode: target,
    actor,
    timestamp: ts,
    correlation_id,
  };
  const preflightPayload = {
    session_id: sessionId,
    prev_mode: prevMode,
    target_mode: target,
    existing_team_id: existingTeam,
    required_team_id: requiredTeam,
    branch: branch || null,
    worktree: worktree || null,
    turbo_perms_state: turbo,
    actor,
    timestamp: ts,
    dry_run: true,
    correlation_id,
  };
  try {
    if (emit("mode:switch:requested", reqPayload)) events.push("mode:switch:requested");
  } catch {
  }
  try {
    if (emit("mode:switch:preflight", preflightPayload))
      events.push("mode:switch:preflight");
  } catch {
  }

  try {
    const teamLabel = existingTeam ? `active team "${existingTeam}"` : "no active team";
    const advisory =
      `[mode-lifecycle-guard] preflight for /mode:${target} ` +
      `(from ${prevMode}): ${teamLabel}` +
      (requiredTeam ? `; target requires "${requiredTeam}"` : "") +
      `. Report-only BACKSTOP — scripts/mode-set.js owns the switch transaction.`;
    stdout(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: advisory,
        },
      }),
    );
  } catch {
  }

  return { action: "emitted", decision: null, correlation_id, target, events };
}

if (require.main === module) {
  (async () => {
    try {
      const event = await readStdinJson();
      run(event || {});
    } catch {
    } finally {
      process.exit(0);
    }
  })();
}

module.exports = {
  run,
  extractModeTarget,
  killReason,
  attestModeGuardKillSwitch,
  findActiveTeamForProject,
  resolvePrevMode,
  gitLabels,
  turboLabel,
  KNOWN_MODES,
};
