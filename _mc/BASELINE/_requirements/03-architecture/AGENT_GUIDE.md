# Agent Guide — Reference

> **Reference doc.** The operational source for agent definitions is `.claude/agents/`. Update both this doc AND the operational source when changing agent roles.

## Layout

| Layer | Path | Contains |
|---|---|---|
| Alpha (orchestrator) | `.claude/agents/00-alex/alpha.md` | Identity, reasoning, autonomy boundaries — Alpha IS the main Claude Code session |
| Beta (judgment) | `.claude/agents/00-alex/beta.md` | DECIDE / DIRECTIVE / ESCALATE protocol, read-only |
| Gamma (adhoc orchestrator) | `.claude/agents/00-alex/gamma.md` | Single-feature builds with builder + reviewer + compliance gauntlet |
| Delta (oneshot orchestrator) | `.claude/agents/00-alex/delta.md` | Full skeleton runs with state machine + cycles + points |
| Adhoc role briefs | `.claude/agents/01-adhoc/{builder,reviewer,fixer,compliance,qa,redteam}/*.md` | Prompts for the gauntlet workers Gamma dispatches |
| Oneshot role briefs | `.claude/agents/02-oneshot/{builder,reviewer,fixer,compliance,redteam,learner,stub-scaffold}/*.md` | Prompts for the gauntlet workers Delta dispatches |
| Cross-cutting | `.claude/agents/.system/` | Protocols, dispatch guides, oneshot tokens |

## Build modes

| Mode | Composition | Use when |
|---|---|---|
| Solo | Just Alpha + user | Quick one-off tasks, no agent infra |
| Adhoc (default) | Alpha + Beta + Gamma | Single-feature development with quality gates |
| Oneshot | Delta runs standalone | Full skeleton builds — Delta IS the session, not spawned by Alpha |

## Read order for builders (per feature)

1. `_requirements/03-architecture/FLOW_SPEC.md` — entry/exit states, gates, parallelism
2. `_requirements/03-architecture/PROMPT_TEMPLATES.md` — Claude prompt contracts (if feature calls Claude)
3. `_requirements/03-architecture/API_SURFACE.md` — route specs, rate limits, billing
4. `_requirements/04-features/{slug}/PRD.md` — Section 8 is the primary build guide
5. `_requirements/04-features/{slug}/STORIES.md` — granular acceptance criteria (the contract)
6. `_requirements/04-features/{slug}/COPY.md` — exact user-facing strings
7. `_requirements/04-features/{slug}/INPUTS.md` — controls, validation, data contracts

## Authoritative sources (when docs disagree)

| Topic | Authoritative doc |
|---|---|
| Rate limiting | `SECURITY.md` |
| Persistence / storage | `PERSISTENCE.md` |
| CSRF / origin validation | `VALIDATION_RULES.md` |
| Env vars | `CLAUDE.md` |
| Prompts | `PROMPT_TEMPLATES.md` |
| Agent identity | `.claude/agents/00-alex/{alpha,beta,gamma,delta}.md` |
| Agent dispatch protocol | `.claude/agents/_system/guides/agent-dispatch-guide.md` (canonical; `paths.agentDispatchGuide`) |

## Hygiene

Builders should read `.claude/agents/.system/oneshot/retros/{latest}/HYGIENE.md` before coding — patterns from prior runs that prevent repeat bugs.
