---
description: "[deprecated alias → /scan:mc-ship-coverage] Forwards to /scan:mc-ship-coverage. The `scan:warpos-*` skills were renamed to `scan:mc-*` in mc@2.0.0 (S-OS-06). Removed in mc@2.1.0."
tags: [deprecated, alias, mc]
---

# /scan:warpos-ship-coverage — DEPRECATED, use /scan:mc-ship-coverage

This skill is a thin alias that forwards to **`/scan:mc-ship-coverage`**. The `scan:warpos-*` skills were renamed to `scan:mc-*` in mc@2.0.0 (S-OS-06). Behavior is identical; only the canonical name changed.

## Deprecation notice (one-time)

Before forwarding, show this notice ONCE per session (skip it if it was already shown this session):

> `/scan:warpos-ship-coverage` is deprecated and will be removed in mc@2.1.0. Use `/scan:mc-ship-coverage`.

## Implementation

Reads `$ARGUMENTS` and dispatches:

```
/scan:mc-ship-coverage $ARGUMENTS
```

## Removal

Scheduled for removal at `mc@2.1.0`. Update any docs, scripts, or skill references that still call `/scan:warpos-ship-coverage` → `/scan:mc-ship-coverage`. Every legacy → mc alias is listed in `scripts/open-source/mc-alias-map.json`.
