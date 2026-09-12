# WarpOS System Updates — 2026-04-15

## Hook Generification (13 files)

### memory-guard.js
- **Before:** Hardcoded paths `.claude/project/events/events.jsonl`, `.claude/project/memory/learnings.jsonl`, etc.
- **After:** Reads `PATHS.events` and `PATHS.memory` from paths.json. Learnings count check also uses `memoryDir` variable.

### learning-validator.js
- **Before:** Hardcoded paths `.claude/project/memory/learnings.jsonl` and `systems.jsonl`
- **After:** Derives `learningsRel` and `systemsRel` from `PATHS.memory` at module load time.

### ownership-guard.js
- **Before:** Hardcoded `src/` and `extension/` directories, wrong store path at `.claude/agents/.system/oneshot/store.json`
- **After:** Reads `source_dirs` from manifest.json (default: `["src/", "extension/"]`). Store path from `PATHS.agents`. Uses `relPath()` for normalization.

### typecheck.js
- **Before:** Hardcoded path to `node_modules/typescript/bin/tsc`, crashes (exit 2) if TypeScript not installed
- **After:** Checks `fs.existsSync(tscBin)` before running. Filters out "Cannot find module" and "ENOENT" errors from blocking. Graceful skip on non-TS projects.

### lint.js
- **Before:** Hardcoded `npx next lint` — crashes on non-Next.js projects
- **After:** `detectLintCommand()` auto-detects: Next.js → ESLint → npm lint script. Returns null if no linter found → graceful skip.

### edit-watcher.js
- **Before:** 70+ hardcoded component-to-feature mappings (`Step1Resume: "onboarding"`, etc.), hardcoded SPEC_PATTERNS, CODE_PATTERNS, 4 hardcoded JSON file paths (`SPEC_GRAPH.json`, `FIELD_REGISTRY.json`, `PRECEDENCE.json`, `MODE.json`), hardcoded `FEATURES_DIR`
- **After:** All config reads from manifest.json:
  - `manifest.component_feature_map` — empty default (code tracking works but without feature attribution)
  - `manifest.spec_patterns` — string→RegExp conversion, defaults to framework-generic patterns
  - `manifest.code_patterns` — same
  - `manifest.canonical_dir` — for JSON file paths
  - `manifest.features_dir` — for requirement drift staging
  - `manifest.foundation_files` — added to spec patterns if present

### foundation-guard.js
- **Before:** 14 hardcoded origin-product file paths (`src/lib/types.ts`, `src/app/page.tsx`, etc.), wrong store path
- **After:** Reads `manifest.fileOwnership.foundation` array. Empty default = no blocking on fresh projects. Store path from `PATHS.agents`.

### boss-boundary.js
- **Before:** Hardcoded blocks on `src/` and `extension/`, store path via `__dirname`
- **After:** Reads `manifest.source_dirs` for blocked directories. Store path from `PATHS.agents`.

### context-sources.js (lib)
- **Before:** Hardcoded `.claude/memory/` for learnings/traces, hardcoded `agents/alex/` for beta decisions
- **After:** Uses `PATHS.memory` and `PATHS.agents` from paths.json.

### cycle-enforcer.js
- **Before:** Store path via `__dirname` relative resolution
- **After:** Tries `PATHS.agents` from paths.js, falls back to `__dirname` if unavailable.

### gate-check.js
- **Before:** Store path via `__dirname`
- **After:** Same pattern as cycle-enforcer — PATHS.agents with __dirname fallback.

### gauntlet-gate.js
- **Before:** Store path via `__dirname`
- **After:** Same pattern.

### store-validator.js
- **Before:** Store at `PROJECT/.claude/agents/store.json`, cache at `PROJECT/.claude/logs/`
- **After:** Uses `PATHS.agents` and `PATHS.logs` from paths.json.

## manifest.json Updates

Added new fields to the origin product's manifest:
- `source_dirs: ["src/", "extension/"]`
- `component_feature_map: { Step1Resume: "onboarding", ... }` — full 30-entry map
- `spec_patterns: [...]` — 11 regex patterns as strings
- `code_patterns: [...]` — 2 regex patterns
- `features_dir: "_requirements/05-features"`
- `canonical_dir: "_docs/00-canonical"`

## Skill Scrubbing (20+ files)

### Mode skills
- `mode/adhoc.md` — Fixed agent paths from `alex/` to `00-alex/`, protocol path to `01-adhoc/.system/`, store path to `.claude/agents/store.json`
- `mode/oneshot.md` — Fixed store path, protocol path to `02-oneshot/.system/`, delta path to `00-alex/delta.md`

### Check skills
- `check/specs.md` — Removed hardcoded 13-feature list. Now reads features from `manifest.build.features[]`, paths from `manifest.projectPaths`
- `check/arch.md` — Removed hardcoded foundation file refs. Now reads from manifest.

### Research skills
- `research/deep.md` — Replaced "Next.js job search app (origin-product)" context with "Read CLAUDE.md and PROJECT.md for context". Changed "Applicability to origin-product" → "Applicability to This Project"
- `research/simple.md` — Same changes.

### Bulk retro path replacement (8 files)
Replaced `_docs/09-agentic-system/retro` with `the retro directory (check manifest.json projectPaths.retro for location)` in:
- check/patterns.md, fix/deep.md, preflight/run.md, sleep/deep.md, learn/ingest.md, maps/enforcements.md, retro/full.md, retro/code.md

### Other scrubs
- `learn/ingest.md` — "origin-product system" → "current project and WarpOS system"
- `session/history.md` — Removed origin-product-specific example handoff entries

## WarpOS Repo Restructure

### Agent directory: flat → per-mode
- **Before:** `alex/` + `general/` + `.system/{adhoc,oneshot}/`
- **After:** `00-alex/` + `01-adhoc/` + `02-oneshot/` with full sub-agent trees
- Removed orphan `general/lead.md` (was duplicate of auditor)
- Added 22 new agent files (QA scan/analyze, RedTeam orch/scan/analyze for both modes, oneshot-specific variants)
- Added Beta support files (persona, persona-template, lexicon)

### Reference docs added
- `operational-loop.md`
- `learning-lifecycle.md`
- `evolution.md`
- `SYSTEMS-REFERENCE.md`

### Skills added
- `check/refs.md`, `redteam/full.md`, `redteam/scan.md`, `reqs/review.md`, `ui/review.md`
- `warp/health.md`, `warp/tour.md`

## New Files Created

### Install system
- `WarpOS/scripts/warp-setup.js` — Node.js installer (detects stack, copies framework, generates manifest, merges settings, creates structure)
- `WarpOS/install.ps1` — PowerShell wrapper for Windows
- `.claude/commands/warp/health.md` — Installation verification skill
- `.claude/commands/warp/tour.md` — Guided introduction skill

### WarpOS final counts
- 221 total files
- 38 agent definitions
- 66 skills
- 25 hooks
- 6 reference docs
- 30 requirement templates
- Install tested on fresh project: 161 files installed cleanly
