# MC — Canonical Systems List

The authoritative list of systems. Each system has state, rules, a lifecycle, and interactions with other systems. This doc + `paths.systemsFile` (`.claude/project/memory/systems.jsonl`) are the two sources of truth.

Maintained by `/scan:system` (enumerate + diff) and `/maps:systems` (render).

Last updated: 2026-04-16.

---

## Tier 1 — Identity & doctrine

| System | Files | Purpose |
|---|---|---|
| Alex identity | `CLAUDE.md` | Core behavioral rules — act, don't ask; detect layer; manage systems |
| Agent team | `paths.agents/00-alex/{alpha,beta,gamma,delta}.md` | α (architect) + β (judgment) + γ (adhoc builder) + δ (oneshot builder) |
| Build-chain (adhoc) | `paths.agents/01-adhoc/{builder,evaluator,compliance,fixer,qa,redteam}/*.md` | Agents γ dispatches |
| Build-chain (oneshot) | `paths.agents/02-oneshot/{auditor,builder,evaluator,compliance,fixer,qa,redteam}/*.md` | Agents δ dispatches |
| Modes | `paths.commands/mode/{solo,adhoc,oneshot}.md` | Operating configurations |

## Tier 2 — Cognition

| System | Files | Purpose |
|---|---|---|
| Reasoning engine | `paths.reference/reasoning-frameworks.md` + `paths.commands/reasoning/` + `paths.tracesFile` | Framework router, fix quality scoring |
| Learning system | `paths.learningsFile` + `paths.commands/learn/` + `paths.reference/learning-lifecycle.md` | Staged promotion, decay, reactivation |
| Memory stores | `paths.eventsFile`, `paths.learningsFile`, `paths.tracesFile`, `paths.systemsFile`, `paths.betaEvents` | Persistent knowledge |
| Beta judgment model | `paths.judgmentModel`, `paths.judgmentRecommendations`, `paths.betaSourceData`, `paths.lexicon` | β's decision-making reference |

## Tier 3 — Orchestration

| System | Files | Purpose |
|---|---|---|
| Smart-context pipeline | `paths.hooks/smart-context.js` + `paths.hookLib/context-sources.js` | Haiku enrichment + memory injection on every prompt |
| Session lifecycle | `paths.hooks/{session-start,session-stop,session-tracker}.js` + `paths.commands/session/` | Start → work → stop → handoff |
| Cross-session inbox | `paths.eventsFile` (cat=inbox) + `paths.commands/session/{read,write}.md` | Inter-terminal messaging |
| Store (build state) | `paths.store` | oneshot's state machine persistence |

## Tier 4 — Automation (hooks)

**One system, 31 implementations.** Registered in `paths.settings`, wired per Claude Code event.

| Hook category | Files | Event |
|---|---|---|
| Guards | `secret-guard`, `memory-guard`, `foundation-guard`, `ownership-guard`, `merge-guard`, `team-guard`, `store-validator`, `path-guard` | PreToolUse |
| Watchers | `edit-watcher`, `session-tracker`, `systems-sync`, `learning-validator`, `save-session-lint`, `prompt-validator` | PostToolUse |
| Quality | `format`, `typecheck`, `lint`, `ui-lint` | PostToolUse Edit|Write |
| Lifecycle | `session-start`, `session-stop`, `compact-saver` | SessionStart/Stop/PostCompact |
| Context | `smart-context`, `prompt-logger` | UserPromptSubmit |
| Build | `gate-check`, `gauntlet-gate`, `cycle-enforcer`, `boss-boundary`, `worktree-preflight`, `create-worktree-from-head`, `ref-checker`, `excalidraw-guard`, `beta-gate` | PreToolUse / WorktreeCreate |

## Tier 5 — Capability (skills)

**One system, 66+ implementations across 21 namespaces.**

| Namespace | Count | Purpose |
|---|---|---|
| beta | 2 | mine patterns, integrate recommendations |
| check | 6 | architecture, environment, patterns, references, requirements, system |
| commit | 3 | local, remote, both |
| content | 2 | linkedin, contra (jobhunter-only) |
| fav | 2 | list, search |
| fix | 2 | fast, deep |
| hooks | 5 | add, disable, friction, sync, test |
| learn | 4 | combined, conversation, events, ingest |
| maps | 8 | all, architecture, enforcements, hooks, memory, skills, systems, tools |
| mode | 3 | solo, adhoc, oneshot |
| preflight | 2 | run, improve |
| qa | 2 | audit, check |
| reasoning | 3 | run, log, score |
| redteam | 2 | full, scan |
| research | 2 | simple, deep |
| retro | 3 | context, code, full |
| session | 6 | handoff, checkpoint, resume, history, read, write |
| skills | 4 | create, edit, delete, cleanup |
| sleep | 2 | quick, deep |
| ui | 1 | review |
| warp | 5 | init, health, tour, sync, check |

