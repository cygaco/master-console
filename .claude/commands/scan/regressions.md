---
description: Run the regression-seed suite — the recurring bug classes, made runnable. Reports per-class pass/fail/gap + catch-rate. Framework repository only (an install does not carry the suite).
---

# /scan:regressions — Recurring-bug-class regression suite

The runnable core of the Per-Sprint Exhaustive Test-Suite System. Executes the detector for each recurring bug class in `_requirements/07-testing/recurring-bug-classes.json` (the regression seed made executable) and reports a catch-rate.

This suite runs in the framework repository only. An installed product does not carry `scripts/testsuite/` or the bug-class registry. The command below runs the suite where it exists; in a product it prints one plain line — `the regression suite runs in the framework repository only; nothing to check in this project` — and exits 0. When the suite is missing and `scripts/mc/repo-role.js` resolves the role `canonical` (the framework repository itself), a missing suite is a broken tree: the command prints `regression suite missing in the framework repo` on stderr and exits 2.

## Usage

```
node scripts/mc/scan-regressions.js $ARGUMENTS
```

- *(no args)* — human report (per-class table + summary)
- `--json` — machine output (consumed by `/scan:full`)
- `--quiet` — summary line only

## What it checks

Every class in the registry. Each maps to a detector: an existing `scan:*` / check engine (**covered**), an approximation (**partial**), or none yet (**gap** — the suite's build backlog).

## Result semantics

| Mark | Meaning |
|---|---|
| `PASS` | detector ran green — the class is held closed |
| `FAIL` | detector red = possible regression in a covered class → exit 1 |
| `n/a` | the registry marks the detector consumer-only (`expect_canonical: "na"`) and it did not pass, or it failed while every one of its `na_when` conditions holds for this tree |
| `gap` | no detector yet — the system's build backlog |
| `man` | manual/orchestrated detector (e.g. `scan:references`) — not auto-run |

Exit 0 when no canonical-expected detector failed; non-zero on a real regression. Gaps / manual / n/a never fail the run — they're reported as backlog.

## The per-sprint convention

Every MC sprint keeps this suite green (modulo documented `n/a`/`gap`) **and** adds a detector for any newly-recurring bug class (≥2 occurrences or an `/issues:log` entry → a new registry row + a real detector in the same sprint). The seed grows with the framework. It is mandatory in the framework repository.

## Relationship

Wired into `/scan:full` (Tier 3). Mirror of the ROADMAP regression seed.
