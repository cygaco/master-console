#!/usr/bin/env node

"use strict";
const mcEnv = require("./lib/mc-env");

const path = require("path");

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

if (mcEnv.readEnv("DISPATCH_ROUTE_GUARD") === "off") process.exit(0);

function block(reason) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent("block", "system", "dispatch-route-guard", "", reason);
  } catch {
  }
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

function probeBypass(cmd) {
  if (mcEnv.readEnv("PROVIDER_PROBE") === "1") {
    try {
      const { logEvent } = require("./lib/logger");
      logEvent(
        "bypass",
        "system",
        "dispatch-route-guard-probe",
        "",
        cmd.slice(0, 200),
      );
    } catch {
    }
    return true;
  }
  return false;
}

const SAFE_PROVIDER_TAILS =
  /^\s*(?:--version|--help|-h|-v|models?\b|auth\b|whoami\b|config\b|login\b|logout\b|completion\b)\b/;

function hasCanonicalDispatchPrefix(cmd) {
  return /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*node\s+["'`]?\S*dispatch-(?:agent|claude)\.js\b/.test(
    cmd,
  );
}

function isClaudeAgentInvocation(slice) {
  return /\bclaude\s+-p\b[\s\S]*\B--agent\b/.test(slice);
}

let registryRoles = null;
try {
  registryRoles = require("../dispatch/registry-roles");
} catch {
}
let normalizeRole = (r) => r;
try {
  ({ normalizeRole } = require("./lib/role-aliases"));
} catch {
}
const BUILD_CHAIN_ROLES_LITERAL = [
  "builder",
  "backend-builder",
  "frontend-builder",
  "fixer",
  "skeleton-builder",
  "stub-scaffold",
  "security-builder",
  "frontend-fixer",
  "backend-fixer",
  "security-fixer",
];
const BUILD_CHAIN_ROLES = new Set(
  registryRoles
    ? registryRoles.deriveOrFallback(
        () => [...registryRoles.buildChainRoles(), "builder", "fixer"],
        BUILD_CHAIN_ROLES_LITERAL,
        "dispatch-route-guard.BUILD_CHAIN_ROLES",
      )
    : BUILD_CHAIN_ROLES_LITERAL,
);

const REVIEW_ROLES_LITERAL = [
  "backend-reviewer",
  "frontend-reviewer",
  "qa-reviewer",
  "security-reviewer",
];
const REVIEW_ROLES = new Set(
  registryRoles
    ? registryRoles.deriveOrFallback(
        () => {
          const roles = registryRoles.loadRoles();
          return Object.keys(roles).filter(
            (k) => roles[k] && roles[k].kind === "reviewer" && !roles[k].claude_pinned,
          );
        },
        REVIEW_ROLES_LITERAL,
        "dispatch-route-guard.REVIEW_ROLES",
      )
    : REVIEW_ROLES_LITERAL,
);

function shellWords(s) {
  const words = [];
  let cur = "";
  let inWord = false;
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      inWord = true;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      inWord = true;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (inWord) {
        words.push(cur);
        cur = "";
        inWord = false;
      }
      continue;
    }
    cur += ch;
    inWord = true;
  }
  if (inWord) words.push(cur);
  return words;
}

function roleFromAgentFlag(cmd) {
  const words = shellWords(cmd);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === "--agent" && i + 1 < words.length) return words[i + 1].toLowerCase();
    const m = w.match(/^--agent=(.+)$/);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

