---
description: Audit all skills for dead weight, duplicates, broken references, and namespace issues — then clean up
---

# /skill:cleanup — Skills Cleanup Protocol

Audit the entire skill system and clean up dead weight.

## Phase 0: Load or Build Skill Map

Prefer `.claude/project/maps/skills.jsonl` (structured, has `referenced_by` arrays per skill):
- **If it exists**: parse each line as JSON. Use the `referenced_by`, `calls`, `reads`, and `writes` fields as the cross-reference graph for Phases 1-3.
- **If it doesn't exist**: fall back to `.claude/project/reference/skill-map.md`, or run `/maps:skills` to build it.

**Staleness check:** Read the `_meta` line and compare `version` date against today. If > 3 days old, print: "Map may be stale — running /maps:skills --refresh first." Then refresh before proceeding.

The map tells you what calls what — so when Phase 3 says "delete this skill", check `referenced_by` directly instead of re-scanning.

## Phase 1: Inventory

List every file in `.claude/commands/` recursively. For each file, record:

| File | Registers As | Autocompletes? | Last Modified | Size |
|------|-------------|----------------|---------------|------|

**Autocomplete rule**: Only `dir/file.md` files autocomplete as `/dir:file`. Standalone root `.md` files do NOT autocomplete. Router files (e.g., `audit.md` next to `audit/`) don't register at all.

Flag:
- **Orphan root files**: Standalone `.md` at root level that don't autocomplete (e.g., `flag.md`, `qa.md`)
- **Dead routers**: Router `.md` files whose subdirectory exists (e.g., `audit.md` + `audit/` — router is dead weight)
- **Empty directories**: Dirs with no `.md` files

## Phase 2: Content Audit

For each skill file, check:

1. **Title freshness**: Does the `#` title match the current skill name? (e.g., still says `/old-ns:skill` after a rename)
2. **Dead skill references**: Does it reference `/namespace:skill` names that no longer exist? (e.g., `/old-ns:skill` after a rename to `/new-ns:skill`)
3. **Dead file path references**: Does it reference file paths (`.claude/commands/...`, `scripts/hooks/...`, `.claude/project/memory/...`) that don't exist on disk? Grep for paths, verify each with Glob or file existence check.
4. **Duplicate functionality**: Are two skills doing the same thing? (e.g., `/a:fix` vs `/b:fix` overlap)
5. **Frontmatter hygiene**: Only `description:` is required. `name:` is optional (overrides display name). Extra fields (`created`, `source`, `depends-on`, `status`) are metadata bloat — remove them.
6. **Stale instructions**: Does it reference deprecated systems (e.g., a removed subsystem or namespace)?

## Phase 2b: Systems Existence Check

Don't rely on a hardcoded list of deprecated systems — check dynamically:

1. **Read `.claude/project/memory/systems.jsonl`** — get every system ID and its `status` (active, broken, stub, untested)
2. **For each skill**, check if it references systems, hooks, or files that:
   - Don't exist in the systems manifest at all (orphan reference)
   - Have `status: "broken"` (reference to known-broken system)
   - Reference file paths in the `files` arrays that don't exist on disk
3. **Check for dead namespaces** — if a skill references `/namespace:command` where the namespace directory doesn't exist in `.claude/commands/`, flag it
4. **Check hook references** — if a skill says "this hook does X", verify the hook is registered in `.claude/settings.json`

Present flagged skills separately with the specific dead reference and what it points to.

## Phase 2c: Never-Invoked Detection (Skill Usage Counter)

Read `paths.skillUsageFile` (`.claude/project/events/skill-usage.jsonl`) — the running record of slash-command invocations from `scripts/hooks/skill-counter.js`. Each line is `{ ts, skill, session, elapsedMs }`.

Build a set of every skill that has ever been invoked. Compare against the inventory from Phase 1. **Flag the difference as "never invoked".**

Caveats:
- The counter only captures invocations since it was wired. Older skills may legitimately predate the counter.
- Skills invoked exclusively by agents (not the user) won't show up — only direct slash-command invocations are counted.
- "Never invoked" is a signal for review, not an automatic delete. Cross-reference with Phase 2 (dead refs) and Phase 2b (orphan refs) before proposing removal.

If the file doesn't exist or is empty, skip this phase — the counter just hasn't accumulated data yet.

## Phase 3: Classify Actions

For each issue found, classify:

| Action | Criteria |
|--------|----------|
| **Delete** | Skill is unused, duplicated, or references entirely removed systems. Check the skill map `referenced_by` array — if non-empty, it's not safe to delete. Also distinguish: `referenced_by:[]` + no recent traces.jsonl usage = dead weight (safe to delete). `referenced_by:[]` + recent traces usage = user-invoked entry point (keep). |
| **Move** | Standalone root `.md` should become a subdirectory skill for autocomplete |
| **Merge** | Two skills overlap significantly — combine into one |
| **Fix** | Title, references, or frontmatter need updating |
| **Keep** | Skill is fine as-is |

## Phase 4: Present Report

Show the full inventory table, then a cleanup action list:

```
SKILLS INVENTORY: {N} files across {M} directories

CLEANUP ACTIONS:
  Delete: {N} files (list each with reason)
  Move:   {N} files (from → to)
  Merge:  {N} pairs (which + which → into what)
  Fix:    {N} files (what's wrong)
  Keep:   {N} files (healthy)

Estimated reduction: {N} → {M} files ({X}% leaner)
```

## Phase 5: Execute (with confirmation)

For each action category:
1. **Deletes**: List files to delete. Wait for user confirmation before proceeding.
2. **Moves**: Show old path → new path. Execute.
3. **Merges**: Show what's being combined. Execute.
4. **Fixes**: Apply title/reference/frontmatter fixes silently.

After execution:
- `git add` all changes
- Report final state: total files, directories, autocomplete coverage

## What NOT to touch

- Don't delete skills just because they haven't been used recently
- Don't reorganize skills the user explicitly created this session
- Don't change skill behavior — only structure, naming, and references
- Don't touch `memory/learnings.jsonl` or other data files
