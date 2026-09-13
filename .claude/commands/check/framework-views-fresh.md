---
description: "[deprecated alias → /scan:framework-views-fresh] Verify .claude views are byte-identical regenerations of _mc sources. Superseded by /scan:framework-views-fresh in the check:→scan: namespace rename (SP-20260528-001)."
user-invocable: true
tags: [deprecated, alias, scan, mc]
---

# /check:framework-views-fresh — DEPRECATED, use /scan:framework-views-fresh

Thin alias forwarding to **`/scan:framework-views-fresh`**. The `check:` namespace was renamed to `scan:` in SP-20260528-001.

## Implementation

Reads `$ARGUMENTS` and dispatches:

```
/scan:framework-views-fresh $ARGUMENTS
```

Behavior is identical — only the canonical name changed.

## Removal

Scheduled for removal at `mc@1.0.0`. Update any docs/scripts/skill references that still call `/check:framework-views-fresh` → `/scan:framework-views-fresh`.
