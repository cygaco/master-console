#!/usr/bin/env node
/**
 * authorization-gate.js — PreToolUse hook that short-circuits downstream
 * guards when an active `/turbo` authorization covers the tool call.
 *
 * Pairs with `scripts/turbo/apply.js`. Reads `paths.runtime/authorization.json`
 * (schema mc/auth/v1). If absent, expired, or scope-mismatched: no-op
 * pass-through. Existing BLOCK guards run untouched.
 *
 * When scope matches AND not in safety floor:
 *   - Emit `auth-bypass` audit event
 *   - stdout: { "decision": "approve", "reason": "[turbo] scope=<s> ttl_min_remaining=<n>" }
 *
 * The Claude Code PreToolUse contract treats `decision: "approve"` as a
 * positive signal to skip subsequent guards in the chain. This hook is
 * registered FIRST in the PreToolUse hook chain, so an approve short-circuits
 * the rest.
 *
 * Safety floor (ALWAYS blocked, regardless of --scope all):
 *   - `git push --force` (any remote/branch)
 *   - `git push *` to backup/* or pre-* branches deleted
 *   - `git branch -D backup/*` / `git branch -D pre-*`
 *
 * Fail-open: any error in this hook → no-op pass-through. Never block.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const PROJECT = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());

// ── Load PATHS registry (best-effort) ──────────────────────
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
  /* registry optional */
}

const RUNTIME_DIR = PATHS.runtime || path.join(PROJECT, ".claude", "runtime");
const AUTH_PATH = path.join(RUNTIME_DIR, "authorization.json");

// Logger is best-effort.
let logEvent = null;
try {
  ({ logEvent } = require("./lib/logger"));
} catch {
  /* logger optional */
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
    /* swallow */
  }
}

