#!/usr/bin/env node
// SessionStart hook: runs on new session, /clear, /resume, and post-compaction.
// Source-aware: handles each entry type differently.
// 1. Checks environment health
// 2. Saves starting commit for session-end diff
// 3. Loads previous handoff or checkpoint
// 4. Archives (not deletes) stale logs

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { logEvent, query, RUNTIME_DIR } = require("./lib/logger");
const { PATHS } = require("./lib/paths");
// F-RET-3: single source for the handoff-live basename allowlist — the same
// tightened regex retention.js uses, so the live-state scan and the retention
// sweep can never disagree on what a valid handoff-live name is.
const { HANDOFF_LIVE_RE } = require("./lib/retention");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    // Use CLAUDE_PROJECT_DIR (reliable) instead of event.cwd (can be a subdirectory)
    const cwd = process.env.CLAUDE_PROJECT_DIR || event.cwd;
    const source = event.source || "startup";
    const checks = [];
    const claudeDir = path.join(cwd, ".claude");
    const runtimeDir = path.join(claudeDir, "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const checkpointPath = path.join(runtimeDir, ".session-checkpoint.json");
    const guardPath = path.join(runtimeDir, ".session-handoff-done");
    const sessionIdPath = path.join(runtimeDir, ".session-id");

    // ── Generate Session ID ──────────────────────────────────
    // Each session gets a unique short ID (e.g., "s-1a2b3c")
    // Only create if file doesn't exist — parallel instances share the session ID
    // Instance-level differentiation is handled by logger.js (getInstanceId)
    if (!fs.existsSync(sessionIdPath)) {
      const id = "s-" + Date.now().toString(36).slice(-6);
      fs.writeFileSync(sessionIdPath, id);
      checks.push(`Session ID: ${id} (new)`);
    } else {
      const existingId = fs.readFileSync(sessionIdPath, "utf8").trim();
      checks.push(`Session ID: ${existingId} (existing)`);
    }

    // ── Source-Aware Log Handling ──────────────────────────────
    if (source === "clear") {
      // /clear: SAVE a checkpoint before clearing — preserve what happened
      try {
        saveCheckpoint(claudeDir, "clear");
        checks.push("Clear: checkpoint saved before reset");
      } catch {
        /* checkpoint is optional */
      }
    } else if (source === "resume") {
      // /resume: Do NOT delete logs — this is the same session continuing
      checks.push("Resume: keeping session logs intact");
    } else if (source === "compact") {
      // Post-compaction: Do NOT delete anything — mid-session
      checks.push("Compact: mid-session, logs preserved");
    } else {
      // "startup" — fresh session
      // Clear stale compact summary and observer state
      [".compact-summary.md", ".observer-state.jsonl"].forEach((f) => {
        const p = path.join(claudeDir, f);
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch {
          /* ignore */
        }
      });
      // Clear the handoff-done guard so Stop hook will generate fresh handoff
      try {
        if (fs.existsSync(guardPath)) fs.unlinkSync(guardPath);
      } catch {
        /* ignore */
      }
    }

    // ── Git State (all source types) ──────────────────────────
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

      // Only save start commit on fresh startup (not clear/resume/compact)
      if (source === "startup") {
        fs.writeFileSync(
          path.join(claudeDir, ".session-start-commit"),
          currentHead,
        );
      }
    } catch {
      checks.push("Git: not available");
    }

    // ── Topology Snapshot ─────────────────────────────────────
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
              /* scan failed */
            }
          }
          fs.writeFileSync(
            path.join(runtimeDir, ".topology-snapshot.json"),
            JSON.stringify(snapshot, null, 2),
          );
        }
      } catch {
        /* topology snapshot is optional */
      }
    }

    // ── Sleep Journal ─────────────────────────────────────────
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
        /* sleep journal check is optional */
      }
    }

    // ── Environment Checks ─────────────────────────────────────
    if (source === "startup" || source === "clear") {
      // Check .env.local for ANTHROPIC_API_KEY (minimum required key)
      const envPath = path.join(cwd, ".env.local");
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, "utf-8");
        // Always check for ANTHROPIC_API_KEY; project-config may add more
        const keys = ["ANTHROPIC_API_KEY"];
        try {
          const { loadConfig } = require("./lib/project-config");
          const cfg = loadConfig();
          if (cfg.requiredEnvKeys) keys.push(...cfg.requiredEnvKeys);
        } catch {
          /* no project-config — just check ANTHROPIC_API_KEY */
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

    // ── Load Handoff / Checkpoint ─────────────────────────────
    let handoffContext = "";
    // F-RET-4: paths this session LOADED — retention must never archive a
    // handoff the current session is actively using (passed as `protected`).
    const protectedHandoffPaths = [];

    // Priority 1: handoff.md (most recent, written by session-stop)
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
        /* ignore */
      }
    }

    // Priority 2: session checkpoint (written every 30min by session-tracker)
    if (!handoffContext && fs.existsSync(checkpointPath)) {
      try {
        const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
        const ageHours =
          (Date.now() - new Date(checkpoint.timestamp).getTime()) / 3600000;
        if (ageHours < 168) {
          // 7 days
          handoffContext = `SESSION CHECKPOINT (${ageHours < 1 ? "recent" : Math.round(ageHours) + "h ago"}):\n`;
          if (checkpoint.promptLog) {
            handoffContext += `\nRecent user messages:\n${checkpoint.promptLog}\n`;
          }
          checks.push(`Checkpoint: loaded (${Math.round(ageHours)}h ago)`);
        }
      } catch {
        /* ignore */
      }
    }

    // Priority 3: most recent timestamped handoff from handoffs/ directory
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
              // 7 days
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
        /* ignore */
      }
    }

    if (!handoffContext) {
      checks.push("Handoff: none found");
    }

    // ── Layer-1 live-state freshness comparison (S-11, RI-006) ────────────
    // The cheap per-turn `handoff-live-<sid>.md` (written by handoff-live.js) is
    // the safety net for tracker-drift + untracked work. If it is NEWER than the
    // rich handoff.md (a crash after the last clean /session:end, or a /clear),
    // surface the delta — else the uncommitted work it captured stays invisible
    // (the exact failure S-11 prevents). Per-session_id keyed (decision #1),
    // /clear-bridge aware (decision #2), fail-open.
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
        .filter((f) => HANDOFF_LIVE_RE.test(f)) // F-RET-3: tightened basename allowlist (no `..`)
        .map((f) => {
          // lstat (NO symlink-follow) + regular-file-only. A symlink/junction
          // named handoff-live-<sid>.md would otherwise have its TARGET's content
          // read into the session additionalContext — an external content-injection
          // vector (gauntlet R2 NEWDEF). Drop anything non-regular.
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
            // Captured for the best-effort post-open inode recheck below.
            ino: st.ino,
            dev: st.dev,
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.mtime - a.mtime);
      // Prefer the file matching the CURRENT sid; else the most recent + label it.
      const chosen = liveFiles.find((f) => curSid && f.sid === curSid) || liveFiles[0];
      if (chosen) {
        const handoffMtime = fs.existsSync(handoffPath)
          ? fs.statSync(handoffPath).mtimeMs
          : 0;
        const ageHours = (Date.now() - chosen.mtime) / 3600000;
        // Surface only when the live snapshot is NEWER than the narrative (or no
        // narrative exists) AND recent enough to matter (≤72h).
        if (ageHours < 72 && chosen.mtime > handoffMtime + 1000) {
          // No-follow read of the live snapshot. The earlier lstat proved a
          // regular file; a symlink swapped in between that lstat and this read
          // would otherwise inject its target's content into additionalContext.
          // O_NOFOLLOW refuses a symlink final component (ELOOP) — EFFECTIVE ON
          // POSIX. On WINDOWS `fs.constants.O_NOFOLLOW` is UNDEFINED (→ 0), so the
          // open does NOT block a symlink there; as a cross-platform best-effort we
          // also fstat the OPEN fd and refuse if its inode/device differ from the
          // enumeration-time lstat (a swap changes the inode). RESIDUAL (honest,
          // out-of-model per the standing discriminator, ADR-0017): on Windows,
          // absent both O_NOFOLLOW and reliable inode ids, a swapped-symlink race
          // could still read external content — attacker-only, NON-destructive
          // (a content read into context), and NO new capability over a same-user
          // attacker simply writing a regular handoff-live file. Not further
          // mechanised; the CLAIM is corrected here, not overstated.
          let content = null;
          try {
            const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
            const fd = fs.openSync(
              path.join(runtimeDir, chosen.name),
              fs.constants.O_RDONLY | O_NOFOLLOW,
            );
            try {
              const fst = fs.fstatSync(fd);
              // Best-effort inode recheck: only enforce when both ids are present
              // (0/undefined on some Windows FS → skip, don't false-drop).
              const inodeStable =
                !chosen.ino || !fst.ino || (fst.ino === chosen.ino && fst.dev === chosen.dev);
              if (fst.isFile() && inodeStable) content = fs.readFileSync(fd, "utf8").trim();
            } finally {
              try {
                fs.closeSync(fd);
              } catch {
                /* fd already gone */
              }
            }
          } catch {
            /* symlink (ELOOP) / vanished / unreadable — never surface external content */
          }
          if (content != null) {
            // F-RET-4: the live handoff this session just surfaced must never be
            // archived out from under it (even if it is beyond the newest-N rank).
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
      /* live-state surfacing is optional + fail-open */
    }

    // ── Retention sweep (S: runtime-retention) ─────────────────────────
    // Conservative-by-construction ARCHIVING of transient runtime cruft
    // (handoff-live-*.md beyond the newest 10 / not recent, handoffs/* older
    // than 14d, the one named stray error log) — MOVED to the archive tier, not
    // deleted (D-1). MUST run AFTER the handoff-load blocks above (load first,
    // prune second) so a file this session just loaded is never archived out
    // from under it (F-RET-4: `protectedHandoffPaths`). F-RET-2: the apply root
    // is the TRUSTED PATHS-anchored root (CLAUDE_PROJECT_DIR-derived), NOT
    // event.cwd. Best-effort/fail-open — a retention fault must never disturb
    // session start.
    if (source === "startup" || source === "clear") {
      try {
        const { applyRetention } = require("./lib/retention");
        // Trusted root: anchor to PATHS (derived from CLAUDE_PROJECT_DIR), never
        // the possibly-attacker-influenced event.cwd.
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
        /* retention is best-effort — never block session start */
      }
    }

    // ── Systems Health Nudge ────────────────────────────────
    let systemsNudge = "";
    if (source === "startup" || source === "clear") {
      try {
        // Count pending learnings
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
              /* skip */
            }
          }
          if (pending > 5) {
            systemsNudge += `SYSTEMS: ${pending}/${total} learnings pending validation — consider running /overseer:review\n`;
          }
        }
      } catch {
        /* systems nudge is optional */
      }

      // Phase 0 workstream C: eager prune of dispatch concurrency locks
      // whose owning PID is no longer alive. Lazy prune in concurrency-lock.js
      // only runs at acquire time; a long idle gap can leave dead locks until
      // the next dispatch attempt. Best-effort, fail-open.
      try {
        const { pruneDeadLocks } = require("./lib/concurrency-lock");
        const sum = pruneDeadLocks();
        if (sum.dead > 0) {
          checks.push(`Dispatch locks: pruned ${sum.dead} dead PID lock(s)`);
        }
      } catch {
        /* prune is non-blocking */
      }

      // E-TEAMS-MIGRATION-001: detect ORPHANED dispatch subprocesses (the reap /
      // bg-drop class — a provider CLI whose wrapper was reaped, still running with
      // no completion record). pruneDeadLocks above clears the dead lock FILE; this
      // surfaces the orphaned PROCESS. REPORT-ONLY here (dry-run, never auto-kills on
      // session start — the kill is a deliberate /warp:health --apply or manual
      // action). Conservative-by-construction + fail-open (reaps nothing on any
      // ambiguity); wrapped so a slow/failed enumeration never blocks session start.
      try {
        const { run: reapOrphans } = require("../dispatch/reap-orphans");
        const r = reapOrphans({ apply: false });
        if (r && r.orphanCount > 0) {
          checks.push(
            `Dispatch orphans: ${r.orphanCount} orphaned subprocess(es) detected — run \`node scripts/dispatch/reap-orphans.js --apply\` to reap`,
          );
        }
      } catch {
        /* orphan detection is non-blocking, fail-open */
      }

      // Prune old session/instance log directories (keep last 5)
      // Dirs are named "s-{sid}_{iid}" (new) or "s-{sid}" (legacy)
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
        /* cleanup is non-blocking */
      }
    }

    // ── Adhoc team-marker freshness (Phase 0 workstream I) ────────────
    // .claude/runtime/.team-marker is touched by /mode:adhoc step 6.
    // When it is older than 24h, alert the operator so they can decide
    // whether to refresh the team.
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
        /* marker check is non-blocking */
      }
    }

    // ── Mandatory agent-dispatch-guide reference (Phase 0 workstream D) ──
    // Always injected on cold start, regardless of handoff state. Compact —
    // just the path + the one-line forbidden-pattern reminder. The full guide
    // lives at paths.agentDispatchGuide and Gamma/Delta read it themselves.
    let dispatchReference = "";
    if (source === "startup" || source === "clear") {
      dispatchReference =
        "MANDATORY REFERENCE — Build-chain dispatch must use " +
        "`node scripts/dispatch-agent.js <role> <prompt-file>` (or the " +
        "documented `claude -p --agent <role>` Claude fallback). Raw " +
        "`codex exec` / `agy -p` / `cat … | codex|agy|claude` " +
        "calls from Bash are blocked by the dispatch-route-guard hook " +
        "(LRN-2026-04-17 Windows-stdin, LRN-2026-04-30 binding-gap). Full " +
        "rules: .claude/agents/_system/guides/agent-dispatch-guide.md " +
        "(paths.agentDispatchGuide).";
    }

    // ── Per-role dispatch-readiness nudge (Phase 0 workstream A3) ────────────
    // Resolve-only sweep: detect if any build-chain role resolves to a provider
    // whose CLI is missing or unauthed. Token-free (--no-ping: no live dispatch).
    // Best-effort + fail-open — a providers.js load failure on a partial install
    // must NEVER break session start. Only runs on cold start / clear.
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
        // --no-ping: resolve provider+model but skip live dispatch (token-free).
        const rows = perRoleProbe(PER_ROLE_BUILD_CHAIN, { noPing: true });
        // RED = unresolved (provider CLI missing / providers.js can't find a
        // mapping for the role). "resolved" rows are non-fatal for --no-ping.
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
            "/warp:health for the full per-role verdict.";
        }
      } catch {
        // Fail-open: providers.js or smoke load failure on a partial install
        // must not block session start. Nudge is advisory only.
      }
    }

    // ── System-sourced MANDATORY persistent-team init (E-SYSTEM-ORG-001 S-12) ──
    // ROOT FIX for the recurring memory-over-system team miss (RT-2026-06-08-*,
    // recurred 2026-06-06): the correct team-init lives inside /mode:<mode> Step
    // 1.75 — a caller BYPASSED when a session kicks off from a /clear'd handoff
    // that names /mode:sprint as TEXT (read as context, the Skill never invoked),
    // so I improvise the team from a lossy auto-memory summary → wrong roster.
    // mode.json PERSISTS across /clear, so HERE — at session entry, before any
    // improvisation — we read it and, if the mode's persistent team is not live
    // with the RIGHT faces, inject the EXACT Step-1.75 calls (sourced from the
    // SYSTEM, not memory) as the mandatory first action. Fail-open.
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
          /* no or malformed mode marker — no directive */
        }
        // S-LC-01: the per-mode ROSTER (which faces) is resolved FROM the
        // Mode-Lifecycle Registry (.claude/agents/_org/mode-lifecycle.json) via
        // the shared reader — no hardcoded required-team-by-mode map remains as
        // the authoritative source. Only the PRESENTATION (display name + the
        // spec-load path per face, and the human desc) stays local — it is not
        // roster data. Fail-open: if the reader is unavailable the FALLBACK
        // mirror inside lib/mode-lifecycle.js still yields the right faces.
        let registryFaces;
        try {
          registryFaces = require("./lib/mode-lifecycle").faces(curMode);
        } catch {
          registryFaces = [];
        }
        // Per-face presentation (display name + STARTUP load path). Keyed by the
        // role id the registry roster carries. desc is the human one-liner.
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
          // Is the correct team live? (a fresh ~/.claude/teams config carrying ALL faces)
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
                  /* skip this team dir */
                }
              }
            }
          } catch {
            /* no teams dir — treat as not live */
          }
          // S-12c heartbeat WRITER (cross-provider review 2026-06-08 CRITICAL:
          // teamHeartbeatFresh had no production writer — only the test fixture
          // wrote the marker, so a long-idle (>24h config) correct team would
          // false-block once the hard gate ships ON). When the correct team is
          // confirmed live HERE (session start/resume), stamp the sid-keyed
          // ~/.claude/runtime/.team-live-<sid> marker the gate reads as the
          // freshness-independent liveness signal. Fail-open (never blocks start).
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
              /* heartbeat write is best-effort — never block session start */
            }
          }
          if (!live) {
            const team = `${slug}-${curMode}`;
            // Claude Code v2.1.178 (2026-06-15) REMOVED TeamCreate/TeamDelete. The
            // team is now IMPLICIT + session-scoped: the FIRST named background
            // subagent the harness spawns creates the session team (and the harness
            // still writes ~/.claude/teams/<session>/config.json with members[]).
            // So there is no separate TeamCreate call — the directive is just the
            // named Agent spawns. team_name is still ACCEPTED by the harness (kept
            // for a stable, sibling-project-distinct handle), but is no longer the
            // thing that creates the team. (E-TEAMS-MIGRATION-001.)
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
              `Then WAIT for both readiness pings (SendMessage to team-lead) before any boundary consult or work; do NOT proceed with the task until the team acks. ` +
              `(E-SYSTEM-ORG-001 S-12 / ED-035 / E-TEAMS-MIGRATION-001; this team-skip recurred 2026-06-06 & 2026-06-08 — "where's the team?" / "where's epsilon?".)`;
          }
        }
      } catch {
        /* team-init directive is best-effort + fail-open */
      }
    }

    // ── Inject context into model ──────────────────────────
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

// ── Helpers ─────────────────────────────────────────────────

function saveCheckpoint(claudeDir, reason) {
  const checkpoint = {
    timestamp: new Date().toISOString(),
    reason,
  };

  // Recent prompts from centralized event log
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
