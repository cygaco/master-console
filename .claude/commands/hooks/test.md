---
description: Test all hooks with synthetic payloads and measure execution time
user-invocable: true
---

# /hooks:test — Test All Hooks

Run:

```bash
node scripts/hooks/test.js --all $ARGUMENTS
```

For each hook in settings.json:
1. Load its manifest entry from `scripts/hooks/hook-manifest.json`
2. Pipe each listed fixture payload to the hook script
3. Report exit code and any output
4. Measure execution time per hook

Report results table.
