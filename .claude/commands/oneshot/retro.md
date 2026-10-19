---
description: Post-run retrospective — context + git log + code diffs + cross-run analysis, all 9 categories. Default = full. Args control surgical access.
user-invocable: true
---

# /oneshot:retro — Retrospective

Single entry point for post-run reflection.

**Default invocation runs the full retro:** all 4 sources, all 9 categories, cross-run analysis included.

## Usage

| Invocation | Behavior |
|------------|----------|
| `/oneshot:retro` | **Full retro.** All 4 sources + all 9 categories + cross-run analysis. Use after a run completes/halts. |
| `/oneshot:retro --context` | **Narrow.** Just scan the conversation context for retro signals. 0 tool calls. Use for fast sanity check during the session. |
| `/oneshot:retro --code` | **Narrow.** Just scan git diff for code-level signals (bug fixes, new patterns, hygiene rules). |

`$ARGUMENTS` parses for `--context` or `--code`. If neither, runs the full retro.

---

## Mode 1 — Full retro (default)

### The 4 Sources

| Source | What It Catches | How |
|--------|----------------|-----|
| **Conversation context** | Bug reports, decisions, deferred items, UX feedback | Scan in-context (0 tool calls) |
| **Git log** | Reverts, hotspot files, orphan branches, commit patterns | `git log` + `git branch` |
| **Code diffs** | Bug fixes, new patterns, type changes, removed features | `git diff` |
| **Cross-run retro docs** | Recurring patterns, rule effectiveness, trends | Read prior run BUGS/HYGIENE/LEARNINGS |

### The 9 Categories

| # | Category | Doc | Primary Source |
|---|----------|-----|----------------|
| 1 | Process changes | RETRO.md | Context + git log |
| 2 | Tooling changes | TOOLING.md | Context + git log |
| 3 | Bugs | BUGS.md | Code diffs + context |
| 4 | New patterns | HYGIENE.md | Code diffs |
| 5 | Repeat problem areas | LEARNINGS.md | Cross-run docs + current findings |
| 6 | Hygiene rules | HYGIENE.md | Code diffs |
| 7 | Requirement propagation | (inline) | Event log (spec + code categories) |
| 8 | Agent performance | RETRO.md | Git log + context + cross-run trends |
| 9 | Prevention proposals | LEARNINGS.md | Synthesized from all sources |

### Phase A: Context Scan (0 tool calls)

Scan the conversation for bug reports, decisions, deferred items, UX feedback, surprises, and patterns. Hold findings for Phase F.

This is the same logic as `--context` mode below; in full mode it runs inline as Phase A.

### Phase B: Git Log Scan (~3 commands)

```bash
git log --oneline --since="3 days ago" --format="%h %ai %s" | head -30
git log --since="7 days ago" --name-only --format="" | sort | uniq -c | sort -rn | head -10
git branch --all | grep -E 'agent/|wt-|temp'
```

### Phase C: Code Diff Scan (~2 commands)

This is the same logic as `--code` mode below; in full mode it runs inline as Phase C.

```bash
git log --oneline -1 -- 'the retro directory (check manifest.json projectPaths.retro for location)/'
git diff {baseline}..HEAD --stat -- 'src/' 'scripts/'
git diff {baseline}..HEAD -- 'src/' | head -500
```

### Phase C2: Requirement Propagation Check

Delegate to `/scan:requirements drift`. This queries the event log for spec and code events, cross-references per feature, checks hierarchy propagation.

Add findings under REQUIREMENTS PROPAGATION:

```
REQUIREMENTS PROPAGATION:
  14. [STALE] onboarding/INPUTS.md — code removed "Edit profile text" but spec still references it
  15. [COMPLETE] notifications — all spec layers updated
  16. [UNMATCHED] page.tsx — layout change with no spec update
```

If no events exist, falls back to `git diff --name-only`.

### Phase D: Cross-Run Analysis

Delegate to `/scan:patterns diagnose`. This spawns an Explore agent to read all prior retro docs and returns:

1. Repeat problem areas (grouped by root cause, with run counts and status)
2. Rule effectiveness scorecard (EFFECTIVE / NEEDS ENFORCEMENT / UNTESTED / DEPRECATED)
3. Agent performance trends (cross-run success/failure)
4. Run-over-run metrics (bugs, P0s, recurring, new rules per run)

### Phase D2: Recurring System-Issue Scan

```bash
node scripts/recurring-issues-helper.js scan
node scripts/recurring-issues-helper.js list
```

The first command pattern-mines `paths.eventsFile` over the last 7 days, ranking `cat:"audit"` block signatures by frequency. The second shows currently-open curated entries from `paths.recurringIssuesFile`.

For each scan result with **count ≥ 3** that is NOT already represented in the curated list, propose it under `RECURRING SYSTEM ISSUES:` in Phase F output, e.g.:

