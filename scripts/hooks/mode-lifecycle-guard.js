#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// mode-lifecycle-guard.js — REAL PreToolUse guard #1 (S-LC-03 / E-LIFECYCLE-001).
//
// Fires on PreToolUse with matcher "SlashCommand|Skill" (same matcher the
// skill-invocation-tracker uses) and acts ONLY when the tool is a `/mode:*`
// invocation. It runs the mode-switch PREFLIGHT:
//   1. detect the active persistent team (project-slug-scoped read of
//      ~/.claude/teams/*/config.json),
//   2. resolve the current (prev) mode vs the requested target mode,
//   3. EMIT the two virtual lifecycle events in order —
//        mode:switch:requested  →  mode:switch:preflight
//      via scripts/hooks/lib/lifecycle-events.js#emit (the S-LC-02 spine).
//      Payloads carry STATUS LABELS only — never secrets / raw input.
//   4. surface a NON-blocking advisory (hookSpecificOutput.additionalContext).
//
// BACKSTOP-ONLY (plan §8.3, β 2026-06-08): the SINGLE lifecycle-transaction
// writer is scripts/mode-set.js — IT owns preflight→teardown→init→persist. This
// PreToolUse guard only OBSERVES + EMITS, catching switches that bypass mode-set.js.
// It is explicitly NOT co-primary with the writer.
//
// HARD INVARIANTS this sprint:
//   • REPORT-ONLY — this guard NEVER returns a `decision:"block"`. (Flip-to-block
//     is a later ramp gated on §22 #4.)
//   • FAIL-OPEN — any parse/registry/team-config error degrades to allow; a guard
//     exception must NEVER brick a /mode:* invocation (plan §20 blast-radius).
//   • KILL-SWITCH — honored via env WARPOS_DISABLE_MODE_GUARD, a marker file
//     (.claude/runtime/.mode-guard-off), and a bootstrap allow-list (don't fire
//     during initial setup). Mirrors team-guard's kill-switch shape.
//   • SCOPED — only `/mode:*` is touched; every other Skill/SlashCommand is a
//     pass-through no-op.
//
// SETTINGS WIRING IS DEFERRED (S-LC-03 does NOT edit settings.json): α integrates
// the matcher entry serially. See the build envelope for the exact JSON.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const fs = require("fs");
const path = require("path");
const mcEnv = require("./lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

// Lazy/guarded requires — a hook must never crash at load time on a bad module.
let lifecycle = null;
try {
  lifecycle = require("./lib/lifecycle-events");
} catch {
  lifecycle = null; // fail-open: with no emitter we still pass through cleanly
}

// ── Constants ────────────────────────────────────────────────────────────────
const KNOWN_MODES = new Set(["solo", "adhoc", "oneshot", "sprint"]);
const MARKER_OFF = ".mode-guard-off"; // .claude/runtime/<marker> — kill-switch
const MARKER_BOOTSTRAP = ".mode-guard-bootstrap"; // .claude/runtime/<marker>

// ── stdin reader (mirrors skill-invocation-tracker) ──────────────────────────
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
    // fail-open (security-reviewer S-LC-03): a stream-level 'error' (e.g. broken
    // pipe) on a listener-less stream throws an UNHANDLED exception that bypasses
    // the await chain + the top-level finally{exit(0)} → process would exit 1,
    // violating the "exit 0 on ANY internal error" report-only contract. Resolve null.
    process.stdin.on("error", () => resolve(null));
    if (process.stdin.isTTY) resolve(null);
  });
}

