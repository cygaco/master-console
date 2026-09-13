---
description: "[deprecated alias → /scan:install] Verify a fresh MC install. Superseded by /scan:install in the check:→scan: namespace rename (SP-20260528-001)."
user-invocable: true
tags: [deprecated, alias, scan, mc]
---

# /check:install — DEPRECATED, use /scan:install

Thin alias forwarding to **`/scan:install`**. The `check:` namespace was renamed to `scan:` in SP-20260528-001.

## Implementation

Reads `$ARGUMENTS` and dispatches:

```
/scan:install $ARGUMENTS
```

Behavior is identical — only the canonical name changed.

## Removal

Scheduled for removal at `mc@1.0.0`. Update any docs/scripts/skill references that still call `/check:install` → `/scan:install`.
