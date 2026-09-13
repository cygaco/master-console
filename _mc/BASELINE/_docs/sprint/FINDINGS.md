# Sprint Workflow v0.1 — Repo Inspection Findings

Status: Phase 1 inspection complete. Phase 0 verified present (commit
`b3a5ab0`, manifest version `0.3.0`). Phase 1 implementation is unblocked.

This note is the compact findings record required before any code changes
land. It exists alongside `IMPLEMENTATION_PLAN.md`. Both are framework-
level docs (not downstream live tracker state).

---

## Phase 0 Verification

| Workstream | Evidence | Result |
|---|---|---|
| A — promotion workflow (`/warp:flag`, `/warp:promote-flags`, archive) | `.claude/commands/warp/{flag,promote-flags}.md`, the (retired) flag-ledger path, the (retired) promoted-archive + promote-reports paths | present |
| B — dispatch safety (route guard, lock telemetry) | `scripts/hooks/dispatch-route-guard.js`, `scripts/dispatch/prune-dead-locks.js`, `paths.dispatchLocks`, `paths.dispatchDeathsFile`, `paths.dispatchCompletionsFile` | present |
| C — provider health classifier (11 states) | `scripts/hooks/lib/provider-health.js`, `scripts/test-provider-health.js`, consumed by `/warp:health` + `/warp:setup` | present |
| D — install hygiene + provider-tmp | `paths.providerTmp` (`.claude/runtime/.provider-tmp`) | present |
| E — provider fallback policy scaffold | `.claude/agents/00-alex/.system/policy/provider-fallback.json` (`paths.providerFallbackPolicy`), 5 roles, 7 failure signals | present (documented; not yet enforced inside `runProvider`) |
| F — ROADMAP split | `WARPOS_ROADMAP.md` (framework) + `ROADMAP.md` (product scaffold) | present |
| G — dispatch mode-awareness | `scripts/dispatch-agent.js#findAgentSpec` reads `WARPOS_MODE` env / oneshot store | present |
| H — manifest hygiene (framework-manifest-guard) | `scripts/hooks/framework-manifest-guard.js` canonical-vs-product split, `.mc/manifest-guard-disable` sentinel | present |
| I — `/mode:adhoc` stale-team classification | `.claude/commands/mode/adhoc.md` lines 36-77 (Step 1.75 + no-auto-claim startup directive + `.team-marker` freshness check) | present |
| J — requirement write-time linter | `scripts/hooks/requirement-format-guard.js`, wired in `.claude/settings.json` PreToolUse Edit\|Write | present |
| K — agent dispatch guide auto-load | `paths.agentDispatchGuide` cited from Gamma, Delta, session-start | present |

`scripts/phase0-verify.js` is the canonical reproducer. The Phase 0 final
report at `_docs/phase0/FINAL_REPORT.md` records 7/7 fixture tests and
9/9 consistency checks green. Sprint v0.1 builds on this foundation —
none of its work undoes a Phase 0 capability.

## Repo Architecture — What Exists

### Path registry (paths.json) — single source of truth

- Source: `framework/paths.registry.json` (v4).
- Generates: `.claude/paths.json`, `scripts/hooks/lib/paths.generated.js`,
  `scripts/path-lint.rules.generated.json`, `schemas/paths.schema.json`,
  `_requirements/03-architecture/PATH_KEYS.md`.
- Build script: `scripts/paths/build.js`.
- Path-lint: `scripts/path-lint.js` (critical=exit-1, warn=advisory).
- `.claude/project/{events,decisions,memory,maps}` is `owner: runtime` —
  the framework ships the dir convention, not the live files.
- `_requirements/04-features/` is `owner: project` — feature PRDs live
  there (existing convention to preserve).

### Modes

- Three modes: `solo`, `adhoc`, `oneshot`.
- Canonical writer: `scripts/mode-set.js` (state machine, marker v2).
- Marker file: `.claude/runtime/mode.json`.
- `/mode:adhoc` already references future `/sprint:design` writes
  (`mode/adhoc.md` line 137) — the sprint layer is anticipated.

### Agents

- `00-alex/`: alpha, beta, gamma, delta (4 core agents).
- 14 build-chain agents (builder, reviewer, etc.) — dispatched via
  `scripts/dispatch-agent.js`.
- 58 agent specs total (per `framework-manifest.json#counts.agent`).

### Hooks

- 55 hooks (per manifest count).
- Wired in `.claude/settings.json` across `SessionStart`,
  `UserPromptSubmit`, `PreToolUse` (Bash | Edit\|Write | Agent | Read\|Grep\|Glob | MCP | AskUserQuestion), `PostToolUse`,
  `PostCompact`, `Stop`, `SessionEnd`, `StopFailure`.
- Existing `requirement-format-guard.js` (Phase 0 workstream J) covers
  PRD / STORIES / HL-STORIES / CROSS-STANDARDS id formats — sprint
  design will reuse this guard, not duplicate it.

### Commands / Skills

- 118 skills (per manifest count) spread across ~30 namespaces under
  `.claude/commands/`.
- Frontmatter convention: `description:` + optional `user-invocable: true`.
- No existing `sprint/` namespace — clean greenfield.
- Existing `mode/`, `issues/`, `warp/`, `commit/`, `fix/`, `qa/`,
  `redteam/`, `learn/`, `check/`, `session/`, `karpathy/`, `reasoning/`,
  `oneshot/` namespaces show the surface conventions to mirror.

### Issues

