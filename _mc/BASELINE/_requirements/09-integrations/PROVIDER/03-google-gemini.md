# Google Gemini — Models, Thinking, CLI

**Sources** (re-fetch when models change):
- https://ai.google.dev/gemini-api/docs/models
- https://docs.cloud.google.com/gemini/docs/codeassist/gemini-cli
- https://geminicli.com/docs/get-started/installation/ (full CLI reference)

Last verified: 2026-05-30 (dispatch empirically re-verified — see § Current model families).

> **Note:** Both source pages were sparse on flag-level detail. CLI invocation pattern below is taken from `scripts/hooks/lib/providers.js:115-124` (the dispatcher's working syntax) and is the authoritative project reference until upstream docs improve.

## Current model families (verified 2026-05-30)

> **Empirically verified this revision:** `gemini-2.5-flash` dispatches successfully
> end-to-end through `providers.js` (auth code-41 fixed + trusted-dir fixed +
> JSON envelope returned, served model self-reported as `gemini-2.5-flash`). The
> `gemini-3.1-*` ids previously listed here were **GHOSTS** (HTTP 404 on v1beta)
> and have been removed from `scripts/dispatch/catalog.js` + all dispatch config.

### Gemini 3 (preview)

| Model ID | Tier | Thinking | Status |
|---|---|---|---|
| `gemini-3-pro-preview` | Pro | Always-on | Official preview id (it's the `--model` example in Google's own Gemini CLI docs). **Quota-fragile** — `TerminalQuotaError` after 1-2 real redteam scans on typical accounts → opt-in only via `GEMINI_MODEL=gemini-3-pro-preview`, NOT the default. |

### Gemini 2.5 (stable)

| Model ID | Tier | Thinking | Status |
|---|---|---|---|
| `gemini-2.5-pro` | Pro | Configurable | **DO NOT USE** — project policy (see below) |
| `gemini-2.5-flash` | Flash | Off | **DEFAULT for redteam** — real, reliable, generous quota, corpus-diverse vs GPT/Claude (verified 2026-05-30) |
| `gemini-2.5-flash-lite` | Flash-Lite | Off | available |

### Specialized (not used by dispatch agents)

- Nano Banana 2 / Pro (vision/image)
- Veo 3.1 (video)
- Embedding 2 (embeddings)

### Ghost / removed — DO NOT re-add

- `gemini-3.1-pro-preview`, `gemini-3.1-flash`, `gemini-3.1-flash-lite`, `gemini-3-flash` — never existed on the API (HTTP 404 `ModelNotFoundError: models/... is not found for API version v1beta`). Removed from the catalog + all dispatch config 2026-05-30.
- The prior revision's claim that "`gemini-3-pro-preview` was sunset 2026-03-09, migrate to `gemini-3.1-pro-preview`" was **incorrect/hallucinated** — it had it backwards: `gemini-3-pro-preview` is the real id and `gemini-3.1-*` is the ghost.

## Thinking mode

Gemini does NOT expose an explicit `effort` or `reasoning_effort` parameter via the CLI used by the dispatcher. For the pro-preview tier, thinking is always-on at the API level. For Flash tiers, thinking is off.

The `provider_reasoning_effort` frontmatter key is therefore a **no-op** when provider is `gemini`. Project convention: still set it (for documentation), default to `high`.

## Gemini CLI reference

**Install:** see https://geminicli.com/docs/get-started/installation/

**Headless flags (from providers.js DEFAULT_PROVIDERS.gemini.syntax):**

| Flag | Purpose |
|---|---|
| `-m <model>` | Model selection |
| `-p <prompt>` | Inline prompt; combine with stdin context |
| stdin | Pipe context (file content, etc.) before the `-p` instruction |

**Full invocation pattern:**

```bash
gemini -m gemini-2.5-flash -p "<instruction>" < context.txt
```

**Authentication (verified 2026-05-30):** put `GEMINI_API_KEY=<key>` in `~/.gemini/.env`
(the CLI's global env file). Under `spawnSync` the CLI does **not** auto-load that file,
so `providers.js#loadGeminiApiKey()` reads it and injects `GEMINI_API_KEY` into the gemini
child env. `gcloud auth` works for Cloud Code paths. Key value is never logged.

## Project policy

> **DO NOT USE `gemini-2.5-pro`** — see user memory `feedback_no_gemini_25pro.md`.

The catalog (`scripts/dispatch/catalog.js`) deliberately excludes this model. CLI will not offer it.

## Known field issues (DISCOVERED-2026-05-11, tracked via /warp:flag)

- ~~`gemini-3.1-flash` and `gemini-3.1-flash-lite` return HTTP 404~~ **RESOLVED 2026-05-30**: all `gemini-3.1-*` ghost ids dropped from `scripts/dispatch/catalog.js` + `providers.js` + manifest + agent specs. Default redteam model is now `gemini-2.5-flash` (real, verified). `provider-health.js` still flags any re-introduced ghost via `status: model_not_found`.
- Gemini CLI's bundled model registry (`models list`) lags the API. A `model_not_found` from `gemini -m <id> -p` does NOT necessarily mean the model is gone — try a CLI upgrade first.
- If `GEMINI_API_KEY` is set in the harness env AND the CLI's `~/.gemini/settings.json` declares `auth.selectedType: oauth-personal`, the CLI may silently use the OAuth account and ignore the API key. `provider-health.js` flags this as `auth_source_mismatch`; `smart-context.js` injects a one-shot session warning so the operator sees the configuration ambiguity before interpreting failures.

## Trusted-directory requirement

Gemini CLI refuses headless runs outside a trusted directory (dies with "not a
trusted directory"). **Fixed 2026-05-30:** `providers.js` now sets
`GEMINI_CLI_TRUST_WORKSPACE=true` in the gemini child env by default (the official
headless equivalent of "trust this folder", per
geminicli.com/docs/cli/trusted-folders/#headless-and-automated-environments). The
older opt-in `WARPOS_GEMINI_TRUST_BYPASS=1` → `--skip-trust` path still exists as a
fallback. `provider-health.js` reports `trusted_directory_required` on the failure signature.

## Project decisions

- **redteam:** `gemini-2.5-flash` (corpus diversity vs Claude/OpenAI, reliable quota). Fallback to `anthropic` (claude-opus-4-8) when the CLI is unavailable. A **second security pass** always runs on `openai:gpt-5.5` via `dispatch-agent.js redteam <prompt> --provider openai`, so security covers two model families and survives a total gemini outage.
