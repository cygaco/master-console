---
description: "[deprecated alias → /scan:framework-purity] Refuse product-content leaks in canonical. Superseded by /scan:framework-purity in the check:→scan: namespace rename (SP-20260528-001)."
user-invocable: true
tags: [deprecated, alias, scan, mc]
---

# /check:framework-purity — DEPRECATED, use /scan:framework-purity

Thin alias forwarding to **`/scan:framework-purity`**. The `check:` namespace was renamed to `scan:` in SP-20260528-001.

## Implementation

Reads `$ARGUMENTS` and dispatches:

```
/scan:framework-purity $ARGUMENTS
```

Behavior is identical — only the canonical name changed.

## Removal

Scheduled for removal at `warpos@1.0.0`. Update any docs/scripts/skill references that still call `/check:framework-purity` → `/scan:framework-purity`.
