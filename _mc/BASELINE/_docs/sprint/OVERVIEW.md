# Sprint Workflow v0.2 — Overview

A five-command sprint layer above MC's existing modes. Turns brief
plain-language intent into durable, evidence-labeled, approval-aware
work that survives crashes and integrates with existing requirements,
issues, hooks, and learning systems. As of v0.2 (SP-20260512-001),
multiple sprints can coexist and execute concurrently in isolated
lanes; see `LANES.md`.

## The shape

Two equally valid front doors:

```
                           ── manual per-phase ──
/sprint:plan      → Plan Contract        (the bridge between intent and design)
/sprint:design    → Requirements + Tickets (PRD, stories, COPY, INPUTS, TRACE, AC, QA, redteam, release plan)
/sprint:execute   → Ralph loops          (governed plan/act/test/review/record/checkpoint per ticket)
/sprint:release   → Release record       (final checks, approval, deploy mark, retrospective)
/sprint:retrospective → Post-sprint retro (outcomes, friction, action items)
/sprint:status    → Live sprint list     (read-only view of every active sprint)

                           ── autonomous front door (SP-20260518-001) ──
/sprint:full      → Single invocation, all 5 phases, bounded autonomy preset
                    (conservative | moderate | aggressive)
                    Cannot bypass CLAUDE.md hard ceilings — push to remote,
                    paid services, production deploy, destructive migrations,
                    secrets-to-remote remain operator-only.
```

All commands accept `--sprint <SP-id>` to target a specific sprint;
omitted → registry primary; unknown id → exit non-zero with COPY C-10.

### When to use which front door

| Situation | Front door |
|---|---|
| Small/medium sprint, low keyboard tolerance | `/sprint:full --autonomy moderate` |
| Sprint touches production or paid services | Per-phase commands (manual approval at each gate) |
| You're testing the sprint pipeline itself | Per-phase commands (granular checkpoints) |
| Routine docs/refactor/research sprint | `/sprint:full --autonomy moderate` |
| First time on a new product surface | Per-phase commands (read what the helpers do) |
| You want to ship to staging without per-step approval | `/sprint:full --autonomy aggressive` |
| You want production deploy auto-anything | Not supported. Hard ceiling. Always manual. |

See `_docs/sprint/AUTONOMY.md` for `/sprint:full` preset semantics.

## Why it exists

A sprint workflow ensures:

1. **No fantasy planning.** Every claim has an evidence level.
2. **No premature ticketing.** Tickets are minted from designed
   requirements, not chat impulses.
3. **No hidden assumptions.** Safe vs unsafe assumptions are separated.
4. **No untracked external services.** Signup, billing, credentials,
   OAuth, DNS, and compliance are first-class.
5. **No accidental execution.** Approval boundaries are recorded.
6. **No lost progress.** Checkpoints in files, not chat.
7. **No scope creep.** Ralph loops stop when scope expands.
8. **No mode coupling.** Sprint state is mode-independent.

## Where sprint state lives

All live sprint state lives in the **downstream product repo**:

```
.claude/project/sprint/                    (paths.sprintRoot)
  active-sprints.yaml                       (paths.sprintActiveRegistry — v0.2)
  sprints/<SP-id>/current.yaml + progress.yaml  (per-sprint state — v0.2)
  ...
issues.md                                   (paths.sprintIssuesLedger, repo root)
```

Legacy v0.1 installs keep `current-sprint.yaml` + `sprint-progress.yaml`
at the sprint root with `layout: legacy_root` in the registry. Run
`scripts/sprint/migrate-v0.2.js` to move them.

The MC **framework** repo ships templates + schemas + commands +
docs — no live tracker state.

## Adopting sprint v0.1

In a downstream product repo that has MC installed:

```bash
node scripts/sprint/init.js --project "my-product"
```

This creates the tracker tree from the templates. Re-runnable; refuses
to clobber existing files unless `--force`.

Then:

```text
/sprint:plan "<brief plain-language request>"
```

## Integrations

| Integration | How sprint uses it |
|---|---|
| `paths.recurringIssuesFile` | Sprint v0.1 leaves this alone — it's SYSTEM-recurring issues. Sprint product issues live in `paths.sprintIssues`. |
| `paths.requirementsRoot` (`_requirements/`) | Per-feature PRDs at `_requirements/04-features/<feature>/PRD.md` are the canonical home for feature requirements. Sprint requirements link to them. |
| `scripts/hooks/requirement-format-guard.js` | Enforces `R-N`/`S-N`/`H-N`/`CS-N` id formats on sprint-generated requirement files. Templates carry `<!-- requirement-format-legacy -->` so placeholders don't fight the guard. |
| `paths.eventsFile` (`logger.js`) | Sprint commands emit structured events (`sprint.plan.created`, `sprint.ticket.opened`, etc.) — same logger, same store. |
| `paths.decisionLedger` | Sprint commands record Beta and routing decisions here. |
| `paths.learningsFile` | `/sprint:release` surfaces learning candidates that go through the existing `/learn:integrate` promotion flow. |
| `paths.providerFallbackPolicy` (Phase 0) | Sprint routing declares classes; actual provider selection respects this. |
| `paths.dispatchLocks` etc. (Phase 0) | Sprint commands dispatch via `scripts/dispatch-agent.js` like everything else. |
| `/mode:adhoc` stale-team classification (Phase 0) | Sprint tracker is the durable task-truth source; team-task ownership is ephemeral. |

## Build-mode awareness

Sprint commands run in solo, adhoc, and oneshot, but mode invocation
stays user-controlled. The Plan Contract's `recommended_mode` is
advisory; sprint never auto-switches modes.

## What sprint v0.1 explicitly does NOT do

- It does NOT build a Jira clone.
- It does NOT sync to Linear / Jira / GitHub Issues (this pass).
- It does NOT replace existing modes.
- It does NOT retune `/mode:oneshot` (out of scope per the prompt).
- It does NOT install new provider SDKs.
- It does NOT hard-code product-specific behavior.
- It does NOT store live tracker state in the framework repo.
- It does NOT make production deploys automatic.
- It does NOT create dozens of user-facing skill commands (just four).
- It does NOT skip docs or hide bugs.
- It does NOT let tickets float above requirements.

## Reading order

1. `OVERVIEW.md` (this file)
2. `paths.sprintReference` (`.claude/project/reference/sprint-workflow.md`)
3. `FRAMEWORK_VS_DOWNSTREAM.md`
4. `DOWNSTREAM_ADOPTION.md`
5. `CRASH_RECOVERY.md`
6. `MODE_RELATIONSHIP.md`
7. `MODEL_ROUTING.md`
8. `EXTERNAL_SERVICES.md`
9. `TICKET_MODEL.md`
10. `ISSUES_MD.md`
11. `RALPH_LOOP.md`
