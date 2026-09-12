---
description: Architecture integrity — do the layers connect? agent system, cross-layer seams, documentation health
---

# /scan:architecture — Architecture Integrity

Single owner for "Do the layers actually connect?" Verifies the agent system, foundation files, specs, code, and docs are internally consistent and reference things that exist.

## Input

`$ARGUMENTS` — Mode selection:
- No args — run all three modes in order (internal → seams → health)
- `internal` — Agent system internal consistency only
- `seams` — Cross-layer seam checks only (requirements ↔ architecture ↔ code ↔ agents)
- `health` — Document-level health of specs, agent docs, foundation files, infra
- `--json` — raw JSON output instead of markdown report
- `<layer-pair>` — e.g. `req+arch`, `skills+hooks`, `docs+agents` for targeted seam checks

---

## Files to read (all modes)

Bootstrap paths and config — every mode reads these first:

1. `.claude/paths.json` — canonical path registry
2. `.claude/manifest.json` — project metadata (`build.features[]`, `fileOwnership.foundation`, `source_dirs`, `buildCommands`)
3. `.claude/settings.json` — hook registrations
4. `.claude/agents/store.json` — build system state (may not exist in fresh projects)
5. `.claude/paths.json` resolved keys — locate `agents`, `commands`, `reference`, `maps`, `memory`, `events`

Any check that depends on a path should resolve it via `paths.json`, not hardcode it.

---

## Mode: internal — Agent System Consistency

Spawn an Explore agent. Focus: **can agents build from these docs without contradictions?**

### Additional files to read

- `.claude/agents/president/{alpha,beta,gamma,delta,epsilon}.md` — president faces
- `.claude/agents/president/_system/protocol.md` (if exists) — shared protocol <!-- doc-ref-ignore: explicitly conditional ("if exists"); the real protocols are the adhoc/oneshot ones below -->
- `.claude/agents/president/_system/adhoc/protocol.md` — adhoc mode protocol
- `.claude/agents/president/_system/oneshot/protocol.md` — oneshot state machine
- `.claude/agents/president/_system/adhoc/*/` and `.claude/agents/president/_system/oneshot/*/` — build-chain agent definitions
- `.claude/project/reference/{reasoning-frameworks,operational-loop,learning-lifecycle}.md`
- Foundation files listed in `manifest.fileOwnership.foundation`
- Each feature's spec files (resolve `_requirements/04-features/{feature}/` from manifest; fall back to `_requirements/04-features/`)

### Internal checks (I1–I12)

