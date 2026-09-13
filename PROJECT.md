# MC — Project Context

> Project-specific context for MC itself. For the framework instructions an agent operates under, see [CLAUDE.md](CLAUDE.md). For the agent system router, see [AGENTS.md](AGENTS.md).

## What MC is

MC is an AI operating system for Claude Code. It gives a single developer a multi-agent engineering team (Alex α/β/γ/δ/ε), a registry of slash-command skills, a pipeline of automated hooks, an enforced sprint workflow, and learning/memory infrastructure that persists across sessions.

You install it into a project, open Claude Code, and you stop talking to a single assistant — you talk to a team that plans, builds, reviews, and learns.

## The Alex team

| Agent | Symbol | Role | When it runs |
|-------|--------|------|-------------|
| Alpha | α | Architect, orchestrator, main session | Always — Alpha IS the session |
| Beta  | β | Judgment model — DECIDE / DIRECTIVE / ESCALATE | On every Class-B/C decision; before any `AskUserQuestion` |
| Gamma | γ | Adhoc build orchestrator (single features) | When a real feature build kicks off in `/mode:adhoc` |
| Delta | δ | Oneshot build orchestrator (full skeleton runs) | Standalone in `/mode:oneshot` — Delta IS the session |
| Epsilon | ε | Sprint conductor — full lifecycle (plan→design→build→gauntlet→release→retro) | In `/mode:sprint` — drives `/sprint:full`; resolves the agent roster per step from the registry and dispatches for REAL with completion records (ADR-0009) |

Plus build agents:

- **Both modes:** Builder, Reviewer (7-check spec+code), Req-Reviewer (requirements traceability), Compliance, Fixer, QA (13 failure-mode personas), Red Team (11 security personas)
- **Oneshot only:** Learner (cross-cycle pattern analysis), Stub-Scaffold, Test-Runner, Visual-Review

Full router in [AGENTS.md](AGENTS.md).

## Build modes

| Mode | Composition | Purpose |
|------|-------------|---------|
| `solo` | Alpha alone | System tweaking, quick edits, exploratory reading. Default for 80% of work. |
| `adhoc` | Alpha + Beta + Gamma | Building one feature with oversight. Gamma dispatches the gauntlet (Builder → Evaluator → Compliance → QA → Red Team). |
| `oneshot` | Delta standalone | End-to-end skeleton rebuild. State machine, cycles, fix loops. No Alpha/Beta. |
| `sprint` | Epsilon conducts | Full roadmap-sequenced lifecycle (plan→design→build→gauntlet→release→retro). ε resolves the agent roster per step from the registry and dispatches for REAL — CLI-routable builders+reviewers via `dispatch-*.js`, the in-process roster via the harness Agent tool + `record-inprocess`. β at the four phase boundaries. |

Modes are **project-wide and persistent** — set in any terminal applies to all terminals on that project.

## Core systems

### Sprint workflow

Plain-language request → durable Plan Contract → designed requirements bundle → executable tickets → reviewed, traceable changes. Skills: `/sprint:plan`, `/sprint:design`, `/sprint:execute`, `/sprint:release` — or `/sprint:full` to run the whole pipeline autonomously under a bounded preset. In `/mode:sprint`, **ε (the sprint conductor)** drives the lifecycle via the registry-driven runtime (`scripts/sprint/epsilon-runtime.js`, ADR-0009) with REAL per-agent dispatch + completion records `gauntlet-verify` reads. Per-sprint state under `.claude/project/sprint/sprints/<SP-id>/`. Multi-sprint parallel — active sprints tracked in `paths.sprintActiveRegistry` with one designated `primary`.

### Skills

~140 slash-command markdown files under `.claude/commands/`. Each skill is a self-contained procedure — agents invoke them via the Skill tool. Skill use is salience-driven: when `SUGGESTED SKILLS:` appears in additionalContext, score-≥0.7 matches are invoked automatically. Manual invocation (`/skill:name`) always overrides.

### Hooks

57 automated hooks (54 enabled by default) registered via `framework/hooks.registry.json`. Hooks fire on lifecycle events: SessionStart, PreToolUse, PostToolUse, Stop, etc. Build them: `node scripts/hooks/build.js`. Test: `node scripts/hooks/test.js`. The registry is the single source of truth — `.claude/settings.json#hooks` is derived from it.

### Paths registry

`.claude/paths.json` is the canonical location resolver. Skills, agents, and hooks reference `paths.X` keys (e.g. `paths.eventsFile`, `paths.learningsFile`, `paths.sprintCurrent`) **never** literal strings. Renames propagate from one registry edit. The `path-guard.js` hook warns on stale literals; `path-lint.js` exits non-zero on criticals.

### Memory & learning

