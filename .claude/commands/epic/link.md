---
description: Establish and verify an epic's linkages — its companion plan artifact, ROADMAP § Epics entry, TRACKER header, child sprints, and dependency edges to sibling epics — repairing the round-trip pointers. (Designed; build deferred.)
user-invocable: true
---

# /epic:link — Link an Epic

> STATUS: designed — not yet built (build deferred)

This is a **design spec**, not an implementation. No backing JS ships with it.

## Purpose

Establish and verify the full linkage graph for an epic so the enforced-tracker
cross-file checks pass: the `trackers/epics/<id>.md` ⇄ `_planning/epics/<id>.md`
round-trip, the ROADMAP § Epics entry, the TRACKER header pointer, the links to
every child sprint, and the dependency edges to sibling/prerequisite epics. Where
a pointer is missing or one-directional, repair it (additively).

## Inputs

```text
/epic:link --id <E-SEGMENT-###> [--verify-only] [--add-dep <E-OTHER-###>] [--add-sprint <S-id>]
```

- `--verify-only` — report missing/one-directional links without writing.
- `--add-dep` / `--add-sprint` — add a dependency edge or a child-sprint link.

## Procedure (outline)

1. Load the epic file + plan artifact.
2. Verify the round-trip plan ⇄ epic linkage (both pointers resolve).
3. Verify the ROADMAP § Epics entry references the epic ID (validate check `n`).
4. Verify the TRACKER header pointer + cross-file state reconciliation (check `r`).
5. Verify each § Related sprints link resolves to an existing sprint file.
6. Add/repair missing pointers additively; never break an existing link.
7. Emit a linkage report (resolved / missing / repaired).

## Outputs

- A linkage report; repaired round-trip + ROADMAP/TRACKER/sprint pointers.
- No state mutation under `--verify-only`.
