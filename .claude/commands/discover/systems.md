---
description: Multi-angle system discovery — find every system in a project by intersecting 6 discovery lenses, surface what's declared vs what actually exists
user-invocable: true
---

# /discover:systems — Multi-Angle System Discovery

Complements `/scan:system` (which inventories what's DECLARED in `paths.systemsFile`) by looking at the project from **6 different angles**. What the project says exists ≠ what actually exists ≠ what's actually used. Finding the gaps between those three is how we surface undeclared systems, ghost systems (declared but dead), and emergent systems (real but never named).

`/scan:system` = "is the manifest accurate?"
`/discover:systems` = "what does this project actually contain, regardless of what the manifest claims?"

---

## Input

`$ARGUMENTS`:
- No args — run all 6 angles, produce rollup
- `--angle=<N>` — run just one angle (1–6)
- `--delta` — only show items where angles disagree (the interesting findings)
- `--json` — raw JSON output
- `--update-manifest` — offer to add undeclared-but-real systems to `paths.systemsFile` (interactive)

---

## The 6 angles

Each angle is a different *lens* on "what is a system in this project." They overlap deliberately — an item found by ALL 6 is solid ground; an item found by ONLY 1 is a smell worth investigating.

### Angle 1 — Declarative (Stated)

What the project explicitly claims exists.

**Sources:**
- `paths.manifest` — `systems` / `features` / `agentProviders` / `providers` blocks
- `paths.systemsFile` — `systems.jsonl` entries
- `CLAUDE.md`, `AGENTS.md`, `PROJECT.md` — doctrine references
- `paths.json` — every declared path key IS an implicit system declaration

**Signal:** an item appearing here is the author's mental model.
**Noise:** declared but dead, or stale after a rename.

### Angle 2 — Structural (Groups) — _user's explicit 6th angle_

Directory shape. A folder with ≥3 files following the same pattern is very likely a system, whether or not anyone named it.

**Heuristics:**
- Directories with ≥3 files of the same extension (`scripts/hooks/*.js` = hook system, `.claude/commands/*/*.md` = skill namespace)
- Directories with a sibling `.system/` or `.system.md` marker = explicit system root
- Filename-prefix clusters: `foundation-*.ts`, `*-guard.js`, `evolution-*.md`
- Sibling file triples (e.g. `X.md`, `X.js`, `X.test.ts` = feature bundle)

**Signal:** shape reveals intent even when no one wrote a spec.
**Noise:** any dumping-ground dir with unrelated leftovers.

### Angle 3 — Behavioral (Observed)

What's actually running, measured from the event log.

**Sources:**
- `paths.eventsFile` — hook fires, tool calls, block events, merge events
- `paths.tracesFile` — reasoning episodes, which skills got invoked
- `paths.betaEvents` — β decisions, which domains they judged
- `paths.logs/*/smart-context.log` — what context got loaded

**Signal:** items firing regularly are load-bearing systems.
**Noise:** test events, one-offs.

### Angle 4 — Reference graph (Connected)

Who references whom. A tightly-connected cluster of files is usually a system, even if its dir is flat.

**Method:**
- Grep every `.md`, `.js`, `.json` for `paths.X` keys, skill names (`/<ns>:<name>`), hook names, agent names
- Build an edge list: source file → referenced system
- Identify clusters: files with ≥N cross-references between each other
- Orphans (zero inbound refs) are a flag — either dead or very-new

**Signal:** clusters reveal implicit boundaries; orphans reveal decay.
**Noise:** widely-shared utilities look like hubs even when they're not systems.

### Angle 5 — Convention (Named)

Filename and path patterns that MC already uses as system markers.

**Patterns:**
- `*-guard.js` in `paths.hooks` → PreToolUse guard
- `*-watcher.js` in `paths.hooks` → PostToolUse watcher
- `paths.agents/<NN>-<role>/*.md` → agent definition
- `paths.commands/<ns>/<verb>.md` → skill
- `paths.reference/*.md` → durable reference doc
- `paths.maps/inventory-*.json` → system map snapshot
- `*.backup.md`, `*.DEPRECATED.md` → retired (should be found and pruned)

**Signal:** naming convention adherence = healthy system; deviation = new or decaying.
**Noise:** people do rename things; a once-conforming file may be mid-migration.

### Angle 6 — Historical (Co-evolved)

Git co-modification. Files changed together repeatedly are almost certainly one system, even if they're scattered across directories.

**Method:**
- `git log --since=90d --name-only --pretty=format:"COMMIT %H"`
- For each commit, list files modified together
- Count co-occurrences: pairs modified ≥3 times together
- Surface the top 20 pair-clusters

**Signal:** reveals *feature* cohesion invisible to dir structure (e.g. `scripts/hooks/foo.js` + `.claude/commands/foo.md` + `_requirements/04-features/foo/PRD.md` = one feature even though 3 dirs).
**Noise:** omnibus commits touching many unrelated files skew the signal. Filter commits with >20 files.

---

## Procedure

1. **Resolve paths.** Read `.claude/paths.json`. Fall back to `scripts/hooks/lib/paths.js` defaults with a warning.

2. **Run all 6 angles in parallel.** Each produces a list of `{item, category, evidence}` tuples. Use `Agent` subagents (Explore type) if the project is large — each angle is embarrassingly parallel and read-only.

3. **Intersect.** Build a matrix: rows = discovered items, columns = angles. Mark which angles saw each item.

4. **Classify.** Each discovered item falls into one of four buckets:

   | Bucket | Angles present | Meaning |
   |---|---|---|
   | **Solid** | 4+ of 6 | Real, healthy system |
   | **Emergent** | Angles 2, 3, or 6 but NOT 1 | Real but undeclared — candidate for `paths.systemsFile` |
   | **Ghost** | Angle 1 but NOT 2, 3, 5 | Declared but dead — candidate for removal |
   | **Fragile** | Only 1 angle | Either brand-new or near-decay — investigate |

5. **Report.** Group by bucket. For each Emergent or Ghost item, suggest a concrete next action:
   - Emergent → "Add to `paths.systemsFile` with `{id, category, files, notes: 'discovered by /discover:systems'}`"
   - Ghost → "Remove from manifest; archive to `_docs/99-archive/` if files still exist"

6. **(Optional) `--update-manifest` mode:** for each Emergent item, offer to append an entry to `paths.systemsFile`. Use `Edit` tool (memory-guard allows Edit; never Write). User confirms per item.

---

## Output format

### Rollup table

```
┌──────────────────────────────────────────────────────────────────────┐
│ /discover:systems — 2026-04-17T10:30Z                                │
├──────────────────────────────────────────────────────────────────────┤
│  Bucket      Count   Examples                                        │
│  ────────    ─────   ────────                                        │
│  Solid       42      agents, hooks, skills, memory stores, guards    │
│  Emergent    6       dispatch-agent.js, path-lint.js, ...            │
│  Ghost       3       daemon-events-STALE.jsonl, old-audit-reports    │
│  Fragile     11      ref-checker.js (only in structure), ...         │
│  ────────    ─────   ────────                                        │
│  TOTAL       62                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Per-bucket detail

- **Emergent:** one line each with `[angles seen]`, file path, suggested manifest entry
- **Ghost:** file path, last-modified date, suggested action
- **Fragile:** which angle saw it and which didn't — why the asymmetry?

### JSON (`--json`)

```json
{
  "ranAt": "<ISO>",
  "angles": ["declarative","structural","behavioral","refgraph","convention","historical"],
  "items": [
    {"item":"scripts/hooks/foo.js","category":"hook","angles":[1,2,3,5],"bucket":"solid"},
    {"item":"scripts/dispatch-agent.js","category":"lib","angles":[2,3,6],"bucket":"emergent","suggest":"add to systemsFile"},
    ...
  ],
  "summary": {"solid": 42, "emergent": 6, "ghost": 3, "fragile": 11}
}
```

---

## Why 6 angles?

Because one angle lies. The declared inventory lies when someone forgets to update the manifest. Directory shape lies in legacy trees. Event logs lie when systems are dormant. Cross-references lie when code uses dynamic paths. Naming conventions lie mid-rename. Git history lies on fresh repos.

**All 6 together triangulate.** An item seen by ≥4 angles is real. An item seen by ≤1 is a smell.

---

## Relation to other skills

- `/scan:system` — inventories Angle 1 only (declarative). This skill supersets it.
- `/maps:systems` — builds the dependency graph this skill's Angle 4 also uses; reuse the cache if fresh.
- `/scan:references` — Angle 4 overlap, but `/scan:references` is looking for BROKEN refs; this skill uses refs to discover systems.
- `/oneshot:preflight` — runs a subset (Angles 1, 2, 5) as part of pre-run verification.
- `/learn:integrate` — when this skill promotes an Emergent to the manifest, log a `learn` event; the next `/learn:integrate` run may want to validate.

---

## When to run

- **Before a quarterly health check** — "what do we actually own?"
- **After a big rename or restructure** — catch what got orphaned
- **Before writing a new system** — avoid duplicating something that already exists under a different name
- **When `/scan:system` says "inventory clean" but things feel off** — the manifest may be clean because it's simply wrong about what exists
