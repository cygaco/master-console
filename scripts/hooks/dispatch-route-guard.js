#!/usr/bin/env node
/**
 * dispatch-route-guard.js — PreToolUse Bash hook.
 *
 * Phase 0 workstream B. Blocks raw cross-provider CLI prompt invocations that
 * bypass the canonical dispatch route (`node scripts/dispatch-agent.js …`).
 *
 * Forbidden (cross-provider stdin / -p prompt patterns):
 *   - `codex exec` not preceded by `node scripts/dispatch-agent.js`
 *   - `gemini … -p` (with a prompt arg, not --help / --version)
 *   - `claude -p` *unless* immediately followed by `--agent <role>` (the
 *      documented Claude fallback path Gamma/Delta already use)
 *   - `cat <file> | (codex|gemini|claude)`
 *
 * Allowed (always):
 *   - `<provider> --version` / `--help` / `auth status` / `models list`
 *   - Anything that begins with `node scripts/dispatch-agent.js`
 *   - Commands operating on `.claude/runtime/.provider-tmp/` paths
 *   - When `WARPOS_PROVIDER_PROBE=1` is set in the harness env (one-shot
 *      health probe escape hatch; the bypass is logged.)
 *
 * Why this hook exists: raw provider CLI prompt invocation from Bash has
 * re-triggered known stdin / binding-gap failures multiple times
 * (LRN-2026-04-17 codex Windows stdin; LRN-2026-04-30 binding-gap). The
 * canonical wrapper at `scripts/dispatch-agent.js` is the only path that
 * goes through `runProvider`, which carries the Windows-stdin fix and the
 * concurrency-lock layer.
 *
 * Fail-open on parse errors. Never block on hook bugs.
 */

"use strict";
const mcEnv = require("./lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const path = require("path");

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();

// Kill switch
if (mcEnv.readEnv("DISPATCH_ROUTE_GUARD") === "off") process.exit(0);

function block(reason) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent("block", "system", "dispatch-route-guard", "", reason);
  } catch {
    /* logger optional */
  }
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

function probeBypass(cmd) {
  // Honour one-shot bypass for provider-health probes. The probe path sets
  // WARPOS_PROVIDER_PROBE=1 in the harness env before launching the Bash
  // tool call. We log the bypass for audit.
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
      /* skip */
    }
    return true;
  }
  return false;
}

// --- Pattern matchers -----------------------------------------------------

// Allow when a `<provider>` token is followed by one of these "harmless" flags
// or subcommands rather than a `-p` prompt invocation.
const SAFE_PROVIDER_TAILS =
  /^\s*(?:--version|--help|-h|-v|models?\b|auth\b|whoami\b|config\b|login\b|logout\b|completion\b)\b/;

function hasCanonicalDispatchPrefix(cmd) {
  // Accept `node scripts/dispatch-agent.js`, `node "…/dispatch-agent.js"`,
  // `node ${CLAUDE_PROJECT_DIR}/scripts/dispatch-agent.js`, and the Claude-role
  // bounded sibling dispatch-claude.js (RI-004/ED-018). The wrapper must be the
  // LEADING command of the segment (after optional `VAR=val` env prefixes) — NOT
  // merely appear somewhere — else `codex exec foo node …/dispatch-agent.js`
  // would exempt the whole segment while `codex` is the real command (reviewer-HIGH).
  return /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*node\s+["'`]?\S*dispatch-(?:agent|claude)\.js\b/.test(
    cmd,
  );
}

function isClaudeAgentInvocation(slice) {
  // `claude -p … --agent <role>` is the documented fallback path used by
  // Gamma/Delta. Allow when `--agent` is present *anywhere* after `-p`.
  return /\bclaude\s+-p\b[\s\S]*\B--agent\b/.test(slice);
}

