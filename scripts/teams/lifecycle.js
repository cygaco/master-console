#!/usr/bin/env node
// scripts/teams/lifecycle.js — Persistent-Team Lifecycle Manager
// (E-LIFECYCLE-001 / S-LC-05). Project-slug-scoped spawn/verify, BEST-EFFORT
// kill/teardown, duplicate prevention, orphan + stale detection, a durable
// readiness record, and resume reconciliation over the machine-global harness
// team store (~/.claude/teams/*/config.json).
//
// ─────────────────────────────────────────────────────────────────────────
// THE HONEST CEILING (feasibility-corrected 2026-06-08; plan §8.4 / §20)
// ─────────────────────────────────────────────────────────────────────────
//   • Teams are a HARNESS primitive. As of Claude Code v2.1.178 (2026-06-15) they
//     are IMPLICIT + session-scoped: a teammate is spawned via Agent(name,
//     run_in_background:true) — the first such spawn creates the session team
//     (TeamCreate / TeamDelete were REMOVED; SendMessage is unchanged). A Node
//     script CANNOT spawn a teammate, CANNOT delete a team (no TeamDelete; and the
//     session team is reaped with the session), and CANNOT force-kill a live
//     in-process teammate. So: (E-TEAMS-MIGRATION-001)
//       - verify()   REPORTS liveness + returns the EXACT spawn directive for
//                    the model to execute — it does not itself spawn.
//       - teardown() is BEST-EFFORT: it RECORDS the shutdown request, (only in
//                    apply mode) removes the durable team HANDLE (config.json —
//                    the Node-side surrogate for TeamDelete), marks residual
//                    state, and NEVER claims a guaranteed kill of a live
//                    teammate. killedGuaranteed is ALWAYS false.
//   • Team state is machine-GLOBAL — there is no per-project field. So project
//     scoping is a SLUG HEURISTIC on the team NAME (session-start.js mints
//     `<slug>-<mode>`). The slug filter is the LOAD-BEARING SAFETY: a team
//     whose slug ≠ this project's is FOREIGN and is NEVER touched by any kill.
//
// POSTURE: FAIL-OPEN. Default is report-only (detect + record). The SessionEnd
// backstop REQUESTS teardown (no handle removal), logs the result, never throws.
// Actual handle removal happens only under an explicit `apply` flag, still
// slug-scoped, still best-effort, still never a claimed guaranteed kill.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

// Staleness threshold — mirrors session-start.js's 24h `.team-marker` warning.
const STALE_HOURS = 24;

// ── Roots (all injectable for tests so we NEVER touch the real machine-global
//    ~/.claude/teams during a test run — that store holds other projects' live
//    teams, e.g. `doogle-sprint`). ───────────────────────────────────────────
function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/** Machine-global team store. opts.teamsRoot > env override > ~/.claude/teams. */
function teamsRoot(opts = {}) {
  return (
    opts.teamsRoot ||
    process.env.WARPOS_TEAMS_DIR_OVERRIDE ||
    path.join(homeDir(), ".claude", "teams")
  );
}

/** Durable runtime store for readiness/state records (machine-global, matching
 *  where session-start.js writes `.team-live-<sid>`). Injectable for tests. */
function stateDir(opts = {}) {
  return (
    opts.stateDir ||
    process.env.WARPOS_TEAM_STATE_DIR_OVERRIDE ||
    path.join(homeDir(), ".claude", "runtime")
  );
}

/** Project directory (for slug derivation). opts.projectDir > CLAUDE_PROJECT_DIR > cwd. */
function projectDir(opts = {}) {
  return path.resolve(
    opts.projectDir || process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  );
}

/** Project slug — mirrors session-start.js EXACTLY so the filter matches the
 *  team names that hook mints (`<slug>-<mode>`):
 *    basename(projectDir).toLowerCase().replace(/[^a-z0-9]/g, "") || "project".
 *  opts.slug short-circuits (used by the hook + tests). */
