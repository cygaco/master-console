---
description: "Assert every done/retrospected/released sprint has BOTH a Sprints-table ledger row AND a Shipped narrative entry in ROADMAP.md — covers the narrative half of /sprint:full Step 8b."
user-invocable: true
namespace: check
reads: [paths.sprintActiveRegistry]
writes: []
---

# /scan:roadmap-trace

`/sprint:full` Step 8b ALWAYS records a sprint to `ROADMAP.md` in two halves: a
**Sprints-table row** (enforced by `scripts/sprint/ledger.js`) and a **Shipped
narrative entry** (skill-body discipline). This check
closes that gap — it verifies every shipped sprint has **both**.

## Input

`$ARGUMENTS` → forwarded to `node scripts/check/roadmap-trace.js` (`--json` for
machine-readable output).

## Output

```
OK    <SP-id> (<status>)
FAIL  <SP-id> (<status>)  (ledger_row=<bool> shipped_narrative=<bool>)
# <traced>/<total> sprints traced
```

A sprint with status `done`, `retrospected`, or `released` in
`paths.sprintActiveRegistry` must appear as a ledger-table row (its id present)
AND in the `Shipped` narrative region (id or exact title under a `Shipped`
heading, including an `Ad-hoc / unplanned` subsection).

## Exit codes

- `0` — every tracked sprint is fully traced (or no sprints / no `ROADMAP.md` —
  fail-open warn, mirroring the ledger writer; an absent roadmap never blocks).
- `1` — at least one tracked sprint is missing its ledger row and/or Shipped
  narrative entry.

## Implementation

```bash
node scripts/check/roadmap-trace.js $ARGUMENTS
```

Wire into `/scan:full` so roadmap-trace drift surfaces in the unified health
sweep alongside architecture / references / requirements.

## Reference

- Step 8b: `.claude/commands/sprint/full.md`
- Ledger writer: `scripts/sprint/ledger.js` (anchor `<!-- ledger:sprints -->`)
- Backing script: `scripts/check/roadmap-trace.js`
