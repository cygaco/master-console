---
description: "[deprecated alias → /mc:sync] Forwards to /mc:sync. The `warp:` skill namespace was renamed to `mc:` in mc@2.0.0 (S-OS-06). Removed in mc@2.1.0."
user-invocable: true
tags: [deprecated, alias, mc]
---

# /warp:sync — DEPRECATED, use /mc:sync

This skill is a thin alias that forwards to **`/mc:sync`**. The `warp:` skill namespace was renamed to `mc:` in mc@2.0.0 (S-OS-06). Behavior is identical; only the canonical name changed.

## Deprecation notice (one-time)

Before forwarding, show this notice ONCE per session (skip it if it was already shown this session):

> `/warp:sync` is deprecated and will be removed in mc@2.1.0. Use `/mc:sync`.

## Implementation

Reads `$ARGUMENTS` and dispatches:

```
/mc:sync $ARGUMENTS
```

## Removal

Scheduled for removal at `mc@2.1.0`. Update any docs, scripts, or skill references that still call `/warp:sync` → `/mc:sync`. Every legacy → mc alias is listed in `scripts/open-source/mc-alias-map.json`.
