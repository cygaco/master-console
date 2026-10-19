---
description: Report an epic's true, evidence-based status — percent completion, sprint roll-up, DoD progress, blockers, and tracker/roadmap reconciliation drift. Read-only. (Designed; build deferred.)
user-invocable: true
says:
  - epic status
  - how's the epic
  - where is the epic
  - how far along is the epic
says-args: topic
---

# /epic:status — Epic Status

> STATUS: designed — not yet built (build deferred)

This is a **design spec**, not an implementation. No backing JS ships with it.

## Purpose

Give an honest, evidence-based read of one epic (or all epics): percent
completion derived from landed sprints (not self-rated), DoD checkbox progress,
the sprint roll-up (Completed / Active / Planned), open blockers + risks, and any
drift between the epic file, ROADMAP § Epics, and the TRACKER header. Read-only —
it reports, it never mutates state.

## Inputs

```text
/epic:status [--id <E-SEGMENT-###>] [--all] [--json]
```

- `--id` — a single epic; `--all` — every `trackers/epics/E-*.md`.
- `--json` — machine-readable envelope for consumers/scans.

## Procedure (outline)

1. Load the epic file(s) + the companion plan artifact(s).
2. Roll up sprint states from § Related sprints (Completed/Active/Planned counts).
3. Derive a conservative completion from landed sprints; compare to the recorded
   percent (flag optimistic drift).
4. Parse DoD checkboxes (done vs open).
5. Cross-check epic state vs ROADMAP § Epics vs TRACKER (reconciliation drift).
6. Emit the status report (human or `--json`).

## Outputs

- A per-epic status report: state, conservative vs recorded %, sprint roll-up,
  DoD progress, blockers/risks, reconciliation-drift flags.
- No state mutation (read-only).
