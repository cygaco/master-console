---
description: Route a specific command/role to a specific model — thin, validated wrapper over the Dispatch Console (provider/model/effort/fallback), with an atomic backup ring.
user-invocable: true
namespace: models
reads: [scripts/dispatch/catalog.js, .claude/manifest.json]
writes: [.claude/manifest.json, .claude/agents]
---

# /models:route — point one role at a specific model

Route a single build-chain **command/role** (e.g. `redteam`, `reviewer`, `qa`,
`builder`) to a specific provider + model (+ optional reasoning effort and fallback).
This is a thin wrapper over the existing **Dispatch Console** (`scripts/dispatch.js`),
which writes `.claude/manifest.json` + the matching agent frontmatter atomically with a
backup ring — so a route change is safe and revertible.

> In MC, **the routable unit is the role** (the "command" that runs in the build
> chain), not an individual slash-command. Skills/commands dispatch *through* roles, so
> routing a role re-points every command that uses it. Valid roles are listed by
> `node scripts/dispatch.js show`.

## Input

```
$ARGUMENTS  →  node scripts/dispatch.js set <role> <provider> <model> [effort] [fallback]
  <role>       redteam | reviewer | compliance | qa | learner | builder | fixer | … (see `show`)
  <provider>   claude | openai | gemini   (aliases: anthropic, gpt, google)
  <model>      a model id valid for that provider in catalog.js (e.g. gemini-3.5-flash)
  [effort]     low | medium | high | xhigh | max   (provider/model-dependent; omit for gemini)
  [fallback]   provider to fall back to (default: the provider's required fallback)
```

The Console **validates** the tuple against `catalog.js` (`validateTuple`) — an unknown
role, provider, or model is rejected with a non-zero exit and the valid options, so you
can't route to something undispatchable. **Effort caveat:** validation only rejects an
unsupported effort for models that *declare* `effortLevels`. Gemini models declare none
(`effortLevels: []`, thinking is implicit/always-on), so an effort arg passed for a
Gemini model is **accepted but ignored** — omit it for Gemini to avoid persisting a
meaningless value.

## Procedure

1. (optional) Show current routing for context:
   ```bash
   node scripts/dispatch.js show
   ```
2. Apply the route:
   ```bash
   node scripts/dispatch.js set $ARGUMENTS
   ```
3. Confirm the change rendered (re-run `show`), and report what moved.

**Irreversible-action note:** routing is a config write but is *reverted* trivially
(`node scripts/dispatch.js backups` → `node scripts/dispatch.js revert <id>`). No push.
If the route changes a build-chain *default* model family (a meaningful technical call),
consult Beta first per the β-consultation protocol.

## Exit codes

- `0` routed · `2` invalid role/provider/model/effort tuple (usage)

## Examples

```bash
# Point redteam at the GA flash instead of the preview flagship (more reliable):
node scripts/dispatch.js set redteam gemini gemini-3.5-flash

# Route the backend code-reviewer to the GPT flagship at high effort:
node scripts/dispatch.js set backend-reviewer openai gpt-5.5 high

# Revert the last change:
node scripts/dispatch.js backups && node scripts/dispatch.js revert <id>
```

## See also

- `/models:router` — open the full panel (GUI) to edit any role visually
- `/models:check` — verify the model you're routing to is current/servable
