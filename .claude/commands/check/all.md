---
description: "[deprecated alias → /scan:full] Run every scan in parallel — a full system scan. Superseded by /scan:full in the check:→scan: namespace rename (SP-20260528-001)."
user-invocable: true
tags: [deprecated, alias, scan]
---

# /check:all — DEPRECATED, use /scan:full

This skill is a thin alias that forwards to **`/scan:full`**. The `check:` namespace was renamed to `scan:` in SP-20260528-001; `scan:full` also expands the old `check:all` from 6 checks to a true full system scan (project health + governance + MC distribution integrity).

## Implementation

Reads `$ARGUMENTS` and dispatches:

```
/scan:full $ARGUMENTS
```

Behavior is identical (a superset — more scans run). Only the canonical name changed.

## Removal

Scheduled for removal at `warpos@1.0.0`. Update any docs, scripts, or skill references that still call `/check:all` → `/scan:full`.
