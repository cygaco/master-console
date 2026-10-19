---
description: Close a completed epic — verify every DoD item is satisfied + evidenced, fill the Completion record, set state to Completed at 100%, and reconcile ROADMAP/TRACKER. Refuses to close on unmet/un-evidenced DoD. (Designed; build deferred.)
user-invocable: true
says:
  - close the epic
  - wrap up the epic
  - finish the epic
  - epic close
says-args: topic
---

# /epic:close — Close an Epic

> STATUS: designed — not yet built (build deferred)

This is a **design spec**, not an implementation. No backing JS ships with it.

## Purpose

Close an epic honestly. An epic reaches `Completed`/100% ONLY when every DoD item
is satisfied AND evidenced (a planted-fixture-fail, a real record, a green exit
code, or a captured event sequence — never "implemented"). This skill verifies
that, fills the Completion record, sets the terminal state, and reconciles the
roadmap + tracker. It **refuses to close** when any DoD item is unmet or
un-evidenced (the gate against unevidenced completion claims).

## Inputs

```text
/epic:close --id <E-SEGMENT-###> [--force-evidence <evidence-file>]
```

- `--id` — the epic to close.
- `--force-evidence` — supply a consolidated evidence map for the DoD items
  (each item → its proof); the skill cross-checks rather than trusting a flag.

## Procedure (outline)

1. Load the epic file + plan; parse the DoD checkboxes.
2. For each DoD item, require evidence (from the Evidence log / supplied map);
   refuse to close if any item is unchecked or un-evidenced.
3. Verify all § Related sprints are `Completed` (or explicitly descoped).
4. Fill the Completion record (final state, 100%, timestamp, DoD reference,
   evidence links, session IDs, related completed sprints).
5. Set state → `Completed`, percent → 100%.
6. Reconcile ROADMAP § Epics (→ Completed) + the TRACKER header.

## Outputs

- Epic state `Completed`/100% with a filled Completion record — or a **refusal**
  listing the unmet/un-evidenced DoD items.
- ROADMAP/TRACKER reconciliation.
