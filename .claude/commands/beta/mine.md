---
description: Mine patterns from user behavior — prompts, decisions, skill chains, evolution cycles
says:
  - mine beta patterns
  - beta mine
  - what patterns in my decisions
  - mine the decisions
---

# /beta:mine — Pattern Mining for Alex β's Judgment Model

Analyzes user behavior patterns across all data sources to improve Alex β's persona.
Output goes to `.claude/agents/president/_system/beta/judgement-model-recommendations.md` (staging area).
Sleep reviews recommendations — this skill does NOT directly modify `judgement-model.md`.

## Data Sources

| Source | Location | Pattern Type |
|--------|----------|-------------|
| Prompts | `.claude/project/events/events.jsonl` (cat: prompt) | Prompt sequences, frustration signals |
| Tool events | `.claude/project/events/tools.jsonl` | Skill chains, tool co-occurrence |
| Alex β decisions | `.claude/agents/president/_system/beta/events.jsonl` | Accuracy, topic confidence |
| Git | `git log --all --format` | Feature lifecycle, decision cycles |
| Learnings | `.claude/project/memory/learnings.jsonl` | User corrections, preference signals |
| Spec events | `.claude/project/events/requirements.jsonl` | Build/meta cycles |

## Phase 1: Extract Patterns

Run these analyses using the centralized logger's `query()` function:

### 1a. Prompt Sequences
```
query({cat: "prompt", limit: 100})
```
Group prompts by session. Find recurring 2-3 prompt sequences that precede the same action type.
Look for repeated loops, e.g. build → bug report → fix → verify → build.

### 1b. Skill Chains
```
query({cat: "tool", limit: 200})
```
Find tools that fire within 60 seconds of each other. Which skills are always run in sequence?
Example: `/scan:requirements` always followed by `/maps:all`?

### 1c. Frustration-to-Enforcement
Match prompt entries containing frustration signals ("keeps happening", "how do I get you to", "stuck in a loop", repeated corrections) to subsequent hook/skill creation events within 2 sessions.

### 1d. Decision Accuracy (if Alex β decisions exist)
Read `.claude/agents/president/_system/beta/events.jsonl`. Calculate:
- Total consultations, escalations, overrides
- Override rate per topic category
- Topics where Alex β is consistently wrong → recommend confidence decrease
- Topics where Alex β is consistently right → recommend confidence increase

### 1e. Feature Lifecycle
```
git log --all --oneline --format="%h %s"
```
Track features across branches: created → iterated → locked OR killed.
What gets deleted? What survives every branch? What keeps getting reworked?

### 1f. Time-of-Day Patterns
Bucket all events by hour. Look for clusters:
- Cluster events by activity type (e.g. infrastructure, design/meta-reflection, product execution) and note which hours each cluster dominates

## Phase 2: Format Recommendations

Write findings to `.claude/agents/president/_system/beta/judgement-model-recommendations.md`:

```markdown
# Alex β Mining Recommendations — [date]

## New Patterns Discovered
- [P-001] type: description (evidence: EVT-xxx, EVT-yyy) confidence: high/medium/low

## Confidence Adjustments
- [topic]: current → recommended (reason)

## New Anti-Patterns
- [description] (evidence: user corrected N times)

## Persona Gaps
- Questions Alex β couldn't answer with no matching principle

## Decision Policy Gaps
- Cases where β couldn't classify a question as Class A/B/C cleanly (target: `paths.decisionPolicy`)
- Cases where the scoring rubric weights felt wrong for the current product stage (target: `paths.currentStage` or `paths.decisionPolicy`)
- Cases where an escalation red line was hit but β was unsure whether it really applied (target: `paths.decisionPolicy` red lines section)
- Note: these never auto-apply via `/beta:integrate` — always user-flagged for review
```

## Phase 3: Summary

Report to the user:
- Patterns found (count by type)
- Confidence adjustments recommended
- Any new anti-patterns discovered
- Next step: "Review `.claude/agents/president/_system/beta/judgement-model-recommendations.md` or let `/sleep:deep` integrate during Phase 4"
