---
description: Manage an epic's acceptance criteria — ensure all 20 AC categories are present, each names its proof, and report AC coverage. Wraps /scan:ac-coverage at the epic grain. (Designed; build deferred.)
user-invocable: true
---

# /epic:acceptance — Epic Acceptance Criteria

> STATUS: designed — not yet built (build deferred)

This is a **design spec**, not an implementation. No backing JS ships with it.

## Purpose

Ensure an epic plan carries acceptance criteria for all **20 enforcement-criteria
categories** (correct mode selection · switching · team teardown/creation/
verification · lifecycle-hook firing/ordering · agent dispatch · sprint/epic
binding · tracker linkage · planning-artifact persistence · provider readiness ·
safety gates · test strategy · fixture/holdout coverage · review requirements ·
completion proof · user-approval points · learning/persistence capture ·
blast-radius analysis), and that **each AC names its proof** (a planted fixture, a
real record, a green/blocked exit code, or a captured event sequence). Report
coverage; flag any omitted category.

## Inputs

```text
/epic:acceptance --id <E-SEGMENT-###> [--add <category>="<criterion>"] [--check]
```

- `--check` — report coverage only (which of the 20 categories are present + proven).
- `--add` — append a criterion for a category.

## Procedure (outline)

1. Load the epic plan's § Acceptance criteria.
2. Map present criteria to the 20 categories; list omissions.
3. For each present criterion, verify it names a proof; flag "implemented"-only ACs.
4. With `--add`, append the criterion to the right category.
5. Emit a coverage report (categories covered/omitted, ACs missing a proof);
   defer to `/scan:ac-coverage` for the binding enforcement.

## Outputs

- An AC coverage report (20-category presence + per-AC proof check).
- Optionally, a new criterion appended to the epic plan.
