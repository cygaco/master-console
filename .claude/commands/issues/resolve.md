---
description: Mark a recurring system issue resolved with a permanent fix summary
user-invocable: true
---

# /issues:resolve — Resolve a Recurring System Issue

Mark a recurring system issue (`RI-NNN` from `paths.recurringIssuesFile`) as resolved with a one-line permanent-fix summary.

## Input

`$ARGUMENTS` — `<id> "<fix-summary>"`

- **id** — `RI-NNN` from `/issues:list` output
- **fix-summary** — one-line description of the permanent fix that retired this issue (commit ref OK)

Example:
```
/issues:resolve <issue-id> "Wrapped debug-log writes in own try/catch + mkdirSync recursive"
```

## Procedure

```bash
node scripts/recurring-issues-helper.js resolve $ARGUMENTS
```

The helper sets `status: "resolved"`, fills `permanent_fix`, updates `last_seen`. The entry stays in the file but is hidden from `/issues:list` (use `--all` to see resolved).

## When to use

- A class of bug that kept hitting now has a structural fix that should prevent the entire class
- A merge-guard / harness behavior changed and the workaround is no longer needed
- A skeleton-rebuild contract is now spec'd and won't revert on next gut

Don't use to mark something resolved if you only patched one instance — recurring issues need structural fixes, not symptom suppression. If the underlying class can still bite, leave it open and add the workaround to `current_workaround` via a fresh `/issues:log`.
