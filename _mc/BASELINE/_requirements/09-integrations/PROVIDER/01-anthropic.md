# Anthropic — Models, Thinking, Effort, CLI

**Sources** (re-fetch when models change):
- https://platform.claude.com/docs/en/about-claude/models/overview
- https://platform.claude.com/docs/en/build-with-claude/effort
- https://platform.claude.com/docs/en/build-with-claude/extended-thinking
- https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
- https://www.anthropic.com/news/claude-opus-4-8
- https://platform.claude.com/docs/en/api/models/list (programmatic capability lookup)

Last verified: 2026-04-29.

## Current models (April 2026)

| Model ID | API alias | Context | Max output | Effort levels | Pricing in/out per MTok |
|---|---|---|---|---|---|
| `claude-opus-4-8` | `claude-opus-4-8` | 1M | 128k | low \| medium \| high \| xhigh \| max | $5 / $25 |
| `claude-sonnet-4-6` | `claude-sonnet-4-6` | 1M | 64k | low \| medium \| high \| max | $3 / $15 |
| `claude-haiku-4-5-20251001` | `claude-haiku-4-5` | 200k | 64k | (no `effort` param) | $1 / $5 |

**Aliases (frontmatter shorthand):** `inherit`, `sonnet`, `opus`, `haiku`, plus the literal IDs above. The `inherit` alias means "use the parent session's model."

## Thinking modes

| Model | Mode | Notes |
|---|---|---|
| Opus 4.8 | Adaptive only | Manual `thinking: { budget_tokens: N }` is **rejected** with HTTP 400. Use `effort` instead. |
| Sonnet 4.6 | Adaptive (recommended) + manual (deprecated) | `budget_tokens` still accepted but will be removed. |
| Haiku 4.5 | Extended thinking | No `effort` param. |
| Mythos Preview | Adaptive default + manual supported | Invitation-only research preview for defensive cybersecurity (Project Glasswing). |

### API parameter shapes

```jsonc
// Adaptive thinking (Opus 4.8+, Opus 4.6, Sonnet 4.6, Mythos)
{
  "thinking": { "type": "adaptive" },
  "effort": "high"   // low | medium | high | xhigh (Opus 4.8 only) | max
}

// Manual extended thinking (Sonnet 4.6 deprecated, Haiku 4.5, legacy 4.5/4.1/4)
{
  "thinking": {
    "type": "enabled",
    "budget_tokens": 10000,
    "display": "summarized"   // or "omitted" for faster first-token
  }
}
```

Mutually exclusive: don't set both `effort` and `budget_tokens` in the same request. Adaptive is the forward path; manual is being phased out.

### display: omitted (faster streaming)

When using **manual** thinking, `display: "omitted"` skips returning thinking content (lower latency, less output) but keeps a `signature` for multi-turn continuity. Not exposed by the `claude` CLI today — API-only.

### Tool-use constraints with thinking

When `thinking` is enabled (any mode):
- ✓ `tool_choice: {type: "auto"}`  (default)
- ✓ `tool_choice: {type: "none"}`
- ✗ `tool_choice: {type: "any"}`  → 400 error
- ✗ `tool_choice: {type: "tool", name: "..."}`  → 400 error

Pass `thinking` blocks back **unchanged** in continuation turns when threading tool results.

### Interleaved thinking

Claude can reason between tool calls (a "thinking" block between each tool round-trip):
- Opus 4.8, Opus 4.6, Sonnet 4.6, Mythos: **automatic with adaptive** (no beta header)
- Older Claude 4 (Opus 4.5, 4.1, 4 / Sonnet 4.5, 4): requires beta header `interleaved-thinking-2025-05-14`
- With interleaved: `budget_tokens` may exceed `max_tokens` (limited only by context window).

## Effort parameter

```jsonc
// API
{
  "model": "claude-opus-4-8",
  "max_tokens": 4096,
  "messages": [...],
  "output_config": { "effort": "max" }
}
```

