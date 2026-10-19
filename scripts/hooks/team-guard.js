#!/usr/bin/env node

const mcEnv = require("./lib/mc-env");
const fs = require("fs");
const path = require("path");

let modeFaces;
try {
  modeFaces = require("./lib/mode-lifecycle").allFaces();
  if (!(modeFaces instanceof Set) || modeFaces.size === 0)
    throw new Error("empty face set");
} catch {
  modeFaces = new Set(["epsilon", "beta", "gamma", "delta"]);
}

let GAMMA_ONLY_TYPES;
try {
  GAMMA_ONLY_TYPES = require("../dispatch/org-roles").gammaOnlyTypes();
  if (!(GAMMA_ONLY_TYPES instanceof Set) || GAMMA_ONLY_TYPES.size === 0)
    throw new Error("empty gamma-only set");
} catch {
  GAMMA_ONLY_TYPES = new Set([
    "builder", "fixer", "fix-agent", "reviewer", "evaluator", "compliance",
    "ops-analyst", "learner", "auditor", "qa", "redteam", "delta",
    "skeleton-builder", "stub-scaffold",
    "frontend-builder", "backend-builder",
  ]);
}

const TEAMMATE_NAMES = ["beta", "gamma", "β", "γ"];
const TEAMMATE_TYPES = new Set(["beta", "gamma"]);

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
    const m = fs.statSync(hbPath).mtimeMs;
    return (Date.now() - m) / 3600000 < 168;
  } catch {
    return false;
  }
}

const FACE_SYMBOL = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
};

function requiredConductor(mode) {
  try {
    const f = require("./lib/mode-lifecycle").faces(mode);
    if (Array.isArray(f) && f.length) {
      const id = String(f[0]).toLowerCase();
      return { id, symbol: FACE_SYMBOL[id] || id };
    }
  } catch {
  }
  return String(mode || "").toLowerCase() === "sprint"
    ? { id: "epsilon", symbol: "ε" }
    : null;
}

function requiresTeamMode(mode) {
  try {
    return !!require("./lib/mode-lifecycle").requiresTeam(mode);
  } catch {
    return false;
  }
}

function makeIsConductor(conductor) {
  return (v) => {
    const s = String(v == null ? "" : v).trim().toLowerCase();
    return s === conductor.id || s === conductor.symbol;
  };
}

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
      }
    }
  } catch {
  }
  return false;
}

function resolveProjectSlug(projectDir) {
  try {
    const manifestPath = path.join(projectDir, ".claude", "manifest.json");
    const doc = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return String((doc.project && doc.project.slug) || "").toLowerCase();
  } catch {
    return "";
  }
}

function isProjectScopedTeam(doc, teamDirName, slug, projectDir) {
  const name = String((doc && (doc.name || doc.team_name || teamDirName)) || "")
    .trim()
    .toLowerCase();
  const s = String(slug || "").toLowerCase();
  if (s && (name === s || name.startsWith(s + "-"))) return true;
  const normProject = String(projectDir || "").replace(/\\/g, "/").toLowerCase();
  if (!normProject) return false;
  const members = Array.isArray(doc && doc.members) ? doc.members : [];
  return members.some((mem) => {
    const c = String((mem && mem.cwd) || "").replace(/\\/g, "/").toLowerCase();
    return c && (c === normProject || c.startsWith(normProject + "/"));
  });
}

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
        if ((Date.now() - m) / 3600000 >= 24) continue;
        const doc = JSON.parse(fs.readFileSync(cfg, "utf8"));
        const nm = String((doc.name || doc.team_name || d) || "").trim().toLowerCase();
        if (nm !== want) continue;
        if (!docCarriesConductor(doc, conductor)) return false;
        if (slug && !isProjectScopedTeam(doc, d, slug, projectDir)) return false;
        return true;
      } catch {
      }
    }
  } catch {
  }
  return false;
}

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
        if (docCarriesConductor(doc, conductor)) return true;
      } catch {
      }
    }
  } catch {
  }
  return false;
}

