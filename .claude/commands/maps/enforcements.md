---
description: Enforcement coverage — hooks, gates, gap analysis, open/closed gaps
---

# /maps:enforcements — Enforcement Coverage Map

Shows what's enforced, what's not, and where the gaps are.

## Input

`$ARGUMENTS` — optional flags:
- `--refresh` — re-scan hooks + settings.json, rebuild `.claude/project/maps/enforcements.jsonl` + `.claude/project/maps/enforcements.md`
- No flags: display current map

## Procedure

### Step 1: Read sources

- `.claude/settings.json` — hook registrations
- `scripts/hooks/*.js` — read each hook to understand what it blocks/warns/allows
- `scripts/hooks/lib/*.js` — shared gate modules (gate-schema.js, etc.)
- `the retro directory (check manifest.json projectPaths.retro for location)/*/HYGIENE.md` — gap IDs and closure status

### Step 2: Build enforcement inventory

For each hook, determine:
- **id**: hook name (filename without .js)
- **matcher**: what tool pattern triggers it
- **phase**: PreToolUse, PostToolUse, or both
- **mode**: fail-closed (blocks on error) or advisory (warns only)
- **gates**: named gate types it implements (merge-gate, store-gate, etc.)
- **blocks**: actions it prevents
- **warns**: actions it warns about but allows
- **allows**: actions it explicitly permits
- **gaps_closed**: GAP-NNN IDs this hook addresses

### Step 3: Gap analysis

1. Scan retro HYGIENE.md files for all GAP-NNN references
2. Cross-reference against hooks' `gaps_closed` lists
3. Identify open gaps (referenced but not closed by any hook)
4. Calculate coverage: closed / total

### Step 4: Write output

Generate both files:
- `.claude/project/maps/enforcements.jsonl` — one meta line + one line per hook/module
- `.claude/project/maps/enforcements.md` — human-readable with hook chain, gate types, gap summary

**JSONL meta line schema:**
```json
{
  "_meta": true,
  "name": "Enforcements Map",
  "total_hooks": 13,
  "total_gaps": 76,
  "gaps_closed": 70,
  "gaps_open": 6,
  "open_gaps": ["GAP-001", "..."],
  "gate_types": ["merge-gate", "..."]
}
```

**JSONL entry schema:**
```json
{
  "id": "hook-name",
  "type": "hook|module",
  "matcher": "Bash|Edit|Write|Agent|...",
  "phase": "PreToolUse|PostToolUse|both",
  "mode": "fail-closed|advisory|mixed",
  "file": "scripts/hooks/hook-name.js",
  "gates": [],
  "blocks": [],
  "warns": [],
  "allows": [],
  "gaps_closed": []
}
```

### Step 5: Clear staleness

After writing output, clear the `enforcements` entry from `.claude/project/maps/.stale.json`:
1. Read `.claude/project/maps/.stale.json`
2. Delete the `enforcements` key
3. Write back (or delete file if empty)
