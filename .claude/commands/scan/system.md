---
description: System inventory — enumerate every active MC system, diff against manifest, report drift and gaps
---

# /scan:system — System Inventory

Single owner for "What systems are actually in this project, and does the manifest match reality?" Scans every system category (agents, skills, hooks, memory, maps, linters, etc.), compares to `paths.systemsFile` (`systems.jsonl`), and reports:
- New systems on disk not in manifest
- Manifest entries with missing files (dead)
- Staleness (files modified but manifest entry stale)
- Category coverage gaps

## Input

`$ARGUMENTS` — Mode:
- No args — full inventory report
- `--json` — raw JSON output
- `--update` — write the current inventory to `paths.systemsFile` (append or replace entries)
- `<category>` — scope to one category (e.g. `agents`, `hooks`, `skills`, `linters`)

---

## Files to read

**First, resolve paths.** Always start by reading `.claude/paths.json` — that's the canonical path registry. If it doesn't exist, fall back to `scripts/hooks/lib/paths.js` defaults, and warn that paths.json is missing.

Then, from that registry:
- `paths.manifest` — project identity
- `paths.systemsFile` — current catalogue (what this skill updates)
- `paths.agents`, `paths.commands`, `paths.hooks`, `paths.hookLib`, `paths.patterns`, `paths.reference`, `paths.requirements`, `paths.maps`, `paths.memory`, `paths.events`, `paths.agentSystem`, `paths.betaSystem` — directory roots to enumerate
- `paths.eventsFile`, `paths.learningsFile`, `paths.tracesFile`, `paths.systemsFile`, `paths.betaEvents` — individual store files

If any of these keys are missing from `paths.json`, flag it — the registry is the system and should always be complete.

---

## System categories to inventory

These are the canonical MC system categories. Scan each, produce a list, compare to manifest.

### 1. Identity & doctrine
- `CLAUDE.md` — Alex identity rules
- `AGENTS.md` — agent system router
- `PROJECT.md` — project-level identity
- `README.md`, `USER_GUIDE.md` — user-facing
- Scan: top-level `.md` files with `identity` or `doctrine` keywords in frontmatter.

### 2. Agents
- `paths.agents/president/*.md` — president faces (alpha, beta, gamma, delta, epsilon)
- `paths.agents/president/_system/adhoc/**/*.md` — adhoc-mode build-chain agents
- `paths.agents/president/_system/oneshot/**/*.md` — oneshot-mode build-chain agents
- `paths.agentSystem/*` — shared agent system files (protocol, lexicon, policy)
- `paths.betaSystem/*` — Beta's judgment model

### 3. Skills (procedural memory)
- `paths.commands/**/*.md` — every skill file
- Organize by namespace (directory under commands/)
- Count per namespace
- Flag skills without frontmatter `description`

### 4. Hooks
- `paths.hooks/*.js` — every hook script
- `paths.hookLib/*.js` — shared library modules
- Cross-ref to `paths.settings` for registration status (registered vs orphan)

### 5. Linters
- `scripts/lint-*.js` — each linter script
- `scripts/path-lint.js` — the paths terminator
- Plus external: format, typecheck, lint (npm run commands from manifest)

### 6. Memory stores
- `paths.events/*.jsonl` — event logs
- `paths.memory/*.jsonl` — persistent memory (learnings, traces, systems)
- `paths.betaSystem/events.jsonl` — Beta decisions

### 7. Maps
- `paths.maps/*.jsonl` + `*.md` + `*.json` — every map artifact
- Cross-ref: each map should have a `/maps:*` skill that produces it

### 8. Cognition
- `paths.reference/reasoning-frameworks.md` — framework router
- `paths.reference/operational-loop.md` — the 10-step loop
- `paths.reference/learning-lifecycle.md` — learning staging rules

### 9. Orchestration
- `paths.commands/mode/*.md` — mode-switching skills
- `paths.commands/session/*.md` — session lifecycle
- Smart-context pipeline (`paths.hooks/smart-context.js`)

