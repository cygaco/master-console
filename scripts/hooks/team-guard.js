#!/usr/bin/env node
// PreToolUse hook: enforces two-tier agent spawning in adhoc mode.
//
// Layer 1 (teammates): Beta (β) + Gamma (γ) ONLY.
// Alpha-allowed (research/cognition): Explore, Plan, general-purpose
// Gamma-only (build/execution): builder, fixer, reviewer, compliance,
//   learner, qa, redteam, gamma, delta
//
// This restriction ONLY applies during mode:adhoc (active team session).
// Solo mode = no restrictions.

const mcEnv = require("./lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
const fs = require("fs");
const path = require("path");

// S-LC-01: the bootstrap-face allow-list is the union of every mode's roster,
// resolved FROM the Mode-Lifecycle Registry (.claude/agents/_org/mode-lifecycle.json)
// via the shared reader — NOT a hardcoded literal. Fail-open to the known set if
// the reader is unavailable (a guard must never crash); the registry is the
// authoritative source (drift is caught by scripts/checks/mode-lifecycle-registry.js).
let modeFaces;
try {
  modeFaces = require("./lib/mode-lifecycle").allFaces();
  if (!(modeFaces instanceof Set) || modeFaces.size === 0)
    throw new Error("empty face set");
} catch {
  modeFaces = new Set(["epsilon", "beta", "gamma", "delta"]);
}

// Build-chain agent types that only Gamma should dispatch. CONFIG-DRIVEN from
// the org map via scripts/dispatch/org-roles.js (S1.1 chassis): org-map domain
// builders[] + gauntlet members + a documented static augment (legacy rename
// aliases evaluator/auditor/fix-agent + transitional/system roles). Adding a
// Wave-2 domain builder to org-map.json auto-gates it here — no edit needed.
// FAIL-SAFE: if org-roles can't load, fall back to the known build-chain set —
// NEVER an empty gate (empty = permit-all = the exact gate hole this guards).
let GAMMA_ONLY_TYPES;
try {
  GAMMA_ONLY_TYPES = require("../dispatch/org-roles").gammaOnlyTypes();
  if (!(GAMMA_ONLY_TYPES instanceof Set) || GAMMA_ONLY_TYPES.size === 0)
    throw new Error("empty gamma-only set");
} catch {
  GAMMA_ONLY_TYPES = new Set([
    "builder", "fixer", "fix-agent", "reviewer", "evaluator", "compliance",
    "ops-analyst", "learner", "auditor", "qa", "redteam", "delta", // S-7: learner→ops-analyst (legacy ids kept)
    "skeleton-builder", "stub-scaffold", // S-7: stub-scaffold→skeleton-builder (legacy kept)
    "frontend-builder", "backend-builder",
  ]);
}

// Agent names/types that are allowed as teammates (Layer 1)
const TEAMMATE_NAMES = ["beta", "gamma", "β", "γ"];
const TEAMMATE_TYPES = new Set(["beta", "gamma"]);

// S-12c heartbeat-liveness (false-block mitigation #1). The (a)/(b) liveness uses
// a 24h config-mtime window; a correct team that has merely been IDLE >24h would
// read "not live" and the hard gate would false-block. A sid-keyed
// ~/.claude/runtime/.team-live-<sid> marker — written when a correct team is
// confirmed up — asserts liveness by PRESENCE (sid-scoped, so a crashed session's
// marker never matches the live .session-id), independent of config freshness.
// Fail-CLOSED to "not fresh" on any error (the caller treats absence as "verify via
// config" — it never *grants* readiness on an exception).
function teamHeartbeatFresh(projectDir) {
  try {
    const sidPath = path.join(projectDir, ".claude", "runtime", ".session-id");
    if (!fs.existsSync(sidPath)) return false;
    const sid = fs.readFileSync(sidPath, "utf8").trim();
    if (!sid) return false;
    const hbPath = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".claude",
      "runtime",
      `.team-live-${sid}`,
    );
    if (!fs.existsSync(hbPath)) return false;
    // Presence is the signal; sid-scoping is the real staleness guard. Bound the
    // age generously (7d) so a same-sid resume after a very long idle re-verifies,
    // while still surviving the 24h config-mtime window this exists to bypass.
    const m = fs.statSync(hbPath).mtimeMs;
    return (Date.now() - m) / 3600000 < 168;
  } catch {
    return false;
  }
}

// ── S-LC-04: REGISTRY-DRIVEN init-gate helpers (E-LIFECYCLE-001) ──────────────
// Generalize the gate from a HARDCODED sprint-only ε literal to the
// Mode-Lifecycle Registry (.claude/agents/_org/mode-lifecycle.json) via the
// shared reader. The required CONDUCTOR face for a requires_team mode is the
// FIRST non-alpha face in the mode's roster (sprint → epsilon, adhoc → beta).
// Editing a mode's roster in the registry re-points the gate with NO code change
// (the de-dup S-LC-01 did). FAIL-OPEN throughout — a guard must never crash on an
// unreadable/malformed registry; the reader already mirrors FALLBACK, and these
// wrappers swallow any residual error so the sprint gate can never widen and a
// non-sprint mode can never block on a registry fault.
const FACE_SYMBOL = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
};