// ── /mode:* detection ────────────────────────────────────────────────────────
// Returns the TARGET token after `mode:` (lowercased) for a `/mode:<x>` call,
// or null when the tool is not a /mode:* invocation. Models the tool_input
// shapes skill-invocation-tracker handles: SlashCommand {command}, Skill {skill}.
function extractModeTarget(event) {
  try {
    if (!event || !event.tool_input) return null;
    const ti = event.tool_input;
    let raw = null;
    if (typeof ti.command === "string") raw = ti.command; // "/mode:sprint ..."
    else if (typeof ti.skill === "string") raw = ti.skill; // "mode:sprint" | "/mode:sprint"
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

// ── kill-switch + bootstrap allow-list ───────────────────────────────────────
// Returns a reason string when the guard must NO-OP (kill-switch or bootstrap),
// else null. Fail-open: any fs error here resolves to "not killed" so the guard
// still runs (it can never crash the tool call regardless — emit is fail-open too).
function killReason(projectDir, env) {
  try {
    const e = env || process.env;
    if (String(mcEnv.readEnv("DISABLE_MODE_GUARD", e) || "") === "1") return "env";
    const runtimeDir = path.join(projectDir, ".claude", "runtime");
    if (safeExists(path.join(runtimeDir, MARKER_OFF))) return "marker";
    if (safeExists(path.join(runtimeDir, MARKER_BOOTSTRAP))) return "bootstrap";
    // Initial setup: no project manifest yet (greenfield / mid-spinup) — the
    // guard would have nothing meaningful to preflight. Treat as bootstrap.
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

// AC-2.4 (SP-20260611-002): when the mode-guard no-ops on a DELIBERATE kill-switch
// (env WARPOS_DISABLE_MODE_GUARD or the .mode-guard-off marker), the suppression
// must NOT be silent (#6, the same silent-suppression class as the team-gate #5).
// Emit a loud audit record (event + stderr attestation) so a silenced mode-guard
// is visible at /scan. Bootstrap reasons (initial setup / no-manifest) are routine
// greenfield behavior, NOT a suppression — they stay quiet (no noise). Best-effort
// + fail-open: the attestation must never crash the guard or change its no-op.
function attestModeGuardKillSwitch(reason, target) {
  // Only the deliberate operator kill-switches are loud; bootstrap is routine.
  if (reason !== "env" && reason !== "marker") return;
  const which =
    reason === "env" ? "env:WARPOS_DISABLE_MODE_GUARD" : "marker:.mode-guard-off";
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
    /* logging is best-effort — the stderr line below is the fallback signal */
  }
  try {
    process.stderr.write(
      `[mode-lifecycle-guard] ⚠ KILL-SWITCH BYPASS: the mode-guard was DISABLED ` +
        `via ${which} — ${attestation.reason}. (E-LIFECYCLE-001 AC-2.4)\n`,
    );
  } catch {
    /* stderr unavailable — never throw */
  }
}

// ── current (prev) mode resolution ───────────────────────────────────────────
function resolvePrevMode(projectDir) {
  // Prefer the shared reader; fall back to a direct mode.json read; default solo.
  try {
    return require("./lib/mode").getMode() || "solo";
  } catch {
    /* fall through */
  }
  try {
    const p = path.join(projectDir, ".claude", "runtime", "mode.json");
    if (safeExists(p)) {
      const doc = JSON.parse(fs.readFileSync(p, "utf8"));
      if (typeof doc.mode === "string") return doc.mode.toLowerCase();
    }
  } catch {
    /* malformed — fall through */
  }
  return "solo";
}

// ── project slug ─────────────────────────────────────────────────────────────
function resolveSlug() {
  try {
    return String(require("./lib/project-config").getWarpProduct() || "")
      .toLowerCase();
  } catch {
    return "";
  }
}

// ── session id ───────────────────────────────────────────────────────────────
function resolveSessionId(projectDir) {
  try {
    const p = path.join(projectDir, ".claude", "runtime", ".session-id");
    if (safeExists(p)) return fs.readFileSync(p, "utf8").trim() || null;
  } catch {
    /* fall through */
  }
  return null;
}

// ── project-slug-scoped active-team detection ────────────────────────────────
// Reads ~/.claude/teams/*/config.json and returns the freshest team id that
// belongs to THIS project. Belonging = team name starts with "<slug>-"/equals
// slug, OR a member's cwd is the project root EXACTLY or strictly UNDER it.
// SECURITY (T-20260611-325 / W1 MINOR): membership must NOT use parent
// containment. The prior test also accepted `normProject.startsWith(c + "/")`,
// which is true when the member cwd `c` is an ANCESTOR (parent) of the project —
// so a broad/foreign team rooted ABOVE this project (e.g. a member cwd of the
// home dir, or another project's parent) was mislabeled as THIS project's active
// team. A team's cwd being a parent of the project does NOT make it ours; only an
// EXACT project cwd or a member cwd strictly under the project root does. Every
// read is guarded — a malformed config skips that team, never throws.
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
            // EXACT project cwd OR member-cwd strictly UNDER the project root.
            // NOT parent-containment (`normProject.startsWith(c + "/")`) — an
            // ancestor cwd does not make a foreign/broad team ours (T-325).
            return c && (c === normProject || c.startsWith(normProject + "/"));
          });
        }
        if (belongs && mtime > bestMtime) {
          bestMtime = mtime;
          bestId = String(doc.name || d);
        }
      } catch {
        /* malformed config / stat error — skip this team dir */
      }
    }
    return bestId;
  } catch {
    return null;
  }
}

