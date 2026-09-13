---
description: "Bootstrap a product ROADMAP.md from the inputs a project actually has — prefers _requirements/00-canonical/* + a Director-of-PM lens when present, falls back to the competitor clone brief + PROJECT.md. Evidence-bound, MVP-core-loop first."
user-invocable: true
---

# /roadmap:create — Bootstrap a product roadmap

Turns a product's grounding inputs into a real `ROADMAP.md`. The existing
`/roadmap:add` and `/roadmap:cleanup` operate on an *already-existing* roadmap;
nothing **bootstraps** one. A fresh `/portfolio:new` product (or any product
without a roadmap) starts here.

## Input-source detection (the core design — WG-7)

Detect what grounding the project actually has and pick the richest available,
**in this order**:

1. **Canonical-grounded (preferred):** `paths.requirementsRoot`/`00-canonical/*`
   exists (CORE_BRIEF, USER_COHORTS, GOLDEN_PATHS, PRODUCT_MODEL, EVOLUTION,
   FAILURE_STATES). Mine those and reason through the **role-routed product persona**
   (see **Role routing** — the Director of Product by default): sequence by
   user value × evidence × leverage; name the bet each epic makes. This is the
   fuller MC 0.14.0 "Managerial Agent Layer" shape.
2. **Clone + brief (fallback):** no `00-canonical/*`, but a competitor clone
   brief (`_docs/clones/<slug>/<slug>.clone.md` — JTBDs, scored features,
   gaps `G-*`, opportunities `O-*`) and/or `PROJECT.md` exist. Mine those.

The same command serves a bare fresh product and a fully-specified one — detect,
don't ask. State which source set was used in the run summary.

## Role routing (deterministic — R2 altitude split)

Bootstrapping a roadmap is the **product-lens reasoning step** — sequencing
epics, naming the bet each makes, and phasing by lifecycle. Pick the persona
by the **altitude of that reasoning** (FINAL-PLAN §11 R2, β
`EVT-org-roadmap-principles-beta-001`):

- **Default → the **director-of-product** persona.** Roadmap *creation* is inherently
  strategic: it sets the epic arc, names lifecycle bets, and sequences by user
  value × evidence × leverage — a strategic / lifecycle-phase call. This is the
  "Director-of-PM lens" the canonical-grounded path already invokes, now made an
  explicit dispatch. The Director is also the standing default for MC's own
  framework roadmap.
- **The **product-lead** persona** only when the bootstrap is explicitly scoped to a
  *single product's* execution-level backlog/sequencing with the strategic arc already
  fixed (e.g. re-bootstrapping a known product's sprint queue, not setting its
  epic bets) — the per-product / within-sprint altitude.
- **Fallback (R2 — no regression):** if scope is ambiguous, **default to
  `director-of-product`**. Defaulting up never regresses — the Lead inherits the
  Director's principles (R4), and the prior behavior of this skill was the Director-of-PM
  lens, so the Director default *is* the no-regression path.

State the chosen persona (and why) in the run summary.

## Input

`/roadmap:create [--source canonical|clone|auto] [--slug <clone-slug>] [--force]`

- `--source auto` (default) runs the detection above. `canonical`/`clone` force
  a source set. `--force` overwrites an existing `ROADMAP.md` (otherwise refuse
  if one exists — direct the operator to `/roadmap:add` / `/roadmap:cleanup`).

## Invariants

1. **Evidence-bound.** Every epic and every sprint MUST cite its grounding —
   a `JTBD-N` / `G-N` / `O-N` from the clone brief, or a canonical doc + line,
   or a `PROJECT.md` line. No epic without a citation. Unciteable ideas go
   to a "Later (unvalidated)" bucket, not the sequence.
2. **MVP-core-loop first.** Epic 1 validates the core loop before infra.
   **Epic 1's first sprint = the paint step / core-loop sprint** — get the loop
   on screen and prove it serves (the bootstrap:spinup `paint` step's
   verify-before-claim gate) before front-loading anything else. Then
   sequence top opportunities by **leverage × evidence**.
3. **Structure parity.** Render the full `ROADMAP-EXAMPLE.md` shape:
   - **Strategy** block (grounded one-paragraph thesis + the bet).
   - 🏛 **Epics** — an Upcoming sequence overview, then per epic:
     the shift / before→after / sprints-feeding-it / definition-of-done /
     reality-unlocked.
   - **Later** — trigger-gated (what unlocks it), incl. the unvalidated bucket.
   - **Shipped** — stub (empty for a fresh product).
   - **Sprints** — the auto-managed ledger table with the
     `<!-- ledger:sprints -->` anchor so `scripts/sprint/ledger.js` can append.
4. **Never invent product facts.** Pull from the detected sources only.

## Procedure

1. **Refuse-or-detect.** If `ROADMAP.md` exists and no `--force`, stop and point
   at `/roadmap:add` / `/roadmap:cleanup`. Else run input-source detection.
2. **Mine the source set + consult the role-routed persona.** Resolve the candidate
   agents from the skill-hook registry at call time: `node scripts/skills/skill-hook-points.js resolve roadmap:create author`.
   It returns both personas with their `condition` (single-product vs strategic) and the
   `default`. Pick per **Role routing** (Director of Product by default; Product Lead only
   when scoped to a single product's execution backlog with the strategic arc fixed); when
   scope is ambiguous, dispatch the `default` role (the R2 no-regression fallback). Do NOT
   hardcode a role name. State the choice. Canonical: read `00-canonical/*` and reason
   through that persona's lens.
   Clone/brief: read the clone brief's JTBD/feature/gap/opportunity sections +
   `PROJECT.md`. Build the evidence index (every claim → citation).
3. **Sequence** (through the consulted persona). Epic 1 = core-loop validation,
   first sprint = the paint step (core loop on screen). Then order remaining epics by
   leverage × evidence. Each epic names its bet + DoD + the reality it unlocks.
4. **Render** `ROADMAP.md` in the Invariant-3 structure, including the
   `<!-- ledger:sprints -->` anchor (so future `/sprint:full` runs auto-record
   rows — see WG-16 / Step 8b).
5. **Verify + report:** confirm every epic/sprint carries a citation, the
   ledger anchor is present, Epic 1's first sprint is the core-loop/paint sprint,
   which source set was used, and which persona was consulted (Director of Product vs
   Product Lead) + why. Print the epic sequence.

## Notes

- Reference paths via `paths.*` keys, not literals (path-lint enforces).
- This skill is the fallback half (clone+brief) AND the preferred half
  (canonical+DoPM) of one design — the canonical-grounded path is the
  0.14.0 managerial-agent shape; this ships the detection + both
  source readers, with the DoPM lens deepening as 0.14.0 lands.
- Sibling skills: `/portfolio:spinup` (the on-ramp; its `paint` step is Epic 1's
  first sprint), `bootstrap:spinup --clone` (produces the fallback brief),
  `/roadmap:add` / `/roadmap:cleanup` (operate on the result).

## Reference

- Structure model: `ROADMAP-EXAMPLE.md`
- Ledger writer: `scripts/sprint/ledger.js` (anchor `<!-- ledger:sprints -->`)
- Sources: `paths.requirementsRoot`/`00-canonical`, `_docs/clones/<slug>/`, `PROJECT.md`