function projectSlug(opts = {}) {
  if (opts.slug) return String(opts.slug).toLowerCase().replace(/[^a-z0-9]/g, "");
  const base = path.basename(projectDir(opts));
  return base.toLowerCase().replace(/[^a-z0-9]/g, "") || "project";
}

/** Current mode (for required-roster / team-name construction). opts.mode >
 *  runtime/mode.json > "". Fail-open. */
function currentMode(opts = {}) {
  if (opts.mode) return String(opts.mode).toLowerCase();
  try {
    const mj = path.join(projectDir(opts), ".claude", "runtime", "mode.json");
    return (JSON.parse(fs.readFileSync(mj, "utf8")).mode || "").toLowerCase();
  } catch {
    return "";
  }
}

/** Required persistent-team faces for a mode (registry-sourced; fail-open). */
function requiredFaces(mode) {
  try {
    return require("../hooks/lib/mode-lifecycle").faces(mode);
  } catch {
    return [];
  }
}

// ── AC-1.5: EXACT per-member face matching (spoof-safe) ──────────────────────
// Face symbols mirror team-guard.js's FACE_SYMBOL so a face id can be matched by
// its symbol too (a config may carry either). A member SATISFIES a face only when
// a normalized identity field (agentType / role / name) EQUALS the face id or its
// symbol — never a substring. The old `blob.includes(f)` substring match let a
// member named/typed to merely CONTAIN a face token (e.g. `epsilon-helper`, or
// any field whose JSON contains `beta`) false-satisfy that face.
const FACE_SYMBOL = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε" };

/** Does `members` cover EVERY required face by exact per-member identity? */
function membersCoverFaces(members, faces) {
  if (!Array.isArray(faces) || faces.length === 0) return false;
  const roster = Array.isArray(members) ? members : [];
  const norm = (v) => String(v == null ? "" : v).trim().toLowerCase();
  return faces.every((face) => {
    const f = norm(face);
    const sym = FACE_SYMBOL[f] || f;
    return roster.some((mem) => {
      if (!mem) return false;
      const at = norm(mem.agentType);
      const role = norm(mem.role);
      const nm = norm(mem.name);
      return (
        at === f || at === sym ||
        role === f || role === sym ||
        nm === f || nm === sym
      );
    });
  });
}

// ── Team enumeration ────────────────────────────────────────────────────────
/** Every team dir carrying a readable config.json. UUID inbox-only dirs (no
 *  config.json) are NOT teams and are skipped. Malformed config → recorded as
 *  unreadable (fail-open), never thrown. */
function listTeams(opts = {}) {
  const root = teamsRoot(opts);
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return []; // no store → nothing to manage
  }
  const out = [];
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    const file = path.join(root, d.name, "config.json");
    if (!fs.existsSync(file)) continue; // UUID inbox-only dir, etc.
    let config = null;
    let unreadable = false;
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(file).mtimeMs;
      config = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
      unreadable = true;
    }
    const members =
      config && Array.isArray(config.members) ? config.members : [];
    out.push({
      name: (config && (config.name || config.team_name)) || d.name,
      dirName: d.name,
      dir: path.join(root, d.name),
      file,
      mtimeMs,
      ageHours: mtimeMs ? (Date.now() - mtimeMs) / 3_600_000 : Infinity,
      unreadable,
      config,
      members,
      leadSessionId: (config && config.leadSessionId) || null,
    });
  }
  return out;
}

