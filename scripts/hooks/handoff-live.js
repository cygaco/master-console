#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    run(input);
  } catch {
  }
  process.exit(0);
});

function gitRO(args, cwd) {
  try {
    return execSync(`git ${args}`, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 2500,
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, "utf8").trim();
  } catch {
    return "";
  }
}

function resolveSid(event, runtimeDir) {
  const raw =
    (event && event.session_id) ||
    process.env.CLAUDE_SESSION_ID ||
    readFileSafe(path.join(runtimeDir, ".session-id")) ||
    "unknown";
  const safe = String(raw).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
  return safe || "unknown";
}

function parsePorcelain(porcelain) {
  const staged = [];
  const unstaged = [];
  const untracked = [];
  if (!porcelain) return { staged, unstaged, untracked };
  for (const line of porcelain.split("\n")) {
    if (!line || line.length < 3) continue;
    const x = line[0];
    const y = line[1];
    let file = line.slice(2).trim();
    const arrow = file.indexOf(" -> ");
    if (arrow !== -1) file = file.slice(arrow + 4).trim();
    if (file.startsWith('"') && file.endsWith('"')) file = file.slice(1, -1);
    if (!file) continue;
    if (x === "?" && y === "?") {
      untracked.push(file);
      continue;
    }
    if (x !== " " && x !== "?") staged.push(file);
    if (y !== " " && y !== "?") unstaged.push(file);
  }
  return { staged, unstaged, untracked };
}

function eventLogContext(cwd) {
  const out = { asks: [], lastAction: "" };
  try {
    const { query } = require("./lib/logger");
    const prompts = query({ cat: "prompt", limit: 3 }) || [];
    out.asks = prompts.map((e) => {
      const ts = new Date(e.ts).toISOString().slice(11, 19);
      return `[${ts}] ${(e.data && e.data.stripped ? e.data.stripped : "(no text)").slice(0, 180)}`;
    });
    const tools = query({ cat: "tool", limit: 1 }) || [];
    if (tools.length) {
      const t = tools[0];
      const name = (t.data && (t.data.tool || t.data.name)) || "tool";
      out.lastAction = `${name}${t.data && t.data.target ? " → " + String(t.data.target).slice(0, 80) : ""}`;
    }
  } catch {
  }
  return out;
}

function atomicWrite(finalPath, body) {
  const tmp = `${finalPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, finalPath);
}

function run(raw) {
  let event = {};
  try {
    event = JSON.parse(raw);
  } catch {
  }
  const cwd = process.env.CLAUDE_PROJECT_DIR || (event && event.cwd) || process.cwd();
  const claudeDir = path.join(cwd, ".claude");
  const runtimeDir = path.join(claudeDir, "runtime");
  try {
    fs.mkdirSync(runtimeDir, { recursive: true });
  } catch {
  }

  const sid = resolveSid(event, runtimeDir);
  const hookEvent =
    (event && (event.hook_event_name || event.hookEventName)) || "Stop";
  const source = (event && event.source) || "";

  const now = new Date();
  const ts = now.toISOString();

  const branch = gitRO("rev-parse --abbrev-ref HEAD", cwd) || "unknown";
  const head = gitRO("rev-parse --short HEAD", cwd);
  const lastMsg = gitRO("log -1 --pretty=%s", cwd);
  const perSidBaseline = path.join(runtimeDir, `.session-start-commit-${sid}`);
  let startCommit = readFileSafe(perSidBaseline);
  if (!startCommit) {
    startCommit = readFileSafe(path.join(claudeDir, ".session-start-commit")) || head;
    if (startCommit) {
      try {
        fs.writeFileSync(perSidBaseline, startCommit);
      } catch {
      }
    }
  }
  let sessionCommits = "";
  if (startCommit && head) {
    sessionCommits = gitRO(`log --oneline ${startCommit}..HEAD`, cwd);
  }
  const porcelain = gitRO("status --porcelain", cwd);
  const stagedStat = gitRO("diff --staged --stat", cwd);
  const unstagedStat = gitRO("diff --stat", cwd);
  const { staged, unstaged, untracked } = parsePorcelain(porcelain);

  const { asks, lastAction } = eventLogContext(cwd);

  const L = [];
  L.push(`# Handoff (LIVE) — session \`${sid}\` — ${ts}`);
  L.push("");
  L.push(
    "> **Layer-1 live-state safety net**. Cheap deterministic snapshot, rewritten after every turn.",
  );
  L.push(
    "> GROUND TRUTH (git), independent of `TRACKER.md` — use it to catch uncommitted / untracked work the narrative handoff may not yet reflect.",
  );
  L.push(
    "> Physics: a mid-turn hard kill is NOT captured (no hook sees an unfinished turn); otherwise this is ≤1 turn stale. After a crash the rich `handoff.md` is simply absent.",
  );
  L.push("");
  L.push(`- Written by: \`${hookEvent}\`${source ? ` (source: ${source})` : ""}`);
  L.push("");

  L.push("## Git ground truth");
  L.push(`- When: ${ts}`);
  L.push(
    `- Branch: \`${branch}\` · HEAD: \`${head || "?"}\`${lastMsg ? ` — ${lastMsg}` : ""}`,
  );
  if (startCommit) {
    L.push(`- Session start commit: \`${startCommit.slice(0, 12)}\``);
  }
  if (sessionCommits) {
    L.push("");
    L.push("### Commits this session");
    sessionCommits.split("\n").forEach((c) => L.push(`- \`${c}\``));
  }
  L.push("");
  L.push(
    `### Uncommitted (the untracked-work signal) — staged ${staged.length} · unstaged ${unstaged.length} · untracked ${untracked.length}`,
  );
  const listBlock = (label, arr) => {
    if (!arr.length) return;
    L.push(`- **${label}:** ${arr.slice(0, 40).map((f) => `\`${f}\``).join(", ")}${arr.length > 40 ? ` … (+${arr.length - 40})` : ""}`);
  };
  listBlock("Staged", staged);
  listBlock("Unstaged", unstaged);
  listBlock("Untracked", untracked);
  if (stagedStat) {
    L.push("");
    L.push("Staged diffstat:");
    L.push("```");
    L.push(stagedStat);
    L.push("```");
  }
  if (unstagedStat) {
    L.push("");
    L.push("Unstaged diffstat:");
    L.push("```");
    L.push(unstagedStat);
    L.push("```");
  }
  L.push("");

  if (asks.length) {
    L.push("## Last user asks");
    asks.forEach((a) => L.push(`- ${a}`));
    L.push("");
  }
  if (lastAction) {
    L.push("## Last action");
    L.push(`- ${lastAction}`);
    L.push("");
  }

  const body = L.join("\n");
  atomicWrite(path.join(runtimeDir, `handoff-live-${sid}.md`), body);
}

module.exports = {
  resolveSid,
  parsePorcelain,
  atomicWrite,
  _run: run,
};
