#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { PROJECT } = require("./lib/paths");
const { logEvent } = require("./lib/logger");

const STORE_PATH = path.resolve(PROJECT, ".claude", "agents", "store.json");

const ALLOWLIST = [
  "git log",
  "git status",
  "git diff",
  "git branch",
  "git show",
  "git worktree",
  "git stash",
  "git tag",
  "git remote",
  "git rev-parse",
  "git config",
  "ls ",
  "ls\n",
  "cat ",
  "head ",
  "tail ",
  "grep ",
  "rg ",
  "find ",
  "wc ",
  "echo ",
  "printf ",
  "pwd",
  "which ",
  "node -c ",
  "node --check",
  "npx tsc",
  "npx kill-port",
  "npm run build",
  "npm run lint",
  "npm run test",
  "npm run dev",
  "npm install",
  "tasklist",
  "timeout ",
  "sleep ",
  "mkdir ",
  "touch ",
  "cp ",
  "mv ",
  "sort ",
  "uniq ",
  "tr ",
  "sed ",
  "awk ",
  "curl ",
];

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function block(reason) {
  logEvent("block", "system", "merge-guard-blocked", "", reason);
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

function allow(cmd) {
  const trimmed = cmd.trim().slice(0, 30);
  if (
    !trimmed.startsWith("git log") &&
    !trimmed.startsWith("git status") &&
    !trimmed.startsWith("git diff") &&
    !trimmed.startsWith("ls") &&
    !trimmed.startsWith("cat") &&
    !trimmed.startsWith("head") &&
    !trimmed.startsWith("tail")
  ) {
    logEvent("merge", "system", "bash-allowed", "", trimmed);
  }
  process.exit(0);
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name || "";

    if (toolName !== "Bash") {
      process.exit(0);
    }

    const command = (event.tool_input || {}).command || "";
    const cmd = command.trim();

    if (!cmd) {
      process.exit(0);
    }

    if (event.tool_response !== undefined) {
      if (cmd.includes("git merge")) {
        const tr = event.tool_response;
        const response =
          typeof tr === "string"
            ? tr
            : String(
                (tr && (tr.stdout || tr.stderr || tr.error)) ||
                  (tr ? JSON.stringify(tr).slice(0, 500) : ""),
              );
        const merged =
          response.includes("Fast-forward") || response.includes("Merge made");
        const failed =
          response.includes("CONFLICT") ||
          response.includes("error") ||
          response.includes("fatal");
        logEvent(
          "merge",
          "system",
          merged
            ? "merge-completed"
            : failed
              ? "merge-failed"
              : "merge-unknown",
          cmd.slice(0, 100),
          response.slice(0, 200),
        );
        if (merged) {
          process.stderr.write(
            "\x1b[33m[merge-guard] POST-MERGE: Run `npm run build` to verify integration.\x1b[0m\n",
          );
          logEvent(
            "warn",
            "system",
            "post-merge-build-reminder",
            "",
            "Merge succeeded — npm run build required next",
          );
        }
      }
      process.exit(0);
    }

    if (/git\s+branch\s+-[dD]\s+backup-/.test(cmd)) {
      block(
        "Deleting backup branches blocked: backup branches are protected (CLAUDE.md).",
      );
    }

    {
      const m = cmd.match(
        /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*&&\s*(.+)$/,
      );
      if (m) {
        const target = m[1] || m[2] || m[3];
        const tail = m[4];
        let resolved;
        try {
          resolved = path.resolve(process.cwd(), target);
        } catch {
          resolved = target;
        }
        const isProjectDir =
          target === "." ||
          target === "./" ||
          resolved === PROJECT ||
          resolved === path.resolve(PROJECT);
        if (isProjectDir) {
          const stripped = tail.trim();
          logEvent(
            "audit",
            "system",
            "cd-prefix-stripped",
            cmd.slice(0, 120),
            `stripped → ${stripped.slice(0, 80)}`,
          );
          process.stderr.write(
            "\x1b[33m[merge-guard] AUTO-STRIP: removed redundant `cd <projectDir> && ` prefix. " +
              "Bash tool already runs in cwd; the prefix re-confuses path-aware tools (CLAUDE.md).\x1b[0m\n",
          );
          const out = {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              updatedInput: { command: stripped },
            },
          };
          console.log(JSON.stringify(out));
          process.exit(0);
        }
      }
    }

    const subCmds = cmd
      .split(/\s*(?:&&|\|\||\||;)\s*/)
      .map((c) => c.trim())
      .filter(Boolean);
    const isSafeSub = (c) =>
      c.startsWith("cd ") ||
      c === "cd" ||
      ALLOWLIST.some((prefix) => c.startsWith(prefix));
    const allSafe = subCmds.length > 0 && subCmds.every(isSafeSub);
    if (allSafe) {
      allow(cmd);
    }

    if (
      /^\s*git\s+commit\b/.test(cmd) ||
      (/^\s*git\s+merge\b/.test(cmd) && !/git\s+merge\s+agent\//.test(cmd))
    ) {
      const docRef = path.join(PROJECT, "scripts", "checks", "doc-ref-integrity.js");
      if (require("fs").existsSync(docRef)) {
        const { spawnSync } = require("child_process");
        const dr = spawnSync(process.execPath, [docRef, "--enforce"], {
          cwd: PROJECT,
          encoding: "utf8",
        });
        if (dr.status === 1) {
          const tail = (dr.stderr || dr.stdout || "")
            .split("\n")
            .slice(-12)
            .join("\n");
          block(
            `merge-guard: doc-ref-integrity found broken canon reference(s) — blocked.\n${tail}\n\nFix: repoint the dead ref, or (if legitimately absent) add it to scripts/checks/doc-ref-integrity.allowlist.json or mark the line with <!-- doc-ref-ignore -->. Re-run: node scripts/checks/doc-ref-integrity.js --enforce`,
          );
        } else if (dr.status !== 0 && dr.status !== null) {
          const errTail = (dr.stderr || dr.stdout || "")
            .split("\n")
            .slice(-8)
            .join("\n");
          const sig = dr.signal ? ` signal=${dr.signal}` : "";
          block(
            `merge-guard: doc-ref-integrity runner crashed (exit=${dr.status}${sig}) — fail-closed.\n${errTail}\n\nFix: run it directly — node scripts/checks/doc-ref-integrity.js --enforce`,
          );
        }
      }
    }

    if (/^\s*git\s+merge\b/.test(cmd) && !/git\s+merge\s+agent\//.test(cmd)) {
      const { spawnSync } = require("child_process");
      const result = spawnSync(
        process.execPath,
        [path.join(PROJECT, "scripts", "paths", "gate.js")],
        { cwd: PROJECT, encoding: "utf8" },
      );
      if (result.status !== 0) {
        const tail = (result.stdout || "").split("\n").slice(-10).join("\n");
        block(
          `merge-guard: path coherence gate failed before merge.\n${tail}\n\nFix: node scripts/paths/build.js`,
        );
      }

      for (const rel of [
        ["scripts", "paths", "build.js"],
        ["scripts", "hooks", "build.js"],
      ]) {
        const buildScript = path.join(PROJECT, ...rel);
        if (!require("fs").existsSync(buildScript)) continue;
        const fresh = spawnSync(process.execPath, [buildScript, "--check"], {
          cwd: PROJECT,
          encoding: "utf8",
        });
        if (fresh.status === 1) {
          const tail = (fresh.stdout || fresh.stderr || "")
            .split("\n")
            .slice(-10)
            .join("\n");
          const buildCmd = rel.join("/");
          block(
            `merge-guard: generated artifacts stale before merge (${buildCmd} --check failed).\n${tail}\n\nThis merge would leave generated paths/hook artifacts out of sync with their registry — the sprint pipeline + hooks read the stale copy. Fix: node ${buildCmd}  (then commit the regenerated artifacts), and re-run the merge.`,
          );
        } else if (fresh.status !== 0 && fresh.status !== null) {
          const errTail =
            (fresh.stderr || "").split("\n").slice(-8).join("\n") ||
            (fresh.stdout || "").split("\n").slice(-8).join("\n");
          const sig = fresh.signal ? ` signal=${fresh.signal}` : "";
          block(
            `merge-guard: freshness gate crashed before merge (${rel.join("/")} --check exit=${fresh.status}${sig}).\n${errTail}\n\nFix: run it directly to see why — do not bypass without a known-good reason.`,
          );
        }
      }

      const reqGate = path.join(PROJECT, "scripts", "requirements", "gate.js");
      if (require("fs").existsSync(reqGate)) {
        const reqResult = spawnSync(process.execPath, [reqGate], {
          cwd: PROJECT,
          encoding: "utf8",
        });
        const reqStatus = reqResult.status;
        if (reqStatus === 2) {
          const tail = (reqResult.stdout || "")
            .split("\n")
            .slice(-12)
            .join("\n");
          block(
            `merge-guard: requirements Freshness Gate failed before merge.\n${tail}\n\nFix: node scripts/requirements/graph-build.js && node scripts/requirements/apply-rco.js --auto-expire 30 — then resolve any open Class C RCOs.`,
          );
        } else if (reqStatus !== 0 && reqStatus !== 1) {
          const errTail =
            (reqResult.stderr || "").split("\n").slice(-8).join("\n") ||
            (reqResult.stdout || "").split("\n").slice(-8).join("\n");
          const sig = reqResult.signal ? ` signal=${reqResult.signal}` : "";
          block(
            `merge-guard: requirements Freshness Gate crashed (exit=${reqStatus}${sig}).\n${errTail}\n\nFix: investigate scripts/requirements/gate.js — do not bypass the gate without a known-good reason.`,
          );
        }
      }
    }

    if (/git\s+merge\s+agent\//.test(cmd)) {
      const reqGate = path.join(PROJECT, "scripts", "requirements", "gate.js");
      if (require("fs").existsSync(reqGate)) {
        const { spawnSync } = require("child_process");
        const reqResult = spawnSync(process.execPath, [reqGate], {
          cwd: PROJECT,
          encoding: "utf8",
        });
        const reqStatus = reqResult.status;
        if (reqStatus === 2) {
          const tail = (reqResult.stdout || "")
            .split("\n")
            .slice(-12)
            .join("\n");
          block(
            `merge-guard: requirements Freshness Gate failed before agent/* merge.\n${tail}\n\nFix: resolve open Class C RCOs or rebuild graph (node scripts/requirements/graph-build.js).`,
          );
        } else if (reqStatus !== 0 && reqStatus !== 1) {
          const errTail =
            (reqResult.stderr || "").split("\n").slice(-8).join("\n") ||
            (reqResult.stdout || "").split("\n").slice(-8).join("\n");
          const sig = reqResult.signal ? ` signal=${reqResult.signal}` : "";
          block(
            `merge-guard: Freshness Gate crashed before agent/* merge (exit=${reqStatus}${sig}).\n${errTail}`,
          );
        }
      }

      const store = readStore();
      if (!store) {
        block(
          "Cannot read store.json — fail-closed. git merge agent/* blocked.",
        );
      }
      const cycleStep = (store.heartbeat || {}).cycleStep;
      if (cycleStep !== "review-complete") {
        block(
          `git merge agent/* blocked: cycleStep is "${cycleStep}", must be "review-complete". ` +
            "Run gauntlet (eval+security+compliance) first.",
        );
      }
      logEvent(
        "merge",
        "boss",
        "merge-allowed",
        cmd.slice(0, 100),
        `cycleStep=${cycleStep}`,
      );
      process.exit(0);
    }

    if (/git\s+reset\s+--hard/.test(cmd)) {
      block(
        "git reset --hard blocked: destructive operation. Use git revert instead.",
      );
    }

    if (/git\s+checkout\s+agent\//.test(cmd)) {
      block(
        "git checkout agent/* blocked: Boss should not switch to agent branches directly.",
      );
    }

    if (/\bgit\s+checkout\s+--\s+(?:\.|src\/?|docs\/?)\s*$/.test(cmd)) {
      block(
        "wide git checkout blocked: use a path-specific restore for the exact files you intend to discard.",
      );
    }

    if (
      /node\s+-e\s/.test(cmd) &&
      /fs\.(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|rename|renameSync|cp|cpSync|copyFile|copyFileSync|truncate|truncateSync|createWriteStream)\b/.test(
        cmd,
      )
    ) {
      const isJsonl = /\.(jsonl|ndjson)['"]\s*[,)]/.test(cmd);
      const isAppend = /appendFileSync/.test(cmd);
      const isWrite = /writeFileSync/.test(cmd);
      let hint;
      if (isJsonl && isAppend) {
        hint =
          "JSONL append: Read the file, find a unique anchor on the last line, then use Edit to append a `\\n` + new entry. " +
          "Or write a one-shot scripts/append-<name>.js calling `require('./scripts/hooks/lib/logger').logLearning(...)` (or similar canonical helper).";
      } else if (isWrite) {
        hint =
          "Full-file write: use the Write tool (it overwrites). " +
          "For partial JSON updates, prefer Read + Edit. For larger transforms, put logic in scripts/<name>.js and run `node scripts/<name>.js`.";
      } else {
        hint =
          "Use Edit/Write tools, or move the logic into scripts/<name>.js and run `node scripts/<name>.js`. " +
          "Hooks enforce ownership on Edit/Write but allow standalone scripts.";
      }
      block(`node -e with fs write blocked: ${hint}`);
    }

    {
      const segments = cmd.split(/(?:&&|\|\||;|\|)/);
      for (const seg of segments) {
        const s = seg.trim();
        if (!/\brm\b/.test(s)) continue;
        if (/\bgit\s+rm\b/.test(s)) continue;
        if (/\b(?:src|docs)\//.test(s)) {
          block(
            "rm on src/ or _docs/ blocked: use `git rm` to manage file lifecycle.",
          );
        }
      }
    }

    {
      const segments = cmd.split(/(?:&&|\|\||;|\|)/);
      const hasGitRm = segments.some((s) => /\bgit\s+rm\b/.test(s.trim()));
      if (hasGitRm) {
        try {
          const { spawn } = require("child_process");
          const refChecker = path.resolve(__dirname, "ref-checker.js");
          const child = spawn("node", [refChecker, "--summary"], {
            cwd: PROJECT,
            detached: true,
            stdio: "ignore",
          });
          child.unref();
          process.stderr.write(
            "\x1b[33m[merge-guard] ADVISORY: git rm detected — ref-checker scan dispatched in background. Run `node scripts/hooks/ref-checker.js --summary` to see broken refs left by this delete.\x1b[0m\n",
          );
          logEvent(
            "warn",
            "system",
            "ref-checker-dispatched",
            cmd.slice(0, 100),
            "git rm detected — ref-checker spawned async",
          );
        } catch {
        }
      }
    }

    if (
      /git\s+push\s+.*--force/.test(cmd) ||
      /git\s+push\s+-f\b/.test(cmd) ||
      /git\s+push\s+\S+\s+\+\S+/.test(cmd)
    ) {
      block(
        "git push force-push blocked: destructive operation. (matched: --force / -f / +refspec)",
      );
    }

    if (/git\s+push\b.*karpathy-run\//.test(cmd)) {
      block(
        "karpathy-run/* branches are experiment-only; never pushed to remote. Use /karpathy:integrate to land the winning variant onto a feature branch off main.",
      );
    }

    if (
      /git\s+push\b/.test(cmd) &&
      !/--force|-f\b|--dry-run/.test(cmd) &&
      !/git\s+push\s+\S+\s+\+\S+/.test(cmd)
    ) {
      logEvent(
        "warn",
        "system",
        "push-advisory",
        cmd.slice(0, 100),
        "Convention: ask user before pushing (CLAUDE.md)",
      );
      process.stderr.write(
        "\x1b[33m[merge-guard] ADVISORY: git push detected. Convention says ask before pushing.\x1b[0m\n",
      );
    }

    allow(cmd);
  } catch (e) {
    logEvent(
      "block",
      "system",
      "merge-guard-parse-error",
      "",
      String(e).slice(0, 200),
    );
    console.log(
      JSON.stringify({
        decision: "block",
        reason:
          "merge-guard: parse error (fail-closed) — " + String(e).slice(0, 100),
      }),
    );
    process.exit(0);
  }
});
