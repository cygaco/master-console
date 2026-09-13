# Issues — MC

> **What this is.** This file is `paths.sprintIssuesLedger` — a lightweight human-readable issue ledger kept in sync with per-issue YAML files under `.claude/project/sprint/issues/` by `scripts/sprint/issue.js`. Lives at repo root because the `paths.json` binding points here.

Human-readable issue ledger. The machine-readable companion is the
per-issue YAML files under `.claude/project/sprint/issues/`. Both are
kept in sync by `scripts/sprint/issue.js`.

This file is intentionally lightweight. It exists so a human can scan
recent issues without reading YAML. Use `/sprint:plan`, `/sprint:design`,
or `/sprint:execute` to surface and promote issues to tickets.

> Scope: PRODUCT issues — bugs, regressions, edge cases, deferred work,
> rejected fixes — discovered while running sprints for **this** project.
>
> SYSTEM-level recurring issues (MC framework, hooks, agent system)
> still go to `paths.recurringIssuesFile` via `/issues:log`.

## Open

_(none yet — `/sprint:execute` will append entries here as it discovers issues)_

## In progress

_(none)_

## Fixed / Verified

_(none)_

## Deferred / Abandoned

_(none)_

## Notes

- Reopen rule: any issue can be reopened. The reopen is recorded in the
  corresponding `issues/<id>.yaml#fix_attempts` + a new line in the
  appropriate section here.
- Bugfix rule: if a fix fails after 3 serious attempts, the issue must
  be marked `deferred` or `abandoned` unless it blocks core flow.
  Escalate via `/fix:deep`.
- Cross-link rule: promoted-to-ticket issues carry a `→ T-…` reference
  to the ticket file.

### [SP-20260513-001] I-20260513-001 — product-bootstrap unit tests mutate live paths.json

- **Status:** open
- **Severity:** low
- **Discovered:** 2026-05-13T20:50:42.328Z during SP-20260513-001:design
- **Sprint:** SP-20260513-001
- **Ticket:** —

**Expected:** Tests should not mutate live .claude/paths.json
**Actual:** scripts/product/bootstrap.js#registerPaths writes briefsCurrent into the real paths.json during tests; cleanup deletes output but cannot revert paths.json. Future fix: --paths-json override flag.



YAML: `.claude/project/sprint/issues/I-20260513-001.yaml`

