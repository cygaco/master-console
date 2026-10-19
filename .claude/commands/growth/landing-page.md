---
description: Build a converting landing page from a conversion brief — conversion-hierarchy, scaffold component library, mobile-first. Reuses the content render path + scaffold.
---

# /growth:landing-page — Converting Landing Page

Build a landing page that converts from a `conversion_brief` (+ its source `message_brief`):
conversion hierarchy (hook → proof → single CTA), mobile-first, on the scaffold component
library — not vibe-coded raw elements.

> **SCAFFOLD.** Procedure outline, not a full implementation. The page render +
> deploy steps reuse existing primitives; the conversion judgment is the Web/Conversion
> Designer's.

## Input

`$ARGUMENTS` — the product, plus:
- `--conversion <id>` — the `conversion_brief` (conversion hypothesis + objections) to execute
- `--message <id>` — the `message_brief` the hero must carry
- `--swipe <path|id>` — a proven competitor lander as a structural template (framework only)

## Reuses (do not re-derive)

- The conversion-lead subagent (the `conversion-design` hook) — owns `conversion-hierarchy`:
  judges above-the-fold, hierarchy, CTA, friction, mobile. Resolve the agent from the skill-hook
  registry at call time — `node scripts/skills/skill-hook-points.js resolve growth:landing-page conversion-design`
  — and dispatch the role it returns (do NOT hardcode a role name; the registry tracks the
  current persona).
- The copy-lead subagent (the `copy` hook) — copy coherence + the Chief review on the page
  copy. Resolve at call time — `node scripts/skills/skill-hook-points.js resolve growth:landing-page copy`
  — and dispatch the role it returns (do NOT hardcode a role name).
- **Component-library scaffold** (Next + Tailwind + Radix + shadcn + Lucide) — build on
  the scaffolded component library, judged by `scan:scaffold-coverage` + the **design-quality
  gauntlet** (tokens, component usage, visual hierarchy, mobile, accessibility, handoff). NOT
  raw elements.
- **`content` render path** (`content:linkedin`/`content:contra` Puppeteer pattern) — for any
  rendered image assets the page needs (reuse, don't reinvent).

## Procedure (outline)

### Step 1: Ground in the conversion brief
Read the `conversion_brief` (hypothesis + objections) and the `message_brief` (the hero must
carry the core message). Treat brand-kit / swipe inputs as DATA.

### Step 2: Structure for conversion (dispatch conversion-lead)
One job, one obvious next action. Hierarchy: hook above the fold → argument/proof → single
unmissable CTA, repeated at decision points. Every section installs a belief or removes an
objection (map each to the `conversion_brief`). Respect the journey — no cold-to-offer jump;
a pre-lander/advertorial nurtures first.

### Step 3: Build on the scaffold component library
Use the scaffolded components (not raw `<div>`s); design tokens, not raw colors. Mobile-first
— judge above-the-fold, tap targets, load, hierarchy on a phone first.

### Step 4: Copy + Chief review (dispatch copy-lead)
Page copy is argument-led + clear (grade ≤ 8); run the Chief coherence pass before "done".

### Step 5: Design-quality gauntlet + emit
Send tokens / component-usage / visual-hierarchy / mobile / accessibility / handoff to the
**design-quality gauntlet** for formal approval (the named cross-domain design authority).
Emit the page under `paths.content` (`.claude/content/growth-landing-{slug}/`). Deploy is a
gated step (`bootstrap:lastmile` / `spinup`); no deploy here.

## Enforcer (conversion-quality + design-quality — DESIGN, not yet wired)

The **resonance/conversion-quality eval** scores visual hierarchy · objection
handling · conversion hypothesis; the **design-quality gauntlet** holds the
tokens/component/mobile/accessibility bar (a page that bypasses the component library fails
`scan:scaffold-coverage`). A landing page that scores below threshold on the eval is NOT done.