// ── THE LOAD-BEARING PROJECT-SCOPE FILTER (name-slug OR member-cwd) ───────────
// E-TEAMS-MIGRATION-001: Claude Code v2.1.178 (2026-06-15) made teams IMPLICIT +
// session-scoped — the harness now names a team `session-<uuid>` (NOT the
// `<slug>-<mode>` handle session-start mints). So the name-slug arm ALONE silently
// stops matching our own team: every MC team reads as FOREIGN, projectTeams()
// goes empty, verify() falsely reports "no team live", AND teardown never reaps the
// real team (it's mistaken for another project's). The harness STILL writes
// members[] with each member's `cwd`, so we add a member-CWD arm (mirrors
// team-guard.js isProjectScopedTeam arm (b), the existing project-scope authority).
// SAFETY IS PRESERVED: a team matches ONLY if its NAME carries our slug OR a MEMBER
// CWD is our project root exactly / strictly under it. A team with neither (foreign
// slug + foreign/empty member cwd) is STILL not ours → never kill-eligible (the
// conservative default the wrong-project-survives invariant depends on). The
// member-cwd arm is STRICT containment (=== root or startsWith root + "/"), never
// parent-containment — a team rooted ABOVE the project is not ours.
/** Does `team` belong to the project identified by `slug` + `projectDir`?
 *  TRUE iff (a) name === slug OR name startsWith `${slug}-`  [legacy handle], OR
 *          (b) any member cwd is the project root exactly, or strictly under it
 *              [v2.1.178 implicit session-team].
 *  `team` may be the team object ({name, members}) OR a bare name string (back-
 *  compat — bare string has no members, so only arm (a) can match). */
function teamBelongsToProject(team, slug, projectDir) {
  const isObj = team && typeof team === "object";
  const name = String((isObj ? team.name || team.team_name : team) || "")
    .toLowerCase();
  const s = String(slug || "").toLowerCase();
  // (a) legacy name-slug arm. The trailing "-" stops prefix bleed (slug "warp"
  // must NOT match "mc-sprint"; "mc" must NOT match "mcx-sprint").
  if (s && name && (name === s || name.startsWith(s + "-"))) return true;
  // (b) member-cwd arm (v2.1.178 session-<uuid> teams). STRICT containment only.
  const normProject = String(projectDir || "").replace(/\\/g, "/").toLowerCase();
  if (!normProject) return false; // no project anchor → cannot attribute by cwd
  const members = isObj && Array.isArray(team.members) ? team.members : [];
  return members.some((mem) => {
    const c = String((mem && mem.cwd) || "").replace(/\\/g, "/").toLowerCase();
    return c && (c === normProject || c.startsWith(normProject + "/"));
  });
}

/** Project-scoped teams (kill-eligible) for the resolved slug + project dir. */
function projectTeams(opts = {}) {
  const slug = projectSlug(opts);
  const dir = projectDir(opts);
  return listTeams(opts).filter((t) => teamBelongsToProject(t, slug, dir));
}

/** FOREIGN teams — every team that does NOT belong to this project. These MUST
 *  survive every teardown (the wrong-project-survives invariant). */
function foreignTeams(opts = {}) {
  const slug = projectSlug(opts);
  const dir = projectDir(opts);
  return listTeams(opts).filter((t) => !teamBelongsToProject(t, slug, dir));
}

// ── Verify (REPORT + spawn directive; never spawns) ─────────────────────────
/** Is the correct team live for this mode? Returns a status + (when not live)
 *  the EXACT named-Agent spawn directive the model must run. Never spawns. */
function verify(opts = {}) {
  const slug = projectSlug(opts);
  const mode = currentMode(opts);
  const faces = requiredFaces(mode);
  const mine = projectTeams(opts);

  // Live = a fresh project team whose members cover every required face. AC-1.5:
  // EXACT per-member identity matching (membersCoverFaces) — NOT a substring
  // `blob.includes(f)` (which let `epsilon-helper` / any field containing a face
  // token false-satisfy a face). Matches team-guard's isConductor `===` posture.
  let live = null;
  for (const t of mine) {
    if (t.unreadable) continue;
    if (t.ageHours >= STALE_HOURS) continue;
    if (faces.length && membersCoverFaces(t.members, faces)) {
      live = t;
      break;
    }
  }

  let directive = null;
  if (!live && faces.length) {
    const team = `${slug}-${mode}`;
    // E-TEAMS-MIGRATION-001: no TeamCreate call — v2.1.178 removed it. The first
    // named background subagent implicitly creates the session-scoped team; the
    // harness still accepts team_name + writes the members[] config. The directive
    // is therefore just the named Agent spawns (run_in_background:true).
    directive = {
      team_name: team,
      calls: faces.map(
        (f) =>
          `Agent(subagent_type:"${f}", name:"${f}", run_in_background:true, team_name:"${team}")`,
      ),
    };
  }

  return {
    slug,
    mode,
    requiredFaces: faces,
    requiresTeam: faces.length > 0,
    live: !!live,
    team: live ? live.name : null,
    directive, // null when already live or mode needs no team
    foreignProtectedCount: foreignTeams(opts).length,
  };
}

