---
description: Analyze friction points — find patterns that suggest missing hooks
user-invocable: true
---

# /hooks:friction — Friction Analysis

Look at recent git history for patterns that suggest missing hooks:
- Type errors introduced and fixed later → need typecheck hook
- Formatting commits → need format hook
- Accidental secret commits → need secret protection
- Build failures from lint issues → need lint hook

Check what's NOT covered by current hooks. Suggest new hooks with priority ranking.
