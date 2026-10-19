---
description: Cross-run intelligence and automation proposals — diagnose recurring patterns or propose prevention
---

# /scan:patterns — Pattern Intelligence

Single owner for "What patterns keep recurring across sessions and runs?" Mines learnings, traces, events, retros, and beta decisions to find repeat offenders and propose automation. Complements `/learn:deep` (which extracts patterns from conversation + events + retros) by focusing on **cross-run** recurrence.

## Input

`$ARGUMENTS` — Mode selection:
- No args — run both modes (diagnose then propose)
- `diagnose` — Cross-run analysis only (embedded in `/oneshot:retro`)
- `propose` — Automation gap proposals only (embedded in `/sleep:deep`)
- `apply` — propose + auto-apply approved proposals (requires confirmation)
- `--since=7d` / `--since=30d` — time window (default: 14d)
- `--json` — raw JSON output

---

## Files to read (all modes)

All paths below are **keys in `paths.json`** — read the registry at `.claude/paths.json` first, then resolve:

- `paths.learningsFile` — validated learnings (cross-session)
- `paths.tracesFile` — reasoning episodes with quality scores
- `paths.eventsFile` — raw event log
- `paths.events/code.jsonl` — code-level events (under `paths.events` dir)
- `paths.betaEvents` — beta decision history (= `paths.betaSystem/events.jsonl`)
- `paths.systemsFile` — system changes over time
- `paths.maps/enforcements.jsonl` — current automation coverage (under `paths.maps` dir)
- `paths.handoffs/*.md` — session summaries
- `paths.reference/reasoning-frameworks.md` — quality scoring rubric
- Retro docs — resolve from `manifest.projectPaths.retro` if present; else skip

`paths.agentSystem`, `paths.betaSystem`, `paths.maps`, etc. are all keys in `paths.json`. If any are missing, warn — the registry should be complete.

`git log --since=<window>` for commit-level signals.

---

## Mode: diagnose — Cross-Run Analysis

Spawn one Explore agent (thoroughness: very thorough). Produces intelligence for the next run.

### Step 1: Load signals

- Learnings within window, grouped by category and tag
- Traces with `quality_score <= 2` (weak fixes — possible recurring issues)
- Beta DIRECTIVE decisions that repeated similar directives
- Event spikes (bursts of error events, repeated hook blocks)
- Git: files edited 3+ times in window → hotspots

### Step 2: Cluster

Group signals by theme:
- **Same root cause across sessions** — e.g. "Windows path bug" appears in 3 hooks
- **Same skill failing repeatedly** — e.g. `/fix:fast` re-escalated to `/fix:deep` N times
- **Same file edited for the same reason** — e.g. types file for the 5th rename this month
- **Hook blocks triggering same false positive** — e.g. memory-guard on `2>&1` redirects

### Step 2.5: Echo-trap audit

Read `paths.reference/echo-trap-monitoring.md` for the full signal catalogue. Run these detectors against `paths.eventsFile`, `paths.tracesFile`, and `paths.betaEvents`:

- **Tool-call echo** — same `tool_name` + hashed `tool_input` ≥ 3× in a 20-call sliding window, excluding Read/Grep/Glob and short responses
- **Agent-dispatch echo** — same `subagent_type` with prompt-similarity ≥ 0.85 ≥ 2× in a 10-dispatch window
- **Trajectory entropy** — Shannon entropy of last 30 tool types < log2(3); flag as cycling
- **Reasoning ping-pong** — two `paths.tracesFile` entries with `quality_score ≤ 2` swapping `framework` on the same problem hash within a session
- **Beta directive recurrence** — same DIRECTIVE in `paths.betaEvents` ≥ 3× same calendar day with same problem signature
- **Hook-block recurrence** — already covered by `scripts/check-guard-promotion.js`; surface its output here

Filter false positives per the anti-pattern list in the reference doc (build-polling, parallel surveys, user-driven repeats).

Each fired detector produces a row for the META-INTELLIGENCE report's new "Echo-trap audit" section.

### Step 3: Produce META-INTELLIGENCE report

Overwrites `paths.reference/META-INTELLIGENCE.md` (or a retro subpath if manifest has one):