// ── Duplicate prevention + orphan/stale detection ───────────────────────────
const SUFFIX_RE = /-\d+$/; // Claude Code's de-dup suffix on an accreted member.

/** Duplicate prevention: more than one project team for the same mode, or a
 *  member name carrying a `-N` de-dup suffix (cross-session accretion, W-21). */
function detectDuplicates(opts = {}) {
  const mode = currentMode(opts);
  const mine = projectTeams(opts).filter((t) => !t.unreadable);
  const findings = [];

  // Multiple live project teams for the same mode → duplicate team handles.
  const sameMode = mine.filter((t) =>
    mode ? t.name.toLowerCase().endsWith(`-${mode}`) : true,
  );
  if (sameMode.length > 1) {
    findings.push({
      type: "duplicate-team",
      detail: `${sameMode.length} project team handles for mode "${mode || "*"}": ${sameMode
        .map((t) => t.name)
        .join(", ")} — only the freshest should be live`,
      teams: sameMode.map((t) => t.name),
    });
  }

  // -N member accretion inside any project team.
  for (const t of mine) {
    for (const m of t.members) {
      const nm = m.name || m.agentId || m.agentType || "<unnamed>";
      if (SUFFIX_RE.test(nm)) {
        findings.push({
          type: "duplicate-suffix",
          team: t.name,
          member: nm,
          detail: `member "${nm}" carries a -N de-dup suffix — a prior same-named member was never reconciled`,
        });
      }
    }
  }
  return findings;
}

/** Orphan + stale detection over PROJECT teams only:
 *    stale-team   — config mtime older than STALE_HOURS (a stale handle).
 *    orphaned     — a fresh-enough team whose leadSessionId has NO live readiness
 *                   marker (`.team-live-<sid>` absent) — a candidate in-process
 *                   zombie / dead-lead handle. Reported, never auto-killed. */
function detectOrphansStale(opts = {}) {
  const mine = projectTeams(opts);
  const sd = stateDir(opts);
  let liveSids = new Set();
  try {
    for (const f of fs.readdirSync(sd)) {
      const m = /^\.team-live-(.+)$/.exec(f);
      if (m) liveSids.add(m[1].toLowerCase());
    }
  } catch {
    /* no state dir → no live markers */
  }
  const findings = [];
  for (const t of mine) {
    if (t.unreadable) {
      findings.push({
        type: "unreadable",
        team: t.name,
        detail: "config.json present but unparseable — cannot verify roster",
      });
      continue;
    }
    if (t.ageHours >= STALE_HOURS) {
      findings.push({
        type: "stale-team",
        team: t.name,
        ageHours: Math.round(t.ageHours),
        detail: `team handle is ${Math.round(t.ageHours)}h old (≥${STALE_HOURS}h) — stale; reconcile before reuse`,
      });
    }
    // Orphaned: a fresh handle whose lead session is not advertising liveness.
    // HONEST CORRELATION ONLY: the `.team-live-<sid>` markers are keyed by the
    // MC short session id (`s-…`), NOT the harness UUID a team's
    // leadSessionId usually carries. We therefore ONLY attempt the orphan
    // correlation when the leadSessionId is in the SAME (`s-…`) namespace — for
    // a UUID-keyed lead the correlation is impossible, so we do NOT claim orphan
    // (no false-positive noise; absence of a correlatable id ≠ orphaned).
    const lead = String(t.leadSessionId || "").toLowerCase();
    if (
      t.ageHours < STALE_HOURS &&
      lead.startsWith("s-") &&
      liveSids.size &&
      !liveSids.has(lead)
    ) {
      findings.push({
        type: "orphaned-candidate",
        team: t.name,
        detail: `no live readiness marker for leadSessionId ${t.leadSessionId} — possible orphaned/zombie handle (report-only)`,
      });
    }
  }
  return findings;
}