// RI-004 / ED-018: build-chain Claude roles silently reap under raw `claude -p`
// (the harness auto-backgrounds the long call → 0 bytes, no completion record,
// exit code lost). These MUST go through the bounded wrapper
// `scripts/dispatch-claude.js`, which converts a reap into a death record +
// non-zero exit. Non-build Claude roles (test-runner, visual-review) keep the
// raw fallback — reap-detection is less load-bearing there.
// v0.2 consumer rewire (Tier 1): derive the build-chain set from the role-registry
// keystone (build_chain:true) and UNION the scrapped aliases {builder,fixer} the
// guard must still block in raw `claude --agent <role>` invocations (β TRAP-B). The
// require is GUARDED and deriveOrFallback warns loudly: this is a fail-open hook, so
// a broken registry read must fall back to the literal, never crash. The derived set
// deep-equals the prior literal (CUT-SAFETY verified before the cut).
let registryRoles = null;
try {
  registryRoles = require("../dispatch/registry-roles");
} catch {
  /* fail-open: BUILD_CHAIN_ROLES falls back to its literal below */
}
// S-7: normalize a legacy role id (stub-scaffold → skeleton-builder, etc.) before
// the build-chain gate so a raw `claude -p --agent <legacy-id>` can't bypass the
// guard once the registry-derived set carries only the NEW canonical name. Guarded
// + identity-fallback — this is a fail-open hook; a broken alias module must never
// crash it. (Memory: rename-cutover-covers-both-layers — the IMPERATIVE gate must
// repoint too, not just the role↔spec bijection.)
let normalizeRole = (r) => r;
try {
  ({ normalizeRole } = require("./lib/role-aliases"));
} catch {
  /* fail-open: identity normalize (legacy-id gating degrades, never crashes) */
}
const BUILD_CHAIN_ROLES_LITERAL = [
  "builder",
  "backend-builder",
  "frontend-builder",
  "fixer",
  "skeleton-builder", // S-7: was `stub-scaffold` (build_chain tool, re-homed to engineering)
  "stub-scaffold", // S-7 legacy id — keep blocked so a raw dispatch by the old name can't bypass the guard
  // ADR-0007 per-pod split (now derived from role-registry.json build_chain:true):
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

// N5 (W2): cross-provider REVIEW roles dispatched raw via `claude -p --agent <reviewer>` are
// RECORDLESS — the harness reaps the long call with NO completion record, so gauntlet-verify
// can't see the review lane (the RI-004/ED-018 wound the build-chain block closes, on the review
// side). A review role's sanctioned Claude FALLBACK is the RECORDED W1 lane
// `dispatch-claude.js <role> … --review-fallback` (T-305). So a raw `claude -p --agent
// <cross-provider-reviewer>` is refused + pointed at that recorded lane. Derived from the registry
// (kind:reviewer + NOT claude_pinned = the cross-provider reviewers with a fallback lane;
// design-quality/visual-review are claude-pinned and intentionally EXCLUDED — they keep the raw
// path) UNION the scrapped legacy ids, with a LOUD literal fallback (fail-open hook).
// SCOPE NOTE: only the CURRENT cross-provider review-role ids are hard-blocked here. The SCRAPPED
// legacy ids (reviewer/redteam/compliance/qa) are intentionally NOT included — the existing
// findAdvisory layer (the $(cat bigfile) argv-overflow warning, memory:claude_fallback_stdin) is
// the soft guard for those legacy names; hard-blocking them here would double-cover and supersede a
// deliberate advisory feature. Current names = the ones actually dispatched post-ADR-0007 rename.
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

// Robust detector (reviewer-HIGH hardening): match a RAW `claude` prompt
// invocation that targets a build-chain role, in ANY flag order and with either
// `--agent <role>` or `--agent=<role>`. The bounded wrapper
// (`node scripts/dispatch-claude.js …`) takes the role POSITIONALLY and never
// emits `claude` + `-p` + `--agent`, so this cannot false-match the wrapper —
// which is why it's safe to run even when a `dispatch-claude.js` substring
// appears elsewhere in a compound command (closes the segment-exemption bypass).
// Quote-aware shell-word tokenizer: split on UNQUOTED whitespace, returning each
// word with its surrounding quotes removed. A quoted blob like `"--agent builder"`
// becomes ONE token (`--agent builder`), so it is NOT mistaken for an `--agent`
// flag followed by a role (reviewer round-5 false-RED fix).
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

// The role of the first REAL `--agent` flag (a standalone `--agent` token whose
// next word is the role, or `--agent=<role>`). Quote-aware via shellWords, so a
// quoted `"--agent builder"` arg to some OTHER flag is skipped.
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

// COMMAND-POSITION-AWARE raw `claude -p --agent <role>` detection (N5 gauntlet rounds 1-2 fixes).
// shellWords tokenizes with quotes STRIPPED, so a quoted-but-EXECUTING token (`"claude"` / `"-p"`)
// is caught while a quoted LITERAL BLOB stays ONE token. CRITICALLY, `claude` must be at a COMMAND
// POSITION — the first token of the segment OR the first token after a `|` pipe — so a separately-
// quoted literal passed to ANOTHER program (`printf "claude" "-p" "--agent" "x"`) is NOT a false-
// positive (round-2 MED). Tolerates a PATH-qualified executable (`/usr/local/bin/claude`,
// `claude.exe`, `C:\Tools\claude.exe` — round-2 HIGH-1) and BACKSLASH-escaped tokens (`c\laude`,
// `-\p` — round-2 HIGH-2) by collapsing `\` before comparing. Returns EVERY --agent role (multi-flag
// last-wins safe). NOTE: this is a best-effort dispatch-INTEGRITY guard (it stops the team's own
// tooling from ACCIDENTAL recordless dispatch), NOT a security boundary — exotic obfuscation
// (base64, eval, var-expansion) is out of scope by design.
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
  // Walk each `|`-delimited command within the segment (segments are already split on ;/&&/||/& by
  // splitSegments). A command at a command position whose head is `claude` + carries `-p` is a raw
  // claude prompt dispatch; collect its --agent roles.
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
  // S-7: normalize legacy ids (stub-scaffold → skeleton-builder) before the gate. Any of the
  // command's --agent roles resolving to a build-chain role blocks it (multi-flag evasion safe).
  const hit = rawClaudeAgentRoles(cmd).find((r) => BUILD_CHAIN_ROLES.has(normalizeRole(r)));
  return hit || null;
}

