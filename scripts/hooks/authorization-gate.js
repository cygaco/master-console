#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const PROJECT = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());

let PATHS = {};
try {
  const raw = JSON.parse(
    fs.readFileSync(path.join(PROJECT, ".claude", "paths.json"), "utf8"),
  );
  PATHS = Object.fromEntries(
    Object.entries(raw)
      .filter(([k]) => k !== "version" && k !== "$schema")
      .map(([k, v]) => [k, path.join(PROJECT, v)]),
  );
} catch {
}

const RUNTIME_DIR = PATHS.runtime || path.join(PROJECT, ".claude", "runtime");
const AUTH_PATH = path.join(RUNTIME_DIR, "authorization.json");

let logEvent = null;
try {
  ({ logEvent } = require("./lib/logger"));
} catch {
}

function emitAuthBypassEvent(payload) {
  if (!logEvent) return;
  try {
    logEvent(
      "auth-bypass",
      "turbo",
      "auth-bypass",
      payload.tool || "",
      `scope=${payload.scope} pattern=${payload.pattern} ttl_remaining_min=${payload.ttl_remaining_min}`,
      payload,
    );
  } catch {
  }
}

function matchManifestEdit(toolName, ti) {
  if (toolName !== "Edit" && toolName !== "Write") return null;
  const fp = String(ti.file_path || "").replace(/\\/g, "/");
  if (fp.endsWith(".claude/manifest.json") || fp === ".claude/manifest.json") {
    return {
      scope: "manifest-edit",
      pattern: `${toolName}(.claude/manifest.json)`,
    };
  }
  return null;
}

function matchWriteJsonl(toolName, ti) {
  if (toolName !== "Write" && toolName !== "Edit") return null;
  const fp = String(ti.file_path || "").replace(/\\/g, "/");
  if (/\.jsonl$/.test(fp)) {
    return {
      scope: "write-jsonl",
      pattern: `${toolName}(${fp.split("/").pop()})`,
    };
  }
  return null;
}

