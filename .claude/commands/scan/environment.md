---
description: Environment readiness and tooling quality — fast go/no-go or deep audit
---

# /scan:environment — Environment & Tooling Health

Single owner for "Can we build and run?" Verifies prerequisites, hooks, build commands, config, and tooling quality. Pairs with `/scan:architecture` (which verifies _docs/agents).

## Input

`$ARGUMENTS` — Mode selection:
- No args or `ready` — Binary go/no-go readiness check (fast, runs commands)
- `audit` — Deep tooling quality audit (thorough, reads everything)
- `hooks` / `skills` / `scripts` / `configs` — Audit sub-focus
- `--json` — raw JSON output

---

## Files to read (all modes)

- `.claude/paths.json`
- `.claude/manifest.json` (specifically `buildCommands`, `source_dirs`, `requiredEnvKeys` if present)
- `.claude/settings.json`
- `package.json` (if Node project) — scripts, dependencies
- `tsconfig.json` (if TS) — strict mode, paths
- `.gitignore`

---

## Mode: ready — Environment Readiness

Spawn a general-purpose agent (runs commands). Focus: **is everything ready to go?**

### Prerequisites

- **E1 Node version** — `node --version` → ≥ 18.x. ERROR if older.
- **E2 Git available** — `git --version`. ERROR if missing.
- **E3 Claude Code environment** — `$CLAUDE_PROJECT_DIR` set (or verifiable via process env)
- **E4 Working directory is a git repo** — `.git/` exists. WARN if missing (some features degrade).

### Project install

- **E5 Node modules installed** — `node_modules/.package-lock.json` exists (if Node). ERROR if `package.json` exists without `node_modules`.
- **E6 Build passes** — resolve `manifest.buildCommands.build` → run → non-zero exit is ERROR. SKIP if no build command.
- **E7 Typecheck passes** — if `typescript` is a dep, `npx tsc --noEmit`. ERROR on output.
- **E8 Lint passes** — resolve `manifest.buildCommands.lint` → run. WARN on output.
- **E9 Kill stale dev servers** — `npx kill-port 3000 2>/dev/null || true` (cleanup; never fails).

### MC wiring

- **E10 paths.json present and valid** — parse check; report version
- **E11 manifest.json present and valid** — parse check; required keys: `project.name`, `mc.version`, `agents.team.name`
- **E12 store.json present and valid** — if oneshot mode may be used; optional otherwise
- **E13 All hook scripts exist** — every hook command in `settings.json` resolves to a file in `paths.hooks`
- **E14 Hook lib present** — `scripts/hooks/lib/paths.js`, `logger.js`, `context-sources.js`, `project-config.js` all present
- **E15 Event log writable** — `paths.events/events.jsonl` is writable (try appendFileSync of an empty string)
- **E16 Memory stores writable** — same for `learnings.jsonl`, `traces.jsonl`, `systems.jsonl`
- **E17 Runtime dir writable** — `paths.runtime` writable

### Environment variables

- **E18 ANTHROPIC_API_KEY** — required for smart-context (prompt enhancement). WARN if missing, but smart-context fail-opens.
- **E19 Additional keys** — read `manifest.requiredEnvKeys` if present; check each. ERROR on missing required.

### Git hygiene

- **E20 Clean tree or known state** — `git status --short` reported
- **E21 Current branch not main** — WARN if editing on main/master
- **E22 Remote reachable** — `git ls-remote origin HEAD` success. WARN if offline.
- **E23 Stale worktrees** — `git worktree list` — flag any pointing to missing paths
- **E24 .gitignore has runtime entries** — `.claude/runtime/`, `.claude/project/events/`, `.claude/project/memory/`, `.claude/agents/**/events.jsonl` — ERROR if any missing

### Cross-provider CLIs (required by review/security agents)

Read `manifest.agentProviders` to determine which providers this project uses. For each non-Claude provider, the corresponding CLI must be present — without it, the agent dispatches fall back to Claude (degrades model diversity).

- **E25 Codex (OpenAI) CLI** — `codex --version`. Required iff any role in `manifest.agentProviders` maps to `"openai"`. By default: `evaluator`, `compliance`, `qa`, `auditor`. If configured-but-missing → ERROR; if no openai roles configured → skip.
  - Install: `npm i -g @openai/codex`
  - Auth: set `OPENAI_API_KEY` env var or run `codex login`