// N5: a raw `claude -p --agent <cross-provider-review-role>` — the recordless review path that
// must instead use the RECORDED `--review-fallback` lane. Same quote-aware detection as the
// build-chain block; only the role SET differs (REVIEW_ROLES, not BUILD).
function rawReviewClaudeRole(cmd, _scan) {
  // RAW match (deliberately NOT normalizeRole) — match only the CURRENT cross-provider review-role
  // names. normalizeRole would collapse legacy ids (qa→qa-reviewer, redteam→security-reviewer) into
  // the set and double-cover the findAdvisory layer that already guards those scrapped names. The
  // residual (a legacy-name raw dispatch slips past this hard block) is low-risk — the names are
  // scrapped, and findAdvisory still warns on the argv form. (Build-chain normalizes because it has
  // no parallel advisory layer; review does, so it stays raw.)
  const hit = rawClaudeAgentRoles(cmd).find((r) => REVIEW_ROLES.has(r));
  return hit || null;
}

/**
 * Walk the command string and find the first forbidden pattern. Returns null
 * when the command is safe.
 */
// QUOTE-AWARE segment splitter (reviewer-MEDIUM): split on UNQUOTED shell
// sequencing operators `;`, `&&`, `||`, `&` (background), and newline. A `;`
// inside a quoted argument is NOT a separator (so we don't false-RED a benign
// `--arg "foo; codex exec bar"`). Single pipes `|` are kept WITHIN a segment so
// the pipe-into-provider check still sees `cat f | codex`.
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
      // background operator (single &) — split; `&&` already handled above.
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
  // Segment-aware so the canonical-prefix exemption applies ONLY to the wrapper's
  // OWN segment — not to a piggy-backed raw provider call in the same compound
  // command (`node dispatch-claude.js …; codex exec …` / `… & codex …`).
  for (const seg of splitSegments(String(rawCmd))) {
    const hit = findForbiddenSegment(seg);
    if (hit) return hit;
  }
  return null;
}

