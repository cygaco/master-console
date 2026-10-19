# Agent Frontmatter Guide

Authoring reference for keys in the YAML frontmatter at the top of each `.claude/agents/**/*.md` file. The dispatch CLI (`node scripts/dispatch.js`, or `npm run dispatch`) reads and writes most of the dispatch keys here; everything else is hand-edited.

> Companion: `scripts/hooks/lib/providers.js:55-87` for runtime defaults.

## Quick start with the CLI

```bash
# View current resolved config for every role
npm run dispatch

# Cascade wizard — pick provider → model → effort interactively
npm run dispatch -- edit reviewer

# Non-interactive set
npm run dispatch -- set reviewer openai gpt-5.6-sol xhigh claude

# Backups + revert
npm run dispatch -- backups
npm run dispatch -- revert <backup-id>
```

There is **no admin URL or web panel** for this — config edits are CLI-only to keep zero attack surface and work without a running server.

## Anatomy

```yaml
---
name: reviewer
description: "Reviews builder output against spec AND holdout golden fixtures. Runs 6-check protocol. Produces ReviewResult JSON. Does NOT write code."
tools: Read, Grep, Glob, Bash
disallowedTools: Agent, Edit, Write
model: claude-opus-4-8
provider: openai
provider_model: gpt-5.6-sol
provider_fallback: claude
provider_reasoning_effort: xhigh
maxTurns: 40
color: yellow
---
```

## Required keys

### `name` (string)

The canonical agent identifier — the value the resolver and `Agent({subagent_type: <name>})` key on. ADR-0007: in the department tree the file is named by ROLE FUNCTION at the pod level (`.claude/agents/engineering/frontend/reviewer.md` → `name: frontend-reviewer`), so `name` need NOT match the file stem or parent dir — `name` is authoritative and the resolver (dispatch-agent.js / role-parity) matches by frontmatter `name:` first. Keep `name` unique across the whole tree.

### `description` (string)

Short prose describing what the agent does and when to spawn it. Shown in agent registry. Keep under 200 characters when possible.

## Tools / boundaries

### `tools` (string list)

Tools the agent is allowed to call. Common patterns:

```yaml
tools: Read, Grep, Glob, Bash, Edit, Write     # builder/fixer
tools: Read, Grep, Glob, Bash                  # reviewer/compliance (read-only)
tools: Agent, Bash, Read, Grep, Glob, Edit, Write   # gamma/delta (orchestrators)
```

### `disallowedTools` (string list)

Hard denylist that wins over `tools`. Used to prevent role drift:

```yaml
disallowedTools: Agent      # builders/fixers can't dispatch sub-agents
disallowedTools: Edit, Write  # reviewer/compliance can't write code
```

### `isolation` ("worktree" | omitted)

Forces the agent to operate in a separate `git worktree`. Required for builder/fixer to prevent main-repo writes during parallel runs.

```yaml
isolation: worktree
```

### `permissionMode`

Controls how the agent's tool calls are gated.

```yaml
permissionMode: acceptEdits   # auto-accept Edit/Write (used by builders in worktrees)
```

### `maxTurns` (number)

Hard cap on the agent's tool-call iterations. Stops runaway loops.

```yaml
maxTurns: 80   # builder
maxTurns: 40   # reviewer/compliance
maxTurns: 200  # delta (long-running orchestrator)
```

## Dispatch keys (panel-managed)

These keys collectively decide which provider/model/effort combination runs the agent. The `/admin/dispatches` panel writes them in lockstep with `.claude/manifest.json` to prevent drift.

### `model` (string)

Allowed values:

| Value | Meaning |
|---|---|
| ~~`inherit`~~ | **FORBIDDEN for registry-routed roles.** See note below. |
| `sonnet` | Alias → `claude-sonnet-4-6` |
| `opus` | Alias → `claude-opus-4-8` |
| `haiku` | Alias → `claude-haiku-4-5` |
| `claude-opus-4-8` | Explicit ID |
| `claude-sonnet-4-6` | Explicit ID |
| `claude-haiku-4-5-20251001` | Explicit ID with snapshot |

When `provider` is set to a non-Anthropic value, `model` is ignored for routing and `provider_model` is used instead; however the `model:` key still governs Agent-tool / claude-fallback spawns and MUST be set (see below).

> **`model: inherit` is FORBIDDEN for roles present in `role-registry.json`.**
> The registry is the single routing source of truth (ADR-0008). Frontmatter `model:` must be kept in sync with the registry entry:
>
> - **Claude roles** (`provider: claude` or absent): set `model:` to the registry's `model` value (e.g. `claude-opus-4-8`).
> - **Cross-provider roles** (`provider: openai` or `gemini`): the role is subprocess-dispatched; frontmatter `model:` only governs the Agent-tool / claude-fallback spawn path. Set it to the claude-fallback pin — `claude-opus-4-8` — not `inherit`.
>
> `inherit` silently causes the in-process Agent-tool spawn to inherit the caller's session model, bypassing registry routing. Enforcer: `scripts/checks/role-parity-scan.js` (model-pin check).