// ── Durable readiness + state records ───────────────────────────────────────
function statePath(opts = {}) {
  return path.join(stateDir(opts), `.team-lifecycle-${projectSlug(opts)}.json`);
}

function readState(opts = {}) {
  try {
    return JSON.parse(fs.readFileSync(statePath(opts), "utf8"));
  } catch {
    return {
      slug: projectSlug(opts),
      teardownRequests: [],
      reconciliations: [],
      readiness: [],
    };
  }
}

function writeState(state, opts = {}) {
  try {
    fs.mkdirSync(stateDir(opts), { recursive: true });
    fs.writeFileSync(statePath(opts), JSON.stringify(state, null, 2));
    return true;
  } catch {
    return false; // fail-open: a state-write failure must never break the caller
  }
}

/** Durable readiness record: the sid-keyed `.team-live-<sid>` marker (the
 *  freshness-independent liveness signal session-start + team-guard read) PLUS
 *  a state-file append. Best-effort; never throws. */
function writeReadinessRecord(opts = {}) {
  const sid = resolveSid(opts);
  const rec = {
    ts: new Date().toISOString(),
    slug: projectSlug(opts),
    mode: currentMode(opts),
    sid,
    team: (verify(opts).team) || null,
  };
  let markerWritten = false;
  if (sid) {
    try {
      fs.mkdirSync(stateDir(opts), { recursive: true });
      fs.writeFileSync(
        path.join(stateDir(opts), `.team-live-${sid}`),
        JSON.stringify({ ts: rec.ts, mode: rec.mode }),
      );
      markerWritten = true;
    } catch {
      /* best-effort */
    }
  }
  const state = readState(opts);
  state.readiness = (state.readiness || []).slice(-19);
  state.readiness.push(rec);
  writeState(state, opts);
  return { ...rec, markerWritten };
}

function resolveSid(opts = {}) {
  if (opts.sid) return String(opts.sid).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
  try {
    const p = path.join(projectDir(opts), ".claude", "runtime", ".session-id");
    return fs.readFileSync(p, "utf8").trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
  } catch {
    return "";
  }
}

// ── Verify-terminated gate (HONEST: fail-safe to "not verified") ─────────────
/** Can we POSITIVELY confirm this team's members are NOT live? This gates handle
 *  removal under `apply` so we NEVER orphan a possibly-live team by blind-removing
 *  its config.json. The harness cannot force-kill a live in-process teammate, so
 *  this is deliberately CONSERVATIVE: it returns TRUE only on a positive not-live
 *  signal and DEFAULTS to FALSE ("not verified") whenever it cannot confirm.
 *
 *  Returns FALSE (cannot confirm → fail-safe) when:
 *    • team is missing/nameless, or
 *    • the config is UNREADABLE (roster unverifiable → termination unverifiable), or
 *    • there is a LIVE-member indicator: a FRESH heartbeat (config mtime within the
 *      STALE_HOURS freshness window) means a member MAY still be touching the
 *      handle — a fresh heartbeat OVERRIDES any stale shutdown record.
 *  Returns TRUE (positively confirmed not-live) when there is NO live-member
 *  indicator AND either:
 *    • the heartbeat is STALE beyond STALE_HOURS (the same staleness signal
 *      detectOrphansStale + verify already use — no live member is touching it), or
 *    • an explicit shutdown/termination was already recorded for THIS exact team. */