// ── Scope matchers — same vocab as scripts/turbo/apply.js ──
//
// Each matcher inspects the PreToolUse event and returns:
//   { scope: <string>, pattern: <human-readable> } when matched
//   null when not relevant to this scope
//
// All matchers are pure functions of `tool_name` + `tool_input`. Order
// doesn't matter — we test all in sequence and take the FIRST hit.
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
  // AC-4.1 (PRIMARY): the node-e-fs scope approves WRITE/APPEND/MKDIR ONLY.
  // rmSync/unlinkSync are NOT in the approvable set — a delete is destructive and
  // is never auto-approved by a turbo grant (it must pass through to downstream
  // guards / the tracked-work-delete floor below). The scope vocabulary in
  // apply.js#SCOPE_PERMISSIONS already lists only write/append/mkdir; this matcher
  // is the gate side of that contract.
  //
  // ALL-OR-NOTHING (gauntlet finding 3 — AC-4.1 extension): if the node -e body
  // contains ANY rmSync / unlinkSync / rmdirSync surface — even via bracket access,
  // direct identifier calls, or destructured require("fs") aliases — the ENTIRE
  // command is NOT approvable. A co-present delete poisons the command; it falls
  // through to pass-through / downstream guards. This closes the same-class bypass
  // where fs.writeFileSync(...); { rmSync } = require("fs"); rmSync(variable) was
  // approved because the write regex fired and the variable-form delete target could
  // not be extracted by extractDeleteTargets.
  if (containsNodeEDestructiveFs(cmd)) {
    return null; // delete call present — poisoned, not auto-approvable
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
  // Match `git push <remote> main`, `git push origin main`, `git push origin HEAD:main`
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

// ── Delete-target extraction (AC-4.2) ──────────────────────
//
// Pull the candidate filesystem path(s) a Bash command would DELETE, across the
// scopes a turbo grant can cover. Best-effort + conservative: any path we extract
// is checked against git; a path we cannot confidently extract simply isn't
// floor-matched here (the narrowed matchers + downstream guards still apply).
//
// Covered delete shapes:
//   node -e "...fs.rmSync('p')..."  /  fs.unlinkSync("p")  /  fs.rmdirSync('p')
//   rm -rf p  /  rm p   (POSIX rm, the destructive-git/shell surface)
//   git rm [--cached] p
function extractDeleteTargets(cmd) {
  const targets = [];
  const add = (p) => {
    if (!p) return;
    const cleaned = String(p).trim().replace(/\\/g, "/");
    if (cleaned && !cleaned.startsWith("-")) targets.push(cleaned);
  };

  // Normalize shell/JS escaping first: a `node -e "..."` command double-quotes its
  // inner string, so an inner path is written `\"path\"` (escaped quotes). Drop the
  // backslash-before-quote so the path matchers below see plain `"path"`. This also
  // closes a floor-evasion via escaped quoting.
  const norm = cmd.replace(/\\(['"])/g, "$1");

  // node -e fs.{rm,unlink,rmdir}Sync('path' | "path")
  const fsDel = /fs\.(?:rmSync|unlinkSync|rmdirSync)\s*\(\s*(['"])([^'"]+)\1/g;
  let m;
  while ((m = fsDel.exec(norm))) add(m[2]);

  const stripQuotes = (tok) => tok.replace(/^['"]|['"]$/g, "");

  // git rm [--cached] <path...>
  const gitRm = norm.match(/\bgit\s+rm\b([^\n;&|]*)/);
  if (gitRm) {
    for (const tok of gitRm[1].split(/\s+/)) {
      if (tok && !tok.startsWith("-")) add(stripQuotes(tok));
    }
  }

  // rm [-rf...] <path...>  (shell rm)
  const shRm = norm.match(/(?:^|[\s;&|])rm\s+([^\n;&|]*)/);
  if (shRm) {
    for (const tok of shRm[1].split(/\s+/)) {
      if (tok && !tok.startsWith("-")) add(stripQuotes(tok));
    }
  }
  return Array.from(new Set(targets));
}

// Git-aware tracked check (AC-4.2 / AC-4.3). Returns true ONLY when `p` resolves
// to a path that git TRACKS (in the index / HEAD). An untracked or
// .gitignore-ignored temp path returns false → not floor-blocked. Fail-OPEN to
// false on any git error (no git, detached, timeout) — the narrowed node-e-fs
// matcher (AC-4.1) is the primary remedy; this floor is the backstop and must not
// itself break the hook. `projectDir` defaults to PROJECT; tests inject a
// throwaway repo so this never depends on (or touches) live session state.
function isGitTracked(p, projectDir = PROJECT) {
  try {
    const abs = path.isAbsolute(p) ? p : path.join(projectDir, p);
    const rel = path.relative(projectDir, abs).replace(/\\/g, "/");
    // A path escaping the repo (`../`) can't be repo-tracked work.
    if (rel.startsWith("..")) return false;
    // `git ls-files --error-unmatch <rel>` exits 0 iff the path is tracked.
    const r = spawnSync(
      "git",
      ["ls-files", "--error-unmatch", "--", rel],
      { cwd: projectDir, encoding: "utf8", timeout: 5000 },
    );
    return r.status === 0;
  } catch {
    return false; // fail-open — never break the hook on a git fault
  }
}

// ── Safety floor: ALWAYS blocked regardless of scope ───────
//
// These checks return `true` if the command/edit is in the floor and MUST
// pass through to downstream guards (i.e., this hook will NOT emit approve).
// The downstream guards are responsible for the actual block decision.
function isInSafetyFloor(toolName, ti, projectDir = PROJECT) {
  if (toolName !== "Bash") return false;
  const cmd = String(ti.command || "");
  // 1. git push --force to main (or any --force-with-lease to main)
  if (
    /\bgit\s+push\b/.test(cmd) &&
    /\bmain\b/.test(cmd) &&
    /--force/.test(cmd)
  ) {
    return true;
  }
  // 2. Backup branch / pre-* branch deletion
  if (/\bgit\s+branch\s+-D\s+(backup\/|pre-)/.test(cmd)) {
    return true;
  }
  if (/\bgit\s+push\s+\S+\s+--delete\s+(backup\/|pre-)/.test(cmd)) {
    return true;
  }
  // 3. AC-4.2 (BACKSTOP — executable tracked-work-delete floor): a delete of
  //    TRACKED work via ANY scope (node-e-fs rm, shell rm, git rm) forces
  //    pass-through — the gate NEVER emits approve for it. The SAFETY_FLOOR prose
  //    "delete tracked uncommitted user work" (apply.js) is now code. Git-aware so
  //    an UNtracked/ignored temp delete (AC-4.3) is NOT over-blocked.
  const delTargets = extractDeleteTargets(cmd);
  for (const t of delTargets) {
    if (isGitTracked(t, projectDir)) return true;
  }
  return false;
}

// ── Read + validate authorization.json ─────────────────────
function readAuth() {
  try {
    if (!fs.existsSync(AUTH_PATH)) return null;
    const auth = JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"));
    if (!auth || auth.schema !== "mc/auth/v1") return null;
    if (!Array.isArray(auth.scopes)) return null;
    if (!auth.expires_at) return null;
    const ms = new Date(auth.expires_at).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return null; // expired
    auth._ttl_remaining_min = Math.max(0, Math.floor(ms / 60000));
    return auth;
  } catch {
    return null;
  }
}

// ── Main: read stdin event, decide ─────────────────────────
// Only attach the stdin reader when run AS the hook (not when `require`d by a
// test). The pure decision functions are exported below for isolated testing.
function runAsHook() {
  let input = "";
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    try {
      const auth = readAuth();
      if (!auth) {
        process.exit(0); // no-op pass-through (no auth, or expired)
      }

      let event;
      try {
        event = JSON.parse(input || "{}");
      } catch {
        process.exit(0); // malformed input — pass through, fail-open
      }
      const toolName = event.tool_name || "";
      const ti = event.tool_input || {};

      // Safety floor check first — if this is a forbidden action, never approve.
      if (isInSafetyFloor(toolName, ti)) {
        process.exit(0);
      }

      // Find the first matching scope.
      let match = null;
      for (const m of MATCHERS) {
        const r = m(toolName, ti);
        if (r) {
          match = r;
          break;
        }
      }
      if (!match) {
        process.exit(0); // unrelated tool call — pass through
      }

      // Is the matched scope authorized?
      if (!auth.scopes.includes(match.scope)) {
        process.exit(0); // scope not granted — pass through
      }

      // Approved. Emit audit event + tell harness to skip downstream guards.
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
      // Fail-open: never block on hook error.
      process.exit(0);
    }
  });

  // Edge case: stdin closed with no data — exit cleanly.
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
