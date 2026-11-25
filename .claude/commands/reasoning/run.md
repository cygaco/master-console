---
description: Reason through a problem or decision — auto-detects quick triage vs deep deliberation
---

# /reasoning:run — Think, Then Act

The reasoning engine entry point. Classifies problems, checks memory, selects frameworks, and either routes quickly or deliberates deeply. Use `--quick` or `--deep` to force a mode, otherwise it auto-detects.

## Input

`$ARGUMENTS` — A problem, error, question, decision, or situation. Flags: `--quick` (force triage), `--deep` (force deliberation).

If no arguments: scan the conversation for the most recent problem or decision point.

## Phase 0: Check History

Search `.claude/project/memory/traces.jsonl` and `.claude/project/memory/learnings.jsonl` for keywords from the problem:
1. Grep for keywords. Filter traces by matching `problem_type`.
2. If match: note framework used, outcome, quality score.
3. If learning match: note tip and conditions.

Output: "Found [N] traces, [M] learnings" or "No prior history." Surface relevant matches before proceeding.

## Phase 1: Classify + Mode Gate

Determine the problem type:

| Type | Signals |
|------|---------|
| `bug` | Error, stack trace, build failure, wrong output, crash, regression |
| `ux` | Confusing flow, screen bloat, user mental model broken |
| `architecture` | Coupling, extensibility, dependency design |
| `performance` | Slow, memory, scaling, O(n^2) suspicion |
| `prioritization` | Competing tasks, "what first?", triage |
| `strategy` | Direction choice, approach tradeoff, build vs buy |
| `communication` | Report structure, explanation quality |
| `code_structure` | Refactoring, pattern choice, design debt |

**IMPORTANT**: Treat the user's framing as a hypothesis, not a diagnosis. If investigation reveals the classification is wrong, reclassify.

### Mode selection

- `--quick` flag → Quick mode
- `--deep` flag → Deep mode
- Bug signals → Quick mode (route to /fix:*)
- Decision, tradeoff, "should we", "are you sure", ambiguous → Deep mode
- Clear non-bug problem with obvious framework → Quick mode
- Everything else → Deep mode (when in doubt, think harder)

## Quick Mode

### Select Framework

Consult `.claude/project/reference/reasoning-frameworks.md` routing table.

Rules:
1. Match signals to the router table
2. History quality >= 3: bias toward same framework. Quality <= 1: avoid it.
3. Note alternatives considered and why they weren't primary.

### Route or Apply

- **Bug** → Route to `/fix:fast` (clear, no history) or `/fix:deep` (complex, recurring). State: "Routing to /fix:[fast|deep] with framework [name] pre-selected." Done.
- **Non-bug** → Apply the selected framework inline. Keep output focused — answer the question, don't perform a ceremony. Then skip to Phase 3.

## Deep Mode

### Step 1: First Impulse

Write the obvious answer in one sentence. Label it **First Impulse**. Do NOT act on it.

### Step 2: Steelman the Opposite

Assume the impulse is wrong. Make the strongest case against it in 2-3 sentences. Genuinely try to be right from the other side.

### Step 3: What Am I Missing?

- **Assumption:** What am I taking for granted?
- **Would change my mind:** What evidence would flip the answer?
- **Dissent:** Who would disagree, and why?

### Step 4: Framework Lens

Consult `.claude/project/reference/reasoning-frameworks.md`. Pick 1-2 frameworks to *challenge* the first impulse (not to solve the problem — to reveal blind spots):

| Problem smells like... | Framework key question |
|------|------|
| Something broke | **Trace Analysis:** Where does data first go wrong? |
| Wrong behavior | **5 Whys:** Why? (5 times, don't stop at 2) |
| Design decision | **JTBD:** What job is the user hiring this for? |
| Tradeoff | **SWOT:** Strengths, weaknesses, opportunities, threats? |
| Priority call | **Eisenhower:** Urgent+important, or just feels urgent? |
| Architecture | **SOLID:** Can each piece change independently? |
| Consequences | **Second-Order:** What happens *because* of this? |
| "Seems fine" | **Rubber Duck:** Explain each step — where do you get stuck? |

If no framework fits, skip. If two apply and contradict — that's the most valuable signal.

### Step 5: Zoom Out, Then Zoom In

**Out:** Restate one abstraction level higher. Does the reframed question change the answer?
**In:** Most concrete version — what exact file, line, behavior, outcome? Pin it down.

### Step 6: Decide

- **Answer:** What you actually think
- **Confidence:** Gut-level honest
- **What changed:** Did deliberation shift the answer from Step 1?
- **Remaining uncertainty:** What you still don't know

## Phase 3: Meta + Log

Two questions:
1. Am I solving symptom or cause? (Quality 1 or 3+?)
2. Was this the right approach? Would a different framework have been better?

Append trace to `.claude/project/memory/traces.jsonl`:
```json
{"id":"RT-NNN","ts":"ISO","problem_type":"...","mode":"quick|deep","framework_selected":"...","hypotheses":[],"outcome":"...","quality_score":null,"source":"reasoning:run"}
```

If any meta-reasoning answer raises a concern, state it explicitly.
