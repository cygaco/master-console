---
description: Coverage enforcer for the panel-registry (the /panel:* suite) — every `panels` row is well-shaped ({name, opener, description, run_context}; run_context ∈ {in_app, cli}) and its opener resolves to a real backing target (a `node <script>` file exists; a `/ns:name` skill resolves via dispatch-skill --resolve). An orphan/phantom/unsafe opener is a hard finding. Fail-CLOSED (exit ≥2) on the enforcer's OWN corrupt input — distinct from a clean pass (0) and a finding (1). Wired REPORT-ONLY into /scan:full.
user-invocable: true
namespace: scan
reads: [scripts/checks/panel-registry-coverage.js, framework/panel-registry.json]
---

# /scan:panel-registry-coverage

The coverage enforcer for the **panel registry** (`framework/panel-registry.json`, the `/panel:*`
suite — SP-20260615-001, AC-R5a/b). The panel sibling of `/scan:admin-suite-coverage`: a
**static** (no events) check made self-detecting on the panel-row ↔ opener-target surface.

Runs `scripts/checks/panel-registry-coverage.js`.

```bash
node scripts/checks/panel-registry-coverage.js          # human-readable
node scripts/checks/panel-registry-coverage.js --json   # machine-readable envelope
```

## The check (per `panels` row)

**ROW SHAPE.** Every row is exactly `{ name, opener, description, run_context }` — all four
non-empty strings — and `run_context ∈ { in_app, cli }`. There is **no** mandatory `route`
(run_context, not route, carries the in-app-vs-CLI distinction). A malformed row is
`malformed_panel_row` / `bad_run_context`.

**OPENER RESOLUTION.** The opener resolves to a **real backing target** via one of the two
recognized forms (kept as a named `RECOGNIZED_FORMS` set — a third form is a one-line
addition, not an ad-hoc branch):

- `node <script>` → the `<script>` file must exist on disk (resolved relative to repo root).
- `/<ns>:<name>` → resolves via `node scripts/dispatch-skill.js --resolve --skill <ns:name> --json` → `found:true`.

Any opener carrying a **shell metacharacter** (`& | ; > < $ \` ...`) is `unsafe_opener`; an
opener matching **no recognized form** is `unrecognized_opener`; a `node`/skill target that
points at nothing is `orphan_opener`. (The injection hardening is ported from
admin-suite-coverage: a loose prefix match would false-green `node x.js && calc`.)

## Tolerance (skip-with-note, pre-integration)

A `node <script>` opener under a known **parallel-lane** prefix (`scripts/panel/`,
`scripts/admin/`) that is **absent in the current worktree** is **SKIPPED-with-note** (counted
in `skipped`, not a finding) — it is built by another gauntlet lane, so the gate is green
post-build but pre-integration. The integrated tree must have every opener present, at which
point every row is enforced (no skips). A target absent **outside** a parallel lane (e.g.
`node nonexistent.js`) is always a hard `orphan_opener`.

## Exit codes (the β-3 fail-CLOSED asymmetry)

- `0` — every row resolves clean (skips allowed pre-integration).
- `1` — ≥1 hard finding (`malformed_panel_row`, `bad_run_context`, `unsafe_opener`,
  `unrecognized_opener`, `orphan_opener`, `resolver_error`).
- `2` — **fail-CLOSED**: the enforcer's OWN input is corrupt — `framework/panel-registry.json`
  is unreadable, not valid JSON, carries the wrong `$schema` (≠ `mc/panel-registry/v1`),
  or has no `panels` object. Could-not-run is **NOT green** and is **distinct** from a clean
  pass (`0`) and from an orphan-row finding (`1`). (Opposite of the R-4 roadmap *generator*,
  which fails SOFT on its human-authored inputs — do not let one leak into the other.)

`--registry <path>` points the check at an alternate registry (used by the regression tests to
exercise fixtures without touching the real file).

## Output

`--json` emits `{ ok, violationCount, violations[], checked, skipped, skippedDetail[] }`.
Default is a human summary; a FAIL lists the findings.

## Wiring

Wired **REPORT-ONLY** into `/scan:full`'s Tier-2 list (beside `/scan:admin-suite-coverage`) —
it surfaces findings but does **not** gate the run (AC-R5c). `/scan:scan-coverage` confirms it
is delegated (no silent scan-list drift).
