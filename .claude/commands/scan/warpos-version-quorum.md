---
description: "[deprecated alias → /scan:mc-version-quorum] Forwards to /scan:mc-version-quorum. The `scan:warpos-*` skills were renamed to `scan:mc-*` in mc@2.0.0 (S-OS-06). Removed in mc@2.1.0."
tags: [deprecated, alias, mc]
---

# /scan:warpos-version-quorum — DEPRECATED, use /scan:mc-version-quorum

This skill is a thin alias that forwards to **`/scan:mc-version-quorum`**. The `scan:warpos-*` skills were renamed to `scan:mc-*` in mc@2.0.0 (S-OS-06). Behavior is identical; only the canonical name changed.

## Deprecation notice (one-time)

Before forwarding, show this notice ONCE per session (skip it if it was already shown this session):

> `/scan:warpos-version-quorum` is deprecated and will be removed in mc@2.1.0. Use `/scan:mc-version-quorum`.

## Implementation

Reads `$ARGUMENTS` and dispatches:

```
/scan:mc-version-quorum $ARGUMENTS
```

## Removal

Scheduled for removal at `mc@2.1.0`. Update any docs, scripts, or skill references that still call `/scan:warpos-version-quorum` → `/scan:mc-version-quorum`. Every legacy → mc alias is listed in `scripts/open-source/mc-alias-map.json`.
