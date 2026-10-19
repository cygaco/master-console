#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { logEvent, query, RUNTIME_DIR } = require("./lib/logger");
const { PATHS } = require("./lib/paths");
const { HANDOFF_LIVE_RE } = require("./lib/retention");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const cwd = process.env.CLAUDE_PROJECT_DIR || event.cwd;
    const source = event.source || "startup";
    const checks = [];
    const claudeDir = path.join(cwd, ".claude");
    const runtimeDir = path.join(claudeDir, "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const checkpointPath = path.join(runtimeDir, ".session-checkpoint.json");
    const guardPath = path.join(runtimeDir, ".session-handoff-done");
    const sessionIdPath = path.join(runtimeDir, ".session-id");

    if (!fs.existsSync(sessionIdPath)) {
      const id = "s-" + Date.now().toString(36).slice(-6);
      fs.writeFileSync(sessionIdPath, id);
      checks.push(`Session ID: ${id} (new)`);
    } else {
      const existingId = fs.readFileSync(sessionIdPath, "utf8").trim();
      checks.push(`Session ID: ${existingId} (existing)`);
    }

    if (source === "clear") {
      try {
        saveCheckpoint(claudeDir, "clear");
        checks.push("Clear: checkpoint saved before reset");
      } catch {
      }
    } else if (source === "resume") {
      checks.push("Resume: keeping session logs intact");
    } else if (source === "compact") {
      checks.push("Compact: mid-session, logs preserved");
    } else {
      [".compact-summary.md", ".observer-state.jsonl"].forEach((f) => {
        const p = path.join(claudeDir, f);
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch {
        }
      });
      try {
        if (fs.existsSync(guardPath)) fs.unlinkSync(guardPath);
      } catch {
      }
    }

    let branch = "unknown";
    let currentHead = "";
    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      })
        .toString()
        .trim();
      const status = execSync("git status --porcelain", {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      })
        .toString()
        .trim();
      const uncommitted = status ? status.split("\n").length : 0;
      checks.push(
        `Branch: ${branch}${uncommitted ? ` (${uncommitted} uncommitted)` : ""}`,
      );

      currentHead = execSync("git rev-parse HEAD", {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      })
        .toString()
        .trim();

      if (source === "startup") {
        fs.writeFileSync(
          path.join(claudeDir, ".session-start-commit"),
          currentHead,
        );
      }
    } catch {
      checks.push("Git: not available");
    }

    if (source === "startup" || source === "clear") {
      try {
        const watchedDirsFile = path.join(
          cwd,
          "docs",
          "00-canonical",
          "WATCHED_DIRS.json",
        );
        if (fs.existsSync(watchedDirsFile)) {
          const watchedDirs = JSON.parse(
            fs.readFileSync(watchedDirsFile, "utf8"),
          );
          const snapshot = { timestamp: new Date().toISOString(), dirs: {} };
          for (const dir of watchedDirs.directories || []) {
            const absDir = path.join(cwd, dir.path.replace(/\*\/?$/, ""));
            try {
              if (fs.existsSync(absDir)) {
                const entries = fs.readdirSync(absDir, { withFileTypes: true });
                snapshot.dirs[dir.path] = entries.map((e) => ({
                  name: e.name,
                  isDir: e.isDirectory(),
                }));
              }
            } catch {
            }
          }
          fs.writeFileSync(
            path.join(runtimeDir, ".topology-snapshot.json"),
            JSON.stringify(snapshot, null, 2),
          );
        }
      } catch {
      }
    }

    let sleepContext = "";
    if (source === "startup" || source === "clear") {
      try {
        const sleepFiles = [
          {
            path: "dreams/journal.md",
            prefix: "SLEEP JOURNAL (last night):\n",
            limit: 1500,
          },
          {
            path: "dreams/coaching.md",
            prefix: "COACHING SUGGESTION:\n",
            limit: 500,
          },
        ];
        for (const sf of sleepFiles) {
          const filePath = path.join(claudeDir, sf.path);
          if (fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            if ((Date.now() - stat.mtimeMs) / 3600000 < 24) {
              sleepContext +=
                sf.prefix +
                fs.readFileSync(filePath, "utf8").slice(0, sf.limit) +
                "\n\n";
            }
          }
        }
        if (sleepContext) checks.push("Sleep: journal found — injected");
      } catch {
      }
    }

    if (source === "startup" || source === "clear") {
      const envPath = path.join(cwd, ".env.local");
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, "utf-8");
        const keys = ["ANTHROPIC_API_KEY"];
        try {
          const { loadConfig } = require("./lib/project-config");
          const cfg = loadConfig();
          if (cfg.requiredEnvKeys) keys.push(...cfg.requiredEnvKeys);
        } catch {
        }
        const missing = keys.filter((k) => !envContent.includes(k + "="));
        if (missing.length > 0) {
          checks.push(`Env: missing ${missing.join(", ")}`);
        } else {
          checks.push("Env: all keys present");
        }
      } else {
        checks.push(
          "Env: .env.local not found (ANTHROPIC_API_KEY needed for prompt enhancement)",
        );
      }

      if (!fs.existsSync(path.join(cwd, "node_modules"))) {
        checks.push("node_modules: MISSING — run npm install");
      }
    }

    let handoffContext = "";
    const protectedHandoffPaths = [];

    const handoffPath = path.join(runtimeDir, "handoff.md");
    if (fs.existsSync(handoffPath)) {
      try {
        const stat = fs.statSync(handoffPath);
        const ageHours = (Date.now() - stat.mtimeMs) / 3600000;
        if (ageHours < 72) {
          const content = fs.readFileSync(handoffPath, "utf-8").trim();
          if (content.length > 0) {
            handoffContext = content;
            checks.push(
              `Handoff: loaded (${ageHours < 1 ? "just now" : Math.round(ageHours) + "h ago"})`,
            );
          }
        }
      } catch {
      }
    }

    if (!handoffContext && fs.existsSync(checkpointPath)) {
      try {
        const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
        const ageHours =
          (Date.now() - new Date(checkpoint.timestamp).getTime()) / 3600000;
        if (ageHours < 168) {
          handoffContext = `SESSION CHECKPOINT (${ageHours < 1 ? "recent" : Math.round(ageHours) + "h ago"}):\n`;
          if (checkpoint.promptLog) {
            handoffContext += `\nRecent user messages:\n${checkpoint.promptLog}\n`;
          }
          checks.push(`Checkpoint: loaded (${Math.round(ageHours)}h ago)`);
        }
      } catch {
      }
    }

    if (!handoffContext) {
      try {
        const handoffsDir = PATHS.handoffs;
        if (fs.existsSync(handoffsDir)) {
          const files = fs
            .readdirSync(handoffsDir)
            .filter((f) => f.endsWith(".md"))
            .sort()
            .reverse();
          if (files.length > 0) {
            const latest = files[0];
            const stat = fs.statSync(path.join(handoffsDir, latest));
            const ageHours = (Date.now() - stat.mtimeMs) / 3600000;
            if (ageHours < 168) {
              handoffContext = fs
                .readFileSync(path.join(handoffsDir, latest), "utf-8")
                .trim();
              protectedHandoffPaths.push(path.join(handoffsDir, latest));
              checks.push(
                `Handoff: loaded from archive (${latest}, ${Math.round(ageHours)}h ago)`,
              );
            }
          }
        }
      } catch {
      }
    }

    if (!handoffContext) {
      checks.push("Handoff: none found");
    }

    let liveStateContext = "";
    try {
      const curSid = (
        event.session_id ||
        process.env.CLAUDE_SESSION_ID ||
        (fs.existsSync(sessionIdPath)
          ? fs.readFileSync(sessionIdPath, "utf8").trim()
          : "")
      )
        .toString()
        .replace(/[^A-Za-z0-9_-]/g, "")
        .slice(0, 48);
      const liveFiles = fs
        .readdirSync(runtimeDir)
        .filter((f) => HANDOFF_LIVE_RE.test(f))
        .map((f) => {
          let st;
          try {
            st = fs.lstatSync(path.join(runtimeDir, f));
          } catch {
            return null;
          }
          if (!st.isFile()) return null;
          return {
            name: f,
            sid: f.replace(/^handoff-live-/, "").replace(/\.md$/, ""),
            mtime: st.mtimeMs,
            ino: st.ino,
            dev: st.dev,
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.mtime - a.mtime);
      const chosen = liveFiles.find((f) => curSid && f.sid === curSid) || liveFiles[0];
      if (chosen) {
        const handoffMtime = fs.existsSync(handoffPath)
          ? fs.statSync(handoffPath).mtimeMs
          : 0;
        const ageHours = (Date.now() - chosen.mtime) / 3600000;
        if (ageHours < 72 && chosen.mtime > handoffMtime + 1000) {
          // POSIX. On WINDOWS `fs.constants.O_NOFOLLOW` is UNDEFINED (→ 0), so the
          let content = null;
          try {
            const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
            const fd = fs.openSync(
              path.join(runtimeDir, chosen.name),
              fs.constants.O_RDONLY | O_NOFOLLOW,
            );
            try {
              const fst = fs.fstatSync(fd);
              const inodeStable =
                !chosen.ino || !fst.ino || (fst.ino === chosen.ino && fst.dev === chosen.dev);
              if (fst.isFile() && inodeStable) content = fs.readFileSync(fd, "utf8").trim();
            } finally {
              try {
                fs.closeSync(fd);
              } catch {
              }
            }
          } catch {
          }
          if (content != null) {
            protectedHandoffPaths.push(path.join(runtimeDir, chosen.name));
            let label;
            if (source === "clear") {
              label =
                "captured at /clear — pre-clear live state; ignore if you cleared to switch tasks (the uncommitted-files list is useful either way)";
            } else if (source === "startup" && (!curSid || chosen.sid !== curSid)) {
              label = `from a PRIOR session (\`${chosen.sid}\`) — verify against current git state before trusting`;
            } else if (curSid && chosen.sid === curSid) {
              label = "this session's live state — newer than the last narrative handoff";
            } else {
              label = `live state from session \`${chosen.sid}\` — verify against current git`;
            }
            liveStateContext = `(${label})\n\n${content}`;
            checks.push(
              `Live-state: surfaced (${ageHours < 1 ? "just now" : Math.round(ageHours) + "h ago"}, newer than narrative)`,
            );
          }
        }
      }
    } catch {
    }

    if (source === "startup" || source === "clear") {
      try {
        const { applyRetention } = require("./lib/retention");
        const trustedRoot = path.resolve(PATHS.runtime, "..", "..");
        const r = applyRetention(trustedRoot, {
          apply: true,
          protected: protectedHandoffPaths,
        });
        const n = (r && r.archived && r.archived.length) || 0;
        if (n > 0) {
          checks.push(`Retention: archived ${n} transient(s)`);
        }
      } catch {
      }
    }

    let systemsNudge = "";
    if (source === "startup" || source === "clear") {
      try {
        const learningsPath = path.join(PATHS.memory, "learnings.jsonl");
        if (fs.existsSync(learningsPath)) {
          const lines = fs
            .readFileSync(learningsPath, "utf8")
            .trim()
            .split("\n");
          let pending = 0;
          let total = 0;
          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              total++;
              if (entry.pending_validation) pending++;
            } catch {
            }
          }
          if (pending > 5) {
            systemsNudge += `SYSTEMS: ${pending}/${total} learnings pending validation\n`;
          }
        }
      } catch {
      }

      try {
        const { pruneDeadLocks } = require("./lib/concurrency-lock");
        const sum = pruneDeadLocks();
        if (sum.dead > 0) {
          checks.push(`Dispatch locks: pruned ${sum.dead} dead PID lock(s)`);
        }
      } catch {
      }

      try {
        const { run: reapOrphans } = require("../dispatch/reap-orphans");
        const r = reapOrphans({ apply: false });
        if (r && r.orphanCount > 0) {
          checks.push(
            `Dispatch orphans: ${r.orphanCount} orphaned subprocess(es) detected — run \`node scripts/dispatch/reap-orphans.js --apply\` to reap`,
          );
        }
      } catch {
      }

      try {
        const logsDir = PATHS.logs;
        if (fs.existsSync(logsDir)) {
          const dirs = fs
            .readdirSync(logsDir, { withFileTypes: true })
            .filter((d) => d.isDirectory() && d.name.startsWith("s-"))
            .map((d) => ({
              name: d.name,
              mtime: fs.statSync(path.join(logsDir, d.name)).mtimeMs,
            }))
            .sort((a, b) => b.mtime - a.mtime);
          for (const d of dirs.slice(5)) {
            fs.rmSync(path.join(logsDir, d.name), {
              recursive: true,
              force: true,
            });
          }
        }
      } catch {
      }
    }

    let teamMarkerWarning = "";
    if (source === "startup" || source === "clear") {
      try {
        const marker = path.join(runtimeDir, ".team-marker");
        if (fs.existsSync(marker)) {
          const st = fs.statSync(marker);
          const ageHrs = (Date.now() - st.mtimeMs) / 3_600_000;
          if (ageHrs > 24) {
            teamMarkerWarning =
              "ADHOC TEAM STATE — Team marker is " +
              Math.round(ageHrs) +
              "h old. If the adhoc team is still around, classify it " +
              "before dispatch (see /mode:adhoc step 1.75). Reuse only " +
              "when fresh; refresh on stale; force-recreate on defunct.";
          }
        }
      } catch {
      }
    }

    let dispatchReference = "";
    if (source === "startup" || source === "clear") {
      dispatchReference =
        "MANDATORY REFERENCE — Build-chain dispatch must use " +
        "`node scripts/dispatch-agent.js <role> <prompt-file>` (or the " +
        "documented `claude -p --agent <role>` Claude fallback). Raw " +
        "`codex exec` / `agy -p` / `cat … | codex|agy|claude` " +
        "calls from Bash are blocked by the dispatch-route-guard hook. Full " +
        "rules:.claude/agents/_system/guides/agent-dispatch-guide.md " +
        "(paths.agentDispatchGuide).";
    }

    let dispatchReadinessNudge = "";
    if (source === "startup" || source === "clear") {
      try {
        const smokePath = path.join(
          __dirname,
          "..",
          "mc",
          "provider-smoke.js",
        );
        const { perRoleProbe, classifyPerRole, PER_ROLE_BUILD_CHAIN } =
          require(smokePath);
        const rows = perRoleProbe(PER_ROLE_BUILD_CHAIN, { noPing: true });
        const redRows = rows.filter(
          (r) =>
            r &&
            r.provider !== "claude" &&
            ["unresolved", "error"].includes(r.status),
        );
        if (redRows.length > 0) {
          const first = redRows[0];
          dispatchReadinessNudge =
            "DISPATCH READINESS — " +
            first.role +
            " resolves to " +
            (first.provider || "unknown provider") +
            " but its CLI is not reachable; cross-provider dispatch will " +
            "fall back to Claude (loses diff-model coverage). Run " +
            "/mc:health for the full per-role verdict.";
        }
      } catch {
      }
    }

    let teamInitDirective = "";
    if (source === "startup" || source === "clear") {
      try {
        let curMode = "";
        try {
          curMode = (
            JSON.parse(fs.readFileSync(path.join(runtimeDir, "mode.json"), "utf8"))
              .mode || ""
          ).toLowerCase();
        } catch {
        }
        let registryFaces;
        try {
          registryFaces = require("./lib/mode-lifecycle").faces(curMode);
        } catch {
          registryFaces = [];
        }
        const FACE_PRESENTATION = {
          epsilon: ["Epsilon (ε)", ".claude/agents/president/epsilon.md + scripts/sprint/epsilon-runtime.js + .claude/agents/_org/sprint-hook-points.json"],
          beta: ["Beta (β)", ".claude/agents/president/beta.md"],
          gamma: ["Gamma (γ)", ".claude/agents/president/gamma.md"],
        };
        const MODE_DESC = {
          sprint: "α lead + ε conductor + β judgment",
          adhoc: "α lead + β judgment + γ build-orchestrator",
        };
        let spec = null;
        if (registryFaces.length && MODE_DESC[curMode]) {
          const spawns = registryFaces
            .filter((f) => FACE_PRESENTATION[f])
            .map((f) => [f, FACE_PRESENTATION[f][0], FACE_PRESENTATION[f][1]]);
          if (spawns.length) {
            spec = { faces: registryFaces, desc: MODE_DESC[curMode], spawns };
          }
        }
        if (spec) {
          const slug =
            path.basename(cwd).toLowerCase().replace(/[^a-z0-9]/g, "") || "project";
          let live = false;
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
                  if ((Date.now() - fs.statSync(cfg).mtimeMs) / 3600000 >= 24) continue;
                  const blob = JSON.stringify(
                    JSON.parse(fs.readFileSync(cfg, "utf8")).members || [],
                  ).toLowerCase();
                  if (spec.faces.every((f) => blob.includes(f))) {
                    live = true;
                    break;
                  }
                } catch {
                }
              }
            }
          } catch {
          }
          if (live) {
            try {
              const sidPath = path.join(cwd, ".claude", "runtime", ".session-id");
              const sid = fs.existsSync(sidPath)
                ? fs.readFileSync(sidPath, "utf8").trim()
                : "";
              if (sid) {
                const hbDir = path.join(
                  process.env.HOME || process.env.USERPROFILE || "",
                  ".claude",
                  "runtime",
                );
                fs.mkdirSync(hbDir, { recursive: true });
                fs.writeFileSync(
                  path.join(hbDir, `.team-live-${sid}`),
                  JSON.stringify({ ts: new Date().toISOString(), mode: curMode }),
                );
              }
            } catch {
            }
          }
          if (!live) {
            const team = `${slug}-${curMode}`;
            const calls = spec.spawns
              .map(
                ([t, nm, load]) =>
                  `  Agent(subagent_type:"${t}", name:"${nm}", run_in_background:true, team_name:"${team}", prompt:"STARTUP DIRECTIVE — SendMessage readiness to team-lead, then go idle (do NOT auto-claim tasks). Load: ${load}.")`,
              )
              .join("\n");
            teamInitDirective =
              `⛔ ${curMode.toUpperCase()} MODE IS ACTIVE (mode.json) but the persistent team is NOT up. ` +
              `Per /mode:${curMode} Step 1.75, your FIRST action MUST be to stand up the company faces by spawning them ` +
              `as NAMED BACKGROUND SUBAGENTS — the SYSTEM's procedure with the RIGHT agents, NOT improvised ` +
              `general-purpose workers, NOT a memory summary. The first spawn implicitly creates the session-scoped team ` +
              `(TeamCreate/TeamDelete were removed in Claude Code v2.1.178):\n${calls}\n` +
              `Then WAIT for both readiness pings (SendMessage to team-lead) before any boundary consult or work; do NOT proceed with the task until the team acks.`;
          }
        }
      } catch {
      }
    }

    if (
      teamInitDirective ||
      handoffContext ||
      liveStateContext ||
      sleepContext ||
      systemsNudge ||
      dispatchReference ||
      teamMarkerWarning ||
      dispatchReadinessNudge
    ) {
      let ctx = "";
      if (teamInitDirective) {
        ctx += `${teamInitDirective}\n\n`;
      }
      if (liveStateContext) {
        ctx += `⚠ LIVE SESSION STATE (newer than the last narrative handoff — uncommitted/untracked work may not be reflected in the handoff below):\n\n${liveStateContext}\n\n`;
      }
      if (handoffContext) {
        ctx += `PREVIOUS SESSION HANDOFF (auto-loaded):\n\n${handoffContext}\n\n`;
      }
      if (sleepContext) {
        ctx += `OVERNIGHT SLEEP CYCLE RESULTS:\n\n${sleepContext}\nThe system ran a sleep cycle since your last session. Review the findings above. Dream solutions are speculative — verify before acting on them.\n\n`;
      }
      if (systemsNudge) {
        ctx += `\n${systemsNudge}\n`;
      }
      if (dispatchReference) {
        ctx += `\n${dispatchReference}\n`;
      }
      if (teamMarkerWarning) {
        ctx += `\n${teamMarkerWarning}\n`;
      }
      if (dispatchReadinessNudge) {
        ctx += `\n${dispatchReadinessNudge}\n`;
      }
      ctx +=
        "Use this context to continue seamlessly. Do not ask the user to recap — you already have the state.";
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: ctx,
          },
        }),
      );
    }

    logEvent(
      "lifecycle",
      "alex",
      "session-start",
      "",
      `source=${source || "unknown"}`,
    );
    process.exit(0);
  } catch {
    process.exit(0);
  }
});

function saveCheckpoint(claudeDir, reason) {
  const checkpoint = {
    timestamp: new Date().toISOString(),
    reason,
  };

  const recentPrompts = query({ cat: "prompt", limit: 30 });
  if (recentPrompts.length > 0) {
    checkpoint.promptLog = recentPrompts
      .map((e) => {
        const ts = new Date(e.ts).toISOString().slice(11, 19);
        return `[${ts}] ${(e.data?.stripped || "").slice(0, 200)}`;
      })
      .join("\n");
  }

  const rtDir = path.join(claudeDir, "runtime");
  fs.mkdirSync(rtDir, { recursive: true });
  fs.writeFileSync(
    path.join(rtDir, ".session-checkpoint.json"),
    JSON.stringify(checkpoint, null, 2),
  );
}
