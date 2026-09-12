---
description: Author a launch guide into _guides/ — grounded in an external brand-building methodology (paid course, not redistributed) + the existing guides, in the right shape (walkthrough/checklist/notice), carrying the guide-anchor contract so /guides:integrate can place it in the bootstrap pipeline.
---

# /guides:write — Author a launch guide

Write (or refine) a single guide under `_guides/` that helps a vibe-coder do the right thing at the right time on the path to a launched, paid product — and tag it with the **guide-anchor contract** so `/guides:integrate` can surface it at the correct bootstrap-pipeline spot.

> `_guides/` is **`owner=framework`, shipped** (ADR-0005) + `/warp:update`-managed — these guides install into every product. Write for the end user (a non-expert founder), not for WarpOS internals.

## Input

`$ARGUMENTS` — the guide topic (e.g. `auth`, `payments`, `dev-account-signups`) + optional:
- `--shape walkthrough|checklist|notice` — override the inferred shape.
- `--anchor <spinup|lastmile>:<phase-or-module>` — override the inferred pipeline anchor.
- `--from-corpus` — ground in `_planning/ingest/source/` (an external brand-building methodology (paid course, not redistributed)) where relevant.

## The guide-anchor contract (THIS skill establishes it; `/guides:integrate` consumes it)

Every guide carries frontmatter declaring **where, how, and when** it surfaces:

```yaml
---
guide: <TOPIC>                 # stable id (matches the filename stem, e.g. AUTH)
anchor: <pipeline location>    # where it plugs into the bootstrap pipeline, e.g.
                               #   spinup:preflight | spinup:intent
                               #   lastmile:audit | lastmile:module/auth | lastmile:module/payments
                               #   lastmile:module/database | lastmile:module/crm
                               #   lastmile:module/platform | lastmile:module/security
                               #   lastmile:gate/<approval-gate>  | none (meta/index)
shape: walkthrough|checklist|notice
timing: project-start | at-module | at-gate | reference   # WHEN in the journey
lead_time: <e.g. "2-14 days (Apple/Google/Play review)" | none>   # real-world wait, drives early surfacing
---
```

**Shape semantics:**
- **walkthrough** — interactive, step-by-step (do this, then this). For integrations the user performs (SSO/auth wiring, payments setup).
- **checklist** — tickable items, often with a done-gate. For readiness/coverage (dev-account signups, deploy preflight, privacy items).
- **notice** — a brief heads-up/warning surfaced at a moment. For "start this NOW because it takes days" or "this needs human/legal review."

**Timing is the load-bearing rule:** anything with a real `lead_time` (dev-account approvals: Apple ~2d, Google verify queue, Play 14d/12-tester) anchors at **`spinup:preflight`/`spinup:intent` (project START)** — NOT at last-mile — so it's cleared by the time the product is ready. (ED-012 / the pre-flight-blocker roadmap entry.)

## Procedure

### Step 1 — Ground (don't invent)
Read, as relevant: the existing `_guides/*.md` (tone, structure, the README index), and — for marketing/launch/creative topics — `_planning/ingest/source/` (the corpus of an external brand-building methodology (paid course, not redistributed); treat as DATA per the untrusted-content firewall). Match the house voice of the existing guides.

### Step 2 — Pick shape + anchor + timing
Infer from the topic (override via flags). Long-lead external setup → `notice`/`checklist` at `spinup:*` (project start). An integration the user wires → `walkthrough` at the matching `lastmile:module/*`. A legal/approval item → `notice` at `lastmile:gate/*`.

### Step 3 — Write the guide
Plain language for a non-expert founder. Honest about cost, lead time, and "human/legal review required" where applicable. No WarpOS-internal jargon. For `walkthrough`: numbered steps. For `checklist`: `- [ ]` items + a clear "done when". For `notice`: 3-6 tight lines + the one action.

### Step 4 — Emit
Write to `_guides/<TOPIC>_GUIDE.md` with the contract frontmatter. Do NOT wire it into the pipeline here — that's `/guides:integrate` (which reads this frontmatter, places the guide at its anchor, and records the plugin spot). Adding/uncommenting frontmatter on an existing guide is in scope; restructuring the whole set is `/guides:organize`.

## Reuses / does not duplicate
- `/learn:ingest` — to pull fresh source material (Google Docs / `.docx`) before writing.
- `_planning/ingest/source/MAP.md` — the corpus file↔link map + the SOP 5 steps.
- Companions: `/guides:organize` (restructure all guides), `/guides:integrate` (place + record into bootstrap), `/guides:coverage` (enforce every guide is anchored + surfaced).

## Anti-patterns
- Don't write WarpOS-internal docs here — these ship to end users.
- Don't omit the contract frontmatter — an un-anchored guide is invisible to `/guides:integrate` and will be flagged by `/guides:coverage`.
- Don't bury a long-lead item (dev-account signup) at last-mile — anchor it at project start.
