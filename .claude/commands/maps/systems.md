---
description: Render the systems manifest as a dependency graph — visualize which systems depend on which, their status, and their categories so you can audit coverage and drift at a glance.
tags: [maps, systems, graph]
---

# /maps:systems — Systems Dependency Map

Visualize the systems manifest as a dependency graph.

## Input

`$ARGUMENTS` — optional flags:
- `--refresh` — verify all systems (files exist, hooks wired, status honest), update systems.jsonl
- `--terminal` — render as ASCII art (default)
- `--file` — write to `.claude/project/maps/systems.txt`
- `--html` — write styled HTML to `.claude/project/maps/systems.html`

## Procedure

### Step 1: Read `.claude/project/memory/systems.jsonl`

Parse each system entry: id, name, status, category, files, depends_on.

### Step 2: Refresh (if `--refresh`)

For each system:
- **Files exist**: check each file in `files` array exists on disk
- **Hooks wired**: if system has hook scripts, verify registered in `.claude/settings.json`
- **Status honest**: if "active", verify tested/used. If "stub", verify not secretly activated.
- **Dependencies valid**: each `depends_on` ID exists as another system

Flag issues. Update systems.jsonl if fixes needed.

### Step 3: Build graph

- **Nodes**: each system (colored by status: green=active, yellow=stub, gray=untested)
- **Edges**: depends_on relationships
- **Groups**: by category (cognition, automation, memory, integration)

### Step 4: Render

Render in requested format. Example terminal:

```
┌──────────────┐     ┌──────────────┐
│  learnings   │◀────│ context-enh  │
│    [A]       │     │    [A]       │
└──────┬───────┘     └──────────────┘
       │
       ▼
┌──────────────┐
│  sleep-sys   │
│    [A]       │
└──────────────┘
```