## Tier 6 — Knowledge infrastructure

| System | Files | Purpose |
|---|---|---|
| Paths registry | `paths.json` (root) | Canonical dir/file locations — SSoT |
| Manifest | `paths.manifest` | Project identity, features, build commands, foundation files |
| Settings | `paths.settings` | Hook registration, permissions, env |
| Maps | `paths.maps/*.{jsonl,md}` — skills, hooks, enforcements, memory, tools, systems, architecture | Relationship graphs |
| Reference docs | `paths.reference/*.md` — reasoning-frameworks, operational-loop, learning-lifecycle, SYSTEMS.md | Living reference library |
| SPEC_GRAPH | `paths.specGraph` | Staleness propagation graph — when A changes, B gets STALE |

## Tier 7 — Product skeleton (MC-only, shipped to installs)

| System | Files | Purpose |
|---|---|---|
| Requirements templates | `paths.requirements/00-canonical through 99-audits/` | Spec template library |
| Patterns library | `paths.patterns/*.md` | Claude API engineering patterns |
| Installer | `scripts/warp-setup.js`, `install.ps1`, `version.json` | Project bootstrap |

## Tier 8 — Worktree / isolation

| System | Files | Purpose |
|---|---|---|
| Worktree hooks | `paths.hooks/{create-worktree-from-head.js,.sh}`, `worktree-preflight.js` | γ dispatches builders into isolated worktrees |

## Tier 9 — Plans

| System | Files | Purpose |
|---|---|---|
| Plan system | `paths.plans/*.md` + `paths.plans/archive/` | Planning docs + archive |

## Tier 10 — Handoffs

| System | Files | Purpose |
|---|---|---|
| Handoff system | `paths.handoffs/*.md`, `paths.handoffLatest` | Session snapshots for cross-session continuity |

## Tier 11 — Dreams

| System | Files | Purpose |
|---|---|---|
| Dream logs | `paths.dreams/*.md` | Sleep-cycle REM artifacts |

## Tier 12 — Favorites

| System | Files | Purpose |
|---|---|---|
| Favorites | `paths.favorites/*` | Saved moments, user-curated |

## Tier 13 — Linters

| System | Files | Purpose |
|---|---|---|
| Lint suite | `scripts/{path-lint,lint-prds,lint-stories,lint-hl-stories,lint-staleness}.js` | Static analysis — paths, specs, code hygiene |
| External linters | `npm run lint`, `tsc --noEmit` (via `format.js`, `typecheck.js`, `lint.js` hooks) | Code quality gates |

## Tier 14 — Compliance / CLI bridge

| System | Files | Purpose |
|---|---|---|
| Compliance CLI | `scripts/run-compliance.sh` | Shell runner for `codex exec` / `gemini` |
| Store compliance config | `paths.store.compliance` | Which CLI to use + fallback |

## Tier 15 — Event-sourced documentation

| System | Files | Purpose |
|---|---|---|
| Decisions log | `scripts/materialize-decisions.js` reading `paths.eventsFile` | Regenerates human-readable DECISIONS.md from events |
| Truth compiler | `scripts/truth-compiler.js` | Event-sourced doc generation |

## Tier 16 — Observability

| System | Files | Purpose |
|---|---|---|
| Agent dashboard | `scripts/agent-dashboard.js` + `scripts/store-viewer.html` | Visual state during oneshot |
| QA health | `scripts/qa-health.js` | QA system state |

---

## Counting

**Total active systems: ~60** (16 tiers, some with multiple instances).

- Tier 1: 5 systems
- Tier 2: 4
- Tier 3: 4
- Tier 4: 1 (hooks) — 31 implementations
- Tier 5: 1 (skills) — 66 implementations across 21 namespaces
- Tier 6: 6
- Tier 7: 3
- Tier 8: 1
- Tier 9: 1
- Tier 10: 1
- Tier 11: 1
- Tier 12: 1
- Tier 13: 2
- Tier 14: 2
- Tier 15: 2
- Tier 16: 2

Each tier should have at least one entry in `paths.systemsFile`. `/scan:system` reports gaps.
