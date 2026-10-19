---
description: Memory store relationships — who reads/writes each store, entry counts
---

# /maps:memory — Memory Store Map

Visualize the memory system: centralized event log, semantic stores, and legacy dual-write files.

## Input

`$ARGUMENTS` — optional flags:
- `--refresh` — re-count entries, re-scan readers/writers, rebuild `.claude/project/maps/memory.jsonl` + `.claude/project/maps/memory.md`
- `--terminal` — render as ASCII art (default)
- No flags: render from existing map (or build if none exists)

## Procedure

### Step 1: Check state

If `.claude/project/maps/memory.jsonl` exists and `--refresh` not passed → skip to Step 4 (render).
Otherwise → Step 2 (build).

### Step 2: Inventory all stores

**Tier 1 — Centralized event log:**
- `.claude/project/events/events.jsonl` — count lines, note 9 categories (prompt, audit, spec, modification, inbox, tool, decision, block, lifecycle)
- API: `scripts/hooks/lib/logger.js` — `log(cat, data)` / `query({cat, since, limit})`
- Writers: grep all hooks for `log(` calls
- Readers: grep all hooks + scripts for `query(` calls

**Tier 2 — Semantic stores** (`.claude/project/memory/`):
- `learnings.jsonl` — count total, count by status (logged/validated/implemented)
- `systems.jsonl` — count entries, count by status (active/stub/untested)
- `traces.jsonl` — count reasoning episodes
- For each: scan `.claude/commands/**/*.md` and `scripts/hooks/*.js` for references, classify as reader or writer

**Tier 3 — Legacy (dual-write, deprecated):**
- `system-events.jsonl`, `events.jsonl`, `modifications.jsonl`, `inbox.jsonl` — count lines, note migration target
- `.session-tracking.jsonl`, `.session-prompts.log` — session-scoped

### Step 3: Build `.claude/project/maps/memory.jsonl` + `.claude/project/maps/memory.md`

Write JSONL with `_meta` header (follow `.claude/project/maps/enforcements.jsonl` pattern), then one entry per store.
Write MD with: tier diagram, category table, per-store details, legacy migration table, writer/reader matrix.

### Step 4: Clear staleness

After writing output, clear the `memory` entry from `.claude/project/maps/.stale.json` if it exists.

### Step 5: Render

Display the map in terminal format showing tiers, stores, and reader/writer connections.
