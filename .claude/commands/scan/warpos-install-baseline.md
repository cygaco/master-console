---
description: "[deprecated alias → /scan:mc-install-baseline] Forwards to /scan:mc-install-baseline. The `scan:warpos-*` skills were renamed to `scan:mc-*` in mc@2.0.0 (S-OS-06). Removed in mc@2.1.0."
tags: [deprecated, alias, mc]
---

# /scan:warpos-install-baseline — DEPRECATED, use /scan:mc-install-baseline

This skill is a thin alias that forwards to **`/scan:mc-install-baseline`**. The `scan:warpos-*` skills were renamed to `scan:mc-*` in mc@2.0.0 (S-OS-06). Behavior is identical; only the canonical name changed.

## Deprecation notice (one-time)

Before forwarding, show this notice ONCE per session (skip it if it was already shown this session):

> `/scan:warpos-install-baseline` is deprecated and will be removed in mc@2.1.0. Use `/scan:mc-install-baseline`.

## Implementation

Reads `$ARGUMENTS` and dispatches:

```
/scan:mc-install-baseline $ARGUMENTS
```

## Removal

Scheduled for removal at `mc@2.1.0`. Update any docs, scripts, or skill references that still call `/scan:warpos-install-baseline` → `/scan:mc-install-baseline`. Every legacy → mc alias is listed in `scripts/open-source/mc-alias-map.json`.