### 10. Knowledge infrastructure
- `paths.json` — path registry
- `paths.manifest` — project manifest
- `paths.settings` — hook registration
- `paths.store` — build system state
- `paths.specGraph` — staleness dependency graph

### 11. Product skeleton (MC-only)
- `paths.requirements/**` — spec templates (00-canonical → 99-audits)
- `paths.patterns/*.md` — engineering pattern library
- `warp-setup.js`, `install.ps1`, `version.json` — installer

### 12. Worktree / isolation
- `paths.hooks/create-worktree-from-head.js` + `.sh` — gamma's builder isolation

### 13. Plans
- `paths.plans/**` — plan docs, archive

### 14. Handoffs
- `paths.handoffs/*.md` + `paths.handoffLatest` — session snapshots

### 15. Dreams
- `paths.dreams/*.md` — sleep-cycle dream logs

### 16. Favorites
- `paths.favorites/**` — saved moments

---

## Procedure

### Step 1: Enumerate
For each category, walk the filesystem and produce a list of `{id, name, category, files[], exists}`.

### Step 2: Load manifest
Read `paths.systemsFile` line by line. Parse as JSONL. Build a map keyed by `id`.

### Step 3: Diff

Three classes of finding:

**Drift** — system in manifest but files missing:
```
id: foo | manifest says file X but file X doesn't exist on disk
```

**Orphan** — files exist but no manifest entry:
```
file Y discovered in category Z but no systems.jsonl entry
```

**Stale** — files modified since manifest's `last_modified`:
```
id: foo | files changed 3 days after last_modified — manifest out of date
```

### Step 4: Gap analysis

For each category above, confirm at least one entry exists in the manifest. Categories with zero entries are coverage gaps.

### Step 5: Report

Markdown (default):

```markdown
# System Inventory Report

## Summary
| Category | On disk | In manifest | Drift | Orphans | Stale |
|----------|---------|-------------|-------|---------|-------|
| agents   |  37    |  4          |  0    | 33      | 0     |
...

## Drift (manifest entries with missing files)
...

## Orphans (files with no manifest entry)
...

## Stale (files newer than manifest)
...

## Coverage gaps (categories with zero manifest entries)
...

## Recommended actions
1. Run `/scan:system --update` to auto-add orphans to manifest
2. Remove N drifted entries (files deleted, manifest stale)
3. Run `/maps:systems --refresh` to regenerate the systems map
```

JSON (`--json`):

```json
{
  "scanned": { "categories": N, "files": N },
  "byCategory": { "agents": { "onDisk": N, "inManifest": N, "drift": [...], "orphans": [...], "stale": [...] } },
  "gaps": [ "linters", "patterns" ],
  "recommended": [ ... ]
}
```

### Step 6: Update (`--update`)

For each orphan: write a new JSONL entry with `id`, `name`, `category`, `files`, `status: "active"`, `created: <ISO>`, `notes: "discovered by /scan:system"`.

Use `appendFileSync` (memory-guard requires it). Never rewrite the whole file.

For each drift entry: append a status update entry with `status: "removed"` + `removed_at: <ISO>`.

---

## Rules

- Use `paths.*` keys — don't hardcode paths (the whole point)
- Use `appendFileSync` for JSONL writes — never `writeFileSync`
- Respect `memory-guard` — it will block otherwise
- If a category returns zero entries, output a gap note rather than silently skipping
- Compare file modification time to `manifest.last_modified` for staleness
- The canonical systems list is 16 categories (listed above). Flag any disk content that doesn't fit a category — suggest new categories.

---

## When to run

- **Weekly / on `/sleep:deep`** — catch drift
- **After major structural changes** (new agent, new skill namespace, new hook)
- **Before a release** — confirm manifest matches reality
- **As part of `/scan:full`** (once that exists)

## Related

- `/scan:architecture` — do layers connect? (this is "what layers exist?")
- `/scan:references` — file-path integrity
- `/maps:systems` — regenerate the visual systems map (runs after this skill)
- `/warp:health` — uses this skill's output for its system-state rollup
