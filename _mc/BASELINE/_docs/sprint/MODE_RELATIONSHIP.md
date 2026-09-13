# Sprint v0.2 — Relationship to Existing Modes

Sprint is a workflow layer above modes. Modes (`solo`, `adhoc`,
`oneshot`) remain user-controlled execution strategies. Sprint never
auto-switches modes. In v0.2 multiple sprints can coexist; each can
be in a different mode if needed. Modes stay orthogonal to sprint
lanes (see `LANES.md`).

## Mental model

```
/sprint:*  = product workflow layer   (what to do — per-sprint)
/mode:*    = execution strategy layer (how to do it — global to the session)
lanes      = isolation primitive      (where to do it — per-sprint, worktree/branch/default)
```

A sprint can run in any mode. Mode choice is a separate decision.
Lane choice is a per-sprint decision recorded on the Plan Contract.

## What each mode does for each sprint phase

### Plan (`/sprint:plan`)

| Mode | Behavior |
|---|---|
| solo    | Alpha plans directly. Reads repo as needed. Produces Plan Contract. |
| adhoc   | Alpha plans. For Class B/C decisions per `paths.decisionPolicy`, Beta is consulted via SendMessage before surfacing to user. Gamma is NOT invoked during plan. |
| oneshot | Allowed but unusual. Oneshot is for full skeleton rebuilds; planning a new sprint mid-oneshot is rare. The Plan Contract still gets written; the recommended_mode is usually `adhoc` once oneshot completes. |

### Design (`/sprint:design`)

| Mode | Behavior |
|---|---|
| solo    | Alpha scaffolds requirements + mints tickets directly. |
| adhoc   | Alpha scaffolds; Beta reviews requirements bundle before tickets are minted. Gamma is NOT invoked. |
| oneshot | Not the intended path. Skeleton-rebuild work is governed by Delta's protocol, not `/sprint:design`. |

### Execute (`/sprint:execute`)

| Mode | Behavior |
|---|---|
| solo    | Alpha runs Ralph loops directly. |
| adhoc   | Alpha runs Ralph loops. When a ticket needs a build/gauntlet cycle, Alpha dispatches to Gamma (existing adhoc dispatch). Sprint progress is the durable record; team-task ownership in adhoc is ephemeral. |
| oneshot | Halt sprint execution. Run `/mode:oneshot` instead. Re-enter the sprint after the oneshot completes. |

### Release (`/sprint:release`)

| Mode | Behavior |
|---|---|
| solo    | Alpha drives the release directly. User approves production deploy. |
| adhoc   | Alpha drives; Beta is consulted for ship/no-ship judgment. |
| oneshot | Not the intended path. Halt oneshot, run `/sprint:release`. |

## The tracker-source-of-truth rule

In every mode, the sprint tracker is the durable task-truth source.
Team tasks (in adhoc) and heartbeat state (in oneshot) are ephemeral
coordination — never the record of decisions.

This was the explicit closing rule from Phase 0 workstream I (see
`.claude/commands/mode/adhoc.md` last section + `_docs/phase0/adhoc-primitive-limits.md`).

Sprint v0.1 honors it:

- Tickets live in `paths.sprintTickets/<T-id>.yaml`, not team tasks.
- Issues live in `paths.sprintIssues/<I-id>.yaml`, not chat or team
  tasks.
- Approvals live in `paths.sprintApprovals/<AP-id>.yaml`, not chat.
- Crash recovery reads `paths.sprintProgress`, not team state.

## Mode invocation is the user's

Sprint never runs `/mode:*` for the user. The Plan Contract's
`recommended_mode` is advisory. The actual mode switch is something
the user types.

This keeps mode lifecycle in the user's hands and avoids the kinds of
silent mode flips that caused trouble in earlier MC versions.

## Carrying state across mode switches

If the user does switch modes mid-sprint:

1. `/sprint:execute` may be running with `current_ticket: T-...`.
2. User runs `/mode:oneshot` (or similar).
3. The mode marker (`.claude/runtime/mode.json`) updates.
4. Delta takes over.
5. After oneshot completes, user runs `/mode:adhoc` (or `/mode:solo`).
6. They re-enter `/sprint:execute`.
7. The sprint tracker is unchanged — `current_ticket` is still set,
   `sprint-progress.yaml` still has the resume command, the Ralph
   file still has the loop state.
8. Alpha resumes from the tracker.

The sprint tracker is mode-independent. Modes can change; sprint
state cannot be lost.

## When sprint and oneshot disagree

`/mode:oneshot` writes a lock (lockOwner = delta, activeBuild = branch).
If sprint commands attempt mode-relevant work while oneshot has a lock,
they:

- Refuse to start a Ralph loop.
- Refuse to mint executable tickets without explicit override.
- Refuse to mark a release deployed.

Resolution: halt oneshot (clear the lock), or wait for oneshot to
complete naturally, before resuming sprint execution.

This is the same behavior `/mode:solo` and `/mode:adhoc` have when
oneshot is locked.

## What sprint v0.1 does NOT do to modes

- It does not retune `/mode:oneshot` (explicit prompt non-goal).
- It does not add a new mode.
- It does not consume Delta's protocol files or store.
- It does not change `scripts/mode-set.js`.
- It does not alter the mode marker schema.
- It does not change `.claude/agents/store.json` or
  `.claude/agents/02-oneshot/.system/store.json`.

## See also

- `paths.sprintReference` — full reference doc.
- `_docs/sprint/CRASH_RECOVERY.md` — recovery across mode changes.
- `_docs/phase0/adhoc-primitive-limits.md` — what `/mode:adhoc` cannot
  fix in-repo.
