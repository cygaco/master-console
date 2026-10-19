---
description: Report-only plan-lint — flags any plan artifact under _planning/epics/** (optionally _planning/plans/**) that omits a principle-required section: a named enforcer, proof/acceptance, or a blast-radius assessment. The named enforcer for the planning principles (the planning principles doc). Fail-open; never blocks.
---

# /scan:planning-principles — Planning-principles plan-lint

The named enforcer for the planning principles doc.
The planning principles say every plan must name an **enforcer** per policy,
state its **proof / acceptance**, and assess its **blast radius**. This
scan makes a plan that OMITS any of those three self-detecting — closing the
gap where principles live only in a prompt and nothing checks them.

## What it does

```
node scripts/checks/planning-principles.js [--json] [--include-plans] [--planning-dir <path>]
```

- Walks the lifecycle-store epic plan artifacts (`_planning/epics/**`). `--include-plans`
  also scans `_planning/plans/**` (the separate org/GTM expansion corpus — opt-in).
- For each plan `.md` (the dir-contract `README.md` is excluded), checks the body for the
  three principle-required sections:
  - **enforcer** — `enforcer` / `enforced by`
  - **proof / acceptance** — `proof` / `required-proof` / `acceptance` / `verified by`
  - **blast-radius** — `blast radius` / `blast-radius`
- A doc missing one or more → a finding naming the file + which sections are absent.
- `--planning-dir <path>` points the scan at a fixture tree (used by the regression test).
- `--json` emits a machine envelope (`{ ok, check, counts:{docs,gaps}, findings[] }`).

## Exit codes

- `0` — **always** (REPORT-ONLY). Gaps are printed,
  never blocking. **FAIL-OPEN:** a missing planning dir, an unreadable file, or any internal
  error degrades to a clean exit 0 with a note — an advisory plan-lint must never break a
  scan or a build.

`--enforce` is the ramp-to-blocking tail: gaps exit 1 and an internal error exits 2
(fail-closed); without it the scan stays report-only (the same ramp pattern as
`/scan:coverage-gate` and the mode-lifecycle coverage enforcers).

## Pairs with

- The planning principles doc — the canonical planning principles this lints against.
- The lifecycle-store contract (subdirs, tracker-linkage, ship boundary).
- `/sprint:plan` + the (planned) `/epic:plan` — the producers of the plan artifacts this scans.
- Wired report-only into `/scan:full` (Dispatch-shape integrity block).
