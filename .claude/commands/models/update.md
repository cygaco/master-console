---
description: Update the dispatch catalog to the latest models — re-ingest vendor docs, migrate deprecated/shut-down ids, add new options, sync routing, and regenerate manifests. Beta-gated for default-model changes.
user-invocable: true
namespace: models
reads: [scripts/dispatch/catalog.js, runtime/models-research]
writes: [scripts/dispatch/catalog.js, .claude/manifest.json, .claude/agents, .claude/framework-manifest.json, .claude/framework-installed.json]
---

# /models:update — bring the catalog to the latest models

Apply the latest vendor model catalogs to MC dispatch: migrate dead ids, add new
options, optionally adopt newer flagships, and keep every place the model is pinned in
agreement. This is the writer half of `/models:check` (the read-only auditor).

> **Decision boundary:** ADDING options and MIGRATING shut-down ids are reversible config
> (decide directly). CHANGING a build-chain *default* model family is a meaningful
> technical call — consult **Beta** first (β-consultation protocol); surface to the
> operator only on `ESCALATE`. Never push (ask first per CLAUDE.md autonomy).

## Input

```
$ARGUMENTS
  --refresh            re-ingest the live vendor docs first (see /models:check)
  --provider <id>      limit to claude | openai | gemini
  --dry-run            show the plan; write nothing (default is to apply with confirmation)
```

## Procedure

1. **Audit first** — establish the gap:
   ```bash
   node scripts/models/check.js          # or: with --refresh, deep-ingest then check
   ```
   Read `runtime/models-research/<vendor>.json` for the exact latest ids, statuses,
   `migrate_to` targets, and `ghost_watch`.

2. **Migrate dead ids** (every `ERROR` from check). For a 1:1 rename, use the safe
   cross-project id rewriter (edits machine-readable ids + Claude labels; never touches
   append-only history):
   ```bash
   node scripts/dispatch/bump-model.js --from <dead-id> --to <migrate_to> --apply
   ```
   For non-Claude renames it rewrites the id everywhere (labels in `catalog.js` are
   updated by hand in the next step).

3. **Edit `scripts/dispatch/catalog.js`** (the source of truth):
   - Remove shut-down ids from the provider's `models[]`.
   - Add new GA/preview ids as options with accurate `contextTokens`, `maxOutputTokens`,
     `effortLevels` (codex/claude) or `thinkingAlwaysOn` (gemini-3), and `pricing` — pull
     these from the research snapshot, don't guess.
   - Update `defaultModel` ONLY after Beta concurs (see decision boundary).
   - Keep a safe non-preview fallback rung available.

4. **Re-point routing** if a default changed — for each affected role:
   ```bash
   node scripts/dispatch.js set <role> <provider> <model> [effort]
   ```
   This keeps `.claude/manifest.json` + agent frontmatter in sync (atomic + backup ring).

5. **Keep every pin in agreement** — the same model is pinned in `catalog.js`,
   `providers.js` (`GEMINI_DEFAULT`/`OPENAI_*`), the redteam orchestrator specs,
   `scaffold-core.js`, `.claude/manifest.json`, `provider-fallback.json`,
   `sprint-routing.json`. The agreement enforcer catches drift:
   ```bash
   node scripts/test-dispatch-config.js
   ```

6. **Regenerate manifests** (hash-tracked `scripts/**` + `.claude/**` changed):
   ```bash
   node scripts/generate-framework-manifest.js && node scripts/mc/snapshot-installed.js
   ```

7. **Verify + report:**
   ```bash
   node scripts/models/check.js          # expect: all current, 0 error
   node scripts/dispatch.js show         # confirm routing rendered
   ```
   Report what migrated, what was added, and any default change (with the Beta verdict).

## Exit / safety

- All catalog/routing writes are revertible (`dispatch.js backups`/`revert`, git).
- Stops and surfaces on a Beta `ESCALATE` for any default-model change.

## See also

- `/models:check` — the auditor (run this first; `--refresh` to re-ingest)
- `/models:route` — point one role at a model · `/models:router` — open the panel
