---
description: "[alias → /session:turbo] Pre-authorize a session batch of high-impact actions via permissions.allow entries. Removes the keyboard cadence for repeat approvals."
user-invocable: true
says-confirm: fuzzy-only
---

# /turbo

> **Canonical name is `/session:turbo`**.
> This root
> `/turbo` stays as a working alias so `/mode:<solo|adhoc|oneshot> --turbo` and
> muscle memory keep working — same engine (`scripts/turbo/apply.js`), same scopes
> + safety floor. For the speed-cadence levers, see `/session:turbo`.

Pre-authorize a batch of high-impact actions for a bounded time window. Designed
to remove the "yes push", "yes manifest", "yes destructive-git" keyboard cadence
in batch work sessions, while preserving a hard safety floor that nothing can
bypass.

Also invoked by `/mode:<solo|adhoc|oneshot>` when `--turbo` is passed; see those skill bodies for per-mode default scopes.

The skill is a thin wrapper around `scripts/turbo/apply.js`. The apply script
snapshots `.claude/settings.json`, additively merges curated `permissions.allow`
entries by scope, writes a runtime state file with a TTL, and prints status.
Pair with the registered `scripts/hooks/authorization-gate.js` PreToolUse hook
so project guards (merge-guard, sprint-tracker-guard, etc.) also honor the
authorization while it is active.

## Inputs

```text
/turbo [--scope <csv>|all] [--ttl <duration>] [--reason "<text>"] [--off|--status]
```

- `--scope <csv>` — comma-separated scope vocab (see below). Default: `manifest-edit,write-jsonl,node-e-fs`. **`push-to-main` is opt-in only** — never in the default set, per CLAUDE.md autonomy rule.
- `--scope all` — every scope except those in the safety floor.
- `--ttl <duration>` — e.g. `30m`, `60m`, `2h`. Default: `60m`.
- `--reason "<text>"` — operator-readable reason logged with the authorization.
- `--off` — restores `.claude/settings.json` from the pre-`/turbo` snapshot and deletes the runtime authorization file.
- `--status` — prints active scopes, TTL remaining, snapshot path, bypass counter.

## Scope vocabulary

| Scope | Pattern category |
|---|---|
| `push-to-main` | `git push` to default branch (OPT-IN ONLY) |
| `manifest-edit` | Edits / writes to `.claude/manifest.json` |
| `destructive-git` | `git rm`, `git reset --hard` (still safety-floored) |
| `node-e-fs` | `node -e` invocations that write files (temporarily reopens the file-write anti-pattern) |
| `write-jsonl` | `.jsonl` file writes |
| `worktree-ops` | `git worktree` operations |

## Safety floor (NEVER bypassed, even with `--scope all`)

- Forced push to the default branch
- Delete branches matching `backup/*` or `pre-*`
- Service signups / purchases
- API spend ≥ 5 USD per session
- Beta consultation `ESCALATE` returns
- Delete tracked uncommitted user work

Enforced at write time in `apply.js` and again in `authorization-gate.js`.

## Procedure

### 1. Apply

```bash
node scripts/turbo/apply.js --scope manifest-edit,write-jsonl --ttl 60m --reason "<text>"
```

Snapshots settings.json on first apply per session, additively merges
`permissions.allow` entries by scope, writes the runtime state.

### 2. Work

Drive your batch. Matched tool calls auto-allow via the harness `permissions.allow`
path. With the `authorization-gate.js` hook registered, project guards also
short-circuit and emit `type=auth-bypass` audit events to `paths.eventsFile`.

### 3. Status

```bash
node scripts/turbo/apply.js --status
```

Prints active scopes, TTL remaining, granted_at, expires_at, snapshot path,
and bypass counter.

### 4. Off

```bash
node scripts/turbo/apply.js --off
```

Restores `.claude/settings.json` from snapshot and deletes the runtime
authorization file. Idempotent.

## Outputs

| Artifact | Path |
|---|---|
| Pre-turbo settings snapshot | `.claude/runtime/settings-pre-turbo.json` |
| Active authorization state | `.claude/runtime/authorization.json` |
| Modified harness settings | `.claude/settings.json` (additive `permissions.allow`) |
| Audit events | `paths.eventsFile` (`type=auth-bypass`) |

## Recovery

If a session crashes mid-apply:

1. Read `.claude/runtime/authorization.json` to see the active state.
2. `node scripts/turbo/apply.js --status` for a human-readable view.
3. `node scripts/turbo/apply.js --off` to revert from snapshot.
4. If the snapshot is missing or `settings.json` is malformed, `git restore .claude/settings.json` and re-apply.

## Limitations honestly documented

1. **The harness classifier may still prompt for some actions even with the right `permissions.allow` entry.** Some classifier heuristics are richer than allow rules; `/turbo` removes ~70% of session friction, not 100%.
2. **TTL is advisory.** No cron auto-runs `--off`. Operator runs `--off` manually, or the next `/turbo` invocation restores from snapshot first.
3. **`permissions.allow` entries persist across sessions until removed.** `--off` cleans up; manual cleanup is `git restore .claude/settings.json`.

## Reference

`scripts/turbo/apply.js`, `scripts/turbo/install-hook.js`, `scripts/hooks/authorization-gate.js`.

Sibling skill: `/fewer-permission-prompts` (transcript-mined long-term harness tuning).
This skill is the short-term batch authorization counterpart.
