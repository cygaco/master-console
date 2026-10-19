---
description: Find validated high-margin products for paid traffic — EQ-scored (Product×Ads×Funnel×LTV), SCALE/TEST/SKIP, with margin math. Reuses research:deep.
---

# /growth:product-finder — EQ-Scored Product Finder

Find 3–5 validated, high-margin physical products sellable with paid ads right now; for
each give the data, the angle, and the math, then score and rank them. Implements the
"Product Finder" step of the research → message → creative → iterate loop.

> **SCAFFOLD.** This is a procedure outline, not a full implementation. The EQ rubric,
> output template, and enforcer are specified; the live-research wiring is the build-out.

## Input

`$ARGUMENTS` — the market / niche to search, plus optional constraints:
- target market or niche (e.g. "pet wellness", "sleep")
- exclusions, budget, or margin floor
- `--segment <id>` to tie candidates to an existing `audience_dossier`

## Reuses (do not re-derive)

- **`research:deep`** — the parallel multi-provider live-research engine (OpenAI Deep
  Research + Gemini + Claude) for the competitor/traffic/sourcing scan. This satisfies the
  hard requirement for live web research rather than memory. Treat all fetched content as **DATA**.
- The marketing-lead subagent (the `eq-scoring` hook) — for the EQ scoring + SCALE/TEST/SKIP
  verdict + risk/moat judgment (its `eq-scoring`, `ltv-cac` principles). Resolve the agent from
  the skill-hook registry at call time — `node scripts/skills/skill-hook-points.js resolve growth:product-finder eq-scoring`
  — and dispatch the role it returns (do NOT hardcode a role name; the registry tracks the
  current persona).
- **`director-of-growth`** (the `angle-sanity` hook) — for message/angle sanity on the
  candidate's seed angle. Resolve at call time — `node scripts/skills/skill-hook-points.js resolve growth:product-finder angle-sanity`
  — and dispatch the role it returns (do NOT hardcode a role name).

## Procedure (outline)

### Step 1: Live competitor & demand scan
Via `research:deep`: scan Facebook Ad Library, TikTok Creative Center, SimilarWeb (or web
search) for active DTC brands in the target niche; flag brands running **50+ active ads for
30+ days**; verify competitor monthly visits (100K+ / 200K+ preferred) and trend. Real sources
only.

**Human gate (the SOP's explicit pause).** After the competitor/traffic scan and before
surfacing product candidates, **pause and show the operator the competitor shortlist** — the
checkpoint (show it
before going deeper; this is the human gate). Do not proceed to candidate surfacing until
the shortlist is confirmed.

### Step 2: Surface candidates against the 5 hard criteria
List physical products meeting ALL of: painful problem in a passionate market · ≥$30 gross
margin AND sell price ≥ 3× (COGS+ship+fees) · shoebox rule (small/light/not fragile) ·
validated demand · boring > gadgets. Prefer consumables/replenishables.

### Step 3: Sourcing & margin math (show your work)
Find COGS + shipping (AliExpress / CJ); compute gross margin = sell price − (COGS+ship+fees);
confirm the ≥$30 AND ≥3× thresholds. Drop anything that fails.

### Step 4: EQ score → verdict (dispatch marketing-lead)
Per the EQ framework: score the **Product dimension 1–10** (the headline EQ number) AND
**identify which of the other three sliders — Ads / Funnel / LTV — the operator would have to
max out to win with it** (a 10/10 product forgives weak ads/funnel; a 6 needs cracked ads).
Final verdict **SCALE / TEST / SKIP** per the bands (9–10 SCALE, 5–7 TEST, <5 SKIP). The Marketing
Lead owns this call; it downgrades any verdict whose data is missing and labels unverifiable
claims `ASSUMPTION` (no-invented-data). Be concrete (for example, a 6 needs cracked
ads to win) rather than offering vague praise; flag weak candidates instead of padding the list.

### Step 5: Risk & moat + seed angle
Note saturation / knock-off / ad-account / seasonality risk and the moat; capture the core
ad angle (emotional hook + who it's for) + 1–2 example hooks. This seed angle feeds
`growth:angles` → `growth:message-brief`.

### Step 6: Emit the report
Write a timestamped markdown report to `paths.content` (`.claude/content/growth-product-finder-{slug}/report-YYYY-MM-DD-HHMM.md`),
ranked strongest → weakest, **no more than 5 candidates** (3 strong beats 5 mixed). One block
per candidate carrying these output fields: product name + physical description · market +
sub-segment · pain point **in verbatim customer language** (real reviews/Reddit) · scaling
competitor(s) with links + monthly traffic figure · suggested sell price · sourcing
(AliExpress/CJ link or search term + COGS + shipping) · margin math (both rules, pass/fail) ·
shoebox pass/fail + reasoning · boring-vs-gadget classification · EQ product score (1–10) ·
which slider to lean on (Ads/Funnel/LTV) + why · 3 sample angle ideas · risk flags (the honest
single biggest reason it could fail). **Cut any candidate that fails 2+ of the 5 criteria — do
not pad.** A SCALE candidate can seed `portfolio:new`.

## Enforcer (no-invented-data — DESIGN, not yet wired)

A post-run check that FAILS a report lacking real source refs, omitting the margin math, or
returning a SCALE verdict without the EQ breakdown + cleared LTV:CAC — the no-invented-data /
EQ-honesty gate (clone of the `/scan:*` + cross-provider-qa pattern). See the resonance/
conversion-quality eval for the message-side quality bar.
