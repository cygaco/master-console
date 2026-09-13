---
description: Smoke-dispatch one agent role (or all non-claude roles) with a tiny ping prompt.
user-invocable: true
namespace: agents
reads: [paths.manifest]
writes: []
---

# /agents:test

Verify cross-provider dispatch works for one or all roles by sending a ≤200-byte ping prompt and checking the response.

## Input

```
$ARGUMENTS  →  forwarded to: node scripts/agents/cli.js test
  <role>                test exactly one role (e.g. reviewer, redteam)
  --all                 test every role with manifest.agentProviders[role] !== "claude"
  --smoke               full dispatch-readiness sweep via provider-smoke --per-role
  --full                alias for --smoke
```

## Output

**Default (single role or --all)** — one line per tested role:

```
<role>: ok provider=<p> model=<m> reply=<first 40 chars>
<role>: FAIL <reason>
<role>: provider=claude — native dispatch (no test possible from CLI)
```

**--smoke / --full** — full per-role reachability table from `provider-smoke.js`:

```
Provider Smoke — GREEN
────────────────────────────────────────────────
  ok  claude   ok           claude is the harness
  ok  openai   ok
Per-role reachability (dispatch resolution path):
────────────────────────────────────────────────
  ok   builder     claude  (default)
  ok   reviewer    openai  gpt-5.5
  xx   redteam     gemini  gemini-3.1-pro-preview   model_unavailable: …
```

## Exit codes

**Default (single role / --all):**
- `0` all tested roles ok (claude roles count as ok — they don't dispatch via CLI)
- `1` one or more roles failed or a RED dispatch-readiness failure detected
- `2` usage error

**--smoke / --full:**
- `0` all green or yellow-only (fallbacks exist)
- `2` at least one RED role or provider (model unavailable / unreachable) — a real
  dispatch-readiness failure; fix before dispatching

A non-zero exit from `--smoke` / `--full` is a RED result, not a warning.

## Relationship between cli.js (default) and provider-smoke (--smoke)

`cli.js test <role>` — single-role quick test. Routes through
`scripts/dispatch-agent.js` (the safe dispatch path) and checks `res.ok`.
Reads role→provider mapping from `.claude/manifest.json#agentProviders`.
Appropriate for quick "does this role work right now?" checks.

`--smoke` / `--full` → `node scripts/mc/provider-smoke.js --per-role` — 
full readiness sweep. Resolves all build-chain roles via the same path real
dispatch uses (providers.js + dispatch-agent.js#getRoleModel), pings
non-Claude roles, and classifies model-availability precisely (catches silent
downgrade / model_unavailable, not just "ping failed"). Use for pre-dispatch
health checks, CI readiness gates, and `/warp:health` equivalence.

## Empty-state behavior

If `manifest.agentProviders` is empty or absent, prints `no non-claude roles in agentProviders — nothing to test` and exits 0.

## Example

```bash
$ node scripts/agents/cli.js test reviewer
reviewer: ok provider=openai model=gpt-5.5 reply=PONG

$ node scripts/agents/cli.js test --smoke
Provider Smoke — GREEN
…
```

## Implementation

```bash
# Default: single role or --all
node scripts/agents/cli.js test $ARGUMENTS

# Full dispatch-readiness sweep (--smoke / --full)
node scripts/mc/provider-smoke.js --per-role
```

See: `tests/transcripts/agents-test.md`.

## Cost note

`--all` makes one API call per non-claude role (typically 4-5). Each is ≤200 bytes prompt + tiny output. Cost is negligible but not free; do not put in a hot loop.

`--smoke` / `--full` also dispatches one ping per non-Claude role (same cost as `--all`). Use `--smoke --no-ping` for a token-free resolve-only check (does not confirm liveness, but catches CLI-missing / auth issues cheaply).
