---
description: Run the regression-seed suite — the 26 recurring bug classes from the 0.17.0 spec, made runnable. Reports per-class pass/fail/gap + catch-rate. Role-aware (consumer-only checks are n/a in canonical).
---

# /scan:regressions — Recurring-bug-class regression suite

The runnable core of the 0.17.0 Per-Sprint Exhaustive Test-Suite System. Executes the detector for each of the **26 recurring bug classes** in `_requirements/07-testing/recurring-bug-classes.json` (the regression seed made executable) and reports a catch-rate.

## Usage

```
node scripts/testsuite/run.js $ARGUMENTS
```

- *(no args)* — human report (per-class table + summary)
- `--json` — machine output (consumed by `/scan:full`)
- `--quiet` — summary line only

## What it checks

The 26 classes mined from the dreams journal, sprint retros, events, and CLAUDE.md / MIGRATION.md / UPDATE.md hygiene sections (ROADMAP § *Mandatory regression seed*). Each maps to a detector: an existing `scan:*` / check engine (**covered**), an approximation (**partial**), or none yet (**gap** — the suite's build backlog).

## Result semantics

| Mark | Meaning |
|---|---|
| `PASS` | detector ran green — the class is held closed |
| `FAIL` | detector red = possible regression in a covered class → exit 1 |
| `n/a` | consumer-only detector, N/A in canonical (role-aware; interim until the shared repo-role resolver lands) |
| `gap` | no detector yet — the system's build backlog |
| `man` | manual/orchestrated detector (e.g. `scan:references`) — not auto-run |

Exit 0 when no canonical-expected detector failed; non-zero on a real regression. Gaps / manual / n/a never fail the run — they're reported as backlog.

## The per-sprint convention (0.17.0)

Every MC sprint keeps this suite green (modulo documented `n/a`/`gap`) **and** adds a detector for any newly-recurring bug class (≥2 occurrences or an `/issues:log` entry → a new registry row + a real detector in the same sprint). The seed grows with the framework. Mandatory in canonical; opt-in in consumer products (the role-aware enforcer is the 0.17.0 deliverable that gates this).

## Relationship

Wired into `/scan:full` (Tier 3). Mirror of the ROADMAP regression seed; reviving the `recurring-issues.jsonl` store (BC-22) is the structured-data counterpart.