| Store | `paths.*` key | Purpose |
|-------|---------------|---------|
| Events | `paths.eventsFile` | Append-only log via `logger.js` |
| Learnings | `paths.learningsFile` | Semantic memory (consolidated by `/sleep:deep`) |
| Traces | `paths.tracesFile` | Reasoning episodes |
| Recurring issues | `paths.recurringIssuesFile` | Patterns that repeat across sessions |
| Decisions | `paths.decisionLedger` | Class-B/C decisions with rationale |

Session memory under `.claude/project/memory/` is gitignored — local to a developer machine. Cross-session continuity is handled by handoff documents (`paths.handoffLatest`) and the SessionStart hook auto-loads the most recent.

### Provider routing

Review and security agents run on a *different* AI provider than the one generating code — same-model review is blind to shared failure modes. Default mapping:

| Agent class | Provider | Rationale |
|---|---|---|
| Builder, Fixer, Alpha, Beta, Gamma, Delta, Epsilon | Claude | Code generation + orchestration tuned to Claude |
| Evaluator, Compliance, Auditor, QA | OpenAI (Codex CLI) | Deep review with different lens |
| Red Team | Gemini | Different adversarial training corpus |

Configured in `.claude/manifest.json#agentProviders`. Missing provider CLI → graceful fallback to Claude (logged honestly via `actualModel` strict assertion, not silently downgraded).

## Conventions

### Dispatch agents via `scripts/dispatch-agent.js`

Build-chain agents are dispatched via `node scripts/dispatch-agent.js <role> <prompt-file>` (or the documented `claude -p --agent <role>` Claude fallback). Raw `codex exec`, `gemini -p`, or `cat … | codex|gemini|claude` calls from Bash are blocked by the `dispatch-route-guard.js` hook — closes the LRN-2026-04-17 Windows-stdin and LRN-2026-04-30 binding-gap classes. Full rules: `.claude/agents/_system/guides/agent-dispatch-guide.md`.

### Every policy needs a named enforcer

Rules without enforcement become aspirational and decay. When writing a rule (skill, doc, hook spec, agent prompt, ADR), name what makes a violation self-detecting: hook, test, schema validator, CI check, agent contract clause, release gate, script that exits non-zero. If nothing detects violations, log to `paths.enforcementDebt` via `/enforcement:log` so the gap is visible. The aspirational-vs-enforced pattern recurs across sprints (routing policy, ledger discipline, beta consultation) — solving it at write-time is upstream of solving it sprint-by-sprint.

### Refactor & rename hygiene

Before deleting a file referenced across the project: `grep` for the basename across all `.md`/`.json`/`.js` files. Before completing an identifier rename: `grep` for ALL occurrences of the OLD literal across the entire codebase, not just the file you remember. Lib-only fixes don't protect against bypassing callers — pair every transport-level fix with a guard hook + a dispatch-contract clause in the agents who'd call it.

## Environment & dev

### What you need

- Claude Code (Anthropic CLI)
- Node.js 18+
- Git
- Optional: OpenAI Codex CLI (`@openai/codex`) for review-agent diversity
- Optional: Google Gemini CLI (`@google/gemini-cli`) for redteam diversity

### Daily skills

| Skill | What it does |
|-------|--------------|
| `/warp:health` | Verifies install; reports green/yellow/red per system |
| `/warp:tour` | Guided introduction |
| `/sprint:plan` | Front door for the sprint workflow |
| `/fix:fast` / `/fix:deep` | Quick / framework-driven debugging |
| `/session:handoff` | Generate rich handoff for the next session |
| `/commit:land` | Commit + push branch + merge into the default branch |
| `/sleep:deep` | End-of-day consolidation cycle |

### Verifying drift

| Skill | Scope |
|-------|-------|
| `/scan:architecture` | Layer connectivity |
| `/scan:references` | Broken cross-file links |
| `/scan:requirements` | Spec consistency + drift |
| `/scan:system` | System inventory vs manifest |
| `/scan:patterns` | Cross-run intelligence — what keeps recurring |

## Git rules

- Never kill or overwrite backup branches
- Main branch stays shippable at all times
- Branches for features/fixes/experiments — `main` is never the work tree
- Push to remote requires explicit approval (`/commit:land` confirms before pushing + merging)
- Never skip hooks (`--no-verify`) — fix the underlying issue
- Force push only after destructive-action approval

See `CLAUDE.md#Autonomy` for the full decision-rights table.

## Compliance

- Repo is public; privacy gate (`/scan:privacy`) runs before every public push
- API keys server-side only — never committed
- Cross-provider diversity for review agents is mandatory (configured in `manifest.json`)
- Session-local memory (`.claude/project/memory/`, `.claude/runtime/`) is gitignored
- Capsules under `framework/releases/<X.Y.Z>/` are reproducible from canonical source — no hand-edits
