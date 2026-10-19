#!/usr/bin/env node

"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const os = require("os");
const path = require("path");

const STALE_HOURS = 24;

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function teamsRoot(opts = {}) {
  return (
    opts.teamsRoot ||
    mcEnv.readEnv("TEAMS_DIR_OVERRIDE") ||
    path.join(homeDir(), ".claude", "teams")
  );
}

function stateDir(opts = {}) {
  return (
    opts.stateDir ||
    mcEnv.readEnv("TEAM_STATE_DIR_OVERRIDE") ||
    path.join(homeDir(), ".claude", "runtime")
  );
}

function projectDir(opts = {}) {
  return path.resolve(
    opts.projectDir || process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  );
}

function projectSlug(opts = {}) {
  if (opts.slug) return String(opts.slug).toLowerCase().replace(/[^a-z0-9]/g, "");
  const base = path.basename(projectDir(opts));
  return base.toLowerCase().replace(/[^a-z0-9]/g, "") || "project";
}

function currentMode(opts = {}) {
  if (opts.mode) return String(opts.mode).toLowerCase();
  try {
    const mj = path.join(projectDir(opts), ".claude", "runtime", "mode.json");
    return (JSON.parse(fs.readFileSync(mj, "utf8")).mode || "").toLowerCase();
  } catch {
    return "";
  }
}

function requiredFaces(mode) {
  try {
    return require("../hooks/lib/mode-lifecycle").faces(mode);
  } catch {
    return [];
  }
}

const FACE_SYMBOL = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε" };

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

function listTeams(opts = {}) {
  const root = teamsRoot(opts);
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    const file = path.join(root, d.name, "config.json");
    if (!fs.existsSync(file)) continue;
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

function teamBelongsToProject(team, slug, projectDir) {
  const isObj = team && typeof team === "object";
  const name = String((isObj ? team.name || team.team_name : team) || "")
    .toLowerCase();
  const s = String(slug || "").toLowerCase();
  if (s && name && (name === s || name.startsWith(s + "-"))) return true;
  const normProject = String(projectDir || "").replace(/\\/g, "/").toLowerCase();
  if (!normProject) return false;
  const members = isObj && Array.isArray(team.members) ? team.members : [];
  return members.some((mem) => {
    const c = String((mem && mem.cwd) || "").replace(/\\/g, "/").toLowerCase();
    return c && (c === normProject || c.startsWith(normProject + "/"));
  });
}

function projectTeams(opts = {}) {
  const slug = projectSlug(opts);
  const dir = projectDir(opts);
  return listTeams(opts).filter((t) => teamBelongsToProject(t, slug, dir));
}

function foreignTeams(opts = {}) {
  const slug = projectSlug(opts);
  const dir = projectDir(opts);
  return listTeams(opts).filter((t) => !teamBelongsToProject(t, slug, dir));
}

function verify(opts = {}) {
  const slug = projectSlug(opts);
  const mode = currentMode(opts);
  const faces = requiredFaces(mode);
  const mine = projectTeams(opts);

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
    directive,
    foreignProtectedCount: foreignTeams(opts).length,
  };
}

const SUFFIX_RE = /-\d+$/;

function detectDuplicates(opts = {}) {
  const mode = currentMode(opts);
  const mine = projectTeams(opts).filter((t) => !t.unreadable);
  const findings = [];

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
    return false;
  }
}

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

function verifyTerminated(team, opts = {}) {
  try {
    if (!team || !team.name) return false;
    if (team.unreadable) return false;
    const fresh =
      typeof team.ageHours === "number" && team.ageHours < STALE_HOURS;
    if (fresh) return false;
    const staleBeyondThreshold =
      typeof team.ageHours === "number" && team.ageHours >= STALE_HOURS;
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
    return false;
  }
}

function teardown(opts = {}) {
  const slug = projectSlug(opts);
  const apply = !!opts.apply;
  const mine = projectTeams(opts);
  const foreign = foreignTeams(opts);

  const requested = [];
  for (const t of mine) {
    const entry = {
      team: t.name,
      shutdownRequested: true,
      handleRemoved: false,
      residual: "best-effort",
      killedGuaranteed: false,
    };
    if (apply) {
      const terminated = verifyTerminated(t, opts);
      entry.terminationVerified = terminated;
      if (terminated) {
        try {
          if (fs.existsSync(t.file)) {
            fs.rmSync(t.file, { force: true });
            entry.handleRemoved = true;
          }
        } catch (e) {
          entry.handleError = e.message;
        }
      } else {
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
    requested,
    foreignProtected: foreign.map((t) => t.name),
    killedGuaranteed: false,
    residual:
      "best-effort: shutdown requested + handle removed (if apply); a live " +
      "in-process teammate cannot be force-killed and may persist until reaped",
    ts: new Date().toISOString(),
  };

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

function logVirtual(event, payload) {
  try {
    const { log } = require("../hooks/lib/logger");
    log("team-lifecycle", { event, ...payload }, { actor: "team-lifecycle-manager" });
  } catch {
  }
}

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