function rawClaudeAgentRoles(cmd) {
  const deescape = (w) => String(w).replace(/\\/g, "");
  const isClaudeCmd = (w) => {
    const b = deescape(w).toLowerCase();
    return (
      b === "claude" ||
      b === "claude.exe" ||
      b.endsWith("/claude") ||
      b.endsWith("\\claude") ||
      b.endsWith("/claude.exe") ||
      b.endsWith("\\claude.exe")
    );
  };
  const words = shellWords(cmd);
  const roles = [];
  let start = 0;
  for (let i = 0; i <= words.length; i++) {
    if (i === words.length || words[i] === "|" || words[i] === "|&") {
      const seg = words.slice(start, i);
      if (seg.length && isClaudeCmd(seg[0]) && seg.some((w) => deescape(w) === "-p")) {
        for (let j = 0; j < seg.length; j++) {
          if (seg[j] === "--agent" && j + 1 < seg.length) roles.push(seg[j + 1].toLowerCase());
          const m = seg[j].match(/^--agent=(.+)$/);
          if (m) roles.push(m[1].toLowerCase());
        }
      }
      start = i + 1;
    }
  }
  return roles;
}

function rawBuildChainClaudeRole(cmd, _scan) {
  const hit = rawClaudeAgentRoles(cmd).find((r) => BUILD_CHAIN_ROLES.has(normalizeRole(r)));
  return hit || null;
}

function rawReviewClaudeRole(cmd, _scan) {
  const hit = rawClaudeAgentRoles(cmd).find((r) => REVIEW_ROLES.has(r));
  return hit || null;
}

function splitSegments(cmd) {
  const segs = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    const next = cmd[i + 1];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "\\") {
      cur += ch + (next || "");
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r" || ch === ";") {
      segs.push(cur);
      cur = "";
      continue;
    }
    if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
      segs.push(cur);
      cur = "";
      i++;
      continue;
    }
    if (ch === "&") {
      segs.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  segs.push(cur);
  return segs;
}

function findForbidden(rawCmd) {
  if (rawCmd === undefined || rawCmd === null) return null;
  for (const seg of splitSegments(String(rawCmd))) {
    const hit = findForbiddenSegment(seg);
    if (hit) return hit;
  }
  return null;
}

function stripQuoted(s) {
  let out = "";
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    out += ch;
  }
  return out;
}

function findForbiddenSegment(rawSeg) {
  const cmd = rawSeg.replace(/\r?\n/g, " ").trim();
  if (!cmd) return null;
  const scan = stripQuoted(cmd);

  const rawBuildRole = rawBuildChainClaudeRole(cmd, scan);
  if (rawBuildRole) {
    return {
      pattern: `claude -p --agent ${rawBuildRole}`,
      detail:
        "build-chain Claude roles silently REAP under raw `claude -p` (the harness auto-backgrounds the long call → 0 bytes, no completion record, exit code lost).",
      use: `node scripts/dispatch-claude.js ${rawBuildRole} <prompt-file> --model <m> -w`,
    };
  }

  const rawReviewRole = rawReviewClaudeRole(cmd, scan);
  if (rawReviewRole) {
    return {
      pattern: `claude -p --agent ${rawReviewRole}`,
      detail:
        "raw `claude -p --agent <reviewer>` is RECORDLESS — the harness reaps the long call with no completion record, so gauntlet-verify can't see the review lane. A review role's sanctioned Claude fallback is the RECORDED `--review-fallback` lane.",
      use: `node scripts/dispatch-claude.js ${rawReviewRole} <prompt-file> --review-fallback`,
    };
  }

  const pipeMatch = scan.match(/\|\s*(codex|gemini|claude)\b([^|]*)$/);
  if (pipeMatch) {
    const [, provider, tail] = pipeMatch;
    if (!SAFE_PROVIDER_TAILS.test(tail)) {
      return {
        pattern: `cat … | ${provider} …`,
        detail:
          "piping into a cross-provider CLI as prompt input bypasses the dispatch wrapper",
      };
    }
  }

  if (hasCanonicalDispatchPrefix(scan)) return null;

  if (/\bcodex\s+exec\b/.test(scan)) {
    return {
      pattern: "codex exec …",
      detail:
        "codex exec must go through node scripts/dispatch-agent.js so the Windows-stdin + concurrency-lock layer applies",
    };
  }

  const geminiMatch = scan.match(/\bgemini\b\s*([\s\S]*)$/);
  if (geminiMatch) {
    const tail = geminiMatch[1];
    if (SAFE_PROVIDER_TAILS.test(tail)) {
    } else if (/(?:^|\s)-p\b/.test(tail)) {
      return {
        pattern: "gemini … -p …",
        detail:
          "gemini prompt invocations must go through node scripts/dispatch-agent.js",
      };
    }
  }

  const claudeMatch = scan.match(/\bclaude\s+-p\b[\s\S]*$/);
  if (claudeMatch) {
    const slice = claudeMatch[0];
    if (!isClaudeAgentInvocation(slice)) {
      if (!SAFE_PROVIDER_TAILS.test(slice.replace(/^\s*claude\s+-p\s*/, ""))) {
        return {
          pattern: "claude -p …",
          detail:
            "raw `claude -p` prompt invocation is forbidden; use `claude -p --agent <role>` (documented fallback) or node scripts/dispatch-agent.js",
        };
      }
    }
  }

  return null;
}

