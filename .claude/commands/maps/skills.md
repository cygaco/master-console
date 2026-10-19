---
description: Skill dependency graph — namespaces, cross-references, data flow
---

# /maps:skills — Skill Dependency Map

Build, verify, or visualize the skill dependency graph.

## Input

`$ARGUMENTS` — optional flags:
- `--refresh` — re-scan all skills and rebuild `.claude/project/maps/skills.jsonl` + `.claude/project/maps/skills.md`
- `--terminal` — render as ASCII art (default)
- `--file` — write to `.claude/project/maps/skills.txt`
- `--html` — write styled HTML to `.claude/project/maps/skills.html`
- No flags: render from existing map (or build if none exists)

## Procedure

### Step 1: Check state

If `.claude/project/maps/skills.jsonl` exists and `--refresh` not passed → skip to Step 5 (render).
Otherwise → Step 2 (build).

### Step 2: Scan all skills

For each `.md` in `.claude/commands/`:

1. Extract outbound references — grep for:
   - `/namespace:command` — skill-to-skill calls
   - `.claude/project/memory/` — data store references
   - `scripts/hooks/` — hook references
   - `systems.jsonl`, `CLAUDE.md` — system references

2. Classify: **Calls** (invokes), **Reads** (reads data), **Writes** (writes data), **References** (mentions)

3. Record: namespace, name, description, outbound refs, inbound refs (computed after full scan)

### Step 3: Generate `.claude/project/maps/skills.jsonl` + `.claude/project/maps/skills.md`

Write JSONL with `_meta` header (follow `.claude/project/maps/enforcements.jsonl` pattern), then one entry per skill.
Write MD with: namespace tree tables, orphan list, cluster diagram, data flow matrix.

### Step 4: Render

Build graph from skill-map.md data:
- **Nodes**: each skill
- **Edges**: calls/reads/writes
- **Groups**: by namespace
- Render in requested format (terminal/file/html)

### Step 5: Clear staleness

After writing output, clear the `skills` entry from `.claude/project/maps/.stale.json` if it exists:
1. Read `.claude/project/maps/.stale.json`
2. Delete the `skills` key
3. Write back (or delete file if empty)

### Step 6: Verify (if map existed)

Compare scan results vs existing map. Flag:
- New skills not in map
- Deleted skills still in map
- Changed references
- Broken references (skill refs `/x:y` that doesn't exist)
- Stale data flow

Report diff and offer to fix.