- Structured ledger: `paths.recurringIssuesFile`
  (`.claude/project/memory/recurring-issues.jsonl`).
- Helper: `scripts/recurring-issues-helper.js`.
- Skills: `/issues:log`, `/issues:list`, `/issues:resolve`, `/scan:issues`.
- Scope: SYSTEM-level recurring issues. Product/feature bugs go through
  `/fix:deep` and live in PRD/feature directories.
- `issues.md` at repo root: NOT present currently. The prompt requires
  preserving `issues.md` if it exists; sprint v0.1 will treat it as the
  human-readable per-project bug inbox (created on demand by downstream
  projects), with structured per-issue YAML files under
  `paths.sprintIssues` as the machine-readable side.

### Memory stores

- Events: `paths.eventsFile` (jsonl, append-only via `logger.js`).
- Learnings: `paths.learningsFile` (semantic memory).
- Traces: `paths.tracesFile` (reasoning episodes).
- Systems: `paths.systemsFile` (systems manifest).
- Maps: `paths.maps/` (graphs).
- Decisions: `paths.decisionLedger` + `paths.providerTrace`.
- Beta events: `paths.betaEvents`.

### Provider health + fallback

- Classifier: `scripts/hooks/lib/provider-health.js` (11 states).
- Policy: `paths.providerFallbackPolicy` (5 roles, 7 fail signals).
- Today: documented; not yet honored inside `runProvider` (slated for
  post-flag-drain promotion per the policy comment).
- Sprint v0.1 implication: sprint routing **declares** desired model
  class + diff-review per phase. Actual provider selection still flows
  through `scripts/dispatch-agent.js` / `runProvider`. No new provider
  SDK installs.

### Framework vs product distinction (already present)

- `.claude/framework-manifest.json` records what the framework ships.
- `scripts/hooks/framework-manifest-guard.js` is canonical-strict /
  product-warn (Phase 0 workstream H).
- `.mc/manifest-guard-disable` sentinel allows opt-out in product
  repos.
- Sprint v0.1 honors this: framework ships templates + schemas + scripts
  + commands + docs; downstream repos get an opt-in init that writes
  live tracker state into their own `.claude/project/sprint/` tree.

### Version + capsule

- Current framework manifest version: `0.3.0` (Phase 0 cut).
- Capsule build: `scripts/mc/release-canonical.js`,
  `scripts/mc/release-build.js`.
- Sprint v0.1 lands as `0.4.0` (additive feature; no breaking changes
  to existing modes, hooks, paths, or commands).

## Gaps Relative to Sprint Workflow v0.1

1. **No `/sprint:*` commands** — full greenfield. (Adhoc command
   already documents the planned `/sprint:design` writes.)
2. **No tracker schemas** — Plan Contract, current-sprint,
   sprint-progress, ticket, structured-issue, external-service-dependency,
   approval, release, sprint-history, ralph-progress all need schemas.
3. **No tracker templates** — downstream repos need a copy-on-init
   template tree.
4. **No tracker paths in registry** — needs `sprintRoot` + ~16 sub-keys.
5. **No sprint routing policy** — needs declarative artifact under
   `paths.policy` honored by `/sprint:*` commands.
6. **No Ralph loop persistence** — needs `ralph-progress.yaml` schema +
   checkpoint helpers + stop-condition documentation.
7. **No external-service-dependency conceptual model** — needs schema +
   statuses + approval gating + mock guidance.
8. **No COPY/INPUTS/TRACE first-class structure** — needs templates
   that produce `_requirements/04-features/<feature>/{copy,inputs,trace}.md`
   linkable from tickets. (Existing PRD/STORIES already use the
   requirement-format-guard.)
9. **No `issues.md` integration spec** — preserve + document.
10. **No sprint-aware documentation** — overview, downstream adoption,
    crash-recovery, model-routing, mode-relationship docs all missing.
11. **Phase 0 mode/team follow-through is partial** — `/mode:adhoc`
    documents the stale-team primitive limits, but the sprint tracker
    needs to be explicitly named as the durable task-truth source so
    no one wires sprint state into team-task ownership.

## Constraints Reaffirmed

- **Framework, not product.** No product-name hardcodes. No live tracker
  state shipped in the framework repo.
- **paths.X everywhere.** No literal path strings. Path-lint will fail
  the build if a critical pattern slips in.
- **No new provider SDKs.** Routing **declares** preferences;
  `runProvider` enforces availability.
- **Additive.** Existing modes, commands, hooks, agents, requirement
  conventions, capsule layout all preserved.
- **`/mode:oneshot` not retuned.** Out of scope per the prompt.
- **Plan artifact before code.** This findings note + the implementation
  plan land before any `/sprint:*` skill or schema is written.

## Where Things Will Live

- Schemas → `schemas/sprint/*.schema.json`.
- Templates → `framework/templates/sprint/`.
- Helper scripts → `scripts/sprint/*.js`.
- Commands → `.claude/commands/sprint/{plan,design,execute,release}.md`.
- Reference → `.claude/project/reference/sprint-workflow.md`.
- Routing policy → `.claude/agents/00-alex/.system/policy/sprint-routing.json`.
- Docs → `_docs/sprint/` (this note, the plan, overview, adoption,
  crash-recovery, mode-relationship, framework-vs-downstream).
- Downstream live state → `.claude/project/sprint/` (created by
  `scripts/sprint/init.js` in the consuming repo; never seeded with
  example content in the framework).

Next: `_docs/sprint/IMPLEMENTATION_PLAN.md`.
