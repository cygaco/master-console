---
description: Read-only status view of every live sprint — shows id, lane, status, phase, last checkpoint, and the resume command for each in-flight sprint, and flags drift between paths.sprintActiveRegistry and on-disk sprints/.
user-invocable: true
tags: [sprint, status, read-only]
says:
  - sprint status
  - where are the sprints
  - what's running
  - how's the sprint going
  - show me live sprints
---

# /sprint:status — Sprint Status

Read-only view of every live sprint. Shows id, lane, status, phase,
last checkpoint, and resume command. In `executing` state, the row also
shows the active ticket and Ralph loop number.

Flags drift between `paths.sprintActiveRegistry` and the on-disk
`sprints/` directory:

- `orphaned` — a `sprints/SP-X/` directory exists on disk but no entry
  in the registry lists it.
- `missing-subdir` — a registry entry has no `current.yaml` /
  `progress.yaml` at its declared pointer.

## When to use

- You want to know what's in flight without grepping `sprints/*/*.yaml`.
- You're about to start work and want to confirm which sprint is the
  primary.
- A sprint command stopped mid-loop and you need the resume command
  for the right id.
- You suspect a sprint's tracker is partially populated (orphan subdir
  or registry-vs-disk drift).

## Inputs

```text
/sprint:status [--json]
```

- `--json` emits a machine-readable array instead of the table.

## Procedure

```bash
node scripts/sprint/status.js [--json]
```

The script:

- Reads `paths.sprintActiveRegistry` for the live set.
- For each entry, reads the per-sprint `current.yaml` + `progress.yaml`
  to populate phase, status, current ticket, loop number, last
  checkpoint, and resume command.
- Marks the registry primary with a `*` in the first column.
- Lists orphan subdirs (in `sprints/` but not in the registry).

## Outputs

Stdout only. No tracker writes.

## Approval gates

None. Status is read-only.

## Recovery

This command is itself a recovery aid — running it tells you which
sprint to resume and how. There is no state to recover for
`/sprint:status` itself.

## Relationship to existing commands

- `/sprint:plan` adds a new sprint to the registry (a later release may add
  `--keep-primary` later if needed).
- `/sprint:execute` honors `--sprint <SP-id>` to target a non-primary
  sprint.
- `/sprint:release` archives a sprint and removes it from the registry.

`/sprint:status` is a passive reader — it never reconciles drift. If
the table shows `orphaned` or `missing-subdir`, fix the registry or
the subdir explicitly; do not let a sync tool auto-resolve.

## Reference

`paths.sprintReference` § "Lanes & parallel sprints (v0.2)".