```bash
# CLI
claude --effort xhigh -p ...
```

### Effort level matrix

| Level | Opus 4.8 | Sonnet 4.6 | Haiku 4.5 | When to use |
|---|---|---|---|---|
| `low` | ✓ | ✓ | — | Simple tasks, classification, short scoped work |
| `medium` | ✓ | ✓ | — | Recommended Sonnet default; cost-sensitive Opus |
| `high` | ✓ (default) | ✓ (default) | — | Complex reasoning; equivalent to omitting param |
| `xhigh` | ✓ | — | — | **Recommended Opus 4.8 starting point** for coding/agentic |
| `max` | ✓ | ✓ | — | Frontier problems; reserve for measurable headroom over xhigh |

`effort` affects ALL output tokens — text, tool calls, and thinking. Lower effort means fewer tool calls.

### Anthropic recommendations

**Sonnet 4.6:** explicitly set `medium` for most agentic work; `low` for high-volume / latency-sensitive; `high` only when intelligence is critical; `max` for frontier work.

**Opus 4.8:** start at `xhigh` for coding/agentic; step down to `medium` for cost; step up to `max` only when evals show measurable headroom. Set large `max_tokens` (start 64k) when running `xhigh` or `max`.

## Legacy / deprecated models

| Model ID | Status | Notes |
|---|---|---|
| `claude-opus-4-6` | Legacy, supported | Adaptive thinking; effort supported |
| `claude-opus-4-5-20251101` | Legacy, supported | |
| `claude-opus-4-1-20250805` | Legacy, supported | |
| `claude-sonnet-4-5-20250929` | Legacy, supported | |
| `claude-sonnet-4-20250514` | **Deprecated** | Retiring 2026-06-15. Migrate to Sonnet 4.6 |
| `claude-opus-4-20250514` | **Deprecated** | Retiring 2026-06-15. Migrate to Opus 4.8 |

## Other settings (informational — most not exposed by the `claude` CLI)

| Setting | Where | Notes |
|---|---|---|
| `priority_tier` | API service tiers | All current models support priority tier. Not surfaced in our CLI. |
| Batch API | Messages Batch API | Independent endpoint; supports up to 300k output tokens with `output-300k-2026-03-24` beta header on Opus 4.8, Opus 4.6, Sonnet 4.6. |
| Prompt caching with thinking | API | Opus 4.5+ and Sonnet 4.6+ keep thinking blocks across turns. System prompts stay cached even when `thinking` params change; message blocks invalidate on `budget_tokens` or `type` change. Use 1-hour cache for long thinking sessions. |
| Bedrock / Vertex IDs | AWS / GCP | Each Claude model has separate IDs (e.g. `anthropic.claude-opus-4-8` on Bedrock, `claude-opus-4-8` on Vertex). Bedrock since Sonnet 4.5 also has global vs regional endpoints. Not used by our local `claude` CLI. |
| Models API | `/v1/models` | Programmatic capability lookup. Returns `max_input_tokens`, `max_tokens`, `capabilities`. |
| Reliable knowledge cutoff | All models | Distinct from training cutoff: knowledge is most reliable up to Opus 4.8 = Jan 2026, Sonnet 4.6 = Aug 2025, Haiku 4.5 = Feb 2025. |

## CLI reference (claude)

```bash
# Non-interactive
claude -p "<prompt>" --effort xhigh --agent <role>

# Stdin
cat prompt.txt | claude -p - --effort high
```

Effort flag: `--effort <low|medium|high|xhigh|max>`.

The `claude` CLI **does not** currently expose: `display`, `budget_tokens`, beta-header toggles, `priority_tier`, batch endpoint, or `tool_choice`. Those are API-level concerns; if you need them, dispatch directly via SDK.

## Project decisions

- **builders, fixers:** `claude-opus-4-8` with `effort: max` (per user 2026-04-26 directive)
- **gamma:** `claude-opus-4-8` with `effort: max` (per user 2026-04-28 directive)