function attestTeamGateKillSwitch(which, projectDir) {
  const attestation = {
    guard: "team-guard",
    bypass: "team-gate-kill-switch",
    switch: which,
    reason: "operator kill-switch active — readiness gate bypassed",
    ts: new Date().toISOString(),
  };
  try {
    const { log } = require("./lib/logger");
    log("audit", { type: "warn", action: "team-gate-kill-switch", ...attestation });
  } catch {
  }
  try {
    process.stderr.write(
      `[team-guard] ⚠ KILL-SWITCH BYPASS: the readiness gate was DISABLED via ` +
        `${which} — ${attestation.reason}.\n`,
    );
  } catch {
  }
}

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
        if ((Date.now() - m) / 3600000 >= 24) continue;
        const doc = JSON.parse(fs.readFileSync(cfg, "utf8"));
        const members = Array.isArray(doc.members) ? doc.members : [];
        if (members.length >= 2) return true;
      } catch {
      }
    }
  } catch {
  }
  return false;
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name;

    try {
      if (mcEnv.readEnv("TEAM_GUARD_DEBUG") === "1") {
        const logDir = path.resolve(__dirname, "..", "..", ".claude", "runtime");
        fs.mkdirSync(logDir, { recursive: true });
        const logPath = path.join(logDir, "team-guard-debug.log");
        try {
          const { rotateBytesIfNeeded } = require("./lib/rotate");
          rotateBytesIfNeeded(logPath, 2 * 1024 * 1024);
        } catch {
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
    }

    if (toolName !== "Agent") {
      process.exit(0);
    }

    const toolInput = event.tool_input || {};
    const agentType = (toolInput.subagent_type || "").toLowerCase();
    const agentName = (toolInput.name || "").toLowerCase();

    const isTeammateType = TEAMMATE_TYPES.has(agentType);
    const normalizedName = agentName.replace(/[\s()\[\]]+/g, "");
    const isTeammateName = TEAMMATE_NAMES.includes(normalizedName);
    if (isTeammateType || isTeammateName) {
      process.exit(0);
    }

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
    }

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
      }
      try {
        process.stderr.write(
          `[team-guard] ⚠ mode.json claims "${currentMode}" but a live ` +
            `multi-agent team is active — NOT disabling the Agent gate on the ` +
            `file's say-so.\n`,
        );
      } catch {
      }
    } else if (modeDisablesGate) {
      process.exit(0);
    }

    if (currentMode === "sprint") {
      const hasTeamName = !!(
        toolInput.team_name && String(toolInput.team_name).trim()
      );
      const FACE_TYPES = modeFaces;
      const RESEARCH_TYPES = new Set(["explore", "plan"]);
      const isWorker =
        agentType && !FACE_TYPES.has(agentType) && !RESEARCH_TYPES.has(agentType);
      const conductor = requiredConductor(currentMode) || {
        id: "epsilon",
        symbol: "ε",
      };
      const projectSlug = resolveProjectSlug(projectDir);
      const teamNameVerified = hasTeamName && namedTeamVerified(toolInput.team_name, conductor, projectSlug, projectDir);
      if (teamNameVerified || !isWorker) {
        process.exit(0);
      }
      if (hasTeamName && !teamNameVerified) {
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
        }
      }
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
              if ((Date.now() - m) / 3600000 >= 24) continue;
              if (projectSlug) {
                const doc = JSON.parse(fs.readFileSync(cfg, "utf8"));
                if (!isProjectScopedTeam(doc, d, projectSlug, projectDir)) continue;
              }
              if (m > activeMtime) {
                activeCfg = cfg;
                activeMtime = m;
              }
            } catch {
            }
          }
        }
      } catch {
      }
      const teamActive = !!activeCfg;
      let teamHasEpsilon = false;
      if (activeCfg) {
        try {
          const doc = JSON.parse(fs.readFileSync(activeCfg, "utf8"));
          teamHasEpsilon = docCarriesConductor(doc, conductor);
        } catch {
        }
      }
      const teamReady = teamActive && teamHasEpsilon;

      const hardGate = mcEnv.readEnv("TEAM_GATE_SOFT") !== "1";
      const killSwitchEnv = mcEnv.readEnv("DISABLE_TEAM_GATE") === "1";
      const killSwitchMarker = fs.existsSync(
        path.join(projectDir, ".claude", "runtime", ".team-gate-off"),
      );
      const killSwitch = killSwitchEnv || killSwitchMarker;
      const heartbeatCorroborated =
        configTeamCarriesConductor(conductor) && teamHeartbeatFresh(projectDir);
      const teamLive = teamReady || heartbeatCorroborated;
      if (hardGate && killSwitch && !teamLive) {
        attestTeamGateKillSwitch(
          killSwitchEnv ? "env:MC_DISABLE_TEAM_GATE" : "marker:.team-gate-off",
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
              `MC_DISABLE_TEAM_GATE=1 or touch .claude/runtime/.team-gate-off.`,
          }),
        );
        process.exit(0);
      }

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
                `team_name): ${advice}. ` +
                `Advisory, not a block.`,
            },
          }),
        );
      }
      process.exit(0);
    }

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
            inAdhocMode = true;
          }
        }
      } catch {
      }
    }

    if (!inAdhocMode) {
      process.exit(0);
    }

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
          }
          const n = prev + 1;
          let wrote = false;
          try {
            fs.writeFileSync(cPath, ready ? "0" : String(n));
            wrote = true;
          } catch {
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
                    `fanning out. REPORT-ONLY (does NOT block; flip-to-` +
                    `blocking for other modes needs sign-off).`,
                },
              }),
            );
          }
        }
      }
    } catch {
    }

    process.exit(0);
  } catch (err) {
    process.exit(0);
  }
});
