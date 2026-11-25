---
description: Record a new instance of a recurring system issue — appends to recurring-issues.jsonl, dedupes by title overlap
user-invocable: true
---

# /issues:log — Log a Recurring System Issue Instance

Append an instance of a system-level issue to `paths.recurringIssuesFile`. If a similar entry already exists (≥70% token overlap with the title), the script increments its `count` and appends to its `instances` array. Otherwise creates a new `RI-NNN` entry.

**Scope:** SYSTEM-only (agent framework, hooks, skills, `.claude/`, `scripts/`). Product bugs go to `/fix:deep`.

## Input

`$ARGUMENTS` — `"<title>" <category> <severity> <context...>`

- **title** — short, slug-like description (the dedup key, ≥70% token overlap matches existing). Quote it if it contains spaces.
- **category** — `hook | path | skeleton-rebuild | provider | spec-drift | merge-guard | harness | dispatch | context-overflow | other`
- **severity** — `low | medium | high`
- **context** — verbatim description of this instance (what triggered it, where, evidence). Free text, no quotes needed for trailing words.

Example:
```
/issues:log "Hook silently disabled by I/O failure" hook high team-guard.js wrote debug log to non-existent dir, ENOENT swallowed by outer try/catch
```

## Procedure

```bash
node scripts/recurring-issues-helper.js log $ARGUMENTS
```

The helper prints either `created RI-NNN` or `incremented RI-NNN (count=N)`. Pass that line through verbatim.

If the user provided a `ref:RT-NNN` token in the context, the helper will preserve it inside the `instances[].context` field — useful for cross-linking to a reasoning trace.

## When to use

Don't use for one-off bugs — those go to `/fix:deep` and the bug registry. Use this when you observe (or recall) that the same class of system bug has hit before, OR when a `/issues:list --scan` surface ranking shows ≥3 hits on the same audit-block signature.

Good signals:
- A hook was silently disabled in a way you've seen before
- A skeleton rebuild lost a fix that was already applied earlier
- A guard you wrote works in tests but the harness allows a bypass
- A merge-guard / format-guard / lint rule fires on a pattern you keep doing
- A provider falls back to Claude when Codex/Gemini was intended
