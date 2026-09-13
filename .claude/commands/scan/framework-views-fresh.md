---
description: Verify .claude/commands and .claude/agents are byte-identical regenerations of their _mc/ sources — fails if any view is stale.
---

# /scan:framework-views-fresh

Runs the manifest-driven regenerator in **read-only check mode**. Surfaces any `.claude/*` view that has drifted from its `_mc/*` source pointer in `_mc/MANIFEST.json`. Exits 1 when at least one view is stale so CI can refuse the merge.

```bash
node scripts/mc/views/regenerate.js --check
```

Add `--quiet` to suppress per-file lines; `--json` for programmatic consumption.

In **canonical MC** (sourcePrefix=framework), every owner=framework entry is self-referential — the check finds zero stale views by design. In **installed products** (sourcePrefix=_mc), the check exercises the real source→dest pipeline and catches "edited generated view, forgot to update source" and "edited source, forgot to regenerate view".

Wired into the SP-20260522-001 architecture core alongside `/scan:mc-manifest-coverage` (planned), `/scan:framework-purity`, and the canonical pre-commit guard. See `_mc/MANIFEST.json` for the source-of-truth.

Exit codes:
- `0` — all views fresh
- `1` — at least one view stale (run without `--check` to apply)
- `2` — manifest unreadable / CLI error
