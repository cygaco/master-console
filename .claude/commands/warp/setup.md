---
description: "[deprecated alias → /mc:setup] Forwards to /mc:setup. The `warp:` skill namespace was renamed to `mc:` in mc@2.0.0 (S-OS-06). Removed in mc@2.1.0."
user-invocable: true
tags: [deprecated, alias, mc]
---

# /warp:setup — DEPRECATED, use /mc:setup

This skill is a thin alias that forwards to **`/mc:setup`**. The `warp:` skill namespace was renamed to `mc:` in mc@2.0.0 (S-OS-06). Behavior is identical; only the canonical name changed.

## Deprecation notice (one-time)

Before forwarding, show this notice ONCE per session (skip it if it was already shown this session):

> `/warp:setup` is deprecated and will be removed in mc@2.1.0. Use `/mc:setup`.

## Implementation

Reads `$ARGUMENTS` and dispatches:

```
/mc:setup $ARGUMENTS
```

## Removal

Scheduled for removal at `mc@2.1.0`. Update any docs, scripts, or skill references that still call `/warp:setup` → `/mc:setup`. Every legacy → mc alias is listed in `scripts/open-source/mc-alias-map.json`.
