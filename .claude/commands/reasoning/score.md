---
name: reasoning:score
description: Score fix quality (0-4) and retroactively reclassify old fixes when new evidence appears
---

# /reasoning:score — Fix Quality Scoring & Reclassification

Scores a fix or decision on the 0-4 quality scale. Can also retroactively reclassify old traces when new evidence shows the original score was wrong.

## Input

`$ARGUMENTS` — One of:
- A trace ID (e.g., "RT-005") to score or reclassify
- "last" — evaluate the most recent trace
- "scan" — scan all traces from the last 7 days for reclassification candidates
- A problem description — find and evaluate the matching trace

## Quality Scale

| Level | Name | Criteria (all must be true for that level) |
|-------|------|-------------------------------------------|
| 0 | **Failed** | Fix didn't work. Problem persists or got worse. |
| 1 | **Surface** | Symptom gone. Root cause unknown or unaddressed. Could recur. |
| 2 | **Context-limited** | Root cause found and fix verified, but only tested under specific conditions. May fail elsewhere. |
| 3 | **Robust** | Root cause fixed + verified + no regression detected + tested across relevant conditions. |
| 4 | **Generalizable** | All of Level 3 + prevention rule/learning logged + reusable pattern identified for similar future cases. |

### Critical Rules

- **Symptom disappearance = Level 1, not Level 3.** Prove robustness with evidence.
- **"Build passes" alone = Level 2 at best.** Does the fix hold under edge cases?
- **Level 4 requires a logged learning or prevention rule.** The fix must teach the system, not just fix the instance.
- **Be honest.** A Level 2 that's honest is more valuable than an inflated Level 3.

## Mode 1: Score a Trace

### 1. Read the Trace

Read `.claude/project/memory/traces.jsonl`, find the matching trace by ID or recency.

### 2. Gather Evidence

For each quality criterion, check:

| Criterion | How to verify |
|-----------|--------------|
| Fix worked | Build passes, behavior is correct, error is gone |
| Root cause identified | Trace has a clear `framework_rationale`, not just "fixed the symptom" |
| Fix verified | Tests pass, manual verification done, or behavior confirmed |
| No regression | Related code paths checked, no new errors introduced |
| Tested across conditions | Multiple scenarios tested, not just the reported case |
| Prevention logged | Learning exists in `learnings.jsonl` linked to this trace |

### 3. Score

Assign the highest level where ALL criteria are met. Write the score to the trace:
- Update the `quality_score` field in the trace entry
- If a linked learning exists, update its `fix_quality` field too

### 4. Output

```
## Fix Quality Assessment: RT-[NNN]

Problem: [summary]
Framework: [selected]
Outcome: [resolved/partial/failed]

| Criterion | Met? | Evidence |
|-----------|------|----------|
| Fix worked | Yes/No | [detail] |
| Root cause identified | Yes/No | [detail] |
| Fix verified | Yes/No | [detail] |
| No regression | Yes/No | [detail] |
| Tested across conditions | Yes/No | [detail] |
| Prevention logged | Yes/No | [detail] |

**Quality Score: [0-4] — [Name]**
[One sentence explaining the score]
```

## Mode 2: Retroactive Reclassification

When called with "scan" or when `/sleep:deep` Phase 1g triggers:

### 1. Find Candidates

Read all traces from the last 7 days (or specified range) with `quality_score >= 2`.

### 2. Check Each Candidate

For each trace:
1. **Did the fix hold?** Check if similar bugs appeared after the fix date (search learnings, git log, BUGS.md)
2. **Did conditions change?** Is the fix still valid in the current codebase state?
3. **Does a better fix exist?** Has a subsequent trace solved the same root cause more completely?

### 3. Reclassify if Needed

If evidence warrants a downgrade (or upgrade):
1. Read the trace
2. Update `quality_score` to the new level
3. Set `reclassified_from` to the old score
4. Set `reclassified_ts` to now
5. If a linked learning exists, update its `fix_quality` too

### 4. Output

```
## Reclassification Report

Scanned: [N] traces from last 7 days

| Trace | Old Score | New Score | Reason |
|-------|-----------|-----------|--------|
| RT-005 | 3 (Robust) | 2 (Context-limited) | Same bug reappeared in different route |
| RT-008 | 2 (Context-limited) | 3 (Robust) | Subsequent testing confirmed broader coverage |

[N] reclassified, [M] unchanged.
```

## Mode 3: Batch Score Unscored Traces

When many traces have `quality_score: null`:

1. List all unscored traces
2. For each, attempt to score based on available evidence
3. If insufficient evidence, leave as null with a note

## Mode 4: Cross-Model Validation (Level 3+ Claims)

When a trace is scored Level 3 (Robust) or Level 4 (Generalizable), same-model self-evaluation is unreliable (90%+ self-confirmation rate). Use a different model family as independent judge.

### 1. Prepare Evaluation Brief

Build a structured prompt containing:
- The problem summary (from trace `problem_summary`)
- The fix applied (from trace `framework_selected` + linked learning)
- The evidence gathered in Mode 1 Step 2
- The claimed quality level and criteria met/unmet

### 2. Call Gemini for Independent Assessment

```bash
gemini -m gemini-2.5-flash -p "You are an independent quality evaluator. Score this fix on a 0-4 scale:
0=Failed, 1=Surface (symptom gone, cause unknown), 2=Context-limited (root cause found, narrow test),
3=Robust (root cause + verified + no regression + multi-condition), 4=Generalizable (Level 3 + prevention rule).

[evaluation brief]

Reply with ONLY: score (0-4), one-sentence rationale." -o text
```

### 3. Compare Scores

- If Gemini agrees (same level ±0): confirm the score
- If Gemini downgrades: use the LOWER score (conservative)
- If Gemini upgrades: keep original score (conservative)
- Record the disagreement either way

### 4. Record in Trace

Update the trace entry with:
- `validator_model`: `"gemini-2.5-flash"`
- `cross_validation`: `{ "gemini_score": N, "agreement": true|false, "gemini_rationale": "..." }`

### Graceful Degradation

If `gemini` CLI is not available (command not found), skip cross-model validation. Set `validator_model: "unavailable"` and note in trace `meta_notes`.

## Mode 5: Score a Chain

When a trace has a `chain` field, score the chain as a whole:

1. Load all traces with the same `chain` ID, ordered by `seq`
2. The chain's quality is determined by the **final trace's outcome**, not earlier missteps
3. A chain with a misclassified first step but a resolved final step is a success
4. Score the final trace using Mode 1 criteria
5. Earlier traces in the chain keep their individual outcomes (`misclassified`, `partial`, etc.) — don't retroactively change them
6. Add to output: "Chain CH-NNN: [N] steps, pivoted [M] times, final outcome [resolved/etc.]"

The chain structure itself is valuable data — a 3-step chain that self-corrected shows healthy reasoning even if the initial classification was wrong.

## Notes

- Reclassification is not failure — it's learning. A downgrade means the system is getting smarter.
- Never inflate scores to look good. The purpose is honest calibration.
- Level 4 is rare and should stay rare. Most good fixes are Level 3.
- When in doubt between two levels, choose the lower one.
- Cross-model validation (Mode 4) is mandatory for Level 3+ and optional for Level 2.
- Chains that self-correct are MORE valuable than chains that get it right first try — they produce learnings about the classification process itself.
