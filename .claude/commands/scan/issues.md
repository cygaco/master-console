---
description: Pattern-mine events.jsonl for repeat audit-block signatures — surface candidates for /issues:log
user-invocable: true
---

# /scan:issues — Pattern-Mine Events for Recurring System Pain

Pure read-only sweep of `paths.eventsFile` over the last 7 days, ranking `cat:"audit"` events with `data.action` containing `"blocked"` by signature frequency. Anything ≥3× is a candidate for `/issues:log`.

Distinct from `/issues:list` (which shows curated entries from `paths.recurringIssuesFile`). This skill surfaces UNCURATED data to inform what should be logged. Doesn't write anything.

## Input

No arguments.

## Procedure

```bash
node scripts/recurring-issues-helper.js scan
```

Render the script output directly. Don't summarize.

## Output shape

```
# Audit-block signatures (last 7d), ranked

- **17×** merge-guard-blocked :: node -e with fs write blocked: use Edit/Write tools, or put
- **7×** merge-guard-blocked :: rm on src/ or _docs/ blocked: use git to manage file lifecycl
- **5×** merge-guard-blocked :: git push force-push blocked: destructive operation. (matched
- **2×** beta-gate-blocked :: Alex β not consulted

→ Anything ≥3× is a recurring-issue candidate. Use `node scripts/recurring-issues-helper.js log ...` to add it.
```

Single occurrences are filtered out — they're not recurring.

## When to run

- During `/oneshot:retro` — surface any block patterns from the run
- After auditor analysis — confirm the auditor's findings against raw block data
- After a long session — see what hooks fired most against your work
- Routinely (e.g. weekly) to check for emerging system pain

## Pairs with

- **/issues:log** — record a new instance of one of these candidates
- **/issues:list** — see curated open issues
- **/issues:resolve** — close an issue when the structural fix lands
- **/learn:deep** — semantic-memory layer above this (turns repeat patterns from events + conversation + retros into general learnings, not specific issues)
