#!/usr/bin/env node

/**
 * scripts/mode-set.js — Phase 2D mode state machine.
 *
 * The single canonical writer for `.claude/runtime/mode.json`. Validates
 * transitions, enforces lock semantics, and emits the enriched schema:
 *
 *   {
 *     "$schema": "mc/mode-marker/v2",
 *     "mode": "solo" | "adhoc" | "oneshot",
 *     "enteredAt": "<ISO8601>",
 *     "enteredBy": "alpha" | "beta" | "delta" | "user" | "<agent>",
 *     "allowedTransitions": ["adhoc", "oneshot", ...],
 *     "activeBuild": "<id>" | null,
 *     "lockOwner": "<agent>" | null
 *   }
 *
 * Usage:
 *   node scripts/mode-set.js <mode> [--by <agent>] [--lock-owner <agent>] [--active-build <id>] [--force]
 *
 * Modes:
 *   solo     Alpha works directly with user. No team, no orchestrator.
 *   adhoc    α + β + γ team. Default development mode.
 *   oneshot  Delta runs standalone. Full skeleton builds.
 *
 * Transition rules:
 *   - solo    ↔ adhoc, oneshot   (always allowed)
 *   - adhoc   ↔ solo, oneshot    (oneshot only if no activeBuild)
 *   - oneshot → solo, adhoc      (only if lockOwner has cleared the lock)
 *
 * Pass --force to override transition validation. Logs the override.
 *
 * Exit codes:
 *   0  marker written
 *   1  invalid mode / arguments
 *   2  transition blocked (use --force to override)
 *
 * Mode-init ≠ authorization (ROADMAP "Mode-entry must NOT trigger autonomous
 * work", REPORTED-2026-06-06): on a FRESH mode entry this writer prints a loud
 * posture banner to stdout. mode-set is the single chokepoint every `/mode:*`
 * skill calls, so the reminder fires at the exact moment of risk, every time —
 * the mechanical half of the fix (the skill bodies + α/CLAUDE.md doctrine are
 * the behavioral half). The banner is advisory (a reminder, not a hard block);
 * the residual "no hard gate on the first state-changing action" is logged as
 * enforcement debt.
 */

const fs = require("fs");
const path = require("path");

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const MARKER_PATH = path.join(PROJECT_DIR, ".claude", "runtime", "mode.json");

// AC-2.1 (SP-20260611-002): mode-set.js is the single-writer chokepoint for
// mode.json. A `node scripts/mode-set.js <mode>` invocation via Bash runs OUTSIDE
// the settings.json `SlashCommand|Skill` PreToolUse matcher, so the mode-lifecycle
// guard never observes it. The coverage fix is to make the WRITER itself emit the
// lifecycle events (the matcher-extension remedy was REJECTED as brittle —
// re-creating the matcher-gap class). Emission is BEST-EFFORT + fail-open: a
// logging fault must never break the mode write (the marker is the source of
// truth; the events are the audit trail the out-of-band detector correlates).
function lifecycleEmitter() {
  try {
    return require("./hooks/lib/lifecycle-events");
  } catch {
    return null; // no emitter available — degrade silently (write still happens)
  }
}

function resolveSessionId() {
  try {
    const p = path.join(PROJECT_DIR, ".claude", "runtime", ".session-id");
    return fs.readFileSync(p, "utf8").trim() || null;
  } catch {
    return null;
  }
}

function resolveSlug() {
  try {
    return (
      String(require("./hooks/lib/project-config").getWarpProduct() || "")
        .toLowerCase() || null
    );
  } catch {
    return null;
  }
}

// Emit the mode-switch lifecycle events for THIS write (requested → preflight →
// after). Payloads carry status LABELS only (the emitter whitelists to declared
// fields + scrubs secrets). Returns the list of emitted event ids (best-effort).
function emitModeLifecycleEvents(prevMode, targetMode, opts) {
  const lc = lifecycleEmitter();
  if (!lc || typeof lc.emit !== "function") return [];
  const emitted = [];
  const sessionId = resolveSessionId();
  const slug = resolveSlug();
  const actor = (opts && opts.by) || "alpha";
  const ts = new Date().toISOString();
  const correlation_id = `modeset-${Date.now().toString(36)}-${Math.random()
    .toString(16)
    .slice(2, 6)}`;
  const requiredTeam =
    targetMode === "sprint" || targetMode === "adhoc"
      ? slug
        ? `${slug}-${targetMode}`
        : targetMode
      : null;
  const tryEmit = (event, payload) => {
    try {
      if (lc.emit(event, payload, { actor })) emitted.push(event);
    } catch {
      /* fail-open: emit must never throw, but double-guard the call site */
    }
  };
  tryEmit("mode:switch:requested", {
    project_slug: slug,
    session_id: sessionId,
    prev_mode: prevMode,
    target_mode: targetMode,
    actor,
    timestamp: ts,
    correlation_id,
  });
  tryEmit("mode:switch:preflight", {
    session_id: sessionId,
    prev_mode: prevMode,
    target_mode: targetMode,
    existing_team_id: null,
    required_team_id: requiredTeam,
    branch: null,
    worktree: null,
    turbo_perms_state: "off",
    actor,
    timestamp: ts,
    dry_run: false, // mode-set.js is the REAL transaction writer (not the backstop)
    correlation_id,
  });
  tryEmit("mode:switch:after", {
    session_id: sessionId,
    prev_mode: prevMode,
    target_mode: targetMode,
    actor,
    timestamp: ts,
    correlation_id,
  });
  return emitted;
}

