# Agentic System — Reference

> **Reference doc.** The operational source for agent specs and dispatch logic is `.claude/agents/`. Update both this doc AND the operational source when changing system behavior.

## Who is Alex?

Alex is the AI operating system you talk to in this project. Alex is not one agent — it's the orchestrator (Alpha), judgment (Beta), build orchestrators (Gamma adhoc, Delta oneshot), plus the workers each spawns. Memory, hooks, skills, and reasoning frameworks are all part of Alex.

## Agent topology

```
You ──► Alpha (α)  ──► consults Beta (β) for judgment
         │
         ├─► Solo: Alpha works directly
         │
         ├─► Adhoc: Alpha dispatches Gamma (γ) ──► builder, reviewer, fixer, compliance
         │
         └─► Oneshot: Delta (δ) IS the session ──► state-machine driven full skeleton
```

| Agent | File | Responsibility |
|---|---|---|
| Alpha | `.claude/agents/00-alex/alpha.md` | Architect, spec creator, orchestrator (the main session) |
| Beta | `.claude/agents/00-alex/beta.md` | Read-only judgment, returns DECIDE / DIRECTIVE / ESCALATE |
| Gamma | `.claude/agents/00-alex/gamma.md` | Adhoc build orchestrator for single features |
| Delta | `.claude/agents/00-alex/delta.md` | Oneshot orchestrator — standalone, runs full skeleton autonomously |

## Build pipeline (oneshot)

1. **Build** — builders run in parallel worktrees, one per feature
2. **Snapshot** — Boss (Delta) hashes builder output files
3. **Gauntlet** — reviewer + compliance + security run **in parallel**
4. **Wait gate** — all 3 must finish before fix or next phase
5. **Fix** — unified fix brief, max 3 retries, targeted re-review on changed files only
6. **Points** — 30-point scoring per feature
7. **Lead/Learner** — analyzes everything, max 3 rule changes + 1 spec patch per cycle, adjusts environment for next cycle

State machine: `building → builders-merged → reviewing → review-complete → fixing → points-done → lead → cycle-complete`. Enforced by `cycle-enforcer.js` — cannot skip steps.

## Gauntlet (3-reviewer gate)

Three reviewers run **simultaneously**, each using a different tool to avoid blind spots:

| Reviewer | Tool | What it catches |
|---|---|---|
| Reviewer (formerly Evaluator) | Claude (Opus/Sonnet) | Structural, grounding, coverage, design compliance, code quality |
| Compliance | Codex or Gemini | Branch theft, phantom completion, dropped requirements, hygiene, hallucinated deps |
| Security | Claude | OWASP Top 10, auth boundaries, prompt injection, rate limit coverage |

`compliance.pass = false` if ANY phantom completion or dropped requirement found — hard gate.

## Hooks

Hooks enforce rules agents cannot bypass. Exit code 2 blocks the action. Full registry: `.claude/manifest.json` + `scripts/hooks/`. Categories:

- **PreToolUse Edit/Write**: `secret-guard.js`, `foundation-guard.js`, `ownership-guard.js`
- **PreToolUse Agent**: `gate-check.js`, `gauntlet-gate.js`, `cycle-enforcer.js`, `worktree-preflight.js`
- **PostToolUse Edit/Write**: `edit-watcher.js`, `format.js`, `lint.js`, `typecheck.js`
- **UserPromptSubmit**: `smart-context.js` (Haiku enrichment + memory injection), `prompt-logger.js`
- **Lifecycle**: `session-start.js`, `session-stop.js`, `compact-saver.js`, `create-worktree-from-head.js`

## Memory

Persistent stores in `.claude/project/memory/`:

| File | Stores | Used for |
|---|---|---|
| `learnings.jsonl` | Validated facts, corrections, patterns | Injected into every prompt by smart-context |
| `traces.jsonl` | Reasoning episodes (framework, decision, outcome) | Sleep cycle reviews for retroactive quality scoring |
| `modifications.jsonl` | Self-changes (hook edits, spec patches) | Validated during `/learn:integrate` |
| `systems.jsonl` | Active systems registry | `/maps:systems`, session-start health checks |

## Context scoping

Each agent type sees a different slice (prevents leaks, keeps focus):

| Agent | Receives | Excluded |
|---|---|---|
| Boss / Delta | `store.json`, specs, dependency tree | App source code, golden fixtures |
| Builder | PRD, STORIES, FLOW_SPEC, COPY, HYGIENE, foundation spec | Reviewer rubric, golden fixtures, other builders' output |
| Reviewer | Golden fixtures, step expectations, builder output | Other builders, learner analysis |
| Compliance | Builder diff, acceptance criteria, hygiene rules | Golden fixtures, reviewer rubric |
| Security | Full codebase (read-only), security checklist | Reviewer results, golden fixtures |
| Learner | Everything | Nothing |

## Self-improvement loop

```
DO WORK → /learn:deep → /sleep:deep → /retro:full → /evolve:scan → smart-context injects learnings → DO WORK (better)
```

Learnings flow: `logged → validated → implemented`. Target active pool: 60-100. Sleep consolidates duplicates and prunes stale.