/** The registry-derived conductor/lead face a requires_team mode must carry, as
 *  { id, symbol }. FAIL-OPEN to the known sprint conductor (ε) so a registry read
 *  failure can never widen the DEFAULT-ON sprint gate; null for an unknown/teamless
 *  mode. */
function requiredConductor(mode) {
  try {
    const f = require("./lib/mode-lifecycle").faces(mode);
    if (Array.isArray(f) && f.length) {
      const id = String(f[0]).toLowerCase();
      return { id, symbol: FACE_SYMBOL[id] || id };
    }
  } catch {
    /* fall through to the fail-open default */
  }
  return String(mode || "").toLowerCase() === "sprint"
    ? { id: "epsilon", symbol: "ε" }
    : null;
}

/** Does the mode operate through a persistent team (registry requires_team)?
 *  FAIL-OPEN to false (no readiness gate) on any reader error. */
function requiresTeamMode(mode) {
  try {
    return !!require("./lib/mode-lifecycle").requiresTeam(mode);
  } catch {
    return false;
  }
}

/** EXACT per-member conductor-identity predicate (id or symbol; normalized).
 *  Shared by every readiness check so a substring spoof (`epsilon-helper`) can
 *  never false-satisfy a face. */
function makeIsConductor(conductor) {
  return (v) => {
    const s = String(v == null ? "" : v).trim().toLowerCase();
    return s === conductor.id || s === conductor.symbol;
  };
}

/** Does a team config doc carry the conductor face by EXACT member identity? */
function docCarriesConductor(doc, conductor) {
  if (!doc || !conductor) return false;
  const isConductor = makeIsConductor(conductor);
  return (doc.members || []).some(
    (mem) =>
      mem &&
      (isConductor(mem.agentType) ||
        isConductor(mem.role) ||
        isConductor(mem.name)),
  );
}

/** Does any FRESH (<24h) active team under ~/.claude/teams carry the given
 *  conductor face? EXACT identity match (id or symbol) — spoof-safe like the
 *  sprint path. FAIL-OPEN to false (caller treats false as "not ready"; for a
 *  non-sprint mode that only ADVISES — never blocks). */
function teamCarriesConductor(conductor) {
  if (!conductor) return false;
  try {
    const teamsRoot = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".claude",
      "teams",
    );
    if (!fs.existsSync(teamsRoot)) return false;
    for (const d of fs.readdirSync(teamsRoot)) {
      const cfg = path.join(teamsRoot, d, "config.json");
      try {
        const m = fs.statSync(cfg).mtimeMs;
        if ((Date.now() - m) / 3600000 >= 24) continue;
        const doc = JSON.parse(fs.readFileSync(cfg, "utf8"));
        if (docCarriesConductor(doc, conductor)) return true;
      } catch {
        /* skip this unreadable team dir */
      }
    }
  } catch {
    /* no teams dir / unreadable — not ready */
  }
  return false;
}

// ── PROJECT-SCOPE helpers (findings 1+2, FIX1-G1) ─────────────────────────────
// A team satisfies the gate ONLY if it binds to THIS project — by slug AND/OR a
// member cwd that is the project root exactly or strictly under it. A foreign
// team (different project slug, no member cwd under this project) must NOT be
// able to bypass the readiness gate, even if it carries the right conductor and
// has a fresh config. The scope predicate mirrors findActiveTeamForProject in
// mode-lifecycle-guard.js (the existing project-scope authority). FAIL-CLOSED to
// false when we CAN determine scope but it doesn't match; callers decide whether
// to fail-open when no scope evidence is available (empty slug + no member cwd).
function resolveProjectSlug(projectDir) {
  try {
    const manifestPath = path.join(projectDir, ".claude", "manifest.json");
    const doc = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return String((doc.project && doc.project.slug) || "").toLowerCase();
  } catch {
    return ""; // no manifest / unreadable — caller applies fail-open
  }
}

/** Does `doc` (a team config) belong to the project identified by `slug` and
 *  `projectDir`? Two arms (either is sufficient):
 *    (a) name-slug: team name equals slug OR starts with "<slug>-" (exact normalize)
 *    (b) member-cwd: any member's cwd is the project root EXACTLY, or strictly
 *        UNDER it — NOT parent-containment (a broad/foreign team rooted ABOVE the
 *        project is not ours). Returns false when neither arm matches. */
function isProjectScopedTeam(doc, teamDirName, slug, projectDir) {
  const name = String((doc && (doc.name || doc.team_name || teamDirName)) || "")
    .trim()
    .toLowerCase();
  const s = String(slug || "").toLowerCase();
  // (a) slug-based name arm
  if (s && (name === s || name.startsWith(s + "-"))) return true;
  // (b) member-cwd arm
  const normProject = String(projectDir || "").replace(/\\/g, "/").toLowerCase();
  if (!normProject) return false;
  const members = Array.isArray(doc && doc.members) ? doc.members : [];
  return members.some((mem) => {
    const c = String((mem && mem.cwd) || "").replace(/\\/g, "/").toLowerCase();
    // EXACT project cwd OR member-cwd strictly UNDER it (NOT parent-containment).
    return c && (c === normProject || c.startsWith(normProject + "/"));
  });
}