### `provider` (string, optional)

| Value | CLI tool | When to use |
|---|---|---|
| `anthropic` (or omit) | `claude` | Default — runs as Claude subagent |
| `openai` | `codex` | Cross-model review (reviewer/compliance/learner/qa) |
| `gemini` | `gemini` | Cognitive-diversity for adversarial work (redteam) |

Setting `provider` to anything other than `claude` triggers the dispatcher (`scripts/hooks/lib/providers.js:runProvider`) instead of the native Claude subagent path. The CLI accepts `anthropic` as an alias for `claude`.

### `provider_model` (string, optional)

Exact model ID for the chosen provider. Required when `provider` is `openai` or `gemini`. Examples:

```yaml
# OpenAI
provider: openai
provider_model: gpt-5.6-sol

# Gemini
provider: gemini
provider_model: gemini-2.5-flash   # gemini-3-pro-preview opt-in (quota-fragile)
```

### `provider_fallback` (string, conditional)

Required when `provider !== "claude"`. Names the provider to fall back to if the primary CLI is missing or fails. Convention: `claude`.

```yaml
provider: openai
provider_model: gpt-5.6-sol
provider_fallback: claude    # required
```

The CLI rejects saves that violate this rule. See `scripts/dispatch/required-fallback.js`.

### `provider_reasoning_effort` (string, optional)

Reasoning depth for the provider. Valid values vary:

| Provider | Valid values | Default in providers.js |
|---|---|---|
| `claude` | `low` \| `medium` \| `high` \| `xhigh` (Opus 4.8 only) \| `max` | `max` for builder/fixer; null elsewhere |
| `openai` | `low` \| `medium` \| `high` \| `xhigh` | `xhigh` (reviewer/compliance/learner); `medium` (qa) |
| `gemini` | (no-op — thinking always-on for pro tier) | `high` (documented; flag is empty) |

### `effort` (string, optional)

Anthropic-only convenience equivalent to `provider_reasoning_effort` when `provider` is `claude` (or omitted). Alex β uses this directly:

```yaml
provider: claude      # or omitted
effort: high          # = provider_reasoning_effort: high
```

## Other keys

### `color` (string)

UI color for tracing the agent in event logs. Pick from: `blue, green, orange, purple, cyan, yellow, pink, red`.

### `memory` (string, optional)

Memory namespace. `project` reads project-level memory. Omit for stateless agents.

### `initialPrompt` (string, optional)

Auto-prepended to first turn. Used by `delta` to bootstrap from `store.json`.

## Worked examples

### Native Claude subagent (most common)

```yaml
---
name: builder
description: Builds ONE feature from spec in an isolated worktree.
tools: Read, Grep, Glob, Bash, Edit, Write
disallowedTools: Agent
model: opus
isolation: worktree
permissionMode: acceptEdits
maxTurns: 80
effort: max
color: cyan
---
```

### Cross-provider review agent (OpenAI)

```yaml
---
name: reviewer
description: Reviews builder output against spec AND holdout golden fixtures.
tools: Read, Grep, Glob, Bash
disallowedTools: Agent, Edit, Write
model: claude-opus-4-8
provider: openai
provider_model: gpt-5.6-sol
provider_fallback: claude
provider_reasoning_effort: xhigh
maxTurns: 40
color: yellow
---
```

### Adversarial agent (Gemini, thinking implicit)

```yaml
---
name: redteam
description: Self-orchestrating Red Team scanner with 11 security personas.
tools: Read, Grep, Glob, Bash, Agent
disallowedTools: Edit, Write
model: sonnet
provider: gemini
provider_model: gemini-2.5-flash
provider_fallback: claude
maxTurns: 60
color: red
---
```

## Validation

The CLI rejects saves that:

1. Set `provider: openai` without a valid `provider_model` from the openai models in `scripts/dispatch/catalog.js` (`gpt-6-astra | gpt-6.1-sol | gpt-6-sol | gpt-6-luna | gpt-5.6-sol | gpt-5.6-terra | gpt-5.6-luna`).
2. Set `provider: gemini` with a deprecated or excluded model (e.g. `gemini-2.5-pro`).
3. Set `provider_reasoning_effort: max` on a non-Anthropic provider.
4. Set `provider_reasoning_effort: xhigh` on Sonnet 4.6 (only Opus 4.8 supports xhigh on Anthropic).
5. Remove `provider_fallback` while `provider !== "claude"`.

## Cross-references

- `.claude/manifest.json` (`agentProviders` block) — project-level provider mapping per role
- `scripts/hooks/lib/providers.js:55-87` — env-var defaults and effort-flag builders
- `scripts/dispatch/catalog.js` — JS source of truth for dropdowns and validation
- `scripts/dispatch.js` — CLI entrypoint
- `.claude/agents/_system/guides/gauntlet-contract.md` — gauntlet/circuit-breaker mechanism contract (`agent-system.md` is the oneshot operational spec and defers to it)
