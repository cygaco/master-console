---
description: Regenerate step tables in canonical docs from _requirements/00-canonical/STEPS.json — closes the last loop in the step-registry infrastructure.
---

# /maps:steps — Regenerate Step Tables from STEPS.json

Reads `_requirements/00-canonical/STEPS.json` and rewrites the auto-generated regions in the three canonical docs:
- `_requirements/00-canonical/PRODUCT_MODEL.md` — onboarding + dashboard tables in "The 10-Step Model (Target State)"
- `_requirements/00-canonical/GLOSSARY.md` — Onboarding Steps + Dashboard Activities tables
- `_requirements/00-canonical/GOLDEN_PATHS.md` — Flow (Target State) primary-path diagram

Each auto-generated region is delimited by `<!-- maps:steps:START (region=<name>) --- auto-generated; do not edit -->` and `<!-- maps:steps:END (region=<name>) -->`. Content between the markers is fully replaced on each run; content outside is untouched.

This is the loop-closer for the step-registry infrastructure. After it lands: any step move/consolidation is a one-file edit to `STEPS.json` followed by `/maps:steps` — no more 29-file agent sweeps like the deep-dive move.

## Input

`$ARGUMENTS` — optional flags:
- no args → regenerate all regions
- `--check` → read-only; exit 1 if any region would change on regen (CI mode / pre-commit)
- `--verbose` → explain every replacement
- `--json` → emit JSON summary `{ changed: [...], missing_markers: [...] }`

## Procedure

1. Resolve paths from `.claude/paths.json` (specGraph is nearby; STEPS.json lives at `_requirements/00-canonical/STEPS.json` — literal, not yet a paths.json key).
2. Invoke the regenerator: `node scripts/generate-steps-maps.js $ARGUMENTS`.
3. If exit is non-zero AND the error is "MISSING MARKERS":
   - Report the list to the user.
   - Offer to insert the required `<!-- maps:steps:START/END -->` markers at the natural location in each doc (near the SOURCE OF TRUTH comment). Default is to insert automatically when run without `--check`; under `--check` just report.
4. If exit is non-zero AND the error is a schema / JSON error in STEPS.json, report the error verbatim and stop — do not write partial updates.
5. On success, print the list of files changed + a diff summary.

## Examples

```bash
# Regenerate everything
/maps:steps

# Pre-commit / CI: fail if regen would produce changes
/maps:steps --check

# See what's being replaced
/maps:steps --verbose
```

## Absence-tolerance (no product canon → no-op)

`generate-steps-maps.js` is **framework tooling**. The product canon it reads
(`STEPS.json` + the three canonical step-table docs) lives in the per-product
canon slot, which is **empty in WarpOS-canonical** — the canonical framework
carries no baked-in product (W4 RESTRUCTURE; the filled example was relocated to
`_warpos/BASELINE/_requirements/`, the synthetic "Pantry Pilot" example). When `STEPS.json` is absent the
generator (and `--check`, the path the blocking `pre-commit-steps-check.js` hook
runs) **no-ops with exit 0** — "no product canon in this repo → nothing to
regenerate" — rather than crashing on the missing file. The companion
pre-commit hook is absence-safe by construction (it only fires when STEPS.json
or a canon doc is *staged*, which can't happen once they're relocated out of
`_requirements/`).

- **Enforcer (named):** `scripts/checks/test-steps-maps-absent-canon.js` — the
  bite-test for this contract. It pins the absent-canon no-op (bare + `--check`
  exit 0) AND that the generator still does real work (round-trips a present
  canon) AND that the drift gate still bites (a corrupted region → `--check`
  exit 1), so absence-tolerance can't silently turn into a defanged blanket-0
  stub. Test seam: `WARPOS_STEPS_ROOT` (cf. `WARPOS_PURITY_ROOT`).

## What gets regenerated (per region)

| Doc | Region | Content |
|---|---|---|
| PRODUCT_MODEL.md | `product-model-onboarding` | Onboarding phase step table (# / phase / id / component / requires / produces) |
| PRODUCT_MODEL.md | `product-model-dashboard` | Dashboard phase activity table (activity / component / requires / produces) |
| GLOSSARY.md | `glossary-onboarding` | Onboarding Steps table (position / id / component / file) |
| GLOSSARY.md | `glossary-dashboard` | Dashboard Activities table (activity / component / file / feature) |
| GOLDEN_PATHS.md | `golden-paths-flow` | Primary-path diagram (onboarding → DASHBOARD → {activities}) |

## What does NOT get regenerated

- Narrative sections, invariants, "why this matters" commentary, emotional arcs, data dependency chain, invalidation rules — all hand-maintained.
- COPY.md, PRD.md, STORIES.md inside individual features — out of scope.

## Relation to step-registry-guard

- `step-registry-guard.js` blocks **hardcoded integers in source** + **invalid edits to STEPS.json itself**.
- `/maps:steps` propagates changes **from STEPS.json to the canonical doc tables** that describe it.
- `STEPS.json` is in `manifest.fileOwnership.foundation` — foundation-guard requires an Alpha/Gamma heartbeat (see `.claude/agents/store.json`) to edit.

Together, these three layers close the loop: one edit to STEPS.json, guarded edit, auto-propagated tables, warned source-code drift.

## Related

- `/maps:all` — registry of all maps; may delegate to this skill
- `/scan:references` — validates cross-file references; respects the auto-generated markers
- `scripts/generate-maps.js` — sibling regenerator for hooks/skills/memory/tools/systems maps (not steps)
- `scripts/generate-steps-maps.js` — the actual implementation invoked by this skill
