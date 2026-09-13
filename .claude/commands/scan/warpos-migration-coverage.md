---
description: "[deprecated alias → /scan:mc-migration-coverage] Forwards to /scan:mc-migration-coverage. The `scan:warpos-*` skills were renamed to `scan:mc-*` in mc@2.0.0 (S-OS-06). Removed in mc@2.1.0."
tags: [deprecated, alias, mc]
---

# /scan:warpos-migration-coverage — DEPRECATED, use /scan:mc-migration-coverage

This skill is a thin alias that forwards to **`/scan:mc-migration-coverage`**. The `scan:warpos-*` skills were renamed to `scan:mc-*` in mc@2.0.0 (S-OS-06). Behavior is identical; only the canonical name changed.

## Deprecation notice (one-time)

Before forwarding, show this notice ONCE per session (skip it if it was already shown this session):

> `/scan:warpos-migration-coverage` is deprecated and will be removed in mc@2.1.0. Use `/scan:mc-migration-coverage`.

## Implementation

Reads `$ARGUMENTS` and dispatches:

```
/scan:mc-migration-coverage $ARGUMENTS
```

## Removal

Scheduled for removal at `mc@2.1.0`. Update any docs, scripts, or skill references that still call `/scan:warpos-migration-coverage` → `/scan:mc-migration-coverage`. Every legacy → mc alias is listed in `scripts/open-source/mc-alias-map.json`.
