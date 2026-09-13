---
description: The launch-readiness cockpit — show how close every registered product is to launch (composite %, blocked items, owner-action work left), or drill into one product. Read-only across the portfolio. The operator's cross-product readiness board.
user-invocable: true
namespace: cockpit
reads: [scripts/cockpit/readiness-board.js, scripts/scaffold/readiness-report.js, ~/.mc/portfolio.json]
writes: []
---

# /cockpit:readiness — Launch-Readiness Cockpit

The President's cross-product view of launch readiness. For every product in the portfolio
registry (`~/.mc/portfolio.json`) it runs the shared readiness producer
(`scripts/scaffold/readiness-report.js`, the `mc/readiness/v1` keystone) against that
product's repo and rolls the results into one board: composite %, done/total, open items,
and blocked count per product — lowest-readiness products floated to the top so the ones that
need attention are first.

This is also the **runnable retrofit / run-anywhere** mechanism (DoP decision 2026-06-13:
*retrofit AND new, via a runnable skill*). A product does NOT need to ship any panel code to
appear here — point the skill at it and it reads the product's `FOUNDERS_CHECKLIST.md` state.
New scaffolds get the in-app founder panel natively (S-PF-09a R-2); existing products get
covered by running this skill against them.

> **STRICTLY READ-ONLY across sibling repos.** It reads each product's `FOUNDERS_CHECKLIST.md`
> and never writes to another project (the MC-only boundary —
> `feedback_mc_only_no_cross_project`). The board is a view, not an editor.

## Inputs

```text
/cockpit:readiness [--product <slug> | --root <path>] [--json] [--registry <path>]
```

- (no args) — **portfolio board** across every registered product (the default cockpit view).
- `--product <slug>` — drill into one registered product (looked up in the registry).
- `--root <path>` — readiness for an arbitrary repo path (works on an unregistered product too).
- `--json` — machine-readable output (`mc/readiness-board/v1` for the board, or
  `mc/readiness/v1` for a single product) — the stable consumer contract a future browser
  cockpit GUI (the gui.js pattern, a follow-up) consumes.

## Procedure

1. **Run the board.** Portfolio (default):
   ```bash
   node scripts/cockpit/readiness-board.js
   ```
   Single product:
   ```bash
   node scripts/cockpit/readiness-board.js --product <slug>
   # or
   node scripts/cockpit/readiness-board.js --root <path>
   ```
2. **Present it.** Show the board (or the single-product item list). Call out the products that
   are blocked or lowest-readiness first — that's the operator's attention queue.
3. **A product reads 0% / 0 items?** It has no `FOUNDERS_CHECKLIST.md` yet (it predates the
   founders-checklist seam, or was scaffolded before S-PF-04). That's honest, not an error —
   it's a retrofit candidate: scaffold the checklist into it (`scripts/scaffold/founders-checklist.js`)
   on the product's own session, then it shows real readiness here.
4. **Repo not found?** The registry path points to a repo that isn't on disk locally — report it
   as `(repo not found)`, don't fail the whole board.

## What it does NOT do

- It does NOT modify any product repo (read-only — see boundary above).
- It does NOT create or register products (`/portfolio:new` / `/portfolio:register`).
- It does NOT ship the in-app founder panel (that's S-PF-09a R-2, the product-shipped view).
- No browser GUI yet — text/`--json` board only; the gui.js-pattern visual cockpit is a
  scoped follow-up that consumes the same `--json` contract.

## Reference

- Aggregator: `scripts/cockpit/readiness-board.js` (+ `readiness-board.test.js`, 18 cases)
- Keystone producer: `scripts/scaffold/readiness-report.js` (the per-product `mc/readiness/v1` object)
- Plan: `.claude/project/sprint/sprints/S-PF-09a/plan-product-lead.md` (R-3, S-PF-09b)
- Registry: `~/.mc/portfolio.json` (managed by `/portfolio:*`)
