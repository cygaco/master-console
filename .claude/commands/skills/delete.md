---
name: skill:delete
description: Remove a skill from .claude/commands with a backup, so it can be restored if the deletion turns out to be premature.
tags: [skills, delete, backup]
---

# /skill:delete — Delete a Skill

## Usage

```
/skill:delete <name>
```

## Procedure

### Step 1: Find the skill

Look for `.claude/commands/<name>.md` and `.claude/commands/<name>/` directory.

If not found, list available skills and ask which one to delete.

### Step 2: Impact check

First, check `.claude/project/maps/skills.jsonl` — find the entry matching this skill and read its `referenced_by` array. This gives you structured inbound references (who calls this skill). If the JSONL map doesn't exist, fall back to `.claude/project/reference/skill-map.md`.

**Staleness check:** Read the `_meta` line (line 1) and compare `version` date against today. If > 3 days old, print: "Map may be stale — grep results below are authoritative."

Then verify with grep (map may be stale):

1. **Other skills**: `grep -r "/namespace:name" .claude/commands/` — which skills call or depend on this one?
2. **CLAUDE.md**: Does the system prompt reference this skill?
3. **Hook scripts**: `grep -r "namespace:name\|namespace/name" scripts/hooks/`
4. **Systems manifest**: `grep "namespace/name\|namespace:name" .claude/project/memory/systems.jsonl`
5. **Maps**: `grep -r "namespace:name" .claude/project/maps/`
6. **Traces**: `grep "namespace:name" .claude/project/memory/traces.jsonl` — was this skill used in reasoning chains?

Report all connections. If other skills depend on this one, warn: "This skill is referenced by [list]. Deleting it will break those references."

### Step 3: Confirm

Even in dark mode, confirm deletion: "Delete `/name`? This removes the skill file and any subcommands. [N] files reference it."

### Step 4: Backup

```bash
mkdir -p backups/skills
cp .claude/commands/<name>.md backups/skills/
cp -r .claude/commands/<name>/ backups/skills/<name>/ 2>/dev/null
```

### Step 5: Delete

Remove `.claude/commands/<name>.md` and `.claude/commands/<name>/` if it exists.

### Step 6: Update map and report

The skills map (`.claude/project/maps/skills.jsonl`) is now stale — staleness detection will flag it automatically. No manual map update needed.

"Deleted `/name`. Backup saved to `backups/skills/<name>.md`. Skill map updated."
