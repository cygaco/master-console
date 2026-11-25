---
description: List recurring system issues — bugs/regressions in the agent framework, hooks, skills, .claude/, scripts/
user-invocable: true
---

# /issues:list — Recurring System Issues

Show open recurring **system-level** issues from `paths.recurringIssuesFile`. These are bugs/regressions in the agent framework, hooks, skills, `.claude/`, scripts/ — NOT product code (those go through `/fix:deep` + bug registry + retro flows).

Use this to see what's persistently broken about the system, ranked by severity then occurrence count.

## Input

`$ARGUMENTS` — Optional flag:
- (none) — show open issues only
- `--all` — include resolved

## Procedure

```bash
node scripts/recurring-issues-helper.js list $ARGUMENTS
```

Render the script output directly. Don't summarize — the list IS the summary.

## Pairs with

- **/issues:log** — record a new instance (creates entry or increments existing by title overlap)
- **/issues:resolve** — mark an issue resolved with a permanent fix
- **/scan:issues** — pattern-mine events.jsonl for repeat audit-block signatures (surfaces UNCURATED candidates, doesn't write)
- `/learn:deep` — learning extraction from events.jsonl + conversation + retros (semantic memory layer above this)
- `paths.tracesFile` — reasoning episodes (RT-NNN), single-instance traces

## Schema reference

Each entry: `{id, title, category, first_seen, last_seen, count, instances[], severity, status, current_workaround, permanent_fix, tags[]}`. Categories: hook, path, skeleton-rebuild, provider, spec-drift, merge-guard, harness, dispatch, context-overflow, other. Severity: low/medium/high. Status: open/monitoring/resolved.