- **E26 Gemini CLI** — `gemini --version`. Required iff any role maps to `"gemini"`. By default: `redteam`. If configured-but-missing → ERROR; if no gemini roles configured → skip.
  - Install: `npm i -g @google/gemini-cli`
  - Auth: set `GEMINI_API_KEY` env var OR run `gemini auth login` (OAuth → `~/.gemini/oauth_creds.json`)
- **E27 Provider config in store** — verify `paths.store.providers` (if present) has matching entries for every provider referenced in `manifest.agentProviders`.
- **E28 Provider fallback chain** — every non-Claude provider in `manifest.providers` must declare a `fallback`. If any is missing → WARN (loss of fallback safety).
- **E28.5 Provider tier readiness (report-only)** — run `node scripts/mc/provider-tier-check.js --json`. This layers a **T1/T2/T3 tier grade** over the health stack (T1 = CLI+auth reachable · T2 = funded/keyed for paid models · T3 = subscription floor met) — **value-free** (reads only key NAMEs, never values) and **report-only**. Surface each provider's `verdict` (`tier_met` / `tier_short` / `unknown-self-attested`) and the `t3_floor` (operator-tunable, default `max_5x`). Severity: **INFO** — never blocks (the check itself exits 0; T3 funding/subscription is undetectable value-free, so an unmet T3 reports `unknown-self-attested`, not an error). To raise a provider's selected tier the operator runs the confirm-class `node scripts/mc/provider-tier-check.js --set-tier <provider> <t1|t2|t3> --sub <subscription>`. Rationale: S-LC-10 — health checks reachability but not tier; this surfaces whether each provider meets the selected funding/subscription floor without spending a token.

### Platform