// ── S-1 / AC-1.1: VERIFY a passed team_name really exists + is fresh + carries
//    the conductor, by a REAL config lookup — never trust the bare string. The
//    `if (hasTeamName || ...) exit(0)` short-circuit was a worker-bypass: ANY
//    nonempty team_name skipped the readiness gate. Now a team_name is honored
//    ONLY when a fresh config.json for that exact team name exists AND carries ε
//    (reuses the same EXACT-match identity as the gate). FAIL-CLOSED to false
//    (not verified) on any error — a verify failure must NOT open the gate. The
//    config-mtime freshness window mirrors teamCarriesConductor (24h).
//    FINDING 1 FIX (FIX1-G1): also verify the team belongs to THIS project (slug
//    or member cwd — isProjectScopedTeam). A foreign team with the right name and
//    conductor (e.g. "doogle-sprint") must NOT bypass the gate for this project.
//    When the project slug is unknown (no manifest), scope can't be determined →
//    fail-open on scope only (the team still must verify name + freshness + ε).
function namedTeamVerified(teamName, conductor, slug, projectDir) {
  if (!conductor) return false;
  const want = String(teamName == null ? "" : teamName).trim().toLowerCase();
  if (!want) return false;
  try {
    const teamsRoot = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".claude",
      "teams",
    );
    if (!fs.existsSync(teamsRoot)) return false;
    for (const d of fs.readdirSync(teamsRoot)) {
      const cfg = path.join(teamsRoot, d, "config.json");
      try {
        const m = fs.statSync(cfg).mtimeMs;
        if ((Date.now() - m) / 3600000 >= 24) continue; // stale handle — not live
        const doc = JSON.parse(fs.readFileSync(cfg, "utf8"));
        const nm = String((doc.name || doc.team_name || d) || "").trim().toLowerCase();
        if (nm !== want) continue; // a DIFFERENT real team is not THIS team_name
        // The named team exists + is fresh: honor it only if it carries ε...
        if (!docCarriesConductor(doc, conductor)) return false;
        // ...AND belongs to THIS project (finding 1 fix: slug+cwd scope). When the
        // project slug is unknown (no manifest, slug=""), scope is indeterminate —
        // fail-open (the name+freshness+conductor check is still the guard). When the
        // slug IS known, a foreign team (different slug, no matching member cwd)
        // must NOT satisfy the named-team verification.
        if (slug && !isProjectScopedTeam(doc, d, slug, projectDir)) return false;
        return true;
      } catch {
        /* skip this unreadable team dir */
      }
    }
  } catch {
    /* no teams dir / unreadable — fail-closed (not verified) */
  }
  return false;
}

// ── S-1 / AC-1.2: does a config-present team carry the conductor, REGARDLESS of
//    the config-mtime freshness window? This is the corroboration the heartbeat
//    marker needs: the marker exists precisely to survive the 24h config-mtime
//    window (a long-idle but real team), so corroboration cannot itself require
//    freshness — it requires a REAL config-backed team IDENTITY carrying ε to
//    exist. A bare planted `.team-live-<sid>` marker with NO backing config (the
//    spoof) finds no such team → not corroborated → does not open the gate.
//    FAIL-CLOSED to false on any error.
function configTeamCarriesConductor(conductor) {
  if (!conductor) return false;
  try {
    const teamsRoot = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".claude",
      "teams",
    );
    if (!fs.existsSync(teamsRoot)) return false;
    for (const d of fs.readdirSync(teamsRoot)) {
      const cfg = path.join(teamsRoot, d, "config.json");
      try {
        const doc = JSON.parse(fs.readFileSync(cfg, "utf8"));
        if (docCarriesConductor(doc, conductor)) return true; // no mtime gate
      } catch {
        /* skip this unreadable team dir */
      }
    }
  } catch {
    /* no teams dir / unreadable — fail-closed */
  }
  return false;
}

// ── S-1 / AC-1.4: LOUD kill-switch attestation. When the team-gate kill-switch
//    fires (env WARPOS_DISABLE_TEAM_GATE or the .team-gate-off marker), the
//    bypass must NEVER be silent — emit a paths.eventsFile audit record AND a
//    stderr attestation line carrying which switch fired + the reason, so a
//    silenced gate is visible at /scan. Best-effort + fail-open: the attestation
//    must never itself crash the guard or change its allow/block decision.
function attestTeamGateKillSwitch(which, projectDir) {
  const attestation = {
    guard: "team-guard",
    bypass: "team-gate-kill-switch",
    switch: which, // "env:WARPOS_DISABLE_TEAM_GATE" | "marker:.team-gate-off"
    reason: "operator kill-switch active — readiness gate bypassed",
    ts: new Date().toISOString(),
  };
  try {
    const { log } = require("./lib/logger");
    log("audit", { type: "warn", action: "team-gate-kill-switch", ...attestation });
  } catch {
    /* logging is best-effort — the stderr line below is the fallback signal */
  }
  try {
    process.stderr.write(
      `[team-guard] ⚠ KILL-SWITCH BYPASS: the readiness gate was DISABLED via ` +
        `${which} — ${attestation.reason}. (E-LIFECYCLE-001 AC-1.4)\n`,
    );
  } catch {
    /* stderr unavailable — never throw */
  }
}