function verifyTerminated(team, opts = {}) {
  try {
    if (!team || !team.name) return false;
    // Unreadable handle → roster (and therefore termination) cannot be verified.
    if (team.unreadable) return false;
    // LIVE-member indicator: a fresh heartbeat → cannot confirm termination.
    const fresh =
      typeof team.ageHours === "number" && team.ageHours < STALE_HOURS;
    if (fresh) return false;
    // No live indicator. Positive not-live signal #1: stale beyond threshold.
    const staleBeyondThreshold =
      typeof team.ageHours === "number" && team.ageHours >= STALE_HOURS;
    // Positive not-live signal #2: an explicit shutdown/termination on record.
    let shutdownRecorded = false;
    try {
      const state = readState(opts);
      shutdownRecorded = (state.teardownRequests || []).some(
        (r) => r && Array.isArray(r.teams) && r.teams.includes(team.name),
      );
    } catch {
      shutdownRecorded = false;
    }
    return staleBeyondThreshold || shutdownRecorded;
  } catch {
    return false; // any verification error → NOT verified (fail-safe)
  }
}

// ── BEST-EFFORT teardown (slug-scoped; honest; never a claimed kill) ─────────
/** Request teardown of THIS PROJECT's team(s). FOREIGN teams are never touched.
 *  Sequence (mirrors the harness primitive flow, recorded honestly):
 *    1. shutdown-requested   — always recorded (the SendMessage(shutdown) the
 *                              model would send; a Node script can't send it).
 *    2. handle-removed       — ONLY when opts.apply: remove config.json (the
 *                              Node-side surrogate for TeamDelete). Best-effort.
 *    3. residual state       — ALWAYS best-effort; killedGuaranteed is ALWAYS
 *                              false (a live in-process teammate cannot be
 *                              force-killed; removing the handle does not kill
 *                              the process).
 *  Default (no apply) = REQUEST-ONLY (report + record, no FS mutation) — the
 *  fail-open posture the SessionEnd backstop uses. */
function teardown(opts = {}) {
  const slug = projectSlug(opts);
  const apply = !!opts.apply;
  const mine = projectTeams(opts);
  const foreign = foreignTeams(opts);

  const requested = [];
  for (const t of mine) {
    const entry = {
      team: t.name,
      shutdownRequested: true, // step 1 — always
      handleRemoved: false, // step 2 — only under apply, best-effort
      residual: "best-effort",
      killedGuaranteed: false, // step 3 — NEVER claimed true
    };
    if (apply) {
      // VERIFY-TERMINATED GATE (load-bearing): only remove the durable handle
      // once we can POSITIVELY confirm the team is not live. If termination is
      // unverified (fresh heartbeat / live indicator) we SKIP — leaving the
      // handle — rather than blind-remove and ORPHAN possibly-live members.
      const terminated = verifyTerminated(t, opts);
      entry.terminationVerified = terminated;
      if (terminated) {
        try {
          // Surrogate for TeamDelete: remove the durable HANDLE (config.json) so
          // the team is no longer the freshest-by-mtime live identity. We leave
          // the dir + inboxes and do NOT rm-rf. This does NOT kill a live process.
          if (fs.existsSync(t.file)) {
            fs.rmSync(t.file, { force: true });
            entry.handleRemoved = true;
          }
        } catch (e) {
          entry.handleError = e.message; // best-effort: record, never throw
        }
      } else {
        // Termination not confirmed → DO NOT remove the handle. Record a residual
        // skip; never blind-remove, never throw.
        entry.handleRemoved = false;
        entry.skippedReason = "termination-unverified";
        entry.residual = "skip: termination unverified — handle left in place";
        logVirtual("team:persistent:kill:skip", {
          slug,
          team: t.name,
          reason: "termination-unverified",
          killedGuaranteed: false,
        });
      }
    }
    requested.push(entry);
  }

  const result = {
    slug,
    mode: currentMode(opts),
    apply,
    requested, // project-scoped only
    foreignProtected: foreign.map((t) => t.name), // proof the filter held
    // HONEST CEILING — surfaced in the record so no caller can claim otherwise.
    killedGuaranteed: false,
    residual:
      "best-effort: shutdown requested + handle removed (if apply); a live " +
      "in-process teammate cannot be force-killed and may persist until reaped",
    ts: new Date().toISOString(),
  };

  // Durable record + virtual event.
  const state = readState(opts);
  state.teardownRequests = (state.teardownRequests || []).slice(-19);
  state.teardownRequests.push({
    ts: result.ts,
    apply,
    teams: requested.map((r) => r.team),
    foreignProtected: result.foreignProtected,
  });
  writeState(state, opts);
  logVirtual("team:persistent:kill:after", {
    slug,
    teams: requested.map((r) => r.team),
    foreignProtected: result.foreignProtected,
    killedGuaranteed: false,
  });
  return result;
}