// Drop quoted spans ('...', "...", `...`) so a forbidden substring that is just a
// LITERAL STRING ARGUMENT (e.g. a commit message `'fix: codex exec bug'` or
// `--arg "foo; codex exec bar"`) is not mistaken for an actual command. The real
// provider command tokens (`codex exec`, `claude -p --agent builder`) are always
// UNQUOTED, so this removes false-REDs without weakening real detection.
// (Residual: a `$(provider …)` command-substitution INSIDE double quotes does
// execute in bash but is dropped here — an exotic form no orchestrator emits;
// logged as enforcement-debt, out of this guardrail's drift-prevention scope.)
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
  // Match against the quote-stripped skeleton so literal-string args don't false-RED.
  const scan = stripQuoted(cmd);

  // RI-004 / ED-018 — checked BEFORE the canonical-prefix exemption: a raw
  // build-chain claude dispatch is forbidden even inside a compound command
  // (`node dispatch-claude.js …; claude -p --agent builder …`). The wrapper
  // never emits `claude -p --agent`, so this can't false-block it.
  const rawBuildRole = rawBuildChainClaudeRole(cmd, scan);
  if (rawBuildRole) {
    return {
      pattern: `claude -p --agent ${rawBuildRole}`,
      detail:
        "build-chain Claude roles silently REAP under raw `claude -p` (the harness auto-backgrounds the long call → 0 bytes, no completion record, exit code lost: RI-004/ED-018).",
      use: `node scripts/dispatch-claude.js ${rawBuildRole} <prompt-file> --model <m> -w`,
    };
  }

  // N5 (W2): a raw `claude -p --agent <cross-provider-reviewer>` is RECORDLESS (the same reap, on
  // the review side). The sanctioned Claude fallback for a review role is the RECORDED W1 lane.
  const rawReviewRole = rawReviewClaudeRole(cmd, scan);
  if (rawReviewRole) {
    return {
      pattern: `claude -p --agent ${rawReviewRole}`,
      detail:
        "raw `claude -p --agent <reviewer>` is RECORDLESS — the harness reaps the long call with no completion record, so gauntlet-verify can't see the review lane (N5/W2). A review role's sanctioned Claude fallback is the RECORDED `--review-fallback` lane (T-305).",
      use: `node scripts/dispatch-claude.js ${rawReviewRole} <prompt-file> --review-fallback`,
    };
  }

  // Pipe-into-provider: `cat foo.txt | codex exec …` / `… | gemini -p` etc.
  // Checked BEFORE the canonical exemption so a wrapper invocation that pipes its
  // result INTO a raw provider (`node dispatch-claude.js … | codex exec`) is still
  // caught (reviewer-HIGH). The pipe alone isn't forbidden — piping codex *output*
  // to grep is fine — we forbid piping INTO codex/gemini/claude prompt mode.
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

  // Bare `codex exec` not in dispatch-agent.
  if (/\bcodex\s+exec\b/.test(scan)) {
    return {
      pattern: "codex exec …",
      detail:
        "codex exec must go through node scripts/dispatch-agent.js so the Windows-stdin + concurrency-lock layer applies",
    };
  }

  // `gemini … -p` (prompt invocation). Allow when next arg after gemini is a
  // safe tail.
  const geminiMatch = scan.match(/\bgemini\b\s*([\s\S]*)$/);
  if (geminiMatch) {
    const tail = geminiMatch[1];
    if (SAFE_PROVIDER_TAILS.test(tail)) {
      // safe form — version/help/etc.
    } else if (/(?:^|\s)-p\b/.test(tail)) {
      return {
        pattern: "gemini … -p …",
        detail:
          "gemini prompt invocations must go through node scripts/dispatch-agent.js",
      };
    }
  }

  // `claude -p` — only forbidden when not the documented `--agent <role>`
  // fallback form.
  const claudeMatch = scan.match(/\bclaude\s+-p\b[\s\S]*$/);
  if (claudeMatch) {
    const slice = claudeMatch[0];
    if (!isClaudeAgentInvocation(slice)) {
      // Allow `claude -p --help` etc.
      if (!SAFE_PROVIDER_TAILS.test(slice.replace(/^\s*claude\s+-p\s*/, ""))) {
        return {
          pattern: "claude -p …",
          detail:
            "raw `claude -p` prompt invocation is forbidden; use `claude -p --agent <role>` (documented fallback) or node scripts/dispatch-agent.js",
        };
      }
    }
    // A `claude -p --agent <role>` for a BUILD-CHAIN role was already caught by
    // rawBuildChainClaudeRole, and a CROSS-PROVIDER REVIEW role by rawReviewClaudeRole
    // (N5), both above. The remaining --agent roles — general-purpose (dispatch-skill),
    // claude-pinned judges (design-quality/visual-review), research/consult — fall
    // through → allowed (no recorded-fallback lane to redirect them to).
  }

  return null;
}

