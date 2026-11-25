---
description: Read the cross-session inbox — see what other Alex sessions have been doing
---

# /session:read — Read Cross-Session Inbox

Reads `.claude/project/events/events.jsonl (cat=inbox)` and displays all messages from the last 24 hours.

## Input

`$ARGUMENTS` — Optional filter:
- No args: show all messages from last 24h
- `clear` — clear all messages (after reading)
- A keyword — filter messages containing that keyword

## Process

1. Query inbox events: `node -e "const {query}=require('./scripts/hooks/lib/logger'); const msgs=query({cat:'inbox',since:Date.now()-86400000}); console.log(JSON.stringify(msgs))"`
2. Already filtered to last 24 hours by the query
3. Display in reverse chronological order (newest first)
4. For each message show: time, source session, message, files changed

## Output

```
## Cross-Session Inbox (N messages, last 24h)

### [HH:MM] from: session-description
message text here
Files: file1.ts, file2.md

### [HH:MM] from: session-description
message text here

---
Oldest message: HH:MM | Newest: HH:MM
```

If inbox is empty: "Inbox empty — no messages from other sessions in the last 24h."

## Notes

- Messages are auto-injected into every prompt via prompt-enhancer (last 5)
- This skill shows ALL messages, not just the last 5
- Messages expire after 24h automatically
- Use `clear` to manually wipe after reading
