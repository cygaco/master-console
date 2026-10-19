#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { PROJECT, relPath, PATHS } = require("./lib/paths");
const { logEvent } = require("./lib/logger");

const PROTECTED_FILES = [
  "events.jsonl",
  "learnings.jsonl",
  "systems.jsonl",
  "traces.jsonl",
];

const eventsDir =
  PATHS.events || path.join(PROJECT, ".claude", "project", "events");
const memoryDir =
  PATHS.memory || path.join(PROJECT, ".claude", "project", "memory");
const PROTECTED_PATHS = [
  relPath(path.join(eventsDir, "events.jsonl")),
  relPath(path.join(memoryDir, "learnings.jsonl")),
  relPath(path.join(memoryDir, "systems.jsonl")),
  relPath(path.join(memoryDir, "traces.jsonl")),
];

function block(reason) {
  logEvent("block", "system", "memory-guard-blocked", "", reason);
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

function isProtectedPath(filePath) {
  const rel = relPath(filePath);
  return PROTECTED_PATHS.some((p) => rel === p || rel.endsWith("/" + p));
}

function isProtectedFile(str) {
  return PROTECTED_FILES.some((f) => str.includes(f));
}

function stripNonTargetText(cmd) {
  let s = cmd;
  s = s.replace(/(^|\s)#[^\n]*/g, "$1");
  s = s.replace(
    /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm,
    " ",
  );
  s = s.replace(
    /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?\\n\s*\2(?=\\n|$|\s)/g,
    " ",
  );
  s = s.replace(/(^|\s)(-m|--message)(\s+|=)(".*?"|'.*?'|\S+)/g, "$1");
  s = s.replace(/(^|\s)(-F|--file)(\s+|=)(".*?"|'.*?'|\S+)/g, "$1");
  return s;
}

function writeTargetsText(strippedCmd) {
  const s = strippedCmd.replace(/\bgit\s+(rm|mv|cp)\b/g, "git __vcs_$1__");
  const targets = [];
  const redir = /(?<!=)>>?\s*([^\s>&|;]+)/g;
  let m;
  while ((m = redir.exec(s)) !== null) {
    targets.push(m[1]);
  }
  const tee = /\btee\b((?:\s+(?:-\S+|[^\s|;&]+))*)/g;
  while ((m = tee.exec(s)) !== null) {
    for (const tok of m[1].split(/\s+/).filter(Boolean)) {
      if (!tok.startsWith("-")) targets.push(tok);
    }
  }
  const fileops = /\b(cp|mv|rm)\b((?:\s+(?:-\S+|[^\s|;&]+))*)/g;
  while ((m = fileops.exec(s)) !== null) {
    for (const tok of m[2].split(/\s+/).filter(Boolean)) {
      if (!tok.startsWith("-")) targets.push(tok);
    }
  }
  return targets.join(" ");
}

function truncateTargets(strippedCmd) {
  const out = [];
  const re = /\btruncate\b((?:\s+(?:-\S+|[^\s|;&]+))*)/g;
  let m;
  while ((m = re.exec(strippedCmd)) !== null) {
    for (const tok of m[1].split(/\s+/).filter(Boolean)) {
      if (tok.startsWith("-")) continue;
      out.push(tok);
    }
  }
  return out.join(" ");
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name || "";

    if (event.tool_response !== undefined) {
      if (toolName === "Write" || toolName === "Edit") {
        const filePath = (event.tool_input || {}).file_path || "";
        if (filePath.includes("learnings.jsonl")) {
          try {
            const absPath = path.join(memoryDir, "learnings.jsonl");
            if (fs.existsSync(absPath)) {
              const content = fs.readFileSync(absPath, "utf8").trim();
              const lines = content ? content.split("\n") : [];
              let activeCount = 0;
              for (const line of lines) {
                try {
                  const entry = JSON.parse(line);
                  if (
                    entry.status !== "implemented" &&
                    entry.effective !== false
                  ) {
                    activeCount++;
                  }
                } catch {
                }
              }
              if (activeCount > 1000) {
                process.stderr.write(
                  `\x1b[33m[memory-guard] WARN: ${activeCount} active learnings (max: 1000). Consider pruning with /learn:conversation.\x1b[0m\n`,
                );
                logEvent(
                  "warn",
                  "system",
                  "learning-count-high",
                  "",
                  `${activeCount} active learnings exceeds 1000 max`,
                );
              }
            }
          } catch {
          }
        }
      }
      process.exit(0);
    }

    if (toolName === "Bash") {
      const command = (event.tool_input || {}).command || "";
      const cmd = command.trim();

      if (!cmd || !isProtectedFile(cmd)) {
        process.exit(0);
      }

      if (/appendFileSync/.test(cmd) && !/writeFileSync/.test(cmd)) {
        process.exit(0);
      }

      if (cmd.includes("setup-system")) {
        process.exit(0);
      }

      const subCmds = cmd.split(/\s*&&\s*/);
      const allSafe = subCmds.every(
        (c) =>
          /^\s*(cd|cat|head|tail|less|more|wc|grep|rg|find|ls|git)\s/.test(c) ||
          /^\s*node\s.*query/.test(c) ||
          /^\s*$/.test(c),
      );
      if (allSafe) {
        process.exit(0);
      }

      const cmdNoProse = stripNonTargetText(cmd);
      const cmdForRedirectCheck = cmdNoProse
        .replace(/\d?>&\d+/g, "")
        .replace(/\d?>\s*\/dev\/(null|stderr|stdout)/g, "");

      const targets = writeTargetsText(cmdForRedirectCheck);
      const targetsProtected = (f) => targets.includes(f);

      if (
        />>/.test(cmdForRedirectCheck) &&
        !/(?<![>])>\s*[^>]/.test(cmdForRedirectCheck.replace(/>>/g, ""))
      ) {
        process.exit(0);
      }

      if (
        /(?<!=)>\s*[^>&]/.test(cmdForRedirectCheck) &&
        !/>>/.test(cmdForRedirectCheck.split(">")[0] + ">")
      ) {
        for (const f of PROTECTED_FILES) {
          const overwriteTarget = /(?<!=)(?<!>)>\s*([^\s>&|;]+)/.exec(
            cmdForRedirectCheck,
          );
          if (overwriteTarget && overwriteTarget[1].includes(f)) {
            block(
              `Overwrite redirect to ${f} blocked. Use logger.js for events or appendFileSync for memory files.`,
            );
          }
        }
      }

      if (/writeFileSync/.test(cmdNoProse)) {
        for (const f of PROTECTED_FILES) {
          const wfsArg = new RegExp(
            "writeFileSync\\s*\\(\\s*[`'\"][^`'\"]*" +
              f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          );
          if (wfsArg.test(cmdNoProse)) {
            block(
              `writeFileSync on ${f} blocked. These files are append-only. Use logger.js or appendFileSync.`,
            );
          }
        }
      }

      if (/\btruncate\b/.test(cmdNoProse)) {
        for (const f of PROTECTED_FILES) {
          if (targetsProtected(f) || truncateTargets(cmdNoProse).includes(f)) {
            block(`truncate on ${f} blocked. These files are append-only.`);
          }
        }
      }

      if (/\brm\b/.test(cmdNoProse)) {
        for (const f of PROTECTED_FILES) {
          if (targetsProtected(f)) {
            block(`rm on ${f} blocked. These files are append-only.`);
          }
        }
      }

      if (
        /\b(echo|printf)\b/.test(cmdNoProse) &&
        /(?<!=)(?<!>)>\s*[^>&]/.test(cmdForRedirectCheck)
      ) {
        for (const f of PROTECTED_FILES) {
          const overwriteTarget = /(?<!=)(?<!>)>\s*([^\s>&|;]+)/.exec(
            cmdForRedirectCheck,
          );
          if (overwriteTarget && overwriteTarget[1].includes(f)) {
            block(
              `echo/printf redirect to ${f} blocked. These files are append-only.`,
            );
          }
        }
      }

      process.exit(0);
    }

    if (toolName === "Edit" || toolName === "Write") {
      const filePath = (event.tool_input || {}).file_path || "";

      if (!filePath) {
        process.exit(0);
      }

      if (filePath.includes("events.jsonl") && isProtectedPath(filePath)) {
        block(
          "Direct Edit/Write to events.jsonl blocked. Use logger.js (appendFileSync) for event logging.",
        );
      }

      if (toolName === "Write" && isProtectedPath(filePath)) {
        block(
          `Write (full overwrite) to ${path.basename(filePath)} blocked. Use Edit for surgical changes or appendFileSync for appending.`,
        );
      }

      process.exit(0);
    }

    process.exit(0);
  } catch (e) {
    logEvent(
      "block",
      "system",
      "memory-guard-parse-error",
      "",
      String(e).slice(0, 200),
    );
    console.log(
      JSON.stringify({
        decision: "block",
        reason:
          "memory-guard: parse error (fail-closed) — " +
          String(e).slice(0, 100),
      }),
    );
    process.exit(0);
  }
});
