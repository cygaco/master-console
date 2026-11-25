---
description: Light nap — NREM consolidation + glymphatic cleanup only (~5 min)
user-invocable: true
---

# /sleep:quick — Light Nap

Run only Phase 1 (NREM Memory Consolidation) and Phase 2 (Glymphatic Cleanup). Skips replay, dreaming, repair, and growth.

Good for mid-session resets or when short on time.

After Phase 2 cleanup, check `.claude/project/events/requirements-staged.jsonl` for pending entries. If any exist, surface a one-line warning:

```
⚠ {N} requirement changes pending review. Run /scan:requirements review or they'll carry to next session.
```

For the full 6-phase cycle (includes REM dreaming): `/sleep:deep`
