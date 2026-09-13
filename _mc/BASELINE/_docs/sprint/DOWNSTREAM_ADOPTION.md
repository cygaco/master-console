# Sprint v0.1 — Downstream Adoption Guide

For a product repo that already has MC installed (version 0.3.x or
later) and wants to opt in to the sprint workflow.

## Preconditions

- MC framework version is 0.4.0 or later (`paths.manifest`).
- The repo is on a working branch with no uncommitted work you'd hate
  to merge with.
- You've read `OVERVIEW.md` and `FRAMEWORK_VS_DOWNSTREAM.md`.

## Step 1 — Update MC

```text
/mc:update --apply
```

This installs the new sprint framework assets:

- `framework/templates/sprint/**`
- `schemas/sprint/**`
- `scripts/sprint/**`
- `.claude/commands/sprint/**`
- `.claude/project/reference/sprint-workflow.md`
- `.claude/agents/00-alex/.system/policy/sprint-routing.json`
- New `paths.sprint*` keys in `.claude/paths.json`

Confirm with:

```bash
node scripts/sprint/validate.js
node scripts/sprint/routing.js validate
```

Both should report ok.

## Step 2 — Initialize the tracker

```bash
node scripts/sprint/init.js --project "my-product"
```

This creates:

- `.claude/project/sprint/` directory tree
- `current-sprint.yaml` (status: `not_started`)
- `sprint-progress.yaml` (status: `starting`)
- `issues.md` at repo root (stub bug inbox)
- `.claude/project/sprint/README.md`

Re-run safely. The script refuses to overwrite existing files unless
`--force`.

## Step 3 — Tell git about the tracker

The tracker is runtime state, not source. Update your `.gitignore` to
keep secrets out, but tracker yaml files themselves are generally
checked in (they're the audit trail).

Suggested `.gitignore` entries:

```
.claude/project/sprint/ralph/**/*.lock
.claude/project/sprint/**/.tmp/
```

Keep `current-sprint.yaml`, `sprint-progress.yaml`, plan-contracts,
tickets, issues, releases, approvals, history — those ARE the durable
record.

## Step 4 — Plan your first sprint

```text
/sprint:plan "<brief plain-language request>"
```

Example:

```text
/sprint:plan "Add a daily-digest email summarizing user activity."
```

Read the Plan Contract that gets written under
`.claude/project/sprint/plan-contracts/<PC-id>.yaml`. Walk through the
plan-quality status, scope variants, assumptions, and the
next-recommended-command.

## Step 5 — Design

```text
/sprint:design
```

Hand-edit the rendered files under
`.claude/project/sprint/requirements/<sprint-id>/`. Remove the
`<!-- requirement-format-legacy -->` marker from a file once it has
real `R-N`/`S-N`/`H-N` ids — then the requirement-format-guard will
keep them valid going forward.

Mint tickets from each granular story via
`scripts/sprint/ticket.js create`. Mint ESDs via
`scripts/sprint/external-service.js create`.

## Step 6 — Execute

```text
/sprint:execute
```

Each ticket goes through a Ralph loop. Checkpoint after every loop.
Stop on approval boundaries, ESD blockers, 3+ failed attempts, scope
expansion, destructive actions, or production-deploy needs.

## Step 7 — Release

```text
/sprint:release
```

Run `release.js check` to compute the checklist. Fill in human-curated
items (release notes, monitoring plan). Record an approval. Deploy
out-of-band; mark with `release.js deploy`. Render the report.

## Step 8 — Recover (if needed)

If a session crashes, read `.claude/project/sprint/sprint-progress.yaml`.
The `resume_command` and `resume_notes` fields tell you exactly what to
run. If `safe_to_continue: false`, investigate the `stop_reason` before
resuming.

## Conventions to keep

- **Tickets sit below requirements.** No tickets without a linked
  story/AC/PRD pointer.
- **External services have ESDs.** Anything that requires signup,
  billing, OAuth, DNS, or compliance is an ESD record before a ticket.
- **Issues.md and sprint/issues/ stay in sync.** `scripts/sprint/issue.js`
  is the single writer.
- **3-attempt rule.** A bugfix that fails 3 times gets deferred or
  abandoned (unless it blocks the sprint).
- **Checkpoint discipline.** Write a checkpoint at every meaningful
  step — sprint state should be reconstructable from files alone.

## What you do NOT need to change

- `/mode:solo`, `/mode:adhoc`, `/mode:oneshot` continue to work exactly
  as before. Sprint commands do not auto-switch modes.
- `_requirements/04-features/<feature>/PRD.md` (your existing
  per-feature PRDs) keep being the canonical home for feature
  requirements. Sprint requirements link to them.
- `paths.recurringIssuesFile` continues to be the SYSTEM-recurring
  issues store. Sprint product issues live in
  `paths.sprintIssues` — distinct.
- Existing hooks, agents, learning, reasoning, and dispatch all
  continue to work. Sprint integrates with them; it does not replace
  them.

## Stop opting in

If sprint isn't a good fit for your project, you can:

- Stop running `/sprint:*` commands. Tracker files freeze.
- `git rm -rf .claude/project/sprint/` to remove tracker. Framework
  remains installed; you can re-init later.
- Pin to MC 0.3.x via `/mc:update --to 0.3.0`. The sprint paths
  vanish on next regen.

Sprint v0.1 is additive — opting out is reversible.
