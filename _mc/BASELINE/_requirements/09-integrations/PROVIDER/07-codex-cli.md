# OpenAI Codex CLI — Compliance Reviews + Dispatch

**Sources:**
- https://developers.openai.com/codex/cli
- Project's `scripts/run-compliance.sh` and `scripts/hooks/lib/providers.js:55-115`

Last verified: 2026-04-28.

> See also: `02-openai.md` for the underlying model details (gpt-5.5 / gpt-5.4 / gpt-5.4-mini), reasoning effort levels, and pricing. This doc covers the **CLI as an integration surface** — invocation patterns, sandbox modes, project conventions.

## Install

```bash
npm i -g @openai/codex
```

Confirm: `codex --version`. Project tested with **0.117** (the stable line at writing).

## Subcommands

| Command | Use |
|---|---|
| `codex` | Interactive TUI session (not used in dispatch) |
| `codex exec` | Non-interactive scripted use — what the dispatcher calls |

## Where wired

| Site | File | Purpose |
|---|---|---|
| Compliance runner | `scripts/run-compliance.sh` | Per-feature compliance review; max 4 source files per call to stay under token budget |
| Dispatch provider config | `scripts/hooks/lib/providers.js:55-115` | DEFAULT_PROVIDERS.openai.syntax — generates the codex exec command for any agent role with `provider: openai` |
| Catalog | `scripts/dispatch/catalog.js` | Maps agent roles → providers (reviewer, compliance, learner currently route to codex) |
| Smoke tests | `scripts/delta-canonical-dispatch-smoke.js` | Verifies codex availability before oneshot runs |
| MC install | `scripts/warp-setup.js` | Prompts for codex install during setup |

## Standard invocation pattern

```bash
codex exec --full-auto -c model_reasoning_effort=<effort> -m <model> -
```

Pipe the prompt on stdin (the trailing `-`).

For compliance reviews:

```bash
codex exec --ephemeral -C src/ -s read-only -o "${OUTPUT}" "${PROMPT}"
```

| Flag | Purpose |
|---|---|
| `--full-auto` | Workspace-write sandbox + on-request approvals (required for non-TTY dispatch) |
| `--ephemeral` | No session accumulation — each call is independent (used by compliance to avoid AGENTS.md interference) |
| `-C <dir>` | Change to directory before running (avoids picking up project AGENTS.md) |
| `-s read-only` | Sandbox: read-only mode (compliance doesn't modify code) |
| `-m <model>` | Model selection (e.g., `gpt-5.5`) |
| `-c model_reasoning_effort=<level>` | Reasoning effort (`low | medium | high | xhigh`) |
| `-o <file>` | Output capture for non-TTY runs |
| `-` | Read prompt from stdin |

## Authentication

`OPENAI_API_KEY` env var, or `codex login` flow. The dispatcher relies on the calling shell having credentials.

## Project conventions

- **Compliance runs use codex** (not Claude or Gemini) because cross-tool diversity in the gauntlet catches blind spots. See `_requirements/03-architecture/AGENTIC_SYSTEM.md` (Gauntlet section).
- **One feature per call.** `scripts/run-compliance.sh` enforces max 4 files per invocation to stay under token budget. Batching multiple features causes PowerShell sandbox failures and token overload.
- **Default reviewer/compliance/learner model:** `gpt-5.5` with `reasoning_effort: xhigh` (per user 2026-04-26).
- **Default qa model:** `gpt-5.4-mini` with `reasoning_effort: medium` (mini for cost on high-volume).

## Known issues

- **gpt-5.5 + Codex CLI 0.117:** observed `model-requires-newer-version` error on some installations. If `node scripts/dispatch.js show` reports CLI rejections, fall back to `provider_fallback: anthropic` in agent frontmatter.
- **AGENTS.md interference:** Codex picks up project AGENTS.md by default. `-C src/` redirects the working dir so it doesn't load the repo-root AGENTS.md (which would conflict with our spec-driven flow). Compliance reviews always use this redirect.
- **Token budget:** compliance enforces max 4 files; the dispatcher enforces per-role context budgets via `scripts/dispatch/catalog.js`. Going over either gets early-killed.

## Retry policy

`scripts/run-compliance.sh` retries once with a 60-second backoff if the first call returns no output. Two failures total → script exits 1, the run logs `compliance: skipped-codex-failure`, gauntlet treats it as a soft fail (Lead can override).
