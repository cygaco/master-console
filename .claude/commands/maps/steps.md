---
description: Regenerate step tables in canonical docs from _requirements/00-canonical/STEPS.json — one region per phase the product declares.
---

# /maps:steps — Regenerate Step Tables from STEPS.json

Reads `_requirements/00-canonical/STEPS.json` and rewrites the auto-generated regions in three canonical docs. The regions follow the phases the product declares in STEPS.json, in the order it declares them:
- `_requirements/00-canonical/PRODUCT_MODEL.md` — one `product-model-<phase>` region per phase: a step table (# / step id / component / requires / produces)
- `_requirements/00-canonical/GLOSSARY.md` — one `glossary-<phase>` region per phase: a step table (position / step id / component / file / feature)
- `_requirements/00-canonical/GOLDEN_PATHS.md` — one `golden-paths-flow` region: every phase in order, with its steps

`<phase>` is the phase name lower-cased, with each run of other characters replaced by `-` and any leading or trailing `-` removed (a phase named `Review Queue` gets the regions `product-model-review-queue` and `glossary-review-queue`).

Each auto-generated region is delimited by `<!-- maps:steps:START (region=<name>) --- auto-generated; do not edit -->` and `<!-- maps:steps:END (region=<name>) -->`. Content between the markers is fully replaced on each run; content outside is untouched.

A step move or a new phase is an edit to `STEPS.json` followed by `/maps:steps`. A new phase also needs its START/END marker pairs in PRODUCT_MODEL.md and GLOSSARY.md; the generator reports any pair it cannot find.

## What STEPS.json supplies

- **Phases** — an object keyed by phase name, or an array whose entries are phase names or objects carrying `id`, `name`, `key` or `label` (the canon engine writes this array shape). A phase may set `label` (display name; default: the name with `-`/`_` turned into spaces and the first letter capitalised), `required` (true → "required", false → "optional"), `ordered` (true → "ordered", false → "unordered"), `description` (rendered under the heading in PRODUCT_MODEL.md) and `steps` (the step ids it contains). Without a `steps` list, a phase contains the steps whose `phase` field names it.
- **Steps** — an object keyed by step id, or an array of objects carrying `id`, `key` or `name`. The tables read `position`, `component`, `component_file`, `feature`, `requires_data` and `produces_data`; a missing value renders as `—`. Steps are listed by `position` within each phase.

In the flow region, an `ordered: false` phase renders its steps as a set (`{A, B}`); any other phase renders them as a sequence (`A → B`).

## Input

`$ARGUMENTS` — optional flags:
- no args → regenerate all regions
- `--check` → read-only; exit 1 if any region would change on regen or a marker pair is missing (CI mode / pre-commit)
- `--verbose` → name every region it updates

## Procedure

1. STEPS.json lives at `_requirements/00-canonical/STEPS.json` (the generator resolves it from the repository root).
2. Invoke the regenerator: `node scripts/generate-steps-maps.js $ARGUMENTS`.
3. If exit is non-zero AND the error is "MISSING MARKERS":
   - Report the list to the user.
   - Without `--check`, insert the missing `<!-- maps:steps:START/END -->` pairs at the natural location in each doc (next to the SOURCE OF TRUTH comment: one pair per declared phase in PRODUCT_MODEL.md and GLOSSARY.md, one `golden-paths-flow` pair in GOLDEN_PATHS.md), then run the generator again. Under `--check`, just report.
4. If exit is non-zero AND the error is a schema / JSON error in STEPS.json, report the error verbatim and stop — the generator writes nothing when STEPS.json fails to load.
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
canon slot, which holds **no STEPS.json in the framework repository** — the framework
carries no baked-in product (the filled example lives at
`_mc/BASELINE/_requirements/`, the synthetic "Pantry Pilot" example). When `STEPS.json` is absent, or
declares no phases (the state the canon engine leaves it in), the generator (and
`--check`) **no-ops with exit 0** — "nothing to regenerate" — rather than
crashing or demanding markers.

- **Enforcer (named):** `scripts/checks/test-steps-maps-absent-canon.js` — the
  bite-test for this contract. It pins the absent-canon no-op (bare + `--check`
  exit 0), the no-phases no-op for `_mc/templates/canonical/STEPS.json.tmpl`,
  that the generator does real work (round-trips a present canon, renders one
  region per declared phase for phases other than onboarding/dashboard, reads
  the array shape), that the drift gate bites (a corrupted region → `--check`
  exit 1), and that the `_mc/BASELINE` example canon matches the generator.
  Test seam: `MC_STEPS_ROOT` (cf. `MC_PURITY_ROOT`).

## What does NOT get regenerated

- Narrative sections, invariants, "why this matters" commentary, emotional arcs, data dependency chain, invalidation rules — all hand-maintained.
- COPY.md, PRD.md, STORIES.md inside individual features — out of scope.

## Relation to the other step-registry checks

- `scripts/hooks/step-registry-guard.js` (PreToolUse on Edit|Write) blocks **hardcoded integer steps in `src/` source files** and **edits that leave STEPS.json schema-invalid**; `STEP_REGISTRY_GUARD_STRICT=0` downgrades it to a warning.
- `scripts/hooks/pre-commit-steps-check.js` is a git pre-commit script: when STEPS.json or one of the three docs is staged, it runs `node scripts/generate-steps-maps.js --check`, and when STEPS.json itself is staged it first validates the staged STEPS.json; either failure blocks the commit.
- `/maps:steps` propagates changes **from STEPS.json to the canonical doc tables** that describe it.
- `/scan:architecture` (check I13) runs `--check` and reports drift as an error.

## Related

- `/maps:all` — registry of all maps
- `scripts/generate-maps.js` — sibling regenerator for hooks/skills/memory/tools/systems maps (not steps)
- `scripts/generate-steps-maps.js` — the implementation invoked by this skill
