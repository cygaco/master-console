---
description: Split an over-large epic into two or more coherent epics — partition scope/sprints/DoD/AC, preserve provenance and dependencies, and create the child epic files with cross-links. (Designed; build deferred.)
user-invocable: true
---

# /epic:split — Split an Epic

> STATUS: designed — not yet built (build deferred)

This is a **design spec**, not an implementation. No backing JS ships with it.

## Purpose

When an epic has grown beyond one coherent spine (for example, a wave of work that is
really its own epic), split it into two or more child epics. Partition scope,
sprint candidates, DoD items, and acceptance criteria cleanly; preserve
provenance (each child records its parent + the split rationale) and the
dependency edges between the children.

## Inputs

```text
/epic:split --id <E-SEGMENT-###> --into <E-NEW-001>,<E-NEW-002> [--map <assignment-file>]
```

- `--id` — the source epic.
- `--into` — the new child epic IDs.
- `--map` — an explicit assignment of sprints/scope/DoD lines to children;
  otherwise the skill proposes a partition for approval.

## Procedure (outline)

1. Load the source epic + plan; refuse if `Completed`/`Cancelled`.
2. Propose (or read `--map`) a partition of scope / sprint candidates / DoD / AC.
3. Surface the partition for approval (a split is taste-heavy/semi-irreversible).
4. Create each child epic file via the `/epic:plan` builder, carrying the
   partitioned scope + a provenance pointer to the parent + the split rationale.
5. Update the source epic: mark `Superseded` (or narrow its scope) and link the
   children; preserve dependency edges between children.
6. Reconcile ROADMAP § Epics + TRACKER for the parent + every child.

## Outputs

- New child epic files (+ companion plan artifacts) with parent provenance.
- Source epic narrowed or marked `Superseded`, cross-linked to the children.
- ROADMAP/TRACKER reconciliation for all involved epics.
