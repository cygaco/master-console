---
description: Tool registry — skills, hooks, external CLIs, API services, npm scripts, platform tools
---

# /maps:tools — Tool Registry

Unified inventory of everything the system uses as a tool. Supports preflight dependency checks, cost tracking, health monitoring, and capability discovery.

## Input

`$ARGUMENTS` — optional flags:
- `--refresh` — re-scan all sources, rebuild `.claude/project/maps/tools.jsonl` + `.claude/project/maps/tools.md`
- `--health` — run health checks for all external CLIs and API services
- `--deps <skill>` — show dependency chain for a specific skill
- No flags: render from existing map (or build if none exists)

## Procedure

### Step 1: Check state

If `.claude/project/maps/tools.jsonl` exists and `--refresh` not passed → skip to Step 5 (render).
Otherwise → Step 2 (build).

### Step 2: Scan sources

**External CLIs** — check each for: install command, health check, required env vars, cost tier, which skills use it.
Known CLIs: gemini, codex, yt-dlp, puppeteer.

**API services** — extract from CLAUDE.md, .env.local, and skill bodies.
Known services: Claude API, OpenAI Deep Research, Gemini API, and the shipped app scaffold's Supabase, PostHog and Resend.

**npm scripts** — read `package.json` scripts section.

**Platform tools** — enumerate Claude Code built-in tools (Read, Edit, Write, Bash, Grep, Glob, Agent, WebSearch, WebFetch) and MCP tools.

**Skills** — read `.claude/project/maps/skills.jsonl`, create cross-ref entries with `external_deps` field.

**Hooks** — read `.claude/project/maps/hooks.jsonl`, create cross-ref entries.

### Step 3: Build `.claude/project/maps/tools.jsonl` + `.claude/project/maps/tools.md`

Write JSONL with `_meta` header, then entries grouped by category.
Write MD with: summary, external CLIs table, API services table, dependency matrix, env var checklist, cost summary.

### Step 4: Clear staleness

After writing output, clear the `tools` entry from `.claude/project/maps/.stale.json` if it exists.

### Step 5: Render / Health check

**Default render:** Show summary table by category with counts.

**`--health` mode:** For each external_cli and api_service with a `health_check` field:
1. Run the health check command
2. Report pass/fail with output
3. Check required env vars are set (don't show values)

**`--deps <skill>` mode:** Read the skill's entry, follow `external_deps` to show the full chain:
```
/research:deep
  ├── gemini-cli (requires: GEMINI_API_KEY) ✓
  ├── codex-cli (requires: OPENAI_API_KEY) ✓
  ├── openai-deep-research (requires: OPENAI_API_KEY, 200k TPM) ✓
  └── gemini-api (requires: GEMINI_API_KEY) ✓
```
