---
description: Review a completed /karpathy:run and merge its winning artifact(s) into main — only command that touches the live codebase from a karpathy run.
---

# /karpathy:integrate — Land the winning variant

Takes a completed `/karpathy:run <run-id>`, shows its winning diff against `main`, and on explicit human approval merges just the target file(s) into a normal feature branch off `main`. Nothing else crosses from the run worktree into the project.

## Input

`$ARGUMENTS` — a run ID. If empty, list recent run dirs under `paths.karpathyRuns` and ask the user to pick (this is an integration decision, not an execution decision — `AskUserQuestion` is appropriate).

## Phase 0 — Resolve paths

```bash
KARPATHY_BASE=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.claude/paths.json','utf8')).karpathyRuns)")
EVENTS_FILE=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.claude/paths.json','utf8')).eventsFile)")
RUN_ID="$ARGUMENTS"
RUN_DIR="$KARPATHY_BASE/$RUN_ID"
BRANCH="karpathy-run/$RUN_ID"
PROJECT_ROOT=$(git rev-parse --show-toplevel)
WORKTREE_PATH="$PROJECT_ROOT/../$(basename $PROJECT_ROOT)-karpathy-$RUN_ID"
```

Verify: run dir exists, branch exists, worktree exists, `log.jsonl` has a `run_stopped` event. If any missing, refuse to integrate and explain.

## Phase 1 — Summarize

Read `$RUN_DIR/log.jsonl` + `$RUN_DIR/results.tsv`. Produce a one-page summary:

```
# Integration Review — <run-id>

## Results
- Iterations:  <N> (<accepted>/<rejected>)
- Baseline:    <baseline_score>
- Best:        <best_score> (Δ +<delta>)
- Wall-clock:  <duration>
- Cost:        $<actual>
- Stop reason: <reason>
- Flags fired: <entropy, budget, …>

## Winning diff
Target: <file>
<unified diff, truncated to 80 lines, with "(N lines omitted)" marker>

## Fixture scores (final iteration)
| Fixture | Pass | Score |
|---|---|---|
…

## Recommendation
<auto-analysis: ACCEPT / REJECT / PARTIAL based on delta, flags, fixture coverage>
```

## Phase 2 — Confirm

Ask the user explicitly:

> Integrate this winning diff into main? The change affects `<file>`. A feature branch `karpathy-<run-id>-integrate` will be created off current main; you can review/PR it before merging further. [approve / reject / partial <list of fixtures to keep>]

This is the gate. If the user declines, log a `karpathy.integrate_rejected` event to `$EVENTS_FILE` and stop. Do not delete the worktree (user may want to resume).

## Phase 3 — Integrate (on approval)

```bash
# From main checkout (not the worktree)
cd "$PROJECT_ROOT"
git fetch .  # no-op but ensures branch is locally visible
git checkout -b "karpathy-$RUN_ID-integrate" main

# Cherry-pick only the target file(s) — never history/, never fixtures, never scripts
git checkout "$BRANCH" -- <target_file>

# Verify the diff matches what the user approved
git diff --cached <target_file>
```

Commit with provenance:

```bash
git commit -m "karpathy(<run-id>): integrate winning variant

Run:        <run-id>
Domain:     <domain>
Iterations: <N>
Score:      <baseline> → <best> (Δ +<delta>)
Target:     <file>
Cost:       \$<actual>

Full log:  $KARPATHY_BASE/<run-id>/log.jsonl
"
```

Emit `karpathy.integrated` event to `$EVENTS_FILE` with the run ID, target file, baseline→best delta, and integrating commit SHA.

## Phase 4 — Cleanup policy (opt-in, not automatic)

After integration, the worktree + branch are preserved by default. The user can:
- Keep running more experiments off the same branch
- Run `/karpathy:discard <run-id>` to remove worktree + branch + (optionally) run dir
- Leave everything for audit

Never auto-delete. The run dir is the provenance record.

## Constraints

1. **Only touches `main` checkout via a new feature branch.** Never merges into `main` directly.
2. **Only the target file crosses over.** Fixtures, scripts, logs stay in the run dir — they are experiment artifacts, not product code.
3. **Explicit human approval required.** This is the one place in the autoresearch pipeline where a question to the user is appropriate.
4. **Provenance preserved.** Commit message + event log both record the run ID so future audits can trace back.
