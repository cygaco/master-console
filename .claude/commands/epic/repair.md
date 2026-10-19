---
description: Detect and repair a drifted or malformed epic file — missing §-sections, blank required sections, broken links, percent/state inconsistencies, and tracker/roadmap reconciliation drift — fail-closed, additive, with a repair report. (Designed; build deferred.)
user-invocable: true
---

# /epic:repair — Repair an Epic

> STATUS: designed — not yet built (build deferred)

This is a **design spec**, not an implementation. No backing JS ships with it.

## Purpose

Bring a drifted or malformed epic file back into a validate-shape, reconciled
state: restore missing §-sections (from `EPIC_TEMPLATE.md`), fill blank required
sections with the explicit sentinel, repair broken intra-repo links, reconcile a
`Completed`-but-not-100% (or 100%-but-not-Completed) inconsistency, and re-sync
the epic state with ROADMAP § Epics + the TRACKER header. Additive + fail-closed:
it never deletes content and surfaces anything it cannot safely auto-repair.

## Inputs

```text
/epic:repair --id <E-SEGMENT-###> [--diagnose-only] [--from-template]
```

- `--diagnose-only` — report drift without writing.
- `--from-template` — restore any missing §-section scaffolding from `EPIC_TEMPLATE.md`.

## Procedure (outline)

1. Load the epic file; run the section-completeness check (`verifyEpicMarkdown`,
   shared with `/epic:plan`) + the relevant tracker cross-file checks.
2. Diagnose: missing/blank sections, broken links, percent/state inconsistency,
   reconciliation drift vs ROADMAP/TRACKER, broken plan ⇄ epic round-trip.
3. Auto-repair the safe classes (scaffold missing sections, sentinel blanks, fix a
   resolvable link, re-point the round-trip); flag the rest for manual resolution.
4. Re-run the checks to confirm green; emit a repair report (repaired / flagged).

## Outputs

- A repaired, validate-shape epic file (additive) — or, under `--diagnose-only`, a
  drift report.
- A list of anything that could not be safely auto-repaired.