```markdown
# Pattern Intelligence — {date}

## 1. Repeat Problem Areas

| Pattern | Occurrences | Window | Status | Root cause | Prevention |
|---------|-------------|--------|--------|------------|------------|

## 2. Rule Effectiveness Scorecard

| Rule / Learning | Added | Recurred? | Verdict | Suggested next step |
|-----------------|-------|-----------|---------|---------------------|

Verdicts: EFFECTIVE / NEEDS ENFORCEMENT / UNTESTED / DEPRECATED

## 3. Agent Performance Trends

| Agent | This window | Previous | Trend | Common failure mode |
|-------|-------------|----------|-------|---------------------|

## 4. Skill Usage Patterns

| Skill | Calls | Success rate | Chained-into | Chained-after |
|-------|-------|--------------|--------------|---------------|

## 4b. Echo-Trap Audit

| Detector | Fires (window) | Top signature | Recommended action |
|----------|----------------|---------------|---------------------|

Detectors per `paths.reference/echo-trap-monitoring.md`. Empty rows = healthy. First fire = advisory; second = Beta consultation; third = orchestrator hard-stop with ESCALATE.

## 5. Top 3 Prevention Proposals

Concrete, implementable actions. Each cites: pattern cluster, estimated friction reduction, implementation path, who implements (skill/hook/manifest edit).
```

### Token budget

~8-12 source files, ~600-1000 lines after filtering. ~6-8K tokens.

---

## Mode: propose — Automation Gap Proposals

Scan for patterns that are **recurring but not automated**, propose concrete fixes.

### Step 1: Load current automation

- `scripts/hooks/*.js` — hook scripts
- `.claude/settings.json` — hook wiring
- `.claude/commands/**/*.md` — all skills
- `paths.maps/enforcements.jsonl` — coverage map

### Step 2: Cross-reference with signals

For each recurring pattern found in diagnose mode:
- Is there a hook that prevents it? If no → propose
- Is there a skill that handles it? If no → propose
- Is there a learning without backing enforcement? → propose

For each file hotspot (edited 3+ times with similar intent):
- Propose a lint rule, a template, or a hook matcher

For each false-positive block pattern in hooks:
- Propose a refinement to the guard's regex/logic

### Step 3: Present

**Report mode** (default):

```
Proposal {N}: {one-line summary}
  Where: {file path to modify or create}
  Because: {pattern evidence — cite learning ID / bug cluster / trace ID}
  Implementation:
    - {exact change or new file to create}
  Expected impact: {qualitative}
  Confidence: {high | medium | low}
```

Wait for approval. Accept: "approve all", "approve 1,3,5", "skip 2", "edit 2" (user provides alternative).

**Apply mode** (`apply` arg):
- One git commit per approved proposal
- Never modifies more than 3 files per proposal without explicit confirmation
- Never removes existing checks — only adds
- Low-confidence proposals skipped by default (require `--include-low`)

### Step 4: Summary

```
| Proposal | Status | Commit |
|----------|--------|--------|
| {N} — {summary} | applied / skipped / rejected | {sha if applied} |
```

---

## Combined Mode (no args)

Runs `diagnose` first, then feeds its "Top 3 Prevention Proposals" into `propose` mode as additional sources. Full pipeline: **what recurs → what to automate → approved changes**.

---

## Guard promotion status

Warn-only guards (those gated behind a `*_STRICT=1` envvar) can drift indefinitely if they keep firing without ever tightening to a hard block. Each such guard carries a `PROMOTION_TRIGGER` header comment declaring the audit-event actions it emits and the 7-day threshold that flips it to block-mode.

Run the promotion checker and include its output in the report:

```bash
node scripts/check-guard-promotion.js
```

Interpretation:

- **OK** — no audit events in the last 7 days; no action needed
- **NEAR_THRESHOLD** — 1 to 4 events; monitor
- **CANDIDATE** — 5+ events in 7 days; propose flipping from warn-only to hard-block (remove the `STRICT` env gate in the guard, or commit a corresponding fix that addresses the root cause)
- **OVERDUE** — `next_review` date has passed; re-evaluate the trigger criteria even if counts are low

When in `propose` mode, every **CANDIDATE** row should become a proposal: "Remove `STRICT` env gate from `<guard>.js` — it fired N times in the last 7d without resolution." Cite the audit-event action names from `metric_query` as evidence.

---

## When to run

- **End of a multi-day work push** — `diagnose` to see what kept coming up
- **On `/sleep:deep`** — embedded automatically in Phase 5 (growth)
- **After a series of similar-looking bugs** — `diagnose --since=7d` to confirm the cluster
- **Monthly** — `propose` with `--since=30d` for bigger structural proposals

## Related

- `/learn:deep` — extracts patterns from conversation + event log + oneshot retro files (single-session)
- `/oneshot:retro` — session-level retrospective (feeds into this)
- `/hooks:friction` — specifically finds friction patterns suggesting missing hooks
- `/maps:enforcements` — current automation coverage (this skill proposes additions to it)