const VALID_MODES = ["solo", "adhoc", "oneshot", "sprint"];

const ALLOWED_TRANSITIONS = {
  solo: ["adhoc", "oneshot", "sprint"],
  adhoc: ["solo", "oneshot", "sprint"],
  oneshot: ["solo", "adhoc", "sprint"],
  sprint: ["solo", "adhoc", "oneshot"],
};

function parseArgs(argv) {
  const out = {
    mode: null,
    by: "alpha",
    lockOwner: null,
    activeBuild: null,
    force: false,
  };
  if (argv.length === 0) return out;
  out.mode = argv[0];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--by") out.by = argv[++i] || "alpha";
    else if (a === "--lock-owner") out.lockOwner = argv[++i] || null;
    else if (a === "--active-build") out.activeBuild = argv[++i] || null;
    else if (a === "--force") out.force = true;
  }
  return out;
}

function readCurrent() {
  try {
    const raw = fs.readFileSync(MARKER_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

function validateTransition(from, to, opts) {
  if (!from) return { ok: true, reason: "no prior marker" };
  if (from.mode === to) return { ok: true, reason: "no-op" };
  const allowed = ALLOWED_TRANSITIONS[from.mode] || [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      reason: `transition ${from.mode} → ${to} not in allowedTransitions ${JSON.stringify(allowed)}`,
    };
  }
  // If source mode is locked by another owner, block (unless --force).
  if (from.lockOwner && from.lockOwner !== opts.by) {
    return {
      ok: false,
      reason: `mode ${from.mode} is locked by ${from.lockOwner}; lockOwner must clear the lock or use --force`,
    };
  }
  // If source mode has an active build, block transition out (unless --force).
  if (from.activeBuild && to !== from.mode) {
    return {
      ok: false,
      reason: `mode ${from.mode} has activeBuild=${from.activeBuild}; halt the build before switching modes`,
    };
  }
  return { ok: true, reason: "valid transition" };
}

// A "fresh entry" is a first-write or a real mode change — NOT a same-mode
// re-run that only updates lock/activeBuild. Only fresh entries get the banner.
function isFreshEntry(current, mode) {
  return !current || current.mode !== mode;
}

function printPostureBanner(mode) {
  const line = "━".repeat(72);
  process.stdout.write(
    [
      "",
      line,
      `⛔ MODE-INIT ≠ AUTHORIZATION — you entered ${mode} mode. Setup only.`,
      line,
      "STOP here and await an EXPLICIT in-session task. Mode entry is plumbing,",
      "not a green light to execute. Do NOT proceed into work — not /sprint:full,",
      'not a build, not "continue" — even if a handoff / DUMP.md / TRACKER.md says',
      "to continue or names a forward plan. An inherited \"continue\" is CONTEXT,",
      "not a command. The first state-changing action after mode entry needs an",
      "explicit operator instruction given THIS session.",
      line,
      "",
    ].join("\n"),
  );
}

function buildMarker(mode, opts, current) {
  // Preserve enteredAt when staying in the same mode (lock/activeBuild
  // updates are not new entries). Only stamp a fresh enteredAt on real
  // transitions or first-write.
  const enteredAt =
    current && current.mode === mode && current.enteredAt
      ? current.enteredAt
      : new Date().toISOString();
  return {
    $schema: "mc/mode-marker/v2",
    mode,
    enteredAt,
    enteredBy: opts.by,
    allowedTransitions: ALLOWED_TRANSITIONS[mode] || [],
    activeBuild: opts.activeBuild,
    lockOwner: opts.lockOwner,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mode || !VALID_MODES.includes(args.mode)) {
    console.error(
      `mode-set: invalid mode ${JSON.stringify(args.mode)}; expected one of ${VALID_MODES.join("|")}`,
    );
    process.exit(1);
  }

  const current = readCurrent();
  const validation = validateTransition(current, args.mode, args);

  if (!validation.ok && !args.force) {
    console.error(`mode-set: blocked — ${validation.reason}`);
    console.error(`  current: ${JSON.stringify(current)}`);
    console.error(`  pass --force to override`);
    process.exit(2);
  }

  const marker = buildMarker(args.mode, args, current);
  if (args.force && !validation.ok) {
    marker._forced = {
      reason: validation.reason,
      forcedAt: new Date().toISOString(),
    };
  }

  fs.mkdirSync(path.dirname(MARKER_PATH), { recursive: true });
  fs.writeFileSync(MARKER_PATH, JSON.stringify(marker, null, 2) + "\n");

  // AC-2.1: emit the mode lifecycle events for THIS write so a Bash-direct
  // `node scripts/mode-set.js <mode>` is COVERED (preflight + event trail)
  // without depending on the PreToolUse hook matcher. Best-effort + fail-open:
  // never let a logging fault break a successful mode write.
  emitModeLifecycleEvents(current ? current.mode : null, args.mode, { by: args.by });

  console.log(
    `mode-set: ${current ? current.mode : "(none)"} → ${args.mode} (by ${args.by}${args.lockOwner ? ", lockOwner=" + args.lockOwner : ""}${args.activeBuild ? ", activeBuild=" + args.activeBuild : ""})`,
  );

  // Mode-init ≠ authorization: on a fresh entry, print the STOP-and-await-a-task
  // posture banner. Same-mode lock/activeBuild updates are not entries — no banner.
  if (isFreshEntry(current, args.mode)) {
    printPostureBanner(args.mode);
  }
}

main();