function isReviewFallbackRoute(rawCmd) {
  const cmd = String(rawCmd || "").replace(/\r?\n/g, " ").trim();
  if (!cmd) return false;
  const scan = stripQuoted(cmd);
  if (
    !/^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*node\s+["'`]?\S*dispatch-claude\.js\b/.test(scan)
  ) return false;
  if (!/\B--review-fallback\b/.test(scan)) return false;
  return true;
}

function findAdvisory(rawCmd) {
  const cmd = rawCmd.replace(/\r?\n/g, " ").trim();
  if (!cmd) return null;
  if (!isClaudeAgentInvocation(cmd)) return null;
  if (/<\s*\S/.test(cmd)) return null;
  const inlinesFileSub =
    /\$\(\s*(?:cat|type|Get-Content)\b[^)]*\)/i.test(cmd) ||
    /`\s*(?:cat|type|Get-Content)\b[^`]*`/i.test(cmd);
  if (!inlinesFileSub) return null;
  return {
    advisory: "claude -p --agent with $(cat <file>) argv",
    detail:
      "large agent prompts (diff-bearing reviewer/security-reviewer fallbacks) overflow the OS arg-length limit when inlined as an argv via $(cat …) — they die with 'Argument list too long' (exit 126). Pipe the prompt via stdin instead: `claude -p --model <m> --agent <role> < <prompt-file>`. Small prompts are unaffected; this is a warning, not a block.",
  };
}

const HEAVY_SKILLS = [
  "scan:full",
  "research:deep",
  "redteam:full",
  "qa:audit",
];
const HEAVY_SKILL_RE = new RegExp(
  `(?:^|\\s|/)(${HEAVY_SKILLS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "i",
);
const LEAN_RETURN_RE =
  /lean[\s-]?return|return\s+(?:only\s+)?(?:a\s+|one\s+)?(?:lean\s+|short\s+|≤?\s*\d+[\s-]?line\s+)?(?:verdict\s+)?envelope|envelope[\s-]?(?:only|return)|write\b[\s\S]{0,80}?\b(?:file|to\s+disk)[\s\S]{0,80}?\breturn\b|return[\s\S]{0,60}?\b(?:≤|<=|under|at most|no more than)\s*\d+\s*lines?\b|do(?:\s+not|n't)\s+(?:return|dump|paste)\s+(?:the\s+)?full\b|don't\s+aggregate[\s\S]{0,40}?context/i;

function findHeavySkillAdvisory(promptText) {
  const text = String(promptText || "");
  if (!text.trim()) return null;
  const m = HEAVY_SKILL_RE.exec(text);
  if (!m) return null;
  if (LEAN_RETURN_RE.test(text)) return null;
  const skill = m[1].toLowerCase();
  return {
    advisory: `heavy-skill in-orchestrator dispatch without lean-return (${skill})`,
    skill,
    detail:
      `[dispatch-route-guard] this Agent dispatch runs the heavy aggregate/verify skill '/${skill}' but the prompt does not request a LEAN RETURN. ` +
      `Heavy skills (/scan:full, /research:deep, /redteam:full, /qa:audit, big synthesis) pull tens of thousands of tokens of sub-output into the orchestrator's context when their full result is returned. ` +
      `Instruct the sub-agent to WRITE its full output to a file and RETURN ONE short verdict envelope (e.g. "≤8 lines: PASS/FAIL + counts + the file path") — do NOT return the full aggregation. ` +
      `This is a context-hygiene contract (a warning, not a block).`,
  };
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);

    if (event.tool_name === "Agent") {
      if (event.tool_response !== undefined) process.exit(0);
      const sub = String((event.tool_input || {}).subagent_type || "")
        .trim()
        .toLowerCase();
      if (BUILD_CHAIN_ROLES.has(normalizeRole(sub))) {
        block(
          [
            "[dispatch-route-guard] In-process Agent dispatch of a build-chain role is forbidden.",
            `Role: ${sub}`,
            "",
            `Use:  node scripts/dispatch-claude.js ${sub} <prompt-file> -w`,
            "Why:  the Agent tool dumps the full sub-agent response (50-100K tokens) into the",
            "      orchestrator's context (the context-lever) AND lacks the wrapper's",
            "      reap-safety. Spec/doc authoring via general-purpose is fine — this",
            "      binds heavy build-chain CODE workers. A Lead's own sub-reviewer fan-out is exempt.",
          ].join("\n"),
        );
      }
      const prompt = String((event.tool_input || {}).prompt || "");
      const heavyAdv = findHeavySkillAdvisory(prompt);
      if (heavyAdv) {
        try {
          const { logEvent } = require("./lib/logger");
          logEvent("warn", "system", "dispatch-route-guard", "", heavyAdv.advisory);
        } catch {
        }
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              additionalContext: heavyAdv.detail,
            },
          }),
        );
      }
      process.exit(0);
    }

    if (event.tool_name !== "Bash") process.exit(0);
    if (event.tool_response !== undefined) process.exit(0);
    const cmd = ((event.tool_input || {}).command || "").trim();
    if (!cmd) process.exit(0);

    if (probeBypass(cmd)) process.exit(0);

    const hit = findForbidden(cmd);
    if (!hit) {
      const adv = findAdvisory(cmd);
      if (adv) {
        try {
          const { logEvent } = require("./lib/logger");
          logEvent("warn", "system", "dispatch-route-guard", "", adv.advisory);
        } catch {
        }
        process.stdout.write(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              additionalContext: `[dispatch-route-guard] ${adv.detail}`,
            },
          }),
        );
      }
      process.exit(0);
    }

    const guidePathHint = path.posix.join(
      ".claude",
      "project",
      "reference",
      "agent-dispatch-guide.md",
    );
    block(
      [
        "[dispatch-route-guard] Direct cross-provider CLI prompt invocation is forbidden.",
        `Pattern matched: ${hit.pattern}`,
        `Detail: ${hit.detail}`,
        "",
        hit.use
          ? `Use:  ${hit.use}`
          : "Use:  node scripts/dispatch-agent.js <role> <prompt-file>",
        hit.use
          ? "Why:  raw `claude -p --agent` for build-chain roles silently reaps —"
          : "Why:  raw provider prompt calls re-trigger known stdin/binding failures",
        hit.use
          ? "      the wrapper bounds the call + writes a death record + non-zero exit."
          : "      (Windows-stdin; binding-gap).",
        "",
        "One-shot bypass for an approved provider-health probe:",
        "  PowerShell: $env:MC_PROVIDER_PROBE = '1'; <command>; Remove-Item Env:MC_PROVIDER_PROBE",
        "  bash:       MC_PROVIDER_PROBE=1 <command>   (note: bash-inline env",
        "              may not propagate to PreToolUse hooks; prefer harness env)",
        "",
        `Full rules: ${guidePathHint} (paths.agentDispatchGuide).`,
      ].join("\n"),
    );
  } catch {
    process.exit(0);
  }
});

module.exports = { findForbidden, findAdvisory, findHeavySkillAdvisory, HEAVY_SKILLS, isReviewFallbackRoute };
