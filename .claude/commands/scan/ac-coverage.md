---
description: Read-only audit of acceptance-criteria.md verified_by:- linkage across active sprints.
user-invocable: true
namespace: check
reads: [".claude/project/sprint/sprints/*/current.yaml", ".claude/project/sprint/plan-contracts/*.yaml", ".claude/project/sprint/requirements/*/acceptance-criteria.md", "_planning/epics/*.md", "scripts/sprint/ac-categories.js"]
writes: []
---

# /scan:ac-coverage

Read-only audit of the `verified_by:` AC-linkage convention
used by Sprint Goal Verification. Scans every active
sprint's `acceptance-criteria.md` and reports per-AC linkage state:

- `executable` — has a `verified_by: <test-file>::<test-name>` line
- `not_applicable` — has `verified_by: not_applicable — <justification>` with a non-empty justification
- `missing` — no recognized `verified_by:` line (or empty justification, or a leftover placeholder)

Diagnostic only. **Never modifies tracker state.**

## Input

```
$ARGUMENTS  →  forwarded to: node scripts/sprint/check-ac-coverage.js
  --sprint <SP-id>     audit a specific sprint instead of all active sprints
  --json               machine-readable output (array of per-sprint reports)
  --categories         AXIS 2 — the 20 enforcement-criteria categories
  --file <path>        (axis 2) audit one plan/epic/sprint AC artifact by path
  --enforce            (axis 2) exit non-zero on an uncovered category (opt-in)
  --help               print usage
```

## Two coverage axes

1. **Per-AC linkage (default).** Each Given/When/Then `AC-N.N` has a real
   `verified_by:` line. This is the original convention.
2. **The 20 enforcement-criteria categories (`--categories`).**
   A *different* axis: does the plan/epic/sprint AC artifact carry AC for **all
   20** categories — *correct mode selection · mode switching · team teardown ·
   team creation · team verification · lifecycle-hook firing · hook ordering ·
   agent dispatch · sprint/epic binding · tracker linkage · planning-artifact
   persistence · provider readiness · safety gates · test strategy ·
   fixture/holdout coverage · review requirements · completion proof ·
   user-approval points · learning/persistence capture · blast-radius analysis* —
   each with a proof? The single source for this list is
   `scripts/sprint/ac-categories.js` (the checker, the `/epic:plan` scaffold, and
   the tests all read the SAME array — no drift). A category is
   **covered** when the artifact NAMES it and a proof / `verified_by:` sits in its
   window; **named-but-unproven** when it carries only a bare `proof: TODO` stub;
   **missing** when not named at all.

   **Report-only ramp.** A plan missing categories is FLAGGED (listed in
   findings) and **exits 0** — it is NOT blocked, matching the rest of
   the report-only→blocking discipline until operator sign-off
   flips it. `--enforce` opts into a non-zero exit on any gap (off by default).
   **Fail-open:** an unreadable/absent artifact reports nothing and exits 0.

## Output

Prose default — one summary line per sprint plus a missing-AC breakdown when applicable:

```
ac-coverage — sprint <SP-id>: 8 executable, 2 not_applicable, 1 missing  (total: 11)
  missing ACs:
    - AC-3.1.1 (line 47; placeholder)
```

JSON: array of objects `{ sprint_id, title, gate_applicable, goal_verification_reproduction, acceptance_criteria_path, total_acs, executable, not_applicable, missing, details[] }`.

## Empty-state behavior

- No active sprints in registry → stderr `no active sprints to audit` + exit 1.
- Sprint has no `acceptance_criteria` linked → ERROR line per sprint, gate_applicable reflects plan_contract.goal_verification presence.

## Exit codes

- `0` all ACs linked (or `goal_verification` absent — gate is not applicable; report is informational)
- `1` at least one sprint with `goal_verification` has `missing > 0`, OR no active sprints
- `2` usage error

## Implementation

```bash
node scripts/sprint/check-ac-coverage.js $ARGUMENTS
```

## Relationship to /sprint:release

`/scan:ac-coverage` is the **pre-release audit** of the same convention the
`/sprint:release` ship-gate enforces at release time. Running this before
`/sprint:release prepare` lets operators see linkage gaps without minting a
release record. The release ship-gate's cited-test executor is the
**executable** counterpart — it actually runs the cited tests.

## Notes

- Empty justification on
  `not_applicable` is treated as `missing` — empty/whitespace = same as
  missing.
- Placeholder `verified_by:` lines containing `{{` or `<test-file>`
  count as `missing` so the audit doesn't false-positive on scaffolded
  templates.
- `/scan:ac-coverage` **is** delegated by `/scan:full` (Tier 2 — Governance
  & quality). The default health pass runs **axis 1** (per-AC linkage); the
  **axis 2** category coverage (`--categories`) is **report-only** and run
  on-demand (or via `--enforce` once the operator flips the ramp to blocking) —
  it is intentionally NOT double-wired as a separate `/scan:full` entry.
