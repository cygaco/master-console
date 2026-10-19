---
name: reasoning:log
description: Log a reasoning episode — record what framework was used, why, and what happened
---

# /reasoning:log — Log Reasoning Episode

Records a reasoning episode to `.claude/project/memory/traces.jsonl`. Called manually after investigation is complete, or by `/fix:deep`, `/fix:fast`.

## Input

`$ARGUMENTS` — One of:
- A problem summary + outcome to log (after reasoning is complete)
- "continue" — add to the current chain (same investigation, new step)
- "last" — log a trace for the most recent reasoning in this conversation

## Process

### 1. Determine IDs

Read `.claude/project/memory/traces.jsonl`, find the highest `RT-NNN` id, increment by 1.

**Chain detection:**
- If "continue" or if a trace was already logged in this conversation → same chain, increment `seq`
- If new investigation → generate new `CH-NNN` chain ID, `seq: 1`
- If standalone (simple fix, no chain needed) → `chain: null`, `seq: null`

### 2. Build Trace Record

```json
{
  "id": "RT-NNN",
  "ts": "ISO-8601 timestamp",
  "trigger": "user|error|self-detected",

  "chain": "CH-NNN or null",
  "seq": 1,
  "pivot_from": "RT-NNN or null",
  "pivot_reason": "max 200 chars — why direction changed, or null",

  "problem_type": "bug|ux|architecture|performance|prioritization|strategy|communication|code_structure",
  "problem_summary": "max 200 chars — what was the problem",

  "framework_selected": "framework key from reasoning-frameworks.md",
  "framework_rationale": "max 300 chars — WHY this framework was chosen",
  "alternatives_considered": ["other framework keys"],

  "hypotheses": [
    {"what": "description", "result": "confirmed|wrong|partial|untested", "evidence": "max 150 chars"}
  ],

  "history_match": "RT-NNN or null",
  "history_outcome": "max 200 chars or null",

  "outcome": "resolved|partial|failed|deferred|misclassified",
  "quality_score": null,
  "meta_notes": "max 200 chars — what to do differently, or null",
  "learning_id": "link to learnings.jsonl entry or null",

  "reclassified_from": null,
  "reclassified_ts": null,
  "validator_model": null,
  "cross_validation": null,
  "source": "reasoning:run|fix:deep|fix:fast|manual"
}
```

### 3. Hypotheses

If hypotheses were tested during the investigation, log them. Each hypothesis has:
- **what**: The hypothesis tested (e.g., "directory was deleted")
- **result**: `confirmed` (led to fix), `wrong` (disproven), `partial` (partly true), `untested` (not yet checked)
- **evidence**: How you know (e.g., "file exists, bash path resolution failed on Windows")

Hypotheses are optional for simple fixes. Required when the investigation tested multiple possibilities.

### 4. Chain Rules

- A **chain** is a sequence of traces for one investigation that went through pivots, reclassifications, or multi-step reasoning.
- Chains share a `chain` ID (format: `CH-NNN`).
- Each trace in a chain has a `seq` number (1, 2, 3...).
- `pivot_from` links to the previous trace. `pivot_reason` explains what changed (user pushback, new evidence, reclassification).
- A solo trace (no chain) has `chain: null, seq: null, pivot_from: null`.
- The **chain outcome** is the outcome of the last trace in the chain. Earlier traces can be `misclassified` or `partial` — that's the honest path.

### 5. Append

Append the JSON line to `.claude/project/memory/traces.jsonl`.

### 6. Output

Confirm: "Trace RT-NNN logged: [problem_type] / [framework_selected] → [outcome]"

If chain: "Chain CH-NNN, step [seq]"

## Notes

- `quality_score` starts as null. It gets set later by `/reasoning:score`.
- `reclassified_from` and `reclassified_ts` are only set during retroactive reclassification by `/reasoning:score`.
- Keep fields concise — traces are for quick scanning, not full documentation.
- Every trace should have a `framework_rationale` that explains WHY, not just WHAT.
- Log when you know the outcome, not before. Don't log mid-investigation — wait until the step is complete.
