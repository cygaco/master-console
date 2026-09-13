---
description: Session speed mode — pre-authorize a batch of high-impact actions (permissions.allow) AND switch the build cadence to fast levers (parallel builds, batched Beta, skip-gauntlet-when-low-risk, engine-sprint fast-close). The one command to go fast for a work session.
user-invocable: true
---

# /session:turbo

Two layers in one command, for when you want a fast work session:

1. **Permission pre-auth** (the original `/turbo`) — additively merge curated
   `permissions.allow` entries by scope for a bounded TTL, removing the
   "yes push / yes manifest / yes destructive-git" keyboard cadence. Thin wrapper
   over `scripts/turbo/apply.js` (snapshots `.claude/settings.json`, writes a
   runtime state file with a TTL, pairs with `scripts/hooks/authorization-gate.js`).
2. **Speed cadence** (added 2026-05-25, RT-speed-analysis) — the build levers that
   cut the round-trips observed building MC 0.15.0. See "Speed cadence" below.

> Relocated from the root `/turbo` into the `session:` namespace (it's a
> session-scoped mode). `/turbo` remains as a thin alias so `/mode:*` `--turbo`
> references keep working.

## Inputs

```text
/session:turbo [--scope <csv>|all] [--ttl <duration>] [--reason "<text>"] [--off|--status]
               [--speed]   # also print/activate the speed-cadence checklist
```

- `--scope <csv>` — comma-separated scope vocab (below). Default: `manifest-edit,write-jsonl,node-e-fs`. **`push-to-main` is opt-in only** — never in the default set, per CLAUDE.md autonomy. Note: the harness auto-mode classifier sits ABOVE `permissions.allow`, so even an active `push-to-main` scope (or a durable `Bash(git push *)` allow rule) does NOT make a push-to-main classifier-immune — it still needs per-action operator intent (PROVEN 2026-06-09, L-2026-06-09-classifier-above-permissions-allow).
- `--scope all` — every scope except the safety floor.
- `--ttl <duration>` — e.g. `30m`, `60m`, `2h`. Default: `60m`.
- `--reason "<text>"` — operator-readable reason logged with the authorization.
- `--off` — restore `.claude/settings.json` from the pre-turbo snapshot; delete the runtime auth file.
- `--status` — active scopes, TTL remaining, snapshot path, bypass counter.
- `--speed` — print the speed-cadence checklist (and, when paired with `/sprint:full`, recommend `--autonomy turbo`).

## Scope vocabulary

| Scope | Pattern category |
|---|---|
| `push-to-main` | `git push` to default branch (OPT-IN ONLY) |
| `manifest-edit` | Edits / writes to `.claude/manifest.json` |
| `destructive-git` | `git rm`, `git reset --hard` (still safety-floored) |
| `node-e-fs` | `node -e` invocations that write files |
| `write-jsonl` | `.jsonl` file writes |
| `worktree-ops` | `git worktree` operations |

## Speed cadence (the build levers)

When `--speed` is active (or `/sprint:full --autonomy turbo`), bias the build toward
these levers — each one removes a class of round-trip observed building MC 0.15.0
(see RT speed analysis 2026-05-25 + `/issues:list` RI-001):

1. **Parallel builds by default.** Fan out independent tickets / modules to
   concurrent builder subagents against a shared interface, rather than a serial
   ticket-by-ticket loop. (0.15.0 Sprint C: 4 phase modules built concurrently.)
2. **Batched Beta.** For low-risk sprints, do ONE upfront plan-consult that
   pre-clears the phase boundaries (β names any boundary that genuinely needs a
   halt) instead of a SendMessage round-trip at all four boundaries. ESCALATE
   still hard-halts.
3. **Skip the gauntlet when low-risk.** For tickets at or below `medium` risk with
   a green e2e, skip the reviewer/qa/redteam gauntlet; keep it for `high`/`critical`.
4. **Engine-sprint fast-close.** Tooling/engine sprints have no deploy artifact —
   close via a BROKERED merge onto `main` (`node scripts/dispatch/broker-merge.js
   <branch> --sp-id <id>`) + status→closed instead of dead-ending in `/sprint:full`'s
   release-prep (RI-001). A raw `git` ff-merge to `main` works today unbrokered via
   the logged fallback but is REFUSED by the reference-transaction hook post-flip.
   Defer the retro to epic close.
5. **Don't over-deliberate reversible bookkeeping.** Cheap, reversible, local-only
   actions (status flips, local merges, doc edits) are act-don't-deliberate.

The matching `/sprint:full` `turbo` autonomy preset (in `paths.sprintFullAutonomy`)
encodes 2-4 declaratively (`beta_cadence: batched`, `skip_gauntlet_max_risk`,
`parallel_builds_default`, `engine_sprint_fast_close`). Adding that preset widens
autonomy, so it requires explicit operator approval (like AP-20260518-017..020) +
`scripts/sprint/full.js` cadence wiring — tracked as a follow-up, not auto-applied.

## Safety floor (NEVER bypassed, even with `--scope all` or `--speed`)

- Forced push to the default branch
- Delete branches matching `backup/*` or `pre-*`
- Service signups / purchases
- API spend ≥ 5 USD per session
- Beta consultation `ESCALATE` returns
- Delete tracked uncommitted user work
- Production deploy / destructive migration

Enforced at write time in `scripts/turbo/apply.js` and again in
`scripts/hooks/authorization-gate.js`. `--speed` changes cadence, never the floor.

## Procedure

### 1. Apply (permission layer)
Run `node scripts/turbo/apply.js --scope <csv> --ttl <duration> --reason "<text>"`.
It snapshots settings, merges the scoped `permissions.allow` entries, writes the
runtime state file + TTL, and prints active scopes.

### 2. Speed cadence (when --speed)
Print the five levers above as the session's working defaults. If a `/sprint:full`
run is in play, recommend `--autonomy turbo` (once the operator has approved the
preset). Otherwise apply the levers as build discipline.

### 3. Status / Off
- `--status` → `node scripts/turbo/apply.js --status`.
- `--off` → `node scripts/turbo/apply.js --off` (restores the snapshot).

## Reference
- Engine: `scripts/turbo/apply.js`
- Authorization hook: `scripts/hooks/authorization-gate.js`
- Speed analysis: traces.jsonl RT (2026-05-25) + `/issues:list` RI-001
- Autonomy preset pairing: `paths.sprintFullAutonomy` (`turbo` — pending approval)
