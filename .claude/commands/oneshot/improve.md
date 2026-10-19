---
description: Update preflight passes based on gaps discovered during runs. Modifies the check skills themselves.
user-invocable: true
---

# /oneshot:improve — Self-Improvement Protocol for Preflight

Update the preflight and check skills based on gaps discovered during conversations, agent runs, or post-preflight analysis. When a check misses something that caused a run failure or required manual intervention, this skill captures the miss and adds it to the right skill.

This is **meta** — it edits the skill files themselves so future preflight runs catch what we just learned. Distinct from `/oneshot:preflight` which RUNS the checks.

## Usage

- `/oneshot:improve` — interactive: asks what was missed, classifies, updates the right skill
- `/oneshot:improve "description of what was missed"` — direct: processes the described gap

## Procedure

### Step 1: Identify the gap

Ask (or parse from `$ARGUMENTS`): What did preflight miss? What should it have caught?

### Step 2: Classify which file to update

| If the gap is about... | Update this file |
|---|---|
| Spec/story/copy/data field inconsistencies | `.claude/commands/scan/requirements.md` (static mode) |
| Missing test coverage, story gaps, metadata | `.claude/commands/scan/requirements.md` (static mode) |
| Spec drift, propagation after code changes | `.claude/commands/scan/requirements.md` (drift mode) |
| Agent manifests, ownership, buildability | `.claude/commands/scan/architecture.md` (internal mode) |
| Architecture mechanism implementation | `.claude/commands/scan/architecture.md` (internal mode) |
| Cross-layer seams, doc→agent integration | `.claude/commands/scan/architecture.md` (seams mode) |
| Doc quality, foundation, infra data | `.claude/commands/scan/architecture.md` (health mode) |
| Environment, build, hooks, scripts, git state | `.claude/commands/scan/environment.md` (ready mode) |
| Hook/skill quality, config, test infra | `.claude/commands/scan/environment.md` (audit mode) |
| Run transition, retro, store reset, hygiene | `.claude/commands/oneshot/preflight.md` (Pass 5 inline) |
| Skeleton stubs, foundation files, gutting | `.claude/commands/oneshot/preflight.md` (Pass 7 inline) |
| Recurring patterns, automation proposals | `.claude/commands/scan/patterns.md` |
| Multiple areas | Update all relevant files |

### Step 3: Draft the new check

Format for a new check:

```markdown
- **{ID} {Short Title}** — {What to check}. {How to check it}. Flag {condition} as {ERROR|WARN|INFO}.
```

Format for adding to an existing check:

```markdown
- {What to verify}. Flag: "{error message template}".
```

### Step 4: Read the target file and insert

1. Read the target skill file
2. Find the correct mode section and last check
3. Add the new check, using the next ID in sequence
4. If adding to an existing check, append the bullet

### Step 5: Log to events

```bash
node -e "const {log}=require('./scripts/hooks/lib/logger'); log('modification', {file:'{target-file}', change:'Added check {ID}: {description}', reason:'{what was missed}'})"
```

### Step 6: Confirm with user

Show: which file was updated, the new check text, the event log entry.

## Important

- Changes what future preflight/check runs verify.
- Always log to events so the rationale is preserved.
- Prefer adding to existing checks over new checks when scope overlaps.
- Keep checks actionable — include HOW (files, commands, grep patterns), not just WHAT.
- New checks must include severity guidance (ERROR/WARN/INFO).

## Companion skills

- `/oneshot:preflight` — runs the checks this skill modifies
- `/oneshot:retro` — surfaces gaps that often feed this skill
