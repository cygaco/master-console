---
description: Predict candidate roadmap entries across four evidence lenses (3 each = 12 ideas) — whole-roadmap, last-3-shipped, last-3-active, vision/canonical. Read-only; proposes only, pairs with /roadmap:add. Role-aware — consults the Product Lead (single-product) or Director of Product (strategic) for a real product lens.
---

# /roadmap:ideas — predictive roadmap-entry generator

Surfaces **12 candidate roadmap entries** across four evidence lenses (3 per lens), each grounded in real project artifacts and tagged with the evidence it came from. **Read-only** — it proposes; you pick and commit with `/roadmap:add`. The synthesis runs through the role-appropriate product persona (see **Role routing**) so the ideas carry a product lens (majority userbase, golden paths, tangential connections), not generic guessing.

## Role routing (deterministic — R2 altitude split)

Pick the consulting persona by the **scope** of the idea generation, per the altitude split (FINAL-PLAN §11 R2, β `EVT-org-roadmap-principles-beta-001`):

- **Single-product / within-sprint candidate generation** → the **product-lead** persona. Signals: candidates for *one* product's backlog or next sprint, `--lens active` on a single product's thread, `$ARGUMENTS` scoped to one product.
- **Strategic / cross-product / lifecycle-phase-shift candidate generation** → the **director-of-product** persona. Signals: the **vision** lens, portfolio-wide ideas, lifecycle-phase or pivot bets, program-altitude direction.
- **Fallback (R2 — no regression):** when the Product Lead *would* be chosen but scope is ambiguous, **default to `director-of-product`** (also the standing default for MC's own framework roadmap). Defaulting up never regresses — the Lead inherits the Director's principles (R4).

Whole-slate runs (all four lenses, no product scoping) default to the **Director of Product** — the vision lens alone makes the run strategic-altitude.

## Input

`$ARGUMENTS` — optional:
- *(none)* — all four lenses, 3 ideas each.
- `--lens <whole|shipped|active|vision>` — only that lens.
- `--n <k>` — k ideas per lens (default 3).

## Evidence the skill reads (ground every idea — never invent)

1. `ROADMAP.md` — Strategy block, 🏛 Epics (Upcoming + Later + Shipped), Sprint 11+ candidates, Sprint backlog.
2. Canonical intent (if present) — `_requirements/00-canonical/*` (CORE_BRIEF, USER_COHORTS, GOLDEN_PATHS, PRODUCT_MODEL, EVOLUTION, FAILURE_STATES).
3. Recent activity — `git log` (last ~15), `paths.eventsFile` tail, `PROJECT.md`.

## The four lenses

| Lens | Source | Question it answers |
|---|---|---|
| **whole** | the entire roadmap | What's structurally missing or a natural extension across the whole backlog? |
| **shipped** | the last 3 completed/🟢 Shipped items | What's the momentum follow-on — what does each recent ship make newly possible or newly necessary? |
| **active** | the last 3 entries on the roadmap (most-recently-added) | What does the current active thread imply next? |
| **vision** | the Strategy block + canonical docs | What does the stated vision call for that isn't on the roadmap yet? |

## Procedure

1. Read the evidence above. Identify: the last 3 Shipped epics, the last 3 added entries (active thread), the Strategy/vision, and the whole-backlog shape.
2. **Consult the role-appropriate persona** — resolve the candidate agents from the skill-hook registry at call time: `node scripts/skills/skill-hook-points.js resolve roadmap:ideas generate`. It returns both personas with their `condition` (single-product vs strategic) and the `default`. Pick per the **Role routing** rules above; when scope is ambiguous (whole-slate runs included), dispatch the `default` role (the R2 no-regression fallback). Do NOT hardcode a role name. (Once 0.14.0 skill-scoped injection lands, this may instead arrive via the `temporary-agent` directive.) State the chosen persona in one line. Hand it the evidence + the four lenses; ask for 3 candidate entries per lens, each applying the `lean-product-development` principle (by slug — never an ordinal; it may renumber/move) and naming any tangential connection drawn.
3. Format each idea as a ready-to-paste roadmap candidate: a one-line title + 2-3 line body + the lens + the evidence it's grounded in + (if relevant) which epic it feeds.
4. **Propose only.** Do not write to `ROADMAP.md`. End by reminding the operator: `commit a pick with /roadmap:add "<idea>"`.

## Output shape

```
ROADMAP IDEAS — 4 lenses × 3

LENS: whole-roadmap
  1. <title> — <2-3 line rationale>  [evidence: …]  [feeds: <epic?>]
  2. …
LENS: last-3-shipped  (<the 3 epics>)
  …
LENS: last-3-active  (<the 3 entries>)
  …
LENS: vision/canonical
  …

Pick one → /roadmap:add "<idea>"
```

## Anti-patterns

- **Don't invent evidence.** If canonical docs are absent, say so and lean on ROADMAP + git history; don't fabricate a vision.
- **Don't write the roadmap.** This proposes; `/roadmap:add` commits.
- **Don't return generic SaaS advice.** Every idea must cite the project artifact it's grounded in. That's the whole point of consulting the product persona over the real evidence.

## Related

- `/roadmap:next` — the 1-idea sibling (the consulted persona's single top pick).
- `/roadmap:add` — commit a chosen idea (role-neutral mechanical appender).
- `product-lead` / `director-of-product` agents — the product-lens engines this skill consults (single-product vs strategic, per **Role routing**).
