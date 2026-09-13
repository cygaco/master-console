---
description: "[deprecated alias → /mc:update] Forwards to /mc:update. The `warp:` skill namespace was renamed to `mc:` in mc@2.0.0 (S-OS-06). Removed in mc@2.1.0."
user-invocable: true
tags: [deprecated, alias, mc]
---

# /warp:update — DEPRECATED, use /mc:update

This skill is a thin alias that forwards to **`/mc:update`**. The `warp:` skill namespace was renamed to `mc:` in mc@2.0.0 (S-OS-06). Behavior is identical; only the canonical name changed.

## Deprecation notice (one-time)

Before forwarding, show this notice ONCE per session (skip it if it was already shown this session):

> `/warp:update` is deprecated and will be removed in mc@2.1.0. Use `/mc:update`.

## Implementation

Reads `$ARGUMENTS` and dispatches:

```
/mc:update $ARGUMENTS
```

## Removal

Scheduled for removal at `mc@2.1.0`. Update any docs, scripts, or skill references that still call `/warp:update` → `/mc:update`. Every legacy → mc alias is listed in `scripts/open-source/mc-alias-map.json`.