// ── Resume reconciliation (mark stale, never blind-kill) ─────────────────────
/** On resume: detect a stale/orphaned project-team handle and RECONCILE — mark
 *  it stale in the durable state + log; NEVER blind-kill (a teardown is a
 *  separate, explicit, slug-scoped op). Fail-open. */
function reconcile(opts = {}) {
  const slug = projectSlug(opts);
  const stale = detectOrphansStale(opts);
  const dupes = detectDuplicates(opts);
  const rec = {
    ts: new Date().toISOString(),
    slug,
    mode: currentMode(opts),
    staleFindings: stale,
    duplicateFindings: dupes,
    action: "marked-stale-no-kill",
  };
  const state = readState(opts);
  state.reconciliations = (state.reconciliations || []).slice(-19);
  state.reconciliations.push(rec);
  writeState(state, opts);
  logVirtual("session:resume:stale-team-detect", {
    slug,
    stale: stale.length,
    duplicates: dupes.length,
  });
  return rec;
}

// ── Status (aggregate snapshot) ─────────────────────────────────────────────
function status(opts = {}) {
  const v = verify(opts);
  return {
    slug: v.slug,
    mode: v.mode,
    live: v.live,
    team: v.team,
    requiredFaces: v.requiredFaces,
    projectTeams: projectTeams(opts).map((t) => t.name),
    foreignTeams: foreignTeams(opts).map((t) => t.name),
    duplicates: detectDuplicates(opts),
    orphansStale: detectOrphansStale(opts),
  };
}

// ── Virtual-event logging (fail-open) ───────────────────────────────────────
function logVirtual(event, payload) {
  try {
    const { log } = require("../hooks/lib/logger");
    log("team-lifecycle", { event, ...payload }, { actor: "team-lifecycle-manager" });
  } catch {
    /* logging is best-effort — never break the caller */
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--apply") opts.apply = true;
    else if (a === "--slug") opts.slug = argv[++i];
    else if (a === "--mode") opts.mode = argv[++i];
    else if (a === "--sid") opts.sid = argv[++i];
    else if (!opts._cmd) opts._cmd = a;
  }
  return opts;
}

function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const cmd = opts._cmd || "status";
  let out;
  try {
    if (cmd === "verify") out = verify(opts);
    else if (cmd === "teardown") out = teardown(opts);
    else if (cmd === "reconcile") out = reconcile(opts);
    else if (cmd === "readiness") out = writeReadinessRecord(opts);
    else out = status(opts);
  } catch (e) {
    // Fail-open: a manager error must never crash a caller (esp. the hook).
    out = { ok: false, error: e.message, cmd };
    if (opts.json) console.log(JSON.stringify(out));
    else console.error(`[team-lifecycle] ${cmd} error: ${e.message}`);
    process.exit(0);
  }
  if (opts.json) console.log(JSON.stringify(out, null, 2));
  else console.log(`[team-lifecycle] ${cmd}:\n` + JSON.stringify(out, null, 2));
  process.exit(0);
}

module.exports = {
  STALE_HOURS,
  homeDir,
  teamsRoot,
  stateDir,
  projectDir,
  projectSlug,
  currentMode,
  requiredFaces,
  membersCoverFaces,
  listTeams,
  teamBelongsToProject,
  projectTeams,
  foreignTeams,
  verify,
  detectDuplicates,
  detectOrphansStale,
  statePath,
  readState,
  writeState,
  writeReadinessRecord,
  resolveSid,
  verifyTerminated,
  teardown,
  reconcile,
  status,
  main,
};

if (require.main === module) main();
