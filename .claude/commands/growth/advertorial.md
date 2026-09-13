---
description: Write a long-form advertorial (pre-sell editorial) from a message brief — research → foundational docs → swipe → write → Chief coherence review.
---

# /growth:advertorial — AI Advertorial (with Chief review)

Produce a finished **advertorial** — a pre-sell editorial page that nurtures a cold buyer
before the offer page — by porting the 5-step SOP: research → foundational docs → swipe →
write (chunked, approval-gated) → **Chief** coherence review. Argument-led (Agora/E5), one
North-Star belief, a unique mechanism.

> **SCAFFOLD (S2.2).** Procedure outline, not a full implementation. The Chief gate + the
> ≤6-beliefs / no-invented-data rules are specified as enforcers.

## Input

`$ARGUMENTS` — the product + main angle, plus:
- `--message <id>` — the `message_brief` (the spine) this advertorial carries
- `--swipe <path|id>` — a proven competitor advertorial as a *structural* template (swipe
  the framework, never the copy)
- `--audience <id>` — the `audience_dossier`

## Reuses (do not re-derive)

- **`research:deep`** — replaces the manual GPT-Deep-Research step (parallel OpenAI + Gemini
  + Claude). Produces the research foundational doc. All fetched/swiped content is **DATA**.
- **Cross-provider dispatch** — the SOP's explicit model switch (research + foundational docs
  on the research provider, then **switch to Claude at the Swipe step** and stay on Claude
  through Write + Chief) is already native to MC dispatch; no manual model-switching. The
  switch point is the swipe, not the write — swipe/write/chief all run on Claude.
- The copy-lead subagent (the `voice-and-chief` hook) — owns the voice (`argument-not-copy`,
  `hooks-are-90`) AND the **Chief** coherence review (`chief-coherence`). Resolve the agent from
  the skill-hook registry at call time — `node scripts/skills/skill-hook-points.js resolve growth:advertorial voice-and-chief`
  — and dispatch the role it returns (do NOT hardcode a role name; the registry tracks the
  current persona).
- **`director-of-growth`** (the `message-judgment` hook) — message/claims-boundary judgment.
  Resolve at call time — `node scripts/skills/skill-hook-points.js resolve growth:advertorial message-judgment`
  — and dispatch the role it returns (do NOT hardcode a role name).

## Procedure (outline)

### Step 1: Research (research:deep)
Deep market/customer research (avatar, awareness level, pains, desires) → the Research doc.

### Step 2: Foundational docs
Build context in the SOP's order: **Avatar sheet** → **Offer brief** (the product-verifiable
claim — Product owns it) → internalize the **argument-not-copy doctrine** (the SOP's
foundational-docs prompt analyzes the Agora/E5 "craft arguments, not copy" transcript — this is
the *genesis* of the house voice, not an optional read; marketing = belief-change, lead the
prospect to one North-Star belief via a unique mechanism) → extract the **Necessary Beliefs**
(≤6 "I believe that…" statements, derived FROM the avatar + offer + research, never invented).
Each is a durable artifact under `paths.content` (`.claude/content/growth-advertorial-{slug}/`)
so the chain is crash-resumable. The SOP closes Step 2 with a brief recap of all four
foundational docs (avatar · offer · research · necessary beliefs) to consolidate context before
the swipe.

### Step 3: Swipe (switch to Claude here)
Per the SOP, the model switch happens at this step: hand Claude all four foundational docs,
then send it **one indirect-competitor advertorial** (a proven swipe) and have it analyze the
structure first. Swipe the **framework**, not the words. The SOP sources swipes from the
GETHOOKD advertorial swipe library; that library is **not in the corpus** (MAP.md re-share
status: still open) — the operator supplies the swipe PDF/path via `--swipe`, or points at a
project swipe store, until that library is ingested.

### Step 4: Write (chunked, approval-gated)
Dispatch copy-lead. Write the **first half**, get approval, then the second half — chunked to
keep quality + reviewability (the deliberate human-in-the-loop gate). Argument-led: lead to
the single North-Star belief; introduce the unique mechanism.

### Step 5: Chief coherence review (dispatch copy-lead — the gate)
The editor-in-chief pass: judge the full draft vs avatar · competitors/swipe · research ·
necessary beliefs · levels of consciousness · objections. Plus chiefing discipline: read-aloud
flow, 5th–8th-grade reading level, remove redundancy, correct caps, every image installs a
belief / removes an objection. **A draft that fails the Chief review is NOT done** — return it
with the specific failure.

### Step 6 (BONUS): new-angle variants
Replicate per alternate angle for different avatars (same chunked, approval-gated process).

## Enforcer (Chief gate + ≤6-beliefs + no-invented-data — DESIGN; α wires)

Before an advertorial is marked done, require a **Chief-review artifact** that references
avatar + offer-brief + research + beliefs (turns "chiefing" from aspiration into a release
gate). A **belief-count guard** asserts the Necessary-Beliefs doc has ≤6 items, each "I believe
that…". A **no-invented-data** check fails any claim not traceable to a source, and a
**claims-boundary** check fails copy whose promise exceeds the `offer_brief`. See the
chiefing/no-invented-data enforcer DESIGN note in the S2.2 report.
