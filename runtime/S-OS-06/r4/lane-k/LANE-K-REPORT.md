# S-OS-06 r4 — Lane K report: property adjudication (A instrument / B record / RESIDUE)

**Status: IN PROGRESS.** This is the first commit of the report. It was written before the adjudication was re-run,
so a reap can't take the work with it. Sections marked *IN PROGRESS* are filled in by later commits on this branch.

## Provenance of this lane's artifacts

- Previous dispatch: reaped at the 20-minute wrapper bound (`builder_timeout_reap`, elapsed 1200364 ms, stdout 0 bytes,
  zero commits). The instrument and decision record survived on disk uncommitted.
- Committed as-is at `7b04cdd4`:
  - `runtime/S-OS-06/r4/lane-k/adjudicate-k.js`: the instrument. It reads files and fixes nothing.
  - `runtime/S-OS-06/r4/lane-k/adjudication-k.decisions.json`: the decision record the instrument consumes.
- Decision record `measuredHead`: `56a16fc19269d217879e0a844a15253d9a24bdbc`. Branch HEAD before the commit above was
  `56a16fc1`, so it matches. *IN PROGRESS: re-confirm when the instrument runs.*

## Three sets (A / B / RESIDUE), with counts and per-file reasons

*IN PROGRESS.*

## Regression directory `tests/regression/S-OS-06/`, per file

*IN PROGRESS.*

## The 21 authored join members (lane G `join-authored-for-K.json`)

*IN PROGRESS.*

## The single continuous-integration hit

*IN PROGRESS: identify it only. Not adjudicated, not edited.*

## Provenance document

PROVISIONAL, pending an operator decision. Not settled. *IN PROGRESS: name the file.*

## β's expectation vs the measured result

β's expectation, recorded before measuring: RESIDUE is zero for dreams, reports, archive and decision records, and
non-zero for the planning directory. *IN PROGRESS: compare with the measured result.*
