---
description: Mark an approved sprint release as deployed after the person ran the production deploy themselves, or roll the release record back when the deploy failed. The deploy gate of the sprint release flow; the person runs it.
user-invocable: true
---

# /sprint:deploy — Sprint Deploy Mark

The deploy step of a sprint release, split out of `/sprint:release` so the
rest of the release flow (checks, approval, report, retrospective) can run
without it. `/sprint:release` prepares the release and records its approval;
this skill marks the deployment the person ran, or rolls the record back.

`/sprint:deploy` NEVER performs a production deployment. The person runs the
deploy out-of-band and then this skill only marks it. Its own wording keeps it
in the deny class of the Skill-tool guard (`scripts/hooks/plain-guard.js`), so
a model never starts it: the person types it.

> Ledger contract — the deploy mark updates the release's `RELEASES.md` sprint row via `scripts/sprint/ledger.js` (fail-open: a ledger failure never blocks the mark). See `paths.sprintReference#ledger-discipline`.

## When to use

- `/sprint:release` has run and the release is in `ready_to_deploy`
  (checks green, approval recorded and bound).
- The person has run the production deploy themselves and wants it
  recorded, or the deploy failed and the release must be rolled back.

## Inputs

```text
/sprint:deploy --id <RL-id> [--by <name>] [--target "<env>"]
/sprint:deploy rollback --id <RL-id> --reason "<text>"
```

## Procedure

### Step 1 — Confirm the release is ready

```bash
node scripts/sprint/release.js show --id <RL-id>
```

The status must be `ready_to_deploy`. If it is `preparing` or
`approval_pending`, go back to `/sprint:release` (check, then approval).

### Step 2 — Mark the deployment

After the person's deploy completes:

```bash
node scripts/sprint/release.js deploy --id <RL-id> --by <user> --target "<env>"
```

This sets `deployed_at`, `deployed_by`, and `status: deployed`. The script
refuses a release that is not in `ready_to_deploy`, and
`scripts/hooks/sprint-approval-guard.js` refuses the command when the
release has no approved `approval_ref`.

### Step 3 — Roll back when the deploy fails

If the deploy fails or surfaces a regression:

```bash
node scripts/sprint/release.js rollback --id <RL-id> --reason "<text>"
```

This sets `rollback_at`, `rollback_reason`, and `status: rolled_back`.
Rollback needs no approval of its own (it is a safety action), but the
reason must be recorded.

### Step 4 — Hand back to the release flow

Run `/sprint:release --id <RL-id>` again: its Recovery section picks up a
`deployed` or `rolled_back` release and continues with the report, the
sprint archive, the retrospective trigger and the final checkpoint.

## Outputs

| Artifact | Path |
|---|---|
| Release record (deployed or rolled back) | `paths.sprintReleases/<RL-id>.yaml` |
| Releases ledger row | `RELEASES.md` (via `scripts/sprint/ledger.js`) |

## Approval gates

- Production deploy: **always** requires an approval record, recorded by
  `/sprint:release` Step 4 and bound with `release.js approve`.

## Non-Goals

- `/sprint:deploy` does NOT deploy code.
- `/sprint:deploy` does NOT record or bypass approval; that is
  `/sprint:release`.

## Reference

See `paths.sprintReference` (including § "Crash recovery rule").