- **E29 Platform note** — if `process.platform !== 'win32'`, WARN (MC MVP is Windows-only; features may degrade)
- **E30 paths.json directory resolution** — parse `.claude/paths.json`. For each key whose value is a directory path (no `.` extension): verify the directory exists. Flag any missing path as ERROR: "`paths.X` → \"<path>\" does not exist. Either create the dir or remove the key." Severity: ERROR.
- **E31 Mode-aware team-mode hook deployed** — `scripts/hooks/smart-context.js` (the active UserPromptSubmit hook that emits `TEAM MODE ACTIVE` / `ONESHOT MODE ACTIVE`) MUST branch on `store.heartbeat.agent` or `.claude/runtime/mode.json`, not unconditionally emit `TEAM MODE ACTIVE`. Grep the active hook for `heartbeat.agent` or `mode.json`; if neither reference appears, flag as ERROR: "team-mode hook fires during oneshot — Delta will get directed to consult Beta who is not active." Severity: ERROR.
- **E32 prompt-validator scopes by subagent_type** — `scripts/hooks/prompt-validator.js` MUST read `event.tool_input.subagent_type` as the primary role signal, with `detectRole(prompt)` only as a fallback. Grep the file for `subagent_type`; if absent or only referenced after `detectRole`, flag as ERROR. Rationale: L3 run-09 — fixer dispatch with a `feature:` prefix got HARD-BLOCKED because validator inferred "builder" role from prompt text. Severity: ERROR.
- **E33 oneshot --gut auto-resets store.features** — `.claude/commands/oneshot/preflight.md` (Pass 7 --gut branch) MUST, after gutting code, set every `store.features[<name>].status` back to `"not_started"`. Grep the file for `not_started` within 50 lines of `--gut` or `gutted`; if absent, flag as ERROR: "--gut skipped the store reset — Pass 5.7 WARN-passed on stale 'done' markers in run 08." Severity: ERROR.
- **E34 no hardcoded oneshot store paths in scripts** — `scripts/**/*.js` and `scripts/hooks/**/*.js` MUST NOT hardcode `.claude/agents/store.json` when reading feature/runLog state. That path is a foundation-edit heartbeat marker (296B), not the oneshot build state (67KB at `president/_system/oneshot/store.json`). Grep via `grep -rnE '.claude/agents/store.json"' scripts/`; flag any match as ERROR unless the file is explicitly about the heartbeat marker (`foundation-guard.js` is exempt). Rationale: run-9 validate-gates.js + gauntlet-gate.js both silently mis-read this path, breaking phase advance gating mid-run. Severity: ERROR.
- **E35 maps freshness** — the `.claude/project/maps/.stale.json` file tracks which auto-generated maps are out of sync with current reality. Read it. If any of (skills, tools, hooks, enforcements, memory, systems, architecture) is older than 24h OR is flagged stale, surface as INFO (don't block — maps are diagnostics, not gates). Recommend: run `/maps:all` to regenerate. If `paths.maps/` is missing entirely, flag as WARN (degraded observability — `/discover:systems` and other introspection skills will show outdated state). Rationale: L15 run-10-prep — system state reminders persistently surfaced "Stale maps: skills, tools, hooks, enforcements, memory" across multiple turns but no preflight check ever formalized "maps need regen before launch." Severity: INFO (WARN if paths.maps missing).

### Output

JSON array: `{ check, severity, file, message, autoFixable }`

Decision banner:
- `ENVIRONMENT READY` — 0 errors
- `ENVIRONMENT BLOCKED — N errors` — fix required before running any agent mode

---

## Mode: audit — Deep Tooling Quality

Spawn an Explore agent. Focus: **not just "does it work?" but "is it good?"**

### 1. Hook system

**Wiring:**
- Every hook in `settings.json` resolves to `paths.hooks/<file>`
- No orphan scripts (on disk but not registered)
- Event names valid (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostCompact, Stop, SessionEnd, StopFailure, WorktreeCreate)
- Matcher syntax valid (Bash, Edit|Write, Agent, or empty)
- No duplicate registrations
- `settings.json` parses as JSON

**Quality per hook:**
- Reads from `scripts/hooks/lib/paths.js` (no hardcoded `.claude/` paths) — Windows path bug (RT-004) keeps recurring; this catches it
- Error handling: try/catch around JSON.parse, graceful exit
- Exit codes: `process.exit(0)` for skip/allow, block via `{ decision: "block" }` stdout
- Stdin parsing: handles empty input gracefully
- Imports PATHS from lib, doesn't reconstruct paths

**Performance:**
- Interactive hooks (PreToolUse, UserPromptSubmit) under 100ms — flag slow ones
- Hook timing total: sum of average runtimes across a typical session

**Coverage gaps:**
- Are there HYGIENE rules in learnings that have no hook enforcement?
- Secret-guard: current pattern list vs. known secret formats (API keys, tokens, private keys)
- Is there coverage for every Edit|Write event we care about?

**Resilience:**
- Hooks handle missing files gracefully (no manifest.json → don't crash)
- Hooks handle missing env vars gracefully
- Hooks don't hang indefinitely

### 2. Skill ecosystem

**Frontmatter health:**
- Every skill has `description` field (required — shown in autocomplete)
- Optional fields (`name`, `user-invocable`, `depends-on`) used consistently
- No duplicate skill names across namespaces

**Overlap detection:**
- Skills doing similar work → flag for merge consideration
- Skills that should call each other but don't
- Naming conflicts or ambiguous boundaries

**Health:**
- No dead references to deleted skills (check with `/scan:references`)
- No stale file/path references (same)
- Instructions are actionable — vague ones flagged

### 3. Lint & build scripts

- `scripts/lint-*.js` (or equivalents) functional (if present)
- Every `npm run` script in package.json works (if no reason not to)
- Scripts have consistent error handling
- `.md` lint coverage — are requirement templates linted?

### 4. Build & config

**TypeScript:** strict mode, noImplicitAny, correct paths
**Framework:** sensible defaults, security headers (Next.js)
**Package:** unused deps, security-relevant versions
**Env:** `.env.local.example` matches `manifest.requiredEnvKeys`
**Testing:** if test config exists, harness functional

### 5. Cross-session infrastructure

- **Cross-session inbox** — last write/read times in events log indicate active use
- **Smart-context working** — `paths.logs/*/smart-context.log` has entries since last session start
- **Session tracking** — session-start/session-stop firing (entries in events log)
- **Handoff generation** — `paths.handoffLatest` exists and recent

### Output

```markdown
# Environment & Tooling Audit

## Summary
{counts by severity + area}

## Findings by Area
### Hook System
...
### Skills
...

## Priority Fixes
1. {Fix} — blocks: {what}
```

---

## When to run

- **Fresh install** — immediately after `warp-setup.js`, use `ready` mode
- **First session of the day** — `ready` mode (fast)
- **After system changes** (new hooks, renamed paths, updated manifest) — `ready` + affected audit sub-mode
- **Weekly / `/sleep:deep`** — full `audit` for drift
- **When `/warp:health` shows yellow** on environment items

## Related

- `/warp:health` — higher-level green/yellow/red rollup (consumes this skill's output)
- `/scan:architecture` — verifies docs + agents (this verifies runtime)
- `/hooks:test` — synthetic payload testing for every hook
- `/maps:enforcements` — regenerate hook coverage map
