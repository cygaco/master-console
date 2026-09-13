# OpenAI — Models, Reasoning Effort, Codex CLI

**Sources** (re-fetch when models change):
- https://developers.openai.com/api/docs/models
- https://developers.openai.com/codex/cli (page is sparse; flag detail confirmed via project's existing `scripts/hooks/lib/providers.js:55-115`)

Last verified: 2026-04-28.

## Current models (April 2026)

| Model ID | Context | Max output | Reasoning effort | Vision | Pricing in/out per MTok |
|---|---|---|---|---|---|
| `gpt-5.5` | 1M | 128k | low \| medium \| high \| xhigh | ✓ | $5 / $30 |
| `gpt-5.4` | 1M | 128k | low \| medium \| high \| xhigh | ✓ | $2.50 / $15 |
| `gpt-5.4-mini` | 400k | 128k | low \| medium \| high \| xhigh | ✓ | $0.75 / $4.50 |

**Default flagship for review-layer roles:** `gpt-5.5` (per `OPENAI_FLAGSHIP_MODEL` env, providers.js line 55).
**Default mini for high-volume roles (qa):** `gpt-5.4-mini` (per `OPENAI_MINI_MODEL` env, providers.js line 56).

Knowledge cutoffs: gpt-5.5 — 2025-12-01; gpt-5.4 — 2025-08-31.

Tools supported across the family: function calling, web search, file search, computer use.

> **Known compatibility caveat (2026-04-28):** Codex CLI 0.117 has been observed rejecting `gpt-5.5` with a "model-requires-newer-version" error on some installations. If `node scripts/dispatch.js show` reports CLI rejections, check the codex version and consider falling back through `provider_fallback: anthropic`.

## Reasoning effort

OpenAI's `reasoning_effort` parameter accepts: `low | medium | high | xhigh`. (No `max` value.)

```jsonc
// API request body (Responses API)
{
  "model": "gpt-5.5",
  "reasoning": { "effort": "xhigh" },
  ...
}
```

In the codex CLI, this is passed as a `-c` config override:

```bash
codex exec --full-auto -c model_reasoning_effort=xhigh -m gpt-5.5 -
```

## Codex CLI reference

**Install:** `npm i -g @openai/codex`

**Subcommands:**
- `codex` — interactive TUI session
- `codex exec` — non-interactive scripted use (the dispatcher uses this)

**Headless flags (used by `scripts/dispatch-agent.js` via `scripts/hooks/lib/providers.js`):**

| Flag | Purpose |
|---|---|
| `--full-auto` | Enables workspace-write sandbox + on-request approvals (required for non-TTY) |
| `-m <model>` / `--model <model>` | Model selection |
| `-c model_reasoning_effort=<level>` | Override reasoning depth |
| `-c <key>=<val>` | Generic config override |
| `-o <file>` | Output capture for non-TTY runs |
| `-` | Read prompt from stdin (the dispatcher pipes here) |

**Full invocation pattern (from providers.js DEFAULT_PROVIDERS.openai.syntax):**

```bash
codex exec --full-auto -c model_reasoning_effort=<effort> -m <model> -
```

**Authentication:** OpenAI API key via `OPENAI_API_KEY` env or login flow. The dispatcher relies on the calling shell having credentials configured.

**Sandbox / approval:** `--full-auto` is the dispatcher's standard mode.

## Specialized models (not used by dispatch agents)

- Realtime (speech): `gpt-realtime-1.5`
- Image generation: GPT Image 2
- Transcription: `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`

## Project decisions

- **reviewer, compliance, learner:** `gpt-5.5` with `reasoning_effort: xhigh` (per user 2026-04-26 directive)
- **qa:** `gpt-5.4-mini` with `reasoning_effort: medium` (per user — qa stays on mini for cost)
