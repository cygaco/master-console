---
description: Initialize the enforced tracker system in a repo — scaffold a validator-GREEN tracker structure. Creates the /trackers/ dirs (epics/sprints kept with .gitkeep), a seed TRACKER.md carrying all 34 §5 sections with no blank section / no broken links / every §8 term defined / the enforcement-hook gap acknowledged / no active items, a seed UNTRACKED_WORK.md (from the shipped template if present), and ensures ROADMAP.md is epic-based (creates a `## Epics` roadmap if absent, additively adds `## Epics` if present). Idempotent + read-before-write — never clobbers an existing TRACKER.md/ROADMAP.md/UNTRACKED_WORK.md unless --force. The setup companion to /trackers:validate.
---

# /trackers:init — Stand up the tracker system

The enforced tracker system (`_planning/tracker-system-improvements.md`) makes long-running work **resumable, auditable, and truthful** across sessions — and `/trackers:validate` refuses any tracker that drifted from reality. But a consumer that has the validator and nothing else can't *use* the system: there's no `TRACKER.md`, no `/trackers/` dirs, no seed. This skill is the on-ramp: it scaffolds a fresh, **validator-GREEN** tracker structure so `/trackers:validate` passes from the first run.

It is the setup companion to [`/trackers:validate`](validate.md) and shares its discipline: a **pure planner** (read-before-write, decides create-vs-skip without side effects) wrapped in a thin apply step, so a re-run is safe and a `--dry-run` previews the plan with no writes.

## Run

```bash
node scripts/trackers/init.js                 # scaffold into the current repo (cwd)
node scripts/trackers/init.js --root <dir>     # scaffold into another repo
node scripts/trackers/init.js --force          # overwrite an existing TRACKER.md/ROADMAP.md/UNTRACKED_WORK.md
node scripts/trackers/init.js --dry-run        # print the plan, write nothing
```

Then confirm it's green:

```bash
node scripts/trackers/validate.js              # expect: all 20 checks pass, exit 0
```

## What it creates / ensures (idempotent, read-before-write)

- **`trackers/`, `trackers/epics/`, `trackers/sprints/`** — the §33 required dirs. `epics/` and `sprints/` start empty (a `.gitkeep` keeps them tracked), so there are no active items — the cross-file checks (`epics-in-roadmap`, `cross-file-reconciliation`) are vacuously green.
- **`TRACKER.md`** — a SEED with all **34 §5 sections** (the `# TRACKER.md` Header carries the Version / Owner / Authority block the validator's Header check requires). Every section has real content or the explicit `None currently recorded.` sentinel (no blank section). Every §8 core term is defined as a `## Definition: <Term>` block (no undefined terms). The unbuilt enforcement-hook gap is acknowledged in **Known Gaps** (so `hooks-enforce-or-tracked` passes). No active/planned/completed items, no broken intra-repo links, no ambiguous-state language, no parseable session-log entry.
- **`UNTRACKED_WORK.md`** — adapted from `trackers/templates/UNTRACKED_WORK_TEMPLATE.md` when present (placeholder entry replaced with the empty sentinel), else a valid built-in seed.
- **`ROADMAP.md`** — ensured **epic-based**: created with a `## Epics` section if absent; if it exists but lacks `## Epics`, the section is **additively appended** (existing content untouched). A live (non-`DEPRECATED`) `## …Milestones` heading is **flagged, not rewritten** — see Caveats.

## Templates are framework content (not generated here)

The 9 §33 templates under `trackers/templates/*` are **framework content shipped by the capsule** — this initializer does NOT generate them; it assumes they exist at the target. If any are missing, init prints a `WARN` and `/trackers:validate`'s `required-paths` check will FAIL until the capsule ships them. (In canonical MC the templates are already present.)

## Safety

- **Never clobbers** an existing `TRACKER.md` / `ROADMAP.md` / `UNTRACKED_WORK.md` unless `--force`. Re-runs are safe and report what was left untouched.
- `--root <dir>` targets a repo other than cwd (default = cwd). `--dry-run` writes nothing.
- Exit `0` success · `2` usage / runner error (fail-closed — a missing `--root`, an unknown flag, or an internal throw never reads as success).

## Caveats

- **Pre-existing milestone-based roadmap.** If `ROADMAP.md` already has a live (non-`DEPRECATED`) `## …Milestones` heading, `roadmap-epic-based` stays red until that heading is marked `DEPRECATED`. The initializer **flags** this (it won't rewrite your roadmap prose — that's `/roadmap`'s job) so you can mark it deprecated in one edit, then re-validate.
- **Modes must consult the tracker.** `modes-consult-tracker` requires `.claude/commands/mode/{solo,adhoc,oneshot,sprint}.md` to each carry a start-of-work "consult TRACKER.md" step. Those mode skills are shipped by the framework; init does not author them.

## Reference

- Engine: `scripts/trackers/init.js` — pure `plan(root, force)` (read-before-write) + thin `apply()`, with the seed renderers (`renderTracker` / `renderRoadmapSeed` / `renderUntrackedWork*`). `SECTION_ORDER` + `CORE_TERMS` are kept in lockstep with `scripts/trackers/validate.js`.
- Validator: [`/trackers:validate`](validate.md) — run it after init to confirm all 20 checks pass (exit 0).
- Spec: `_planning/tracker-system-improvements.md` — §5 (34 sections) · §8 (definitions) · §28.7 (validation enforcement) · §29 (epic-based roadmap) · §33 (required paths).
