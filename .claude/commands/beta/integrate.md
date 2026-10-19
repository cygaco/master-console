---
description: Apply validated recommendations from beta mining into the judgment model
---

# /beta:integrate — Integrate Mined Recommendations

Apply validated recommendations from `judgement-model-recommendations.md` into `judgement-model.md`. This closes the pipeline: `/beta:mine` discovers patterns → `/sleep:deep` reviews them → `/beta:integrate` applies them.

## Procedure

### Step 1: Load recommendations

Read `.claude/agents/president/_system/beta/judgement-model-recommendations.md`.

If the file doesn't exist or is empty, report "No pending recommendations" and exit.

### Step 2: Load current judgment model

Read `.claude/agents/president/_system/beta/judgement-model.md`.

### Step 3: Review each recommendation

For each recommendation in the file, display to the user:
- The pattern or finding
- The evidence (event IDs, prompt counts, examples)
- The confidence level (high/medium/low)
- What section of the judgment model it would modify

### Step 4: Apply accepted recommendations

Based on the recommendation type:

| Type | Target Section |
|------|---------------|
| New pattern discovered | Mined Patterns section |
| Confidence adjustment | Confidence table |
| New anti-pattern | Anti-Patterns section |
| Persona gap | Flag for user — may need a new principle |
| Decision Policy gap | Flag for user — target `paths.decisionPolicy` or `paths.currentStage`; never auto-apply |

For each recommendation:
1. Show the proposed change
2. Apply it to `judgement-model.md` using Edit
3. Mark it as applied in the recommendations file

### Step 5: Archive and clear

After all recommendations are processed:
1. Archive the recommendations file — append its contents to the recommendations archive file with a date header
2. Clear the recommendations file (write empty)

### Step 6: Report

```
/beta:integrate complete

Applied:  {N} recommendations
Skipped:  {M} (low confidence or user rejected)
Flagged:  {K} (needs new principle — user review)

Judgment model updated: .claude/agents/president/_system/beta/judgement-model.md
```

## Rules

- Never apply a recommendation without showing it first
- Low confidence recommendations should be flagged, not auto-applied
- If a recommendation contradicts an existing principle, flag the conflict
- Archive before clearing — never lose recommendation history
