---
description: Cross-file reference integrity — broken links, orphans, stale SPEC_GRAPH edges
---

# /scan:references — Reference Integrity

Validates that every file path reference across `.claude/`, `_requirements/` (or `_docs/`), and `scripts/` resolves to a real file on disk. Catches orphaned files, broken cross-links, and stale SPEC_GRAPH edges.

This is the raw file-path-existence check. For semantic doc consistency, use `/scan:architecture health`.

## Input

`$ARGUMENTS` — Mode selection:
- No args — full scan, markdown summary
- `--json` — raw JSON output
- `--fix` — remove broken STALE banners older than 7 days (auto-apply)
- `<pattern>` — limit scan to paths matching pattern (e.g. `hooks`, `beta`)

---

## Step 1: Run the Scanner

```bash
node scripts/hooks/ref-checker.js --summary
```

The scanner walks files with extensions: `.md`, `.js`, `.json`, `.jsonl`, `.ts`, `.tsx` in directories resolved from `paths.json`:
- `paths.commands`
- `paths.agents`
- `paths.reference`
- `paths.maps`
- `paths.hooks`
- `paths.memory`
- `paths.events`

Plus project-specific paths from `manifest.source_dirs` and `manifest.projectPaths.specs` (if present).

### What the scanner finds

1. **Markdown links** — `[text](path/to/file.md)` where path doesn't resolve
2. **Code-style file refs** — backtick-wrapped paths in markdown
3. **Bare path mentions** — string literals that look like paths
4. **SPEC_GRAPH edges** — entries in `.claude/project/reference/SPEC_GRAPH.json` (or `_requirements/00-canonical/SPEC_GRAPH.json`) pointing at deleted files
5. **STALE markers** — `<!-- STALE -->` banners whose source files have moved or been renamed
6. **Orphaned files** — files not referenced by any other file (excluding entry points, event logs, archives)

---

## Step 2: Triage Results

For each category, categorize by priority:

### Broken References

- **Critical** — skill or agent `.md` referencing a deleted hook, missing agent file, or moved store
- **High** — spec file cross-ref to renamed feature folder; manifest references missing file
- **Medium** — doc cross-reference pointing to a renamed reference doc
- **Low** — bare path mention in prose (often an example, not a live ref)

For each broken ref:
1. Grep for the target filename — was it renamed?
2. If renamed, suggest the new path
3. If truly deleted, suggest removing the reference OR restoring the file

Common renames to check first (old → new):
- `beta-persona.md` → `judgement-model.md`
- `.beta-mining-recommendations.md` → `judgement-model-recommendations.md`
- old `scan:arch` → `scan:architecture`
- old `scan:env` → `scan:environment`
- old `scan:refs` → `scan:references`
- old `scan:specs` → `scan:requirements`
- old `reqs:review` → `scan:requirements review`
- `.claude/project/events/` → `.claude/project/events/`
- `.claude/project/memory/` → `.claude/project/memory/`
- `.claude/project/maps/` → `.claude/project/maps/`
- `.claude/handoffs/` → `.claude/runtime/handoffs/`
- `.claude/logs/` → `.claude/runtime/logs/`

### SPEC_GRAPH Issues

- Edges pointing to nonexistent files mean staleness propagation is broken for that path
- Fix by updating the SPEC_GRAPH file (location: `paths.specGraph` (default: `.claude/project/maps/SPEC_GRAPH.json`)
- If the SPEC_GRAPH doesn't exist, skip this category silently

### Orphaned Files

Not all orphans are dead weight. Auto-excluded:
- Entry points (`CLAUDE.md`, `AGENTS.md`, `PROJECT.md`, `README.md`, top-level configs)
- Event logs and map files (written to, not linked)
- Archive directories (`handoffs/`, `plans/archive/`, `retros/`, `99-audits/`)
- Git metadata (`.git/`)

**True orphans** to review:
- Abandoned skills (no cross-refs, not in autocomplete registration)
- Dead hooks (script with no registration in settings.json)
- Stale maps (map file with no data source)
- Old reference docs superseded by newer ones

### Stale STALE Markers

- A `<!-- STALE -->` banner references a source file that was edited more than 7 days ago but never reviewed
- With `--fix`: auto-remove markers older than 7 days AND whose source has been re-edited since the banner was added
- Without `--fix`: list them for manual review

---

## Step 3: Report

### Markdown (default)

```markdown
# Reference Integrity Report

## Summary
- Files scanned: N
- Refs checked: N
- Broken: N (critical: X, high: Y, medium: Z, low: W)
- Orphans: N
- SPEC_GRAPH issues: N
- Stale markers: N

## Critical / High Broken Refs
| File | Ref | Target | Suggested fix |
|------|-----|--------|---------------|

## Orphans worth investigating
| File | Last modified | Possible owner |
|------|---------------|----------------|

## Auto-fixable
- {N stale markers older than 7 days — run with --fix}
- {M STALE markers on renamed files — run with --fix}

## Next actions
1. {fix} — unblocks {what}
```

### JSON (`--json`)

```json
{
  "scanned": { "files": N, "refs": N },
  "broken": [{ "file": "", "ref": "", "severity": "", "suggestedFix": "" }],
  "orphans": [{ "file": "", "lastModified": "" }],
  "specGraphIssues": [...],
  "staleMarkers": [...]
}
```

---

## Auto-fix mode (`--fix`)

Applies these fixes (each a separate commit for review):

1. Remove STALE markers older than 7 days whose source has been re-edited
2. Update known rename patterns (from the list in Step 2) project-wide

Never auto-deletes orphaned files. Never auto-updates broken refs the user hasn't approved.

---

## When to run

- **After structural renames** — always, to catch orphans
- **After deleting a file or skill** — to confirm nothing references it
- **Weekly / on `/sleep:deep`** — to catch drift
- **Before publishing to MC** — to catch refs that break in a fresh install

## Related

- `/scan:architecture health` — doc-level quality (this finds broken paths; that finds stale content)
- `/maps:all` — regenerates maps after rename cascade
- `/skills:cleanup` — dedupes and removes dead skills (uses this skill's orphan detection)
