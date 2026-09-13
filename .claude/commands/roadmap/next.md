---
description: The 1-idea alternative to /roadmap:ideas — the single highest-leverage next roadmap entry (the role-appropriate product persona's top pick — Product Lead for single-product, Director of Product for strategic) with a one-paragraph rationale. For "just tell me the one thing."
---

# /roadmap:next — the one thing to do next

When you don't want 12 candidates, just **the single highest-leverage next roadmap entry**: the role-appropriate product persona's top pick, with a tight rationale. Read-only; proposes one thing, pairs with `/roadmap:add`.

## Role routing (deterministic — R2 altitude split)

Pick the consulting persona by the **scope** of the "what next" question, per the altitude split (FINAL-PLAN §11 R2, β `EVT-org-roadmap-principles-beta-001`):

- **Single-product / within-sprint next pick** → the **product-lead** persona. Signals: the single highest-leverage next item for *one* product's backlog or current sprint; `$ARGUMENTS` scoped to one product.
- **Strategic / cross-product / lifecycle-phase-shift next pick** → the **director-of-product** persona. Signals: the program's next bet, a portfolio-level or lifecycle/pivot call.
- **Fallback (R2 — no regression):** when the Product Lead *would* be chosen but scope is ambiguous, **default to `director-of-product`** (also the standing default for MC's own framework roadmap). Defaulting up never regresses — the Lead inherits the Director's principles (R4).

## Input

`$ARGUMENTS` — optional `--why-long` (fuller rationale) or `--avoid <lens>` (exclude a lens). Default: one pick, one paragraph.

## Procedure

1. Read the same evidence as `/roadmap:ideas` — `ROADMAP.md` (Strategy, Epics, candidates), `_requirements/00-canonical/*` (if present), recent `git log` + `paths.eventsFile`.
2. **Consult the role-appropriate persona** — resolve the candidate agents from the skill-hook registry at call time: `node scripts/skills/skill-hook-points.js resolve roadmap:next pick`. It returns both personas with their `condition` (single-product vs strategic) and the `default`. Pick per the **Role routing** rules above; when scope is ambiguous, dispatch the `default` role (the R2 no-regression fallback). Do NOT hardcode a role name. State the chosen persona in one line. Ask for **exactly one** recommendation — the single most leverage-positive next entry — applying the `lean-product-development` principle (by slug — never an ordinal; it may renumber/move): what serves the majority userbase / golden path, is a calculated risk worth taking now, and (bonus) draws a tangential connection that compounds existing work.
3. Output one pick:
   - **The entry** (title + 1-2 line body, ready for `/roadmap:add`).
   - **Why this, why now** (one paragraph): which lens it came from, what it unblocks, the opportunity cost of *not* doing it, and the tangential connection if any.
   - **Confidence** + the one thing that would change the pick.
4. End: `/roadmap:add "<the pick>"` to commit it, or `/roadmap:ideas` for the full slate.

## Relationship to /roadmap:ideas

Same engine (the same role-routed persona, same evidence, same R2 altitude split) — `next` is `ideas` collapsed to a single decisive recommendation. Use `next` when you trust the persona to choose; use `ideas` when you want to choose from a slate. Both are read-only and propose-only.

## Anti-patterns

- **Don't hedge into a menu.** This skill's whole value is *one* decisive pick. If genuinely torn between two, pick one and name the runner-up in a single line — don't return a list (that's `/roadmap:ideas`).
- **Don't invent evidence.** Ground the pick in a real artifact; if the basis is thin, say so.
- **Don't write the roadmap.** Propose; `/roadmap:add` commits.

## Related

- `/roadmap:ideas` — the 12-idea slate (4 lenses × 3).
- `/roadmap:add` — commit the pick (role-neutral mechanical appender).
- `product-lead` / `director-of-product` agents — the product-lens engines (single-product vs strategic, per **Role routing**).