// ── git branch / worktree labels (best-effort, label-only) ───────────────────
function gitLabels(cwd) {
  const out = { worktree: null, branch: null };
  try {
    out.worktree = path.basename(String(cwd || "")) || null;
  } catch {
    /* ignore */
  }
  try {
    let gitPath = path.join(cwd, ".git");
    if (!safeExists(gitPath)) return out;
    const stat = fs.statSync(gitPath);
    let gitDir = gitPath;
    if (stat.isFile()) {
      // worktree: .git is a file "gitdir: <path>"
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
    /* best-effort — omit branch on any failure */
  }
  return out;
}

// ── turbo/perms status label (label only, never the granted scope) ───────────
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

// ── correlation id (ties requested+preflight to one switch) ──────────────────
function makeCorrelationId() {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(16).slice(2, 6);
  return `modesw-${ts}-${rnd}`;
}

// ── Core run() — pure-ish, dependency-injected for testability ───────────────
// Returns { action, decision, correlation_id?, target?, events? }.
//   action: "noop" (not a /mode call) | "killed" | "emitted"
//   decision: ALWAYS null this sprint (report-only — never a block).
// `opts` injection points (all default to live implementations):
//   emit(event, payload) -> bool   (default lifecycle.emit)
//   stdout(str)                     (default process.stdout.write)
//   projectDir, cwd, env, homeDir
//   prevMode, slug, sessionId, activeTeam  (override the live resolvers in tests)
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

  // 1. Only act on /mode:* — everything else is a pass-through no-op.
  const target = typeof o.target === "string" ? o.target : extractModeTarget(event);
  if (!target) return { action: "noop", decision: null };

  // 2. Kill-switch / bootstrap allow-list — no-op (emit no lifecycle events).
  //    AC-2.4: a DELIBERATE kill-switch (env/marker) no-op is attested LOUDLY so
  //    the silent-suppression class (#6) is closed; bootstrap stays quiet.
  const kr = o.forceKill || killReason(projectDir, env);
  if (kr) {
    const attest =
      typeof o.attest === "function" ? o.attest : attestModeGuardKillSwitch;
    try {
      attest(kr, target);
    } catch {
      /* attestation is best-effort — never disturb the no-op */
    }
    return { action: "killed", decision: null, reason: kr };
  }

  // 3. Gather labels (each resolver is independently fail-open).
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

  // 4. Emit the two virtual events IN ORDER (requested → preflight). The emitter
  //    whitelists each payload to the event's declared fields + scrubs secrets;
  //    we pass status LABELS only. Both calls are fail-open inside emit().
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
    dry_run: true, // BACKSTOP-ONLY: this guard observes; mode-set.js owns the txn.
    correlation_id,
  };
  try {
    if (emit("mode:switch:requested", reqPayload)) events.push("mode:switch:requested");
  } catch {
    /* fail-open: emit must never throw, but double-guard the call site */
  }
  try {
    if (emit("mode:switch:preflight", preflightPayload))
      events.push("mode:switch:preflight");
  } catch {
    /* fail-open */
  }

  // 5. NON-blocking advisory. REPORT-ONLY — never a `decision:"block"`.
  try {
    const teamLabel = existingTeam ? `active team "${existingTeam}"` : "no active team";
    const advisory =
      `[mode-lifecycle-guard] preflight for /mode:${target} ` +
      `(from ${prevMode}): ${teamLabel}` +
      (requiredTeam ? `; target requires "${requiredTeam}"` : "") +
      `. Report-only BACKSTOP — scripts/mode-set.js owns the switch transaction ` +
      `(S-LC-03 / E-LIFECYCLE-001).`;
    stdout(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: advisory,
        },
      }),
    );
  } catch {
    /* advisory is best-effort — never block on it */
  }

  return { action: "emitted", decision: null, correlation_id, target, events };
}

// ── subprocess entrypoint ────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    try {
      const event = await readStdinJson();
      run(event || {});
    } catch {
      /* FAIL-OPEN: never block a /mode:* invocation on a guard exception */
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