function containsNodeEDestructiveFs(cmd) {
  const norm = String(cmd || "").replace(/\\(['"])/g, "$1");
  const destructive = "(?:rmSync|unlinkSync|rmdirSync)";
  const fsRequire = "require\\s*\\(\\s*['\"](?:fs|node:fs)['\"]\\s*\\)";
  const fsMember = new RegExp(`\\bfs\\s*(?:\\.\\s*${destructive}\\b|\\[\\s*['"]${destructive}['"]\\s*\\])`);
  const directCall = new RegExp(`(?:^|[^\\w$])${destructive}\\s*\\(`);
  const destructuredFs = new RegExp(`\\{[^}]*\\b${destructive}\\b[^}]*\\}\\s*=\\s*${fsRequire}`);
  const requireFsMember = new RegExp(`${fsRequire}\\s*(?:\\.\\s*${destructive}\\b|\\[\\s*['"]${destructive}['"]\\s*\\])`);
  return (
    fsMember.test(norm) ||
    directCall.test(norm) ||
    destructuredFs.test(norm) ||
    requireFsMember.test(norm)
  );
}

function matchNodeEFs(toolName, ti) {
  if (toolName !== "Bash") return null;
  const cmd = String(ti.command || "");
  if (!/^\s*node\s+-e\b/.test(cmd)) return null;
  if (containsNodeEDestructiveFs(cmd)) {
    return null;
  }
  if (/fs\.(writeFileSync|appendFileSync|mkdirSync)\b/.test(cmd)) {
    return { scope: "node-e-fs", pattern: "Bash(node -e *fs.{write,append,mkdir}Sync*)" };
  }
  return null;
}

function matchDestructiveGit(toolName, ti) {
  if (toolName !== "Bash") return null;
  const cmd = String(ti.command || "");
  if (/\bgit\s+rm\s+--cached\b/.test(cmd)) {
    return { scope: "destructive-git", pattern: "Bash(git rm --cached *)" };
  }
  if (/\bgit\s+reset\s+--hard\b/.test(cmd)) {
    return { scope: "destructive-git", pattern: "Bash(git reset --hard *)" };
  }
  if (/\bgit\s+restore\b/.test(cmd)) {
    return { scope: "destructive-git", pattern: "Bash(git restore *)" };
  }
  return null;
}

function matchWorktreeOps(toolName, ti) {
  if (toolName !== "Bash") return null;
  const cmd = String(ti.command || "");
  if (/\bgit\s+worktree\s+(add|remove|prune|move)\b/.test(cmd)) {
    return { scope: "worktree-ops", pattern: "Bash(git worktree *)" };
  }
  return null;
}

function matchPushToMain(toolName, ti) {
  if (toolName !== "Bash") return null;
  const cmd = String(ti.command || "");
  if (
    /\bgit\s+push\b/.test(cmd) &&
    /\bmain\b/.test(cmd) &&
    !/--force/.test(cmd)
  ) {
    return { scope: "push-to-main", pattern: "Bash(git push * main)" };
  }
  return null;
}

const MATCHERS = [
  matchManifestEdit,
  matchWriteJsonl,
  matchNodeEFs,
  matchDestructiveGit,
  matchWorktreeOps,
  matchPushToMain,
];

function extractDeleteTargets(cmd) {
  const targets = [];
  const add = (p) => {
    if (!p) return;
    const cleaned = String(p).trim().replace(/\\/g, "/");
    if (cleaned && !cleaned.startsWith("-")) targets.push(cleaned);
  };

  const norm = cmd.replace(/\\(['"])/g, "$1");

  const fsDel = /fs\.(?:rmSync|unlinkSync|rmdirSync)\s*\(\s*(['"])([^'"]+)\1/g;
  let m;
  while ((m = fsDel.exec(norm))) add(m[2]);

  const stripQuotes = (tok) => tok.replace(/^['"]|['"]$/g, "");

  const gitRm = norm.match(/\bgit\s+rm\b([^\n;&|]*)/);
  if (gitRm) {
    for (const tok of gitRm[1].split(/\s+/)) {
      if (tok && !tok.startsWith("-")) add(stripQuotes(tok));
    }
  }

  const shRm = norm.match(/(?:^|[\s;&|])rm\s+([^\n;&|]*)/);
  if (shRm) {
    for (const tok of shRm[1].split(/\s+/)) {
      if (tok && !tok.startsWith("-")) add(stripQuotes(tok));
    }
  }
  return Array.from(new Set(targets));
}

function isGitTracked(p, projectDir = PROJECT) {
  try {
    const abs = path.isAbsolute(p) ? p : path.join(projectDir, p);
    const rel = path.relative(projectDir, abs).replace(/\\/g, "/");
    if (rel.startsWith("..")) return false;
    const r = spawnSync(
      "git",
      ["ls-files", "--error-unmatch", "--", rel],
      { cwd: projectDir, encoding: "utf8", timeout: 5000 },
    );
    return r.status === 0;
  } catch {
    return false;
  }
}

function isInSafetyFloor(toolName, ti, projectDir = PROJECT) {
  if (toolName !== "Bash") return false;
  const cmd = String(ti.command || "");
  if (
    /\bgit\s+push\b/.test(cmd) &&
    /\bmain\b/.test(cmd) &&
    /--force/.test(cmd)
  ) {
    return true;
  }
  if (/\bgit\s+branch\s+-D\s+(backup\/|pre-)/.test(cmd)) {
    return true;
  }
  if (/\bgit\s+push\s+\S+\s+--delete\s+(backup\/|pre-)/.test(cmd)) {
    return true;
  }
  const delTargets = extractDeleteTargets(cmd);
  for (const t of delTargets) {
    if (isGitTracked(t, projectDir)) return true;
  }
  return false;
}

function readAuth() {
  try {
    if (!fs.existsSync(AUTH_PATH)) return null;
    const auth = JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"));
    if (!auth || auth.schema !== "mc/auth/v1") return null;
    if (!Array.isArray(auth.scopes)) return null;
    if (!auth.expires_at) return null;
    const ms = new Date(auth.expires_at).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return null;
    auth._ttl_remaining_min = Math.max(0, Math.floor(ms / 60000));
    return auth;
  } catch {
    return null;
  }
}

function runAsHook() {
  let input = "";
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    try {
      const auth = readAuth();
      if (!auth) {
        process.exit(0);
      }

      let event;
      try {
        event = JSON.parse(input || "{}");
      } catch {
        process.exit(0);
      }
      const toolName = event.tool_name || "";
      const ti = event.tool_input || {};

      if (isInSafetyFloor(toolName, ti)) {
        process.exit(0);
      }

      let match = null;
      for (const m of MATCHERS) {
        const r = m(toolName, ti);
        if (r) {
          match = r;
          break;
        }
      }
      if (!match) {
        process.exit(0);
      }

      if (!auth.scopes.includes(match.scope)) {
        process.exit(0);
      }

      emitAuthBypassEvent({
        type: "auth-bypass",
        action: "auth-bypass",
        scope: match.scope,
        tool: toolName,
        pattern: match.pattern,
        ttl_remaining_min: auth._ttl_remaining_min,
        file_path: ti.file_path || null,
      });

      process.stdout.write(
        JSON.stringify({
          decision: "approve",
          reason: `[turbo] scope=${match.scope} ttl_remaining_min=${auth._ttl_remaining_min}`,
        }) + "\n",
      );
      process.exit(0);
    } catch {
      process.exit(0);
    }
  });

  process.stdin.on("error", () => process.exit(0));
}

if (require.main === module) {
  runAsHook();
}

module.exports = {
  matchManifestEdit,
  matchWriteJsonl,
  matchNodeEFs,
  matchDestructiveGit,
  matchWorktreeOps,
  matchPushToMain,
  MATCHERS,
  extractDeleteTargets,
  isGitTracked,
  isInSafetyFloor,
};
