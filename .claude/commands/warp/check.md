---
description: Compare your MC installation against the latest version — find stale, new, and missing items
---

# /warp:check — Check MC Status

Compare your project's MC installation against the latest version in the MC repo.

## Procedure

### Step 1: Find MC repo

Read `manifest.mc.source` — the repo URL configured at install time. Check for a local clone at `../MC/`. If not found, tell the user to `git clone {manifest.mc.source} ../MC` first.

### Step 2: Compare files

For each category, compare your project's files against MC:

| Category | Your project | MC repo | What to compare |
|----------|-------------|-------------|-----------------|
| Agents | `.claude/agents/` | `../MC/.claude/agents/` | File list + content diff |
| Skills | `.claude/commands/` | `../MC/.claude/commands/` | File list + content diff |
| Hooks | `scripts/hooks/` | `../MC/scripts/hooks/` | File list + content diff |
| Reference | `.claude/project/reference/` | `../MC/.claude/project/reference/` | File list |
| CLAUDE.md | `./CLAUDE.md` | `../MC/CLAUDE.md` | Content diff |
| AGENTS.md | `./AGENTS.md` | `../MC/AGENTS.md` | Content diff |

### Step 3: Classify each file

For each file, classify as:
- **SYNCED** — identical in both locations
- **STALE** — MC has a newer version
- **CUSTOMIZED** — your version differs (you changed it)
- **NEW** — exists in MC but not in your project (added since install)
- **LOCAL** — exists in your project but not in MC (you created it)

### Step 4: Report

```
MC Check
════════════

  Agents:    12 synced, 2 stale, 0 new
  Skills:    58 synced, 3 stale, 5 local
  Hooks:     25 synced, 0 stale
  Reference: 5 synced
  Docs:      CLAUDE.md customized, AGENTS.md synced

  Recommendations:
  - Run /warp:sync to update 5 stale files
  - 5 local skills found (yours to keep)
```