- **I1 Feature coverage** — every `manifest.build.features[].id` has a feature folder with PRD.md, HL-STORIES.md, STORIES.md
- **I2 Foundation files exist** — every path in `fileOwnership.foundation` exists on disk
- **I3 Agent store schema** — if `store.json` exists, required fields present: `features`, `tasks`, `bugDataset`, `heartbeat`, `circuitBreaker`, `compliance`
- **I4 Agent file references** — every file path named inside an agent's `.md` exists (critical for Beta reading judgement-model, lexicon, etc.)
- **I5 Hook registrations** — every hook in `settings.json` has a matching script in `paths.hooks`
- **I6 Orphan hooks** — every script in `paths.hooks` is referenced in `settings.json` OR is a lib/helper
- **I7 Mode protocols present** — adhoc and oneshot protocols reference agents that exist in their respective dirs
- **I8 Compliance CLI** — `store.compliance.command` and `store.compliance.fallback` both resolvable (or missing, with fallback documented)
- **I9 Circuit breaker wiring** — oneshot state machine references match `store.circuitBreaker` field states
- **I10 Role completeness** — each build-chain role (builder, evaluator, compliance, qa, redteam, fixer, auditor) has an agent file in the relevant mode dir
- **I11 Known stubs exist** — every file in `store.knownStubs` exists AND contains a stub marker
- **I12 Locked interfaces** — every entry in `store.lockedInterfaces` references a real exported type
- **I13 Step registry consistency** — **absence-aware** (W4 RESTRUCTURE): the product canon (`_requirements/00-canonical/STEPS.json`) is generated per-product at `bootstrap:spinup` and is **legitimately ABSENT in WarpOS-canonical** (the framework carries no baked-in product — the filled example lives at `_warpos/BASELINE/_requirements/`, the synthetic "Pantry Pilot" example). If STEPS.json is absent → flag as **INFO** ("no product canon in this repo — nothing to check"), NOT an error. If STEPS.json IS present → verify it is valid JSON and passes step-registry-guard schema validation. In both cases run `node scripts/generate-steps-maps.js --check` (it no-ops with exit 0 when STEPS.json is absent); if exit ≠ 0, flag as ERROR (canonical doc tables have drifted from registry). Absence-tolerance is pinned by `scripts/checks/test-steps-maps-absent-canon.js`. Severity: ERROR (present + drifted) / INFO (absent).
- **I14 Canonical dispatch callouts present** — verify `delta.md`, `gamma.md`, `president/_system/adhoc/protocol.md`, and `president/_system/oneshot/protocol.md` each contain a callout that build-chain roles (builder, evaluator, compliance, qa, redteam, fixer, auditor) MUST dispatch via `claude -p --agent` Bash subprocess + `parseProviderJson`, NOT via the in-process `Agent` tool. Grep for `claude -p --agent` or `parseProviderJson` in each of those four files; if any is missing the callout, flag as ERROR. Rationale: L1 run-09 — Agent-tool dispatch returned 50–100K tokens of agent prose per reviewer into the orchestrator and halted a full-session run at Phase 2. Severity: ERROR.
- **I15 Worktree isolation preamble in build personas** — verify every builder and fixer persona (`president/_system/adhoc/builder.md`, `president/_system/adhoc/fixer.md`, `president/_system/oneshot/builder.md`, `president/_system/oneshot/fixer.md`) includes an explicit isolation preamble that runs `pwd && git worktree list --porcelain` at dispatch time and aborts if the working directory is not under `.claude/runtime/worktrees/`. Grep for `git worktree list --porcelain` in each persona file; missing preamble in any role → ERROR. Rationale: L2 run-09 — first parallel dispatch leaked to main repo dir when two `worktree add` calls fired simultaneously; mitigation is only effective if preamble is in the persona. Severity: ERROR.
- **I16 Builder dispatch references latest HYGIENE** — verify builder/fixer personas reference the highest-numbered retro's HYGIENE file (resolve via `ls .claude/agents/president/_system/oneshot/retros/ | sort -n | tail -1`). If persona references an older retro (e.g. "retro 08 HYGIENE" when retro 10 exists), flag as WARN. Rationale: L7 run-09 — Rules 62/63/64 were the ruleset that broke Phase 1 Rockets; stale references leave builders blind to the class of bugs that keeps recurring. Severity: WARN.
- **I17 validate-gates.js PHASES sync with manifest** — every `manifest.build.features[].id` MUST appear in the `PHASES` dict in `scripts/validate-gates.js` at the matching phase number. Conversely, every entry in PHASES must correspond to a manifest feature. Build `Set<feature_id>` from each, symmetric difference must be empty. To check: load both files, parse PHASES from validate-gates.js (regex `(\d+(?:\.\d+)?)\s*:\s*\[([^\]]+)\]`), compare to `manifest.build.features.map(f => f.id)` grouped by phase. Missing entry in PHASES → ERROR. Missing manifest entry but present in PHASES → ERROR (orphan gate). **Exemption: phase=0 (foundation).** The unified `foundation` manifest entry is a product-level abstraction; PHASES enumerates 10 granular `foundation-*` build-orchestration sub-units (foundation-types, foundation-constants, etc.). Both representations are valid at different layers. Skip the symmetric-diff check for phase 0 entries; instead, verify that EVERY file in `manifest.fileOwnership.foundation` is owned by exactly one `foundation-*` entry's `files[]` in store. Rationale: L9 run-10-prep — backend gate sync was the immediate trigger; L12 follow-up — initial enforcement also fired on legitimate foundation schema split, treating two-views as drift. Severity: ERROR (phase ≥ 1); phase=0 uses different validation.

---

## Mode: seams — Cross-Layer Seams

Spawn an Explore agent. Focus: **where layers connect, where they contradict.**

### Requirements × Architecture

- **S1 Specs → foundation types** — every type/field reference in `PRD.md`, `INPUTS.md`, and `STORIES.md` (across all features) MUST resolve to an actual export in `src/lib/types.ts` (or whichever foundation type file `manifest.fileOwnership.foundation` lists). How to check: (a) extract the named-type set from the foundation file (regex `export (type|interface|enum)\s+(\w+)`); (b) for each spec doc, grep for `<TypeName>\.<fieldName>` patterns AND for `Data:` lines (legacy STORIES convention); (c) for each `<TypeName>` referenced in specs, parse the foundation type body and confirm `<fieldName>` exists. Flag any reference to a non-existent type or field as ERROR: "`<feature>/<doc>` references `<TypeName>.<fieldName>` but `<TypeName>` in `<foundation file>` has no such field." Rationale: L13 run-10-prep — backend PRD added references to `SessionData.activeTicketId` for tab-close recovery; if foundation type wasn't updated to match, builder would write `session.activeTicketId = ...` and `npm run build` would fail mid-run, halting Delta. R8 / former-S1 only covered STORIES `Data:` lines — too narrow; PRD prose and INPUTS field tables also reference types and were uncovered. Severity: ERROR.
- **S2 Stories → prompts** — prompt template names in stories match actual template names in code
- **S3 Stories → validation** — error messages and constraint values match validation rules
- **S4 INPUTS → consumers** — every consumed-by feature has a matching story
- **S5 Architecture without stories** — architecture docs describe systems no story asks for (often dead weight)
- **S6 Stories without architecture** — stories assume systems architecture doesn't describe (gap to fill)

