# Provider Integration Reference

Source-of-truth for which provider/model/effort combinations are valid for the agent dispatch system. Powers the catalog in `scripts/dispatch/catalog.js` and the cascade in the CLI tool (`node scripts/dispatch.js`).

Every per-provider doc lists its source URLs at the top so we can re-fetch and update when models change.

## Files

| Doc | Provider | CLI tool | Default flagship | Default mini |
|---|---|---|---|---|
| [01-anthropic.md](./01-anthropic.md) | Anthropic | `claude` | `claude-opus-4-8` | `claude-sonnet-4-6` |
| [02-openai.md](./02-openai.md) | OpenAI | `codex` | `gpt-5.5` | `gpt-5.4-mini` |
| [03-google-gemini.md](./03-google-gemini.md) | Google | `gemini` | `gemini-3.1-pro-preview` | `gemini-3.1-flash` |

## Provider-selection matrix (current project policy)

| Role | Provider | Why |
|---|---|---|
| alpha, beta, gamma, delta | anthropic | Native Claude Code integration |
| builder, fixer | anthropic | Code generation needs deepest reasoning at `max` effort |
| reviewer, compliance, learner | openai | Cross-model review catches what same-model review misses |
| qa | openai | High-volume; mini tier balances cost |
| redteam | gemini | Different adversarial training corpus; thinking always-on |

Mapping lives in `.claude/manifest.json` (`agentProviders` block) and defaults in `scripts/hooks/lib/providers.js` (`DEFAULT_AGENT_PROVIDERS`).

## Project policies

- **No `gemini-2.5-pro`** — see user memory `feedback_no_gemini_25pro.md`. Surfaced as disabled in the CLI.
- **Fallback required when provider ≠ anthropic** — without a fallback, dispatch fails if codex/gemini CLI is missing on the machine. The CLI rejects saves that violate this rule.
- **Effort levels are not portable across providers** — `xhigh` exists on Anthropic Opus 4.8 + all current OpenAI models; `max` is Anthropic-only; Gemini has no explicit effort flag. The CLI cascades model→effort accordingly.

## Resolution chain

```
Dispatch event
  └─ scripts/hooks/lib/providers.js
      ├─ getProviderForRole(role)
      │   manifest.agentProviders[role] → DEFAULT_AGENT_PROVIDERS[role]
      ├─ resolveModel(provider, role)
      │   env var → frontmatter provider_model: → providers.js DEFAULT
      └─ buildReasoningFlag(provider, role)
          env var → frontmatter provider_reasoning_effort: → DEFAULT_REASONING_EFFORT
```

Env vars override file-level config. The CLI surfaces shadowed env-var overrides as warnings.

## Using the CLI

```bash
# Show the current resolved config for every role (default)
node scripts/dispatch.js

# Browser GUI — ephemeral local server, opens automatically (127.0.0.1 only,
# random port, token-gated, dies when you close the tab or stop the CLI)
node scripts/dispatch.js gui

# Edit one role interactively in the terminal (cascades provider → model → effort)
node scripts/dispatch.js edit reviewer

# Non-interactive set
node scripts/dispatch.js set reviewer openai gpt-5.5 xhigh claude

# List backups / revert
node scripts/dispatch.js backups
node scripts/dispatch.js revert <backup-id>
```

There is **no persistent admin URL** — the `gui` server is bound to `127.0.0.1` only, listens on a random port, requires an unguessable token in every request, and exits when the CLI process exits or the browser tab is closed. It is structurally a debugger backend (like Chrome DevTools), not an exposed admin panel.

## When models change

1. Re-fetch the source URLs at the top of each provider doc.
2. Update the model table in this folder.
3. Update `scripts/dispatch/catalog.js` with the new `(model, effortLevels)` entries.
4. If a model is deprecated, mark it with `deprecated: true` in catalog.js (CLI will dim it).
5. Run `node scripts/dispatch.js show` to confirm everything resolves.
