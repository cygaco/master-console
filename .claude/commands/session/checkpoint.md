---
description: Force an immediate session checkpoint save — captures conversation context and tool activity that git alone cannot recover, so the session is resumable after a crash or restart.
user-invocable: true
tags: [session, checkpoint, crash-recovery]
says:
  - checkpoint now
  - save a checkpoint
  - snapshot the session
  - session checkpoint
---

# /session:checkpoint — Force Checkpoint

Save an immediate checkpoint of current session state. Captures what git can't recover: conversation context and tool activity.

## What Gets Saved

Writes `.claude/runtime/.session-checkpoint.json` with:
- Timestamp + reason: "manual"
- Last 30 lines of prompt log (user messages — the things lost on /clear or compaction)
- Last 10 tool call entries (what was being worked on)

## Procedure

```bash
cat .claude/.session-prompts.log | tail -30
tail -10 .claude/.session-tracking.jsonl
```

Write to `.claude/runtime/.session-checkpoint.json` and confirm:

```
Checkpoint saved at {timestamp}
Prompts captured: {N}
Tool calls captured: {N}
```

Also update `.claude/runtime/.last-checkpoint` timestamp so the periodic checkpoint timer resets.

One line output, done.
