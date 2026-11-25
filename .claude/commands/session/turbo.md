---
description: Go fast for this work session (session speed mode) — pre-authorize a batch of local high-impact actions (permissions.allow), check that the operator's user settings trust this repository for pushes (printing the one command if not), and switch the build cadence to the speed levers.
user-invocable: true
disable-model-invocation: true
---

# /session:turbo

Three things in one command, for when you want a fast work session:

1. **Permission pre-auth** (the original `/turbo`) — additively merge curated
   `permissions.allow` entries by scope for a bounded TTL, removing the
   "yes manifest / yes destructive-git" keyboard cadence. Thin wrapper
   over `scripts/turbo/apply.js` (snapshots `.claude/settings.json`, writes a
   runtime state file with a TTL, pairs with `scripts/hooks/authorization-gate.js`).
2. **Push trust check** — turbo cannot grant a push: the harness safety check reads
   its trust rules only from the operator's own user settings
   (`~/.claude/settings.json` `autoMode`), never from the project's settings. Apply
   and `--status` check (read-only) whether that file trusts this repository (its
   own block, or an older whole-account block for its account). If it does not,
   they print the command the operator runs: `node scripts/operator/trust-my-repos.js`.
   That command is a dry run by default — it prints the exact lines it would add or
   replace and writes nothing; the operator re-runs it with `--write` to apply. It
   trusts this repository only unless `--whole-account` is named. Turbo never runs it.
3. **Speed cadence** — switched on by every apply. See "Speed cadence" below.

> Relocated from the root `/turbo` into the `session:` namespace (it's a
> session-scoped mode). `/turbo` remains as a thin alias so `/mode:*` `--turbo`
> references keep working.

## Inputs

```text
/session:turbo [--scope <csv>|all] [--ttl <duration>] [--reason "<text>"] [--off|--status]
```

- `--scope <csv>` — comma-separated scope vocab (below). Default: `manifest-edit,write-jsonl,worktree-ops`. There is no push scope (see the push trust check above).
- `--scope all` — every scope except the safety floor.
- `--ttl <duration>` — e.g. `30m`, `60m`, `2h`. Default: `60m`.
- `--reason "<text>"` — operator-readable reason logged with the authorization.
- `--off` — restore `.claude/settings.json` from the pre-turbo snapshot; delete the runtime auth file.
- `--status` — active scopes, TTL remaining, snapshot path, bypass counter, cadence, push trust.

## Scope vocabulary

| Scope | Pattern category |
|---|---|
| `manifest-edit` | Edits / writes to `.claude/manifest.json` |
| `destructive-git` | `git rm`, `git reset --hard` (still safety-floored) |
| `node-e-fs` | `node -e` invocations that write files |
| `write-jsonl` | `.jsonl` file writes |
| `worktree-ops` | `git worktree` operations |

## Speed cadence (the build levers)

While turbo is on, bias the build toward these levers — each one removes a class of
round-trip (`apply.js` prints them and records `cadence: "speed"`):

1. **Parallel builds by default.** Fan out independent tickets / modules to
   concurrent builder subagents against a shared interface, rather than a serial
   ticket-by-ticket loop.
2. **Batched Beta.** For low-risk sprints, do ONE upfront plan-consult that
   pre-clears the phase boundaries (β names any boundary that genuinely needs a
   halt) instead of a SendMessage round-trip at all four boundaries. ESCALATE
   still hard-halts.
3. **Right-size the gauntlet, never skip it.** The gauntlet package selector
   (applied by hand until its runtime wiring lands) picks the package from the
   change classification trailer (`Change`/`Blast`/`Risks`): a minor non-security bugfix
   gets one focused reviewer, a major or release change gets the wider package. Turbo
   bounds the gauntlet by that package; it does not skip it.
4. **Work on main closes with the store update.** `/sprint:full` skips
   release-prep when HEAD is already on `origin/main`; the retro step's status flip
   to `closed` is the close. Merge through the broker
   (`node scripts/dispatch/broker-merge.js <branch> --sp-id <id>`).
5. **Don't over-deliberate reversible bookkeeping.** Cheap, reversible, local-only
   actions (status flips, local merges, doc edits) are act-don't-deliberate.

The matching `/sprint:full` `turbo` autonomy preset (in `paths.sprintFullAutonomy`)
encodes 2-4 declaratively (`beta_cadence: batched`, `gauntlet_package: auto`,
`parallel_builds_default`, `engine_sprint_fast_close`). Adding that preset widens
autonomy, so it requires explicit operator approval +
`scripts/sprint/full.js` cadence wiring; it is not enabled by default.

## Safety floor (NEVER bypassed, even with `--scope all`)

- Forced push to the default branch
- Delete branches matching `backup/*` or `pre-*`
- Service signups / purchases
- API spend ≥ 5 USD per session
- Beta consultation `ESCALATE` returns
- Delete tracked uncommitted user work
- Production deploy / destructive migration

Enforced at write time in `scripts/turbo/apply.js` and again in
`scripts/hooks/authorization-gate.js`. The cadence changes speed, never the floor.

## Procedure

### 1. Apply (permission layer)
Run `node scripts/turbo/apply.js --scope <csv> --ttl <duration> --reason "<text>"`.
It snapshots settings, merges the scoped `permissions.allow` entries, writes the
runtime state file + TTL, prints active scopes, the push trust result and the
speed cadence.

### 2. Push trust
If the output says `push trust: MISSING`, hand the operator the printed command
(`node scripts/operator/trust-my-repos.js`) in one `▶️ RUN THIS` block: it previews
the change and writes nothing; after reading the preview the operator re-runs it with
`--write`. Never run it yourself: with `--write` it edits the operator's own user settings.

### 3. Status / Off
- `--status` → `node scripts/turbo/apply.js --status`.
- `--off` → `node scripts/turbo/apply.js --off` (restores the snapshot).

## Reference
- Engine: `scripts/turbo/apply.js`
- Push trust (operator-run): `scripts/operator/trust-my-repos.js`
- Authorization hook: `scripts/hooks/authorization-gate.js`
- Autonomy preset pairing: `paths.sprintFullAutonomy` (`turbo` — not enabled by default)
