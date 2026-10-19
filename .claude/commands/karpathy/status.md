---
description: Read-only status dashboard for an active or completed /karpathy:run. Shows score curve, flag counts, cost burn, and stop-condition proximity without any side effects.
---

# /karpathy:status — Run status (read-only)

Non-destructive. Reads only. Never mutates the run dir, the worktree, the branch, the events log, or anything else. Safe to invoke any time — including mid-iteration.

## Input

`$ARGUMENTS` — a run ID. If empty, list recent runs under `paths.karpathyRuns` (sorted by last-modified `log.jsonl`) and show the most recent by default.

## Phase 0 — Resolve paths

```bash
KARPATHY_BASE=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.claude/paths.json','utf8')).karpathyRuns)")
RUN_ID="${ARGUMENTS:-$(ls -t $KARPATHY_BASE | grep -v '^_' | grep -v README | head -1)}"
RUN_DIR="$KARPATHY_BASE/$RUN_ID"
```

If `$RUN_DIR` doesn't exist: say so and list the 5 most recent runs. Do not fall back silently.

## Phase 1 — Read what's there

Read (never write):
- `$RUN_DIR/config.yaml` — budget + stop-condition thresholds
- `$RUN_DIR/program.md` — strategy spec (first 10 lines for context)
- `$RUN_DIR/log.jsonl` — every entry
- `$RUN_DIR/results.tsv` — scoreboard

From `log.jsonl`, compute:
- Total iterations completed
- Accepted vs rejected count
- Best score + iter at which it landed
- Current score (last accepted)
- Cumulative `cost_usd` from all per-iter entries
- Cumulative `wall_clock_s`
- All session-level events (`run_started`, `run_stopped`, `budget_exceeded`, `mode_collapse_detected`, `evaluator_lock_violation`, `user_stopped`, `plateau_reached`)
- Flag-count histogram across all iters (`entropy_ok`, `entropy_dropped`, `cost_cap_*`)
- Is the run currently running? → check for `run_started` without a matching `run_stopped`

## Phase 2 — Render the dashboard

```
═══════════════════════════════════════════════════════════════════
  KARPATHY RUN STATUS: <run-id>
═══════════════════════════════════════════════════════════════════
  State:         <running | paused | completed | aborted | failed>
  Description:   <from program.md first line>
  Domain:        <from config.yaml>
  Target:        <from config.yaml>

  Progress
    Iterations:    <N> / <max_iters>          (<accepted>/<rejected>)
    Best score:    <best> (iter <K>)          baseline=<baseline>
    Current score: <latest accepted score>
    Plateau:       <iters since best changed> / <plateau_iters threshold>

  Budget
    Cost:          $<actual> / $<cap>          (<pct>%)
    Wall-clock:    <h>h <m>m / <h_cap>h
    Per-iter avg:  $<avg>  <s>s

  Flags (cumulative)
    entropy_ok:         <count>
    entropy_dropped:    <count>   ← if >0, mode collapse is approaching
    cost_cap_80pct:     <count>
    eval_lock_violation: <count>   ← if >0, THIS IS FATAL. run should have stopped.

  Session events
    <ts>  run_started
    <ts>  plateau_reached            (if any)
    <ts>  budget_exceeded            (if any)
    <ts>  mode_collapse_detected     (if any)
    <ts>  run_stopped        reason=<reason>

  Stop-condition proximity (lower = closer to stopping)
    iters:      <max_iters - N>
    cost:       $<cap - actual>
    wall-clock: <h_cap*3600 - cumulative>s
    plateau:    <plateau_iters - iters_since_best> (Δ < 0.01)

  Recent iters (last 5)
    iter  score   decision   cost    wall   flags
    17    0.73    accepted   $0.04   287s   entropy_ok
    16    0.69    rejected   $0.04   271s   entropy_ok
    …

  On-disk artifacts
    Log:       <path>  (<N> entries, last updated <ts>)
    Results:   <path>  (<N> rows)
    Worktree:  <path>  (current branch: <branch>, commits: <K>)

  Controls
    touch <run-dir>/.stop       — graceful stop after current iter
    /karpathy:integrate <run-id> — land the winning variant (main checkout)
    /karpathy:discard <run-id>   — remove worktree + branch + run dir (irreversible)
═══════════════════════════════════════════════════════════════════
```

## Constraints

1. **Zero side effects.** No writes. No appends. Not even to the events log. Status is observation, not action.
2. **Works mid-run.** The runner holds `log.jsonl` open for append; status reads the file fresh on each invocation. Partial-line safety: treat the last line as potentially incomplete and skip it if it fails to parse.
3. **No LLM summarization.** The dashboard is computed mechanically from the log. No "how's it going?" interpretation — just numbers.
4. **Every path from `paths.json`.** No literals.