/**
 * Detects the sanctioned `--review-fallback` lane (T-305 G2):
 *   node scripts/dispatch-claude.js <review-role> <prompt> [args] --review-fallback
 *
 * This is the BLESSED fallback path for cross-provider review roles when their
 * normal provider (openai/gemini) is quota-exhausted. dispatch-claude.js handles
 * the actual routing; this detector lets the route-guard explicitly RECOGNIZE the
 * lane (rather than it falling through silently via the canonical-prefix allowance).
 *
 * Key properties:
 *   - Writes a LEDGERED ok:true completion record (fallback:true + provider:claude +
 *     quota_fallback_from) so gauntlet-verify SEES it and coverage-gate TRIPS the
 *     cross_provider_required debt VISIBLY. Honest debt, never silent green.
 *   - No -w required (review roles are READ-ONLY — they don't write code).
 *   - dispatch-claude.js REFUSES --review-fallback for build-chain roles (they still
 *     require -w/--worktree isolation). This detector does NOT enforce that — it
 *     merely names the recognized pattern; the dispatch enforces the role guard.
 *
 * Returns true when the command is the sanctioned review-fallback route, else false.
 */
function isReviewFallbackRoute(rawCmd) {
  const cmd = String(rawCmd || "").replace(/\r?\n/g, " ").trim();
  if (!cmd) return false;
  const scan = stripQuoted(cmd);
  // Must be a dispatch-claude.js invocation (the Claude-role bounded wrapper).
  // The canonical-prefix regex matches both dispatch-agent.js and dispatch-claude.js;
  // we narrow to dispatch-claude.js specifically.
  if (
    !/^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*node\s+["'`]?\S*dispatch-claude\.js\b/.test(scan)
  ) return false;
  // Must include the --review-fallback flag (unquoted — a quoted --review-fallback
  // would not be passed as a real flag to node, so we match unquoted only).
  if (!/\B--review-fallback\b/.test(scan)) return false;
  return true;
}

/**
 * Non-blocking advisory: a `claude -p … --agent <role>` invocation whose prompt
 * is inlined as a command-substitution argv (`"$(cat file)"` / backtick-cat)
 * rather than piped via stdin (`< file`). The inlined form works for small
 * prompts but blows the OS arg-length limit ("Argument list too long", exit
 * 126) for the large diff-bearing reviewer/security-reviewer (legacy: redteam)
 * fallback prompts the orchestrators build (observed twice at 41KB+ in
 * SP-20260525-004). This is
 * NOT forbidden — small prompts are fine — so we WARN, not block, and surface
 * the stdin form. Returns null when no advisory applies.
 */
function findAdvisory(rawCmd) {
  const cmd = rawCmd.replace(/\r?\n/g, " ").trim();
  if (!cmd) return null;
  // Only relevant to the documented claude --agent fallback path.
  if (!isClaudeAgentInvocation(cmd)) return null;
  // Already piping via a stdin redirect somewhere in the command → safe form.
  if (/<\s*\S/.test(cmd)) return null;
  // Prompt supplied via command substitution that inlines a file's contents:
  //   "$(cat file)"  |  $(cat file)  |  `cat file`  (cat/type/Get-Content)
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

// --- ED-021: heavy-skill lean-return advisory (Agent tool) ----------------
//
// The §2.5 build-chain gate above BLOCKS heavy CODE workers from running
// in-process. ED-021 is the sibling for heavy AGGREGATE / VERIFY / RESEARCH
// skills: `/scan:full` (~30-scan roll-up), `/research:deep`, `/redteam:full`,
// `/qa:audit`, and big multi-source synthesis. Run in the orchestrator's own
// subprocess, they pull tens of thousands of tokens of sub-output into the
// orchestrator's context — the "context limits too soon" leak the operator
// flagged (memory: feedback-orchestrator-holds-envelopes-not-content). The fix
// is to DISPATCH them to a lean-return sub-agent that writes its full output to a
// file and returns ONE short verdict envelope.
//
// This is a CONTRACT, not a hard safety gate (the build-chain reap-risk is), and
// the guard can only see the dispatch prompt — not the eventual return shape — so
// it WARNS (non-blocking `additionalContext`), exactly like findAdvisory's
// argv-overflow warning. It fires when an Agent dispatch's prompt invokes a heavy
// skill but does NOT request a lean / envelope / write-file-then-summarize return.
const HEAVY_SKILLS = [
  "scan:full",
  "research:deep",
  "redteam:full",
  "qa:audit",
];
// A heavy-skill invocation in the prompt: `/scan:full`, `scan:full`, or a bare
// `node scripts/checks/full…`-style aggregate run named by the skill token.
const HEAVY_SKILL_RE = new RegExp(
  `(?:^|\\s|/)(${HEAVY_SKILLS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "i",
);
// The prompt already asks for a lean / bounded / envelope return → contract met.
const LEAN_RETURN_RE =
  /lean[\s-]?return|return\s+(?:only\s+)?(?:a\s+|one\s+)?(?:lean\s+|short\s+|≤?\s*\d+[\s-]?line\s+)?(?:verdict\s+)?envelope|envelope[\s-]?(?:only|return)|write\b[\s\S]{0,80}?\b(?:file|to\s+disk)[\s\S]{0,80}?\breturn\b|return[\s\S]{0,60}?\b(?:≤|<=|under|at most|no more than)\s*\d+\s*lines?\b|do(?:\s+not|n't)\s+(?:return|dump|paste)\s+(?:the\s+)?full\b|don't\s+aggregate[\s\S]{0,40}?context/i;

/**
 * Non-blocking advisory for ED-021. Given an Agent dispatch's prompt text, returns
 * an advisory when it runs a heavy aggregate/verify skill WITHOUT a lean-return
 * request, else null. Pure + exported so the bite-test fires each branch.
 */
function findHeavySkillAdvisory(promptText) {
  const text = String(promptText || "");
  if (!text.trim()) return null;
  const m = HEAVY_SKILL_RE.exec(text);
  if (!m) return null;
  if (LEAN_RETURN_RE.test(text)) return null; // contract already satisfied
  const skill = m[1].toLowerCase();
  return {
    advisory: `heavy-skill in-orchestrator dispatch without lean-return (${skill})`,
    skill,
    detail:
      `[dispatch-route-guard] ED-021: this Agent dispatch runs the heavy aggregate/verify skill '/${skill}' but the prompt does not request a LEAN RETURN. ` +
      `Heavy skills (/scan:full, /research:deep, /redteam:full, /qa:audit, big synthesis) pull tens of thousands of tokens of sub-output into the orchestrator's context when their full result is returned. ` +
      `Instruct the sub-agent to WRITE its full output to a file and RETURN ONE short verdict envelope (e.g. "≤8 lines: PASS/FAIL + counts + the file path") — do NOT return the full aggregation. ` +
      `This is a context-hygiene contract (a warning, not a block).`,
  };
}

// --- Hook plumbing --------------------------------------------------------

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);

    // ADR-0007 §2.5 — Agent-tool build-chain gate (the named enforcer for the
    // context-lever). The in-process Agent tool dumps the full sub-agent response
    // (50-100K tokens) into the ORCHESTRATOR's context AND lacks the bounded
    // wrapper's reap-safety. Build-chain workers (builders/fixers/skeleton-builder)
    // MUST dispatch via `node scripts/dispatch-claude.js`. Closes the §2 rule-5
    // gap (only the raw-CLI bypass was gated before). Spec/doc authoring via
    // general-purpose is fine; a Lead fanning out its OWN sub-reviewers inside its
    // subprocess is exempt — this binds the TOP-level dispatch of heavy workers.
    if (event.tool_name === "Agent") {
      if (event.tool_response !== undefined) process.exit(0); // PostToolUse skip
      const sub = String((event.tool_input || {}).subagent_type || "")
        .trim()
        .toLowerCase();
      // S-7: normalize legacy ids (stub-scaffold → skeleton-builder) before the gate.
      if (BUILD_CHAIN_ROLES.has(normalizeRole(sub))) {
        block(
          [
            "[dispatch-route-guard] In-process Agent dispatch of a build-chain role is forbidden.",
            `Role: ${sub}`,
            "",
            `Use:  node scripts/dispatch-claude.js ${sub} <prompt-file> -w`,
            "Why:  the Agent tool dumps the full sub-agent response (50-100K tokens) into the",
            "      orchestrator's context (the §2.5 context-lever) AND lacks the wrapper's",
            "      reap-safety (RI-004). Spec/doc authoring via general-purpose is fine — this",
            "      binds heavy build-chain CODE workers. A Lead's own sub-reviewer fan-out is exempt.",
          ].join("\n"),
        );
      }
      // ED-021 — heavy aggregate/verify skill run in-orchestrator without a
      // lean-return request. Non-blocking advisory (context-hygiene contract),
      // mirroring the Bash argv-overflow advisory below.
      const prompt = String((event.tool_input || {}).prompt || "");
      const heavyAdv = findHeavySkillAdvisory(prompt);
      if (heavyAdv) {
        try {
          const { logEvent } = require("./lib/logger");
          logEvent("warn", "system", "dispatch-route-guard", "", heavyAdv.advisory);
        } catch {
          /* logger optional */
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
    if (event.tool_response !== undefined) process.exit(0); // PostToolUse skip
    const cmd = ((event.tool_input || {}).command || "").trim();
    if (!cmd) process.exit(0);

    if (probeBypass(cmd)) process.exit(0);

    const hit = findForbidden(cmd);
    if (!hit) {
      // Non-blocking advisory: inlined-argv prompt that will overflow arg-length
      // for large fallback prompts. Surface the stdin form; do not block.
      const adv = findAdvisory(cmd);
      if (adv) {
        try {
          const { logEvent } = require("./lib/logger");
          logEvent("warn", "system", "dispatch-route-guard", "", adv.advisory);
        } catch {
          /* logger optional */
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
          ? "      the wrapper bounds the call + writes a death record + non-zero exit (RI-004/ED-018)."
          : "      (LRN-2026-04-17 Windows-stdin; LRN-2026-04-30 binding-gap).",
        "",
        "One-shot bypass for an approved provider-health probe:",
        "  PowerShell: $env:WARPOS_PROVIDER_PROBE = '1'; <command>; Remove-Item Env:WARPOS_PROVIDER_PROBE",
        "  bash:       WARPOS_PROVIDER_PROBE=1 <command>   (note: bash-inline env",
        "              may not propagate to PreToolUse hooks; prefer harness env)",
        "",
        `Full rules: ${guidePathHint} (paths.agentDispatchGuide).`,
      ].join("\n"),
    );
  } catch {
    // Fail-open on hook bugs / malformed JSON.
    process.exit(0);
  }
});

module.exports = { findForbidden, findAdvisory, findHeavySkillAdvisory, HEAVY_SKILLS, isReviewFallbackRoute };