### Skills × Hooks

- **S7 Hook coverage** — every hook in `settings.json` is known to at least one `/hooks:*` skill
- **S8 Skill enforcement backing** — skills claiming enforcement have backing hooks (not just aspirational)
- **S9 Hook-skill version sync** — hook file mtime later than the skill that documents it → warn
- **S10 Missing automation** — patterns that appear in learnings.jsonl as repeated but have no hook/skill enforcement

### Docs × Agents

- **S11 Reference docs in agent read-lists** — every doc in `.claude/project/reference/` is referenced by at least one agent or skill (or intentionally archived)
- **S12 Agent `.system/` consistency** — files an agent is told to read exist (critical — Beta reads 5 files on every invocation)
- **S13 Cross-session inbox wiring** — smart-context.js reads inbox, session:write writes to it, both use paths from `paths.json`

### Field rename detection

Scan `git log --diff-filter=R -M --name-status HEAD~20..HEAD -- <types file>` — if any renames detected in recent history, grep all docs, stories, and prompts for the OLD name. Flag as HIGH severity.

---

## Mode: health — Documentation Health

Spawn an Explore agent. Focus: **each doc layer's quality in isolation.**

### Foundation docs (00-canonical)

Resolve directory: `_requirements/00-canonical/` (or legacy `_requirements/00-canonical/`).

- **H1 Template coverage** — expected files present: `CORE_BRIEF.md`, `PRODUCT_MODEL.md`, `GLOSSARY_TEMPLATE.md` (or filled), `GOLDEN_PATHS.md`, `USER_COHORTS.md`, `FAILURE_STATES.md`
- **H2 Glossary alignment** — terms in GLOSSARY match constants, code identifiers
- **H3 No TODO/PLACEHOLDER** in filled versions
- **H4 Cross-consistency** — PRODUCT_MODEL scope matches CLAUDE.md

### Architecture docs (04-architecture)

- **H5 STACK.md, DATA_FLOW.md, SECURITY.md** — present, non-empty, current
- **H6 DATA_FLOW matches code paths** — every producer-consumer pair resolves
- **H17 Production baseline** — run `node scripts/checks/production-baseline.js`. Missing production, accessibility, analytics, disaster recovery, release readiness, or deprecation policy docs are production-readiness failures.

### Feature docs (05-features)

For every feature folder:
- **H7 Required files** — `PRD.md`, `HL-STORIES.md`, `STORIES.md`
- **H8 Optional but recommended** — `INPUTS.md`, `COPY.md`
- **H9 GUIDANCE comments stripped** — filled-in docs shouldn't have `<!-- GUIDANCE: -->` blocks remaining
- **H10 No stale STALE markers** — `<!-- STALE -->` banners older than 7 days → flag

### Infrastructure data

- **H11 Events log writable** — `paths.events/events.jsonl` exists, appendable
- **H12 Learnings bounded** — `paths.memory/learnings.jsonl` has <200 active entries (warn >100)
- **H13 Systems manifest** — `paths.memory/systems.jsonl` present, entries match `.claude/agents/` + `scripts/hooks/` + `.claude/commands/`
- **H14 Maps fresh** — no map in `paths.maps/` older than 14 days
- **H15 Stale markers sane** — `paths.maps/.stale.json` orphans cleared after regen
- **H16 Paths registry complete** — every path used by hooks/skills is listed in `paths.json`

### Auto-fixable items (report, don't apply without flag)

- Malformed JSON files → reformat
- Orphan STALE markers older than 7 days → clear
- Missing required templates → scaffold from WarpOS `_requirements/` templates
- Unwired hooks (script exists, not in settings.json) → propose registration
- Orphan hooks (script with no users) → propose deletion

---

## Output format

### Markdown (default)

```markdown
# Architecture Integrity Report — {mode}

## Summary
| Severity | Count | Auto-fixable |
|----------|-------|--------------|
| Critical | N | N |
| High     | N | N |
| Medium   | N | N |
| Low      | N | N |

## Critical / High
{Per-finding: check_id, layer, file, message, suggested fix}

## Trends
{If multiple runs: which issues are new, which are recurring}

## Next Actions
1. {First fix} — {why it matters}
2. ...
```

### JSON (`--json`)

Array of `{ check, severity, layer, file, message, autoFixable, suggestedFix }`.

---

## When to run

- **Before starting a build session** — `internal` + `seams`
- **After structural renames** (files moved, skills renamed, agents refactored) — full run
- **Weekly/on `/sleep:deep`** — `health` mode for drift
- **When `/warp:health` shows yellow** on architecture items

## Related

- `/scan:requirements` — spec-layer health (paired with this)
- `/scan:references` — raw file-path integrity (subset of H1, H4, I4)
- `/scan:environment` — can we run? (separate concern)
- `/maps:all` — regenerate the maps this skill reads