// ── S-1 / AC-1.3: harness-team cross-check for the mode.json early-exit. A
//    planted `mode.json {mode:"solo"|"oneshot"}` must NOT disable the Agent gate
//    when the REAL harness state shows an active multi-agent team. The gate must
//    not trust mode.json content to decide whether to trust mode.json — so we
//    cross-check the file against the live team store: a fresh (<24h) team config
//    carrying ≥2 members is "an active multi-agent team". When one is live, the
//    file's solo/oneshot claim is treated as UNTRUSTED for the purpose of
//    disabling the gate (it falls through to the sprint readiness path instead of
//    short-circuiting). FAIL-OPEN to false (no active team) on any error: a
//    cross-check fault must never spuriously keep the gate on for a legit solo.
function activeMultiAgentTeamPresent() {
  try {
    const teamsRoot = path.join(
      process.env.HOME || process.env.USERPROFILE || "",
      ".claude",
      "teams",
    );
    if (!fs.existsSync(teamsRoot)) return false;
    for (const d of fs.readdirSync(teamsRoot)) {
      const cfg = path.join(teamsRoot, d, "config.json");
      try {
        const m = fs.statSync(cfg).mtimeMs;
        if ((Date.now() - m) / 3600000 >= 24) continue; // stale handle — not active
        const doc = JSON.parse(fs.readFileSync(cfg, "utf8"));
        const members = Array.isArray(doc.members) ? doc.members : [];
        if (members.length >= 2) return true; // a real multi-agent team is live
      } catch {
        /* skip this unreadable team dir */
      }
    }
  } catch {
    /* no teams dir / unreadable — no active team */
  }
  return false;
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name;

    // Debug log — wrapped in its own try/catch so a filesystem failure here
    // CANNOT silently disable the guard. RT-013: previously this write
    // targeted .claude/logs/ (which doesn't exist in most projects), threw
    // ENOENT, hit the outer catch, and exited 0 — silently permitting every
    // build-chain dispatch throughout any adhoc session. Never again.
    // S: runtime-retention — this debug log is OFF by default (opt in via
    // WARPOS_TEAM_GUARD_DEBUG=1) AND byte-capped when on, so its ongoing
    // footprint is bounded even during an extended debug session. Was
    // unbounded + always-on; grew unbounded with no rotation.
    try {
      if (mcEnv.readEnv("TEAM_GUARD_DEBUG") === "1") {
        const logDir = path.resolve(__dirname, "..", "..", ".claude", "runtime");
        fs.mkdirSync(logDir, { recursive: true });
        const logPath = path.join(logDir, "team-guard-debug.log");
        try {
          const { rotateBytesIfNeeded } = require("./lib/rotate");
          rotateBytesIfNeeded(logPath, 2 * 1024 * 1024);
        } catch {
          /* rotation is best-effort — never disables the guard */
        }
        fs.appendFileSync(
          logPath,
          JSON.stringify({
            ts: new Date().toISOString(),
            toolName,
            keys: Object.keys(event.tool_input || {}),
            team_name: (event.tool_input || {}).team_name,
            name: (event.tool_input || {}).name,
            subagent_type: (event.tool_input || {}).subagent_type,
          }) + "\n",
        );
      }
    } catch {
      // Debug failures must never disable the guard.
    }

    // Only check Agent tool
    if (toolName !== "Agent") {
      process.exit(0);
    }

    const toolInput = event.tool_input || {};
    const agentType = (toolInput.subagent_type || "").toLowerCase();
    const agentName = (toolInput.name || "").toLowerCase();

    // Always allow Beta and Gamma teammates.
    // Name check uses exact-match-after-normalize (strip parens/spaces) so
    // that "Beta (β)" resolves to "beta" but a sneaky "beta-builder" does
    // not. Previous `includes()` was a bypass path for build-chain calls.
    const isTeammateType = TEAMMATE_TYPES.has(agentType);
    const normalizedName = agentName.replace(/[\s()\[\]]+/g, "");
    const isTeammateName = TEAMMATE_NAMES.includes(normalizedName);
    if (isTeammateType || isTeammateName) {
      process.exit(0);
    }

    // Mode resolution — check mode.json FIRST. RT-013 follow-up: previously
    // this only checked ~/.claude/teams/adhoc/ which persists across mode
    // switches. If user ran /mode:adhoc then /mode:oneshot, the adhoc
    // heartbeat lingered and Delta would get blocked from dispatching
    // builders — halting run-10 at Phase 2 with a cryptic team-guard
    // message. Fix: read the authoritative mode marker first.
    const projectDir =
      process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
    const modePath = path.join(projectDir, ".claude", "runtime", "mode.json");

    let currentMode = null;
    try {
      if (fs.existsSync(modePath)) {
        const modeDoc = JSON.parse(fs.readFileSync(modePath, "utf8"));
        currentMode = (modeDoc.mode || "").toLowerCase();
      }
    } catch {
      // Malformed mode.json = fall through to adhoc heartbeat check
    }

    // S-1 / AC-1.3: a solo/oneshot mode.json disables the Agent gate — but the
    // gate must not trust the file's say-so when the REAL harness state shows an
    // active multi-agent team. Cross-check ONCE for both disabling modes: if a
    // fresh multi-member team is live, the planted solo/oneshot claim is
    // UNTRUSTED — do NOT short-circuit; fall through to the readiness path (and
    // emit a loud cross-check finding so the spoof is visible at /scan). A
    // legitimate solo/oneshot (no active multi-agent team) still exits early.
    const modeDisablesGate =
      currentMode === "oneshot" || currentMode === "solo";
    const modeContradictsHarness =
      modeDisablesGate && activeMultiAgentTeamPresent();
    if (modeContradictsHarness) {
      try {
        const { log } = require("./lib/logger");
        log("audit", {
          type: "warn",
          action: "mode-json-harness-mismatch",
          guard: "team-guard",
          mode_claimed: currentMode,
          harness_state: "active-multi-agent-team",
          detail:
            "mode.json claims a gate-disabling mode but a live multi-agent team " +
            "is present — the file's say-so is NOT trusted to disable the Agent gate",
        });
      } catch {
        /* best-effort attestation */
      }
      try {
        process.stderr.write(
          `[team-guard] ⚠ mode.json claims "${currentMode}" but a live ` +
            `multi-agent team is active — NOT disabling the Agent gate on the ` +
            `file's say-so. (E-LIFECYCLE-001 AC-1.3)\n`,
        );
      } catch {
        /* never throw */
      }
      // Fall through (do NOT exit 0): the gate stays active and re-evaluates
      // via the readiness path below as if the disabling claim were absent.
    } else if (modeDisablesGate) {
      // Legitimate solo/oneshot: Delta IS the orchestrator (oneshot) / explicit
      // opt-out (solo). No contradicting harness state → honor the early exit.
      process.exit(0);
    }

    // ── Sprint-context persistent-team advisory (ED-035) ──────────────────
    // In sprint mode the operator expects work to flow through a PERSISTENT team
    // (named background subagents — reusable + DM-able via SendMessage), NOT
    // fire-and-forget one-off agents. (As of Claude Code v2.1.178 the team is the
    // IMPLICIT session-scoped team the harness creates on the first named spawn;
    // TeamCreate/TeamDelete were removed — E-TEAMS-MIGRATION-001.)
    // The team-spawn step lives inside /mode:sprint's body — bypassed when a
    // session kicks off from a /clear'd handoff with "/mode:sprint" as embedded text
    // (treated as context, the Skill never invoked) — so it skips SILENTLY and recurs
    // (RT-2026-06-06-sprint-team-orphaned-by-node-seam + the 2026-06-08 recurrence).
    // This fires at the dispatch — the exact skip point — reading the persisted mode
    // marker, OUTSIDE the bypassed /mode:sprint caller. ADVISORY ONLY: it never blocks
    // (blocking my own orchestration is too risky); it ramps by counting one-off worker
    // dispatches and suppresses once a persistent team is active. Fail-open throughout.
    if (currentMode === "sprint") {
      const hasTeamName = !!(
        toolInput.team_name && String(toolInput.team_name).trim()
      );
      // Bootstrap + read-only ALLOW-list (S-12c airtight against false-block #2,
      // bootstrap deadlock): the company FACES (so the team CAN be stood up — β/γ
      // already exited above via TEAMMATE_TYPES; ε/δ must be allowed here too) and
      // research/cognition one-offs (legitimately not "the team"). A WORKER is
      // anything else with a subagent_type (general-purpose + the build-chain
      // GAMMA_ONLY_TYPES) — that is what the gate guards.
      const FACE_TYPES = modeFaces; // registry-derived (see module head, S-LC-01)
      const RESEARCH_TYPES = new Set(["explore", "plan"]);
      const isWorker =
        agentType && !FACE_TYPES.has(agentType) && !RESEARCH_TYPES.has(agentType);
      // The required CONDUCTOR face (registry-driven; fail-open to ε for sprint).
      // Resolved BEFORE the short-circuit so team_name verification can reuse it.
      const conductor = requiredConductor(currentMode) || {
        id: "epsilon",
        symbol: "ε",
      };
      // PROJECT-SCOPE slug (finding 1+2 fix): resolved here so namedTeamVerified
      // and the readiness selection can both scope teams to THIS project.
      const projectSlug = resolveProjectSlug(projectDir);
      // AC-1.1: a passed team_name no longer short-circuits the readiness gate on
      // its bare presence. A fabricated/foreign team_name (no fresh config.json
      // carrying ε) is NOT honored — only a team_name that VERIFIES (the named
      // team exists + is fresh + carries the conductor + belongs to THIS project)
      // counts as an into-team dispatch. A non-worker (face / research one-off)
      // still exits early.
      const teamNameVerified = hasTeamName && namedTeamVerified(toolInput.team_name, conductor, projectSlug, projectDir);
      if (teamNameVerified || !isWorker) {
        // VERIFIED into-team dispatch, a face (bootstrap), or a research one-off.
        process.exit(0);
      }
      if (hasTeamName && !teamNameVerified) {
        // A worker arrived carrying a team_name that did NOT verify — log the
        // rejected spoof so the bypass attempt is visible at /scan, then fall
        // through to the readiness gate (the team_name is treated as absent).
        try {
          const { log } = require("./lib/logger");
          log("audit", {
            type: "warn",
            action: "team-name-unverified",
            guard: "team-guard",
            team_name: String(toolInput.team_name).slice(0, 80),
            detail:
              "worker dispatched with a team_name that does not verify (no fresh " +
              "config-backed team carrying ε) — not honored as an into-team dispatch",
          });
        } catch {
          /* best-effort attestation */
        }
      }
      // Is a persistent team active, AND does it carry ε (the sprint conductor /
      // quality-gate)? The persistent SPRINT team is the named company faces α+ε+β
      // — a team of only generic workers with NO ε is the 2nd miss the operator
      // caught 2026-06-08 ("this isn't the persistent team I imagined — where's
      // epsilon?"). Read the freshest active team config + check members for ε.
      // FINDING 2 FIX (FIX1-G1): select the freshest PROJECT-SCOPED team first,
      // then check for ε. A globally-fresher foreign ε-team (belonging to another
      // project) must NOT satisfy readiness for THIS project. When the project slug
      // is unknown (no manifest, projectSlug=""), scope can't be determined → fail-
      // open (old global-freshest behavior) to avoid false-blocking real teams in
      // environments without manifests. In production the manifest always exists.
      let activeCfg = null;
      let activeMtime = 0;
      try {
        const teamsRoot = path.join(
          process.env.HOME || process.env.USERPROFILE || "",
          ".claude",
          "teams",
        );
        if (fs.existsSync(teamsRoot)) {
          for (const d of fs.readdirSync(teamsRoot)) {
            const cfg = path.join(teamsRoot, d, "config.json");
            try {
              const m = fs.statSync(cfg).mtimeMs;
              if ((Date.now() - m) / 3600000 >= 24) continue; // stale
              // PROJECT-SCOPE filter: when slug is known, only consider teams
              // that belong to THIS project (slug+cwd). Read the doc to check.
              // When slug is unknown, skip filter (fail-open — old behavior).
              if (projectSlug) {
                const doc = JSON.parse(fs.readFileSync(cfg, "utf8"));
                if (!isProjectScopedTeam(doc, d, projectSlug, projectDir)) continue;
              }
              if (m > activeMtime) {
                activeCfg = cfg;
                activeMtime = m;
              }
            } catch {
              /* skip this team dir */
            }
          }
        }
      } catch {
        /* no teams dir — treat as no active team */
      }
      const teamActive = !!activeCfg;
      // S-LC-04: `conductor` is resolved above (registry-driven, fail-open to ε).
      // EXACT role/type/name match via docCarriesConductor — never a substring
      // (cross-provider review 2026-06-08 HIGH: `/epsilon/` matched a spoof worker
      // `epsilon-helper`). A member counts as the conductor only if a normalized
      // identity field EQUALS the registry conductor id or its symbol.
      let teamHasEpsilon = false;
      if (activeCfg) {
        try {
          const doc = JSON.parse(fs.readFileSync(activeCfg, "utf8"));
          teamHasEpsilon = docCarriesConductor(doc, conductor);
        } catch {
          /* malformed config — treat the conductor as absent */
        }
      }
      const teamReady = teamActive && teamHasEpsilon;

      // ── S-12c — HARD PreToolUse readiness GATE (un-skippable team-init) ──────
      // Ramps advisory→block: DEFAULT OFF (the (b) advisory below runs as today).
      // When the operator flips HARD_GATE on (env WARPOS_TEAM_GATE_HARD=1 OR a
      // .claude/runtime/.team-gate-hard marker), a WORKER dispatch with no correct
      // team live is BLOCKED from the 1st (NO ramp — un-skippable), while the
      // bootstrap/read-only ALLOW-list above keeps the team standable-up. Three
      // false-block guards: (1) heartbeat-liveness so a long-idle correct team is
      // still "live"; (2) a kill-switch so a stuck gate is bypassable without
      // editing the hook; (3) fail-open via the outer try/catch.
      // S-12c MECHANICAL: the hard gate now DEFAULTS ON (operator 2026-06-08:
      // "it must ship enabled — an enforcement that depends on you flipping a
      // marker isn't an enforcement"). The kill-switch below (env or marker) is
      // the durable escape; the heartbeat + fail-open guard against false-blocks.
      // The old WARPOS_TEAM_GATE_HARD / .team-gate-hard opt-IN is retained as a
      // belt-and-suspenders force-on, but absence no longer disables the gate.
      const hardGate = mcEnv.readEnv("TEAM_GATE_SOFT") !== "1";
      // AC-1.4: resolve WHICH kill-switch fired (for the loud attestation) — not
      // just a boolean. A bypass must never be silent.
      const killSwitchEnv = mcEnv.readEnv("DISABLE_TEAM_GATE") === "1";
      const killSwitchMarker = fs.existsSync(
        path.join(projectDir, ".claude", "runtime", ".team-gate-off"),
      );
      const killSwitch = killSwitchEnv || killSwitchMarker;
      // AC-1.2: the sid-keyed `.team-live-<sid>` heartbeat marker is a
      // freshness-SUPPLEMENT, not a standalone liveness grant. A planted marker
      // (content-free, operator-unauthenticated) must NOT flip teamLive on
      // presence alone — it is honored ONLY when corroborated by a config-verified
      // team IDENTITY: a real config-backed team carrying ε exists. Crucially the
      // corroboration is STALE-TOLERANT (configTeamCarriesConductor ignores the
      // 24h mtime window) — that window is exactly what the marker exists to
      // bypass for a long-idle but real team. A bare planted marker with NO
      // backing config finds no such identity → not corroborated → gate stays on.
      const heartbeatCorroborated =
        configTeamCarriesConductor(conductor) && teamHeartbeatFresh(projectDir);
      const teamLive = teamReady || heartbeatCorroborated;
      // AC-1.4: a kill-switch bypass emits a LOUD attestation (event + stderr)
      // BEFORE the gate is skipped — fired only on the path where the kill-switch
      // actually causes a bypass (the gate would otherwise have evaluated).
      if (hardGate && killSwitch && !teamLive) {
        attestTeamGateKillSwitch(
          killSwitchEnv ? "env:WARPOS_DISABLE_TEAM_GATE" : "marker:.team-gate-off",
          projectDir,
        );
      }
      if (hardGate && !killSwitch && !teamLive) {
        const why = !teamActive
          ? "no active persistent team"
          : "the active team is MISSING ε (the sprint conductor / quality-gate)";
        process.stdout.write(
          JSON.stringify({
            decision: "block",
            reason:
              `⛔ SPRINT MODE + no correct team live (${why}). Stand up the company ` +
              `faces FIRST by spawning them as named background subagents — ` +
              `Agent(subagent_type:"epsilon", name:"Epsilon", run_in_background:true) + ` +
              `Agent(subagent_type:"beta", name:"Beta", run_in_background:true) (the first ` +
              `spawn implicitly creates the session-scoped team — TeamCreate/TeamDelete were ` +
              `REMOVED in Claude Code v2.1.178). Then dispatch workers as named subagents. ` +
              `Bootstrap calls (faces / explore / plan) are allowed. Kill-switch: ` +
              `WARPOS_DISABLE_TEAM_GATE=1 or touch .claude/runtime/.team-gate-off. ` +
              `(E-SYSTEM-ORG-001 S-12c; E-TEAMS-MIGRATION-001)`,
          }),
        );
        process.exit(0);
      }

      // Per-session one-off counter (best-effort ramp; advise once the PATTERN shows).
      let n = 1;
      try {
        const cPath = path.join(
          projectDir,
          ".claude",
          "runtime",
          ".sprint-oneoff-count",
        );
        n = (parseInt(fs.readFileSync(cPath, "utf8"), 10) || 0) + 1;
        fs.writeFileSync(cPath, teamReady ? "0" : String(n));
      } catch {
        /* counter is best-effort */
      }
      if (!teamReady && n >= 2) {
        const advice = !teamActive
          ? `no active persistent team — stand up the company faces by spawning named ` +
            `background subagents (Agent subagent_type:epsilon + subagent_type:beta, ` +
            `run_in_background:true; α leads, ε conducts; the first spawn implicitly creates ` +
            `the session team — TeamCreate was removed in v2.1.178) before fanning out`
          : `a team is active but it is MISSING ε (Epsilon — the sprint conductor / ` +
            `quality-gate). The persistent SPRINT team is the named faces α+ε+β, not ` +
            `generic general-purpose workers — spawn subagent_type:epsilon into the team`;
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              additionalContext:
                `[team-guard] SPRINT MODE + one-off worker dispatch #${n} (no ` +
                `team_name): ${advice}. (ED-035; the no-team skip recurred 2026-06-06 ` +
                `and the wrong-roster/missing-ε miss 2026-06-08.) Advisory, not a block.`,
            },
          }),
        );
      }
      process.exit(0);
    }

    // Adhoc mode: either explicit mode.json or the legacy heartbeat check.
    // Directory existence alone is insufficient — it persists after crashes.
    // smart-context.js writes heartbeat.json with the current session ID.
    // If the session ID doesn't match, this is a stale team from a crash.
    // AC-1.3: a contradicted disabling-mode (planted solo/oneshot + a live
    // multi-agent team) forces the gate ACTIVE — the planted file must not let a
    // build-chain worker through, so we treat it like an active team session.
    let inAdhocMode = currentMode === "adhoc" || modeContradictsHarness;
    if (!inAdhocMode) {
      const adhocDir = path.join(
        process.env.HOME || process.env.USERPROFILE || "",
        ".claude",
        "teams",
        "adhoc",
      );
      try {
        if (fs.existsSync(adhocDir)) {
          const hbPath = path.join(adhocDir, "heartbeat.json");
          const sidPath = path.join(
            projectDir,
            ".claude",
            "runtime",
            ".session-id",
          );
          if (fs.existsSync(hbPath) && fs.existsSync(sidPath)) {
            const hb = JSON.parse(fs.readFileSync(hbPath, "utf8"));
            const currentSid = fs.readFileSync(sidPath, "utf8").trim();
            inAdhocMode = hb.sessionId === currentSid;
          } else if (!fs.existsSync(hbPath)) {
            // No heartbeat file = team just created, not yet pulsed.
            inAdhocMode = true;
          }
        }
      } catch {
        // Filesystem error = assume not in team mode
      }
    }

    if (!inAdhocMode) {
      // Solo mode (implicit) — no restrictions
      process.exit(0);
    }

    // In adhoc mode: block build-chain agents
    if (GAMMA_ONLY_TYPES.has(agentType)) {
      const result = {
        decision: "block",
        reason:
          `[team-guard] Agent type "${agentType}" is build-chain — ` +
          `route through Gamma (γ) in adhoc mode. ` +
          `Alpha can spawn: Explore, Plan, general-purpose. ` +
          `Gamma dispatches: builder, fixer, reviewer, compliance, learner, qa, redteam.`,
      };
      process.stdout.write(JSON.stringify(result));
      process.exit(0);
    }

    // ── S-LC-04 generalized init-gate — REPORT-ONLY for non-sprint modes ──────
    // The §8.6 mode-init checklist's team-readiness item, GENERALIZED across all
    // modes and resolved FROM the Mode-Lifecycle Registry (requires_team +
    // conductor face) — NOT hardcoded. Sprint keeps its DEFAULT-ON hard gate
    // (handled in the sprint branch above). For a NON-sprint mode that requires a
    // team (adhoc), the gate runs REPORT-ONLY this sprint: it emits an advisory
    // and ALLOWS — it NEVER blocks. The flip-to-blocking for other modes needs
    // §22 #4 operator sign-off (NOT this sprint). Ramped + suppressed-when-ready
    // to bound noise; fail-open throughout. (E-LIFECYCLE-001 S-LC-04)
    try {
      if (
        currentMode &&
        currentMode !== "sprint" &&
        requiresTeamMode(currentMode)
      ) {
        const isFace = modeFaces.has(agentType);
        const isResearch = agentType === "explore" || agentType === "plan";
        const isWorkerish = !!agentType && !isFace && !isResearch;
        if (isWorkerish) {
          const conductor = requiredConductor(currentMode);
          const ready = teamCarriesConductor(conductor);
          // Per-mode ramp counter (mirrors the sprint advisory): advise on the
          // 2nd+ worker when no ready team is live; reset to 0 once ready — so a
          // repeated init for the SAME mode never duplicates/escalates work.
          // FIX (S-LC-04 security false-green): the READ lives in its OWN try so a
          // missing/unreadable file (COLD START — first dispatch in a fresh proj)
          // defaults the prior count to 0 instead of aborting before the WRITE.
          // Previously read+write shared one try: a cold-start ENOENT on read
          // skipped the write, the file was NEVER created, every run re-hit ENOENT,
          // n stayed 1 forever, and the n>=2 advisory was DEAD in production.
          // Per-mode filename so alternating non-sprint requires_team modes ramp
          // independently (no cross-mode counter pollution).
          const safeMode = String(currentMode)
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "");
          const cPath = path.join(
            projectDir,
            ".claude",
            "runtime",
            `.initgate-${safeMode}-oneoff-count`,
          );
          let prev = 0;
          try {
            prev = parseInt(fs.readFileSync(cPath, "utf8"), 10) || 0;
          } catch {
            /* cold start / unreadable => prior count defaults to 0 */
          }
          const n = prev + 1;
          // ALWAYS persist (creating the file on cold start). Wrap the WRITE so a
          // failure degrades to "no advisory" — fail-open, never throw/block.
          let wrote = false;
          try {
            fs.writeFileSync(cPath, ready ? "0" : String(n));
            wrote = true;
          } catch {
            /* write failure => degrade to no advisory; never crash the dispatch */
          }
          if (wrote && !ready && n >= 2) {
            const sym = conductor ? conductor.symbol : "the lead face";
            process.stdout.write(
              JSON.stringify({
                hookSpecificOutput: {
                  hookEventName: "PreToolUse",
                  additionalContext:
                    `[init-gate] ${currentMode.toUpperCase()} requires a persistent ` +
                    `team (registry requires_team=true) but none carrying ${sym} is ` +
                    `live — worker dispatch #${n}. Stand up the mode's faces before ` +
                    `fanning out. REPORT-ONLY this sprint (does NOT block; flip-to-` +
                    `blocking for other modes needs §22 #4 sign-off). ` +
                    `(E-LIFECYCLE-001 S-LC-04)`,
                },
              }),
            );
          }
        }
      }
    } catch {
      /* generalized gate is report-only + fail-open — never disturb dispatch */
    }

    // Research agents (Explore, Plan, general-purpose, etc.) — allowed
    process.exit(0);
  } catch (err) {
    // Don't block on infrastructure errors
    process.exit(0);
  }
});
