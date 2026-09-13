# Adhoc Mode — Built-In Primitive Limits

Phase 0 workstream I. This file documents harness behaviours that affect
adhoc team lifecycle but live outside the MC repo. The accompanying
fixes in `/mode:adhoc` are prompt-level and session-start nudge based —
they are the most we can do from in-repo.

## Primitives that live in the Claude Code harness, NOT this repo

| Behaviour | Repo-accessible? | Phase 0 workaround |
|---|---|---|
| `TeamCreate` semantics | No | Document the classify-stale checklist in `/mode:adhoc` |
| `TeamCreate --force-replace` flag | No (does not exist) | Recreate teams manually |
| `SendMessage` to dead/reaped agent | No (returns "agent exited" string) | Alpha must check return value and re-spawn |
| `maxTurns` reap policy | No | Document the limit in `/mode:adhoc` |
| `claim_on_startup` flag | No | Prompt-level STARTUP DIRECTIVE inside teammate spawn prompts |
| Team-task ownership persistence | No (session-bound) | Tracker source-of-truth rule: durable repo state only |

### 2026-05-13 update — SendMessage primitive IS exposed

Earlier wording in this document and in `/mode:adhoc` implied SendMessage
was an entirely unknown primitive. That is incorrect. The Agent tool's
spawn output explicitly includes the line:

  `Use SendMessage with to: <agentId> to continue this agent.`

with a stable `agentId` Alpha can capture and reuse. The actual
limitation is narrower: the SendMessage **schema is not discoverable via
ToolSearch keyword lookup** (`ToolSearch select:SendMessage` returns
empty, and a keyword search for "send" / "message" does not surface a
matching definition). The primitive itself appears callable — the agent
spawn hint is the harness telling us so. The operational rule is:
ToolSearch absence does not imply harness absence. Attempt the call when
the spawn output advertises it. Validated 2026-05-13 in `/mode:adhoc`
dispatch session (Beta agentId `ac69b6bf3df4747c3`, Gamma agentId
`ad97643d7efe975f4`).

## Repo-accessible signals we DO use

- `.claude/runtime/.team-marker` — written by `/mode:adhoc` step 6. Read
  by `scripts/hooks/session-start.js`. When older than 24h, surfaces a
  warning suggesting `/mode:adhoc` refresh.
- `.claude/agents/store.json` — durable orchestrator state. Survives
  sessions.
- `paths.decisionLedger` — durable record of every Class B / C decision.
- `paths.adrIndex` — settled architecture decisions referenced by future
  runs.

## Why the limits matter

The Phase 0 prompt called out three recurring failure modes from
downstream product work:

1. **Stale teams** — operators run `/mode:adhoc` twice in a row and the
   second invocation doesn't notice the first team is still around. The
   classify-stale checklist + `.team-marker` close most of that gap.
2. **Auto-claim** — fresh teammates grab pending tasks before Alpha can
   assign them deliberately. The STARTUP DIRECTIVE in `/mode:adhoc`
   step 2 is the only lever we have.
3. **Silent dead agents** — SendMessage to a reaped teammate returns an
   error but the harness does not auto-respawn. Alpha is responsible
   for noticing and re-spawning.

## Future primitive asks (to surface upstream)

These belong in the `/warp:flag` ledger so the Phase 0 → Phase 1 → 1.0
pipeline tracks them:

- `TeamCreate --force-replace <name>` so refresh is a single primitive
  call instead of manual recreate.
- `SendMessage` auto-respawn-or-error mode controlled by team config.
- Team config field `claim_on_startup: bool`.
- Durable team-task ownership (survives session restart).

Until those primitives ship, the in-repo workarounds in `/mode:adhoc`
are the canonical guardrails.
