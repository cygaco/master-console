---
description: "[deprecated alias → /scan:mc-migration-presence] Forwards to /scan:mc-migration-presence. The `scan:warpos-*` skills were renamed to `scan:mc-*` in mc@2.0.0 (S-OS-06). Removed in mc@2.1.0."
tags: [deprecated, alias, mc]
---

# /scan:warpos-migration-presence — DEPRECATED, use /scan:mc-migration-presence

This skill is a thin alias that forwards to **`/scan:mc-migration-presence`**. The `scan:warpos-*` skills were renamed to `scan:mc-*` in mc@2.0.0 (S-OS-06). Behavior is identical; only the canonical name changed.

## Deprecation notice (one-time)

Before forwarding, show this notice ONCE per session (skip it if it was already shown this session):

> `/scan:warpos-migration-presence` is deprecated and will be removed in mc@2.1.0. Use `/scan:mc-migration-presence`.

## Implementation

Reads `$ARGUMENTS` and dispatches:

```
/scan:mc-migration-presence $ARGUMENTS
```

## Removal

Scheduled for removal at `mc@2.1.0`. Update any docs, scripts, or skill references that still call `/scan:warpos-migration-presence` → `/scan:mc-migration-presence`. Every legacy → mc alias is listed in `scripts/open-source/mc-alias-map.json`.
