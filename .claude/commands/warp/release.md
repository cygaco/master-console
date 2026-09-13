---
description: "[deprecated alias → /mc:release] Forwards to /mc:release. The `warp:` skill namespace was renamed to `mc:` in mc@2.0.0 (S-OS-06). Removed in mc@2.1.0."
user-invocable: true
tags: [deprecated, alias, mc]
---

# /warp:release — DEPRECATED, use /mc:release

This skill is a thin alias that forwards to **`/mc:release`**. The `warp:` skill namespace was renamed to `mc:` in mc@2.0.0 (S-OS-06). Behavior is identical; only the canonical name changed.

## Deprecation notice (one-time)

Before forwarding, show this notice ONCE per session (skip it if it was already shown this session):

> `/warp:release` is deprecated and will be removed in mc@2.1.0. Use `/mc:release`.

## Implementation

Reads `$ARGUMENTS` and dispatches:

```
/mc:release $ARGUMENTS
```

## Removal

Scheduled for removal at `mc@2.1.0`. Update any docs, scripts, or skill references that still call `/warp:release` → `/mc:release`. Every legacy → mc alias is listed in `scripts/open-source/mc-alias-map.json`.
