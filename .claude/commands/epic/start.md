---
description: Transition a planned epic into active execution — mint its first wave of sprints, set state to Active, and stand up the required mode/team. (Designed; build deferred.)
user-invocable: true
says:
  - start the epic
  - kick off the epic
  - begin the epic
  - epic start
says-args: topic
---

# /epic:start — Start an Epic

> STATUS: designed — not yet built (build deferred)

This is a **design spec**, not an implementation. No backing JS ships with it.
The load-bearing two of the `/epic:*` suite (`/epic:plan`, `/epic:fold`) are
built; the other eight (this one) are designed only.

## Purpose

Transition an epic from `Planned`/`Ready` to `Active`: confirm its plan artifact
and DoD exist, mint the first wave's sprint candidates as real sprints, set the
epic state to Active in its tracker file (and reconcile ROADMAP + TRACKER), and
stand up the required mode/persistent-team per the mode-lifecycle registry.

## Inputs

```text
/epic:start --id <E-SEGMENT-###> [--wave <n>] [--no-team]
```

- `--id` — the epic to start (must already exist via `/epic:plan`).
- `--wave` — which wave's sprint candidates to mint (default: the first
  unstarted wave).
- `--no-team` — skip team stand-up (planning-only start).

## Procedure (outline)

1. Locate + read the epic file; refuse if absent or already `Completed`/`Cancelled`.
2. Verify the plan artifact (`_planning/epics/<id>.md`) and a non-empty DoD exist.
3. Resolve the wave's sprint candidates from § Related sprints / the plan.
4. Mint each as a real sprint (`/sprint:plan` per candidate).
5. Set epic state → `Active`; reconcile ROADMAP § Epics + the TRACKER header.
6. Stand up the required mode/team via the mode-lifecycle registry (unless `--no-team`).
7. Emit a start report (sprints minted, state change, team status).

## Outputs

- Epic state set to `Active` in `trackers/epics/<id>-<slug>.md` (+ ROADMAP/TRACKER reconciliation).
- The wave's sprint candidates minted as real sprints.
- A start report (stdout).
