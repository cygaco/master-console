---
description: Generate a rich AI-analyzed handoff document (replaces /handoff)
user-invocable: true
says:
  - write the handoff
  - prepare a handoff
  - hand off to the next session
  - session handoff
---

# /session:handoff — Generate Handoff

Generate a handoff document for continuing work in a new session. Combines AI analysis of conversation context with session data from hooks.

## Variants

- `/session:handoff` — Full handoff (screen + file)
- `/session:handoff code` — Optimized for new Claude Code session
- `/session:handoff project` — Optimized for Claude Project chat (includes CLAUDE.md + skills)
- `/session:handoff quiet` — Save to file only, no screen output

## Data Sources

Read these files to supplement what's in conversation context:

| File | What It Adds |
|------|-------------|
| `.claude/.session-prompts.log` | User messages this session (fills gaps from compaction) |
| `.claude/.session-tracking.jsonl` | Last 50 tool calls (files touched, errors) |
| `.claude/runtime/.session-checkpoint.json` | Last periodic checkpoint |

## Steps

### 1. Gather State (automated)

Run in parallel:
- `git branch --show-current` + `git log --oneline -10` + `git status`
- `git diff --stat` (uncommitted changes)
- Read conversation context for decisions, bugs, deferred items
- Read `.session-prompts.log` for user messages (fills compaction gaps)
- Read last 50 lines of `.session-tracking.jsonl` for tool activity
- Read `.claude/project/events/requirements-staged.jsonl` — count pending entries grouped by feature

### 2. Build the Handoff

```markdown
# Handoff — [Product Name] — [Date]

## Branch State

- Branch: `[branch]` ([N] commits ahead of master)
- Uncommitted: [summary or "clean"]
- Last commit: `[hash] [message]`

## This Session

[3-5 bullets: what was done, decisions made, blockers encountered]

## Session Metrics

- Prompts: {N} this session
- Tool calls: {N} total, {M} errors
- Threads: {list with effectiveness}
- Duration: {first → last timestamp}

## Files Changed

[List of files modified with one-line change descriptions]

## Retro Candidates (unlogged)

[Findings from conversation that aren't in retro docs yet]
- [BUG] description — status
- [DECISION] description
- [DEFERRED] description

## Next Steps

[Prioritized, specific list]

## Pending Requirement Changes

[If any pending entries exist in requirements-staged.jsonl, show:]

| Feature | Count | Highest Priority |
|---------|-------|-----------------|
| {feature} | {N} | {drift_type} |

[If none: omit this section entirely]

Run `/scan:requirements review` to process these before ending the session.

## Warnings

[Don't-touch items, known broken state, pending work]
[If pending requirement overwrites exist, add: "**N spec overwrites pending review** — code behavior has diverged from specs. Run `/scan:requirements review`."]

## Key Context

[Non-obvious context that would take time to re-derive]
```

### 2b. Alex β Carry-overs (team mode only)

**Detection:** Check if this session had Alex β active:
1. Read `.claude/agents/president/_system/beta/events.jsonl` — any entries from today's date?
2. Grep `.claude/project/events/events.jsonl` for `"beta"` category entries from this session

If either is true, append this section after Key Context:

```markdown
## Alex β Carry-overs

### Escalations held for user
[Items where Alex β returned ESCALATE but user wasn't asked yet]

### Deferred to next session
[Decisions Alex β tagged as "next session" or deferred explicitly]

### Pending inbox items
[Cross-session items still unresolved — check .claude/project/events/events.jsonl category "inbox"]
```

Gather data for each subsection:
- **Escalations:** Search conversation context and `.claude/agents/president/_system/beta/events.jsonl` for `ESCALATE` entries without a corresponding user response
- **Deferred:** Search Alex β decisions for "next session", "defer", "later" in the answer or reasoning
- **Inbox:** Query events with `category: "inbox"` that have no `resolved: true` — these are cross-session messages still pending

If all three subsections are empty, include the section header with "None — clean carry-over."

If Alex β was NOT active this session, skip this entire section.

### 3. For `project` variant, append:

```markdown
## Product Context
[Full CLAUDE.md content]

## Skills Reference
[Each skill with description and instructions]
```

### 4. Save

- Always save to `.claude/runtime/handoff.md` (overwrite)
- Also save timestamped copy to `.claude/runtime/handoffs/{YYYY-MM-DD-HHMM}.md`
- Display on screen (unless `quiet` variant)

## Quality Rules

- Under 2000 words — dense, not verbose
- Specific next steps — "fix the rate limiter in api/jobs/route.ts" not "continue working"
- Include the WHY behind decisions
- Warn prominently about uncommitted changes
- Never include secrets or API keys