```
RECURRING SYSTEM ISSUES (system-only, NOT product):
  17. [SCAN-CANDIDATE] merge-guard: `node -e fs.write` blocked N× in 7d — propose: /issues:log
  18. [OPEN, count=2] RI-NNN — same as scan candidate above (already tracked, increment)
```

This is a SYSTEM-only layer (agent framework, hooks, skills, .claude/, scripts/). Do NOT include product bugs here — those go through Phase C/F categories above.

### Phase E: Get next IDs

Grep current run's BUGS.md for last bug number. Grep HYGIENE.md for last rule number.

### Phase F: Classify and present

Merge findings from all 4 sources. Deduplicate. Present grouped by source:

```
/oneshot:retro — {N} findings from 4 sources:

CONTEXT (conversation):
  1. [BUG] <bug summary> — user report, FIXED
  2. [DECISION] <decision summary>
  3. [UX+] <praised UX detail>
  4. [DEFERRED] <deferred item>

GIT LOG:
  5. [HOTSPOT] <file> — N changes this session

CODE DIFFS:
  6. [BUG] <component> — <fix summary>
  7. [PATTERN] Rule N: <pattern>

CROSS-RUN:
  8. [REPEAT] BUG-NNN class — recurrence N
  9. [RULE EFFECTIVE] Rule N (<rule name>) — no recurrence
  10. [NEEDS ENFORCEMENT] Rule N — recurred
  11. [PREVENTION] <proposed enforcement>

Log which? (all / pick numbers / skip)
```

### Phase G: Write confirmed entries

Write to BUGS.md, HYGIENE.md, LEARNINGS.md, RETRO.md. For cross-run findings, also overwrite META-RETRO.md with repeat areas, rule scorecard, trends, metrics, and top 3 prevention proposals.

### Phase H: Summary table

```
/oneshot:retro complete — {N} findings:

| Doc | Entries |
|-----|---------|
| BUGS.md | BUG-001, BUG-002 |
| HYGIENE.md | Rule 50, Rule 51 |
| LEARNINGS.md | 1 repeat area, 2 prevention proposals |
| RETRO.md | 2 decisions, 1 deferred, 2 UX notes |
| META-RETRO.md | Updated: 3 repeat areas, 4 rule scores, 3 proposals |
```

---

## Mode 2 — Context-only (`--context`)

Scan the current conversation for retro signals. **0 tool calls.** Output a structured list of findings under CONTEXT for the user to decide which to log.

### What to look for

- **Bug reports** — explicit "X is broken", "Y doesn't work", "Z returned 0 results"
- **Decisions** — "let's do X instead", "we agreed to Y", "going with Z"
- **Deferred items** — "we'll do X later", "post-MVP", "not now"
- **UX feedback** — explicit praise/complaints about UI, copy, flow
- **Surprises** — unexpected outcomes, "huh", "didn't expect that"
- **Patterns** — same issue type recurring, same fix needed twice

### Output shape

```
/oneshot:retro --context — {N} findings:

  1. [BUG] <verbatim user phrase>
  2. [DECISION] <decision + rationale>
  3. [UX+] <praise>
  4. [DEFERRED] <item>

Log which? (all / pick numbers / skip)
```

If nothing found: report "No retro signals in current context."

---

## Mode 3 — Code-only (`--code`)

Scan git diff for code-level retro signals. ~2-3 commands.

### Commands

```bash
# What's the retro baseline? (last retro commit on the retro dir)
BASELINE=$(git log --oneline -1 --format="%H" -- "$(node -e "console.log(require('./.claude/manifest.json').projectPaths?.retro || '.claude/agents/president/_system/oneshot/retros')")")

# What changed in src/ + scripts/?
git diff "$BASELINE..HEAD" --stat -- 'src/' 'scripts/'
git diff "$BASELINE..HEAD" -- 'src/' | head -500
```

### Signals to extract

- **Bug fixes** — commits with `fix(` prefix touching `src/components/`
- **New patterns** — repeated structural changes across files (e.g., 3 `useEffect` → `useEffect with cleanup`)
- **Hygiene rules** — invariants enforced via new lint, type, or hook
- **Type changes** — modified `src/lib/types.ts` exports
- **Removed features** — deletions in `src/components/`

### Output shape

```
/oneshot:retro --code — {N} findings:

CODE DIFFS:
  1. [BUG] <component> — <fix summary> (commit abc123)
  2. [PATTERN] Rule N: <pattern>
  3. [TYPE-CHANGE] <Type.field> added (<feature>)

Log which? (all / pick numbers / skip)
```

If nothing found: report "No code-level retro signals — diff is empty or trivial."

---

## Token Budget

- Full mode: ~8-10K tokens
- `--context`: ~500-1500 tokens
- `--code`: ~2-4K tokens

## Companion skills

- `/oneshot:preflight` — pre-run setup + audit
- `/oneshot:improve` — when retro reveals a gap that should become a future preflight check
- `/oneshot:start` — wraps preflight + mode switch + Delta handoff in a single kickoff
