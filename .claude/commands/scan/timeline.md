---
description: Reconstruct a build timeline from transaction, event, and provider logs.
user-invocable: true
---

# /scan:timeline

Run:

```bash
node scripts/timeline/check.js $ARGUMENTS
```

Pass a build id to scope the output. Without an id, it returns the recent
coherence-relevant event stream.
