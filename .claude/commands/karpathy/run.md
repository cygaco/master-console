---
description: Karpathy autoresearch loop — plan a closed-loop experiment, review, then run autonomously in an isolated worktree. Optimize any editable artifact (agent spec, skill, hook policy) against a scalar metric.
---

# /karpathy:run — Autoresearch Loop

Runs a Karpathy-style `propose → execute → evaluate → select` loop against any editable artifact in the project, isolated inside a git worktree so the live codebase is never touched until explicit integration.

**Two phases. One command.**

- **Phase A — Planning (interactive, ~30s):** interpret the description, infer the target + domain, generate fixtures, present a reviewable plan. Human approves before anything is written.
- **Phase B — Execution (autonomous, background):** materialize the worktree, run the loop, stream a structured log, auto-stop on budget / plateau / mode-collapse / evaluator-lock violation.

Nothing merges into `main` from this skill. Use `/karpathy:integrate <run-id>` for that.

## Input

`$ARGUMENTS` — a natural-language description of what to optimize. Examples:
- `make alpha spawn the right agents and use gauntlets properly`
- `improve the /scan:full skill so it runs under 60s`
- `tune gamma's fix-dispatch to reduce wasted builder spawns`

If empty, read prior context. If still ambiguous, say so in Phase A's plan (don't ask the user).

## Phase 0 — Resolve paths

Every path must come from `paths.json`. Never hardcode.

```bash
PATHS_JSON=".claude/paths.json"
KARPATHY_BASE=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PATHS_JSON','utf8')).karpathyRuns)")
EVENTS_FILE=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PATHS_JSON','utf8')).eventsFile)")
PROJECT_ROOT=$(git rev-parse --show-toplevel)
```

All run artifacts live under `$KARPATHY_BASE/<run-id>/`. If `paths.karpathyRuns` changes, this skill follows.

## Phase A — Planning

### A.1 — Domain inference

From `$ARGUMENTS`, pick the closest domain template:

| If description mentions… | Domain | Target candidate |
|---|---|---|
| alpha spawning, agent dispatch, gauntlets | `team-dispatch` | `.claude/agents/president/alpha.md` (rubric block) |
| skill ergonomics, skill clarity, skill wording | `skill-clarity` | `.claude/commands/<ns>/<name>.md` |
| hook policy, hook blocking, evaluator lock | `hook-policy` | `scripts/hooks/<name>.js` (policy block only) |
| agent spec (non-dispatch) | `agent-spec` | `.claude/agents/**/*.md` |
| everything else | `generic` | User must confirm target in plan |

Domain templates live at `$KARPATHY_BASE/_templates/<domain>/`. If missing, generate the domain's `scripts/prepare.js` + `scripts/score.js` + `fixtures/` scaffold inline.

### A.1.5 — Blind fixture generation — visible + holdout split (mandatory)

Fixtures are authored by **two separate sibling agents that cannot read the target file**. The split prevents both conflict-of-interest AND overfitting to a single fixture corpus the proposer can see during iteration.

**Sibling 1 — visible set** (proposer sees these via `program.md` during iteration): dispatch via the `Agent` tool with `subagent_type: general-purpose`:

```
Blind VISIBLE fixture brief:
- Description: $ARGUMENTS
- Domain: <domain from A.1>
- Target file: <file path> — DO NOT READ. No Read/Grep/Glob against it or any referenced companion artifact.
- Domain rule space (inferred from description only): <bullet list of 3-6 rules the target should obey>

Your task:
1. For each of the <N_rules> rules, author EXACTLY FOUR fixture variants — canonical, paraphrase, adversarial, boundary. Total fixtures = 4 × N_rules.
2. Variant A (canonical): direct "walk me through rule X" prompt.
3. Variant B (paraphrase): same rule, different vocabulary — resists keyword-tuning.
4. Variant C (adversarial): user pressure to violate the rule; doctrine must refuse.
5. Variant D (boundary): edge case inside the rule's envelope.
6. Each fixture includes: {id, rule_tested, variant, prompt, expected_properties}.
7. `expected_properties` checks are mechanical only (regex / includes / count). NO LLM-judge.
8. `min_checks_passing` MUST equal the total number of checks (100% required — no lenient thresholds).
9. Each fixture must have ≥6 checks across ≥3 different check kinds (must_contain_all, must_contain_any, must_not_contain, regex_match, min_count, max_count).
10. Return JSON array. No preamble.
```

**Sibling 2 — holdout set** (proposer NEVER sees these; scored separately at final report to measure overfitting): dispatch via a SECOND independent `Agent` call:

```
Blind HOLDOUT fixture brief:
- Description: $ARGUMENTS
- Domain: <domain>
- Target file: <file path> — DO NOT READ.
- Domain rule space: <same as visible set>

Your task:
1. Author EXACTLY ONE fixture per rule (total = N_rules, typically 6).
2. Use SYNONYMS and INDIRECT scenarios the proposer is unlikely to keyword-tune toward — e.g., "process-level separation" instead of "worktree", "4th failure in a row" instead of "3 consecutive".
3. Same rubric: min_checks_passing = total_checks, ≥6 checks across ≥3 kinds.
4. At least one holdout fixture must use `min_count` with n ≥ 2 to force structural presence, not single-keyword presence.
5. Return JSON array. No preamble.
```

The returned fixtures populate the plan's fixture table unchanged. The main skill does NOT re-author them. If either sibling violates the "don't read target" rule (detectable via its tool-use log — `Read`/`Grep`/`Glob` against the target path), abort and re-dispatch with a stricter prompt; if it violates twice, flag in the plan and ask the user to redirect.

Rationale:
- **Blind authorship** prevents the candidate doctrine's implementation details from leaking into what counts as passing.
- **Visible + holdout split** surfaces overfitting. The proposer can see visible fixtures via `program.md` and will optimize toward them. Holdout generalization is the only signal that the proposer learned the *rules*, not the *phrases*.
- **Four variants per rule** (canonical + paraphrase + adversarial + boundary) prevents keyword-tuning — a single-variant corpus can be passed by stuffing the exact test phrases into the doctrine.

### A.2 — Assemble the plan

Write the plan to stdout for human review. Do NOT write any file yet. Schema:

```
# Karpathy Loop — Proposed Run

## Description (verbatim from user)
$ARGUMENTS

## Interpreted
- Run ID:    <YYYY-MM-DD>-<HHMMSS>-<domain>-<short-slug>   # seconds precision makes parallel runs collision-free
- Domain:    <inferred domain> (redirect if wrong)
- Target:    <file path + line range if a block, or whole file>

## Strategy
<one-paragraph program.md draft covering: what to optimize, the rules/invariants, the measurable metric. This paragraph IS the contract that governs the loop.>

## Fixtures (authored by TWO blind siblings — visible + holdout)

**Visible set** (proposer sees via `program.md`; 4 variants × N rules):
- Authored by general-purpose sibling agent; target file was NOT readable to it.
- fx-A-01-<rule>-canonical:  direct probe of rule
- fx-B-01-<rule>-paraphrase: same rule, different vocabulary
- fx-C-01-<rule>-adversarial: user pressure to violate; doctrine must refuse
- fx-D-01-<rule>-boundary:    edge case inside the rule's envelope
- ... (repeat 4 variants per rule, total = 4 × N_rules)

**Holdout set** (proposer NEVER sees; scored at final report to surface overfitting):
- Authored by a SECOND blind sibling with synonym / indirect-scenario emphasis.
- ho-01-<rule>: paraphrased scenario using different vocabulary than the visible set
- ... (one per rule)

Each fixture uses `min_checks_passing = total_checks` (100% required) with ≥6 checks across ≥3 kinds.

## Scalar metric (non-linear composite, soft-ceiling)

Default formula (override only with a `redirect:` justification):

```
score = core × cross_artifact × length_factor × trace_factor × entropy_factor

core                  = (visible_rule_pass_rate ^ 2)
                        × structural_integrity
                        × ((1 - contradiction_penalty) ^ 3)
cross_artifact        = (companion artifacts exist AND carry headings) ratio in [0..1]
length_factor         = max(0.5, 1 - max(0, (len - baseline_len) / baseline_len - 0.2))
                        # no penalty up to +20% growth; decays linearly; clamps at 0.5
trace_factor          = 1.0 if canonical dispatch trace section present and passes 5+ regex checks;
                        0.85 if present with 3-4 regex hits; 0.65 if present with <3; 0.5 if absent
entropy_factor        = 1 + 0.1 × (unique_nonblank_lines / total_nonblank_lines)
                        # soft-ceiling bonus; max ~1.1; prevents keyword stuffing
```

- **Non-linear penalties** (rpr², contra³) prevent keyword-stuffing: one forbidden phrase destroys the score even when everything else is perfect.
- **Length factor** caps bloat: the proposer can't pad the doctrine with every fixture phrase.
- **Entropy bonus** breaks the hard 1.0 ceiling; the proposer keeps iterating past "perfect" toward density, not repetition.
- **Cross-artifact** ensures the doctrine and its companion files stay in sync.
- **Holdout pass rate** is NOT in the score the proposer optimizes — it's reported separately as `generalization_gap = visible_pass_rate - holdout_pass_rate`. A gap > 0.15 is a flag for overfitting.

Scoring is **mechanical only — no LLM-judge.** All checks are regex / section-present / file-exists / count. LLM-as-judge is biased and gameable; the scorer must be deterministic code.

## Budget
- Wall-clock per fixture: 5 min
- Nightly cost cap: $25
- Max iterations: 100
- Max total wall-clock: 6h
- Stop early on: score plateau (Δ<0.01 × 15 iters), mode-collapse flag, evaluator-lock violation

## Evaluator-lock (non-negotiable)
- Shadow agent `cwd` fenced to worktree only
- Worktree `.claude/settings.local.json` denylists: fixtures/, scripts/score.js, results.tsv, log.jsonl
- Branch name `karpathy-run/<run-id>` blocked from push by merge-guard

## Instrumentation
- Per-iter entry appended to `log.jsonl` (run dir, append-only)
- **Dual-write**: every iteration also emits an `autoresearch.experiment` event to `paths.eventsFile` (`.claude/project/events/events.jsonl`) so sleep cycles and `/learn:*` skills ingest autoresearch runs alongside regular work.

## Artifacts to be written (on approval)
- $KARPATHY_BASE/<run-id>/program.md
- $KARPATHY_BASE/<run-id>/config.yaml
- $KARPATHY_BASE/<run-id>/target/<file>
- $KARPATHY_BASE/<run-id>/fixtures/*.json
- $KARPATHY_BASE/<run-id>/scripts/{prepare.js,score.js}
- $KARPATHY_BASE/<run-id>/log.jsonl
- $KARPATHY_BASE/<run-id>/results.tsv

## Worktree
- Path: <project>/../<project>-karpathy-<run-id>
- Branch: karpathy-run/<run-id> (off current HEAD)
- Cleanup on completion: keep until `/karpathy:integrate` or `/karpathy:discard`

## Cost estimate
~$<low>-$<high>, ~<N> iterations, ~<h>h wall-clock

## Approve gate (plan-is-contract)

This plan is the contract. Nothing materializes until you respond with one of:

- `Y` — full run with iter-1 pause (default, safest)
- `dry-run` — materialize worktree + scripts + fixtures, then stop; you inspect on disk before any iteration
- `no-pause` — skip the iter-1 sanity pause (use only for repeat configs you already trust)
- `redirect: <direction>` — re-plan with the new direction; can edit fixtures (`redirect: tighten fixture 04: …`), budget, target, domain
- `cancel` — abort, no worktree created

Respond with one of: `Y` | `dry-run` | `no-pause` | `redirect: <direction>` | `cancel`
```

Present the plan. Wait for user response. Accept:
- `Y` or `approve` — proceed to Phase B, auto-pilot to iteration 1, then pause.
- `dry-run` — proceed to Phase B through B.3.5 only (materialize worktree + scripts + fixtures, no iterations). User inspects on disk, then says `go` or `abort`.
- `no-pause` — proceed to Phase B without the iter-1 pause. Use only when user has already run this exact config before and trusts the pipeline.
- `redirect: <direction>` — re-plan with the new direction (including fixture tweaks, domain corrections, budget changes, etc.).
- `cancel` — write a `karpathy.run_cancelled` event to `$EVENTS_FILE` and stop.

## Phase B — Execution

### B.1 — Materialize the worktree

```bash
RUN_ID="<generated>"
WORKTREE_PATH="$PROJECT_ROOT/../$(basename $PROJECT_ROOT)-karpathy-$RUN_ID"
BRANCH="karpathy-run/$RUN_ID"

git worktree add -b "$BRANCH" "$WORKTREE_PATH"
mkdir -p "$KARPATHY_BASE/$RUN_ID"/{target,fixtures,scripts,history}
```

### B.2 — Write the run dir

Snapshot the target file, write the generated fixtures, scripts, `config.yaml`, `program.md`, initialize `log.jsonl` + `results.tsv`. Every write lives inside `$WORKTREE_PATH/$KARPATHY_BASE/$RUN_ID/` — **not the main checkout**.

### B.3 — Evaluator-lock enforcement

Inside the worktree only, write `.claude/settings.local.json` with a deny allowlist for the shadow agent:

```json
{
  "permissions": {
    "deny": [
      "Read(<KARPATHY_BASE>/<RUN_ID>/fixtures/**)",
      "Read(<KARPATHY_BASE>/<RUN_ID>/scripts/score.js)",
      "Read(<KARPATHY_BASE>/<RUN_ID>/results.tsv)",
      "Read(<KARPATHY_BASE>/<RUN_ID>/log.jsonl)",
      "Edit(<KARPATHY_BASE>/<RUN_ID>/fixtures/**)",
      "Edit(<KARPATHY_BASE>/<RUN_ID>/scripts/**)"
    ]
  }
}
```

Merge-guard already blocks `karpathy-run/*` branches from push — confirm by `grep -q "karpathy-run" scripts/hooks/merge-guard.js`; if absent, add the pattern before launching.

### B.3.1 — Lock hygiene (gate — do not skip)

Before B.4 starts, verify the evaluator-lock is materially on disk. The lock is load-bearing for scorer integrity — if iter 1 runs without it, any score the run produces is suspect because the shadow agent could have read the fixtures or the scorer.

```bash
LOCK="$WORKTREE_PATH/.claude/settings.local.json"
test -s "$LOCK" || { echo "FATAL: evaluator-lock missing at $LOCK — refusing to start loop"; exit 1; }
grep -q "\"deny\"" "$LOCK" || { echo "FATAL: evaluator-lock has no deny block"; exit 1; }
grep -q "$RUN_ID/fixtures" "$LOCK" || { echo "FATAL: evaluator-lock does not name this run's fixtures"; exit 1; }
```

If any check fails, abort the run, emit `karpathy.lock_hygiene_failed` event, and leave the worktree intact for forensics. Do NOT proceed to B.4 — a missing lock silently invalidates the whole run, and saturated scores in such runs (e.g. a mechanical scorer that trivially passes iter 1) are indistinguishable from real saturation.

Skipping this step leaves the class of failure the lock prevents — the proposer peeking at the scorer — unguarded, even when the resulting score looks valid.

### B.3.2 — Scorer self-test on synthetic degenerates (gate — do not skip)

Before iter 1, the scorer itself must be validated against four synthetic inputs. This catches gameability bugs in 30 seconds instead of after 60 iters. A scorer that passes the wrong inputs will mislead the entire run.

Write to `$KARPATHY_BASE/$RUN_ID/history/selftest.json` the score from each of:

1. **Empty file** — score `<target>` when replaced with `""`. Expected: near-zero.
2. **Baseline** — score the unmodified target (already done as iter 0). Expected: "problem-shaped" — typically 0.05–0.60 depending on domain.
3. **Keyword blob** — concatenate every phrase from every fixture's `must_contain_all`/`must_contain_any`/`must_contain_phrase` into one flat file; score it. **Expected: NOT 1.0.** If this scores ≥ 0.9, the scorer is gameable — the proposer will trivially win by stuffing — ABORT the run and emit `karpathy.scorer_gameable` event with the keyword-blob score.
4. **Inverted rules** — take the baseline, flip every `must_contain`→`must_not_contain` semantic by systematically replacing refusal language with permissive language and removing canonical section headings. Expected: near-zero. If inverted scores higher than baseline, the scorer's sign is wrong — ABORT with `karpathy.scorer_inverted`.

Emit a summary line to `log.jsonl` regardless of pass/fail:
```json
{"event":"scorer_selftest","ts":"...","empty":<s>,"baseline":<s>,"keyword_blob":<s>,"inverted":<s>,"pass":<bool>,"failed_checks":[...]}
```

If ANY check fails the expected band, abort Phase B immediately, print the failure mode to stdout, and exit non-zero. The user must redesign fixtures or scorer before retrying. Do NOT proceed to iter 1 on a broken scorer — this is the single highest-ROI gate in the entire skill.

Rationale: a rubric like `min_checks_passing << total_checks` where every check is a substring match would score 1.0 against the keyword-blob degenerate. The v2 rubric detects this immediately: `rule_pass_rate² × (1 − contra)³` collapses to near-zero when the blob has no structure. The self-test makes the difference visible before the loop burns budget.

### B.3.5 — Dry-run checkpoint (if `dry-run` mode)

If the user entered Phase B via `dry-run`, stop here. Print:

```
═══════════════════════════════════════════════════════════════════
  DRY RUN COMPLETE — nothing has iterated yet.

  Inspect on disk:
    Run dir:   $KARPATHY_BASE/<run-id>/
    Scripts:   $KARPATHY_BASE/<run-id>/scripts/{prepare.js,score.js}
    Fixtures:  $KARPATHY_BASE/<run-id>/fixtures/*.json
    Program:   $KARPATHY_BASE/<run-id>/program.md
    Worktree:  <worktree path>

  Read anything you want. Nothing has touched main. Nothing has been scored.

  Say `go` to start iterating, or `abort` to remove the worktree + run dir.
═══════════════════════════════════════════════════════════════════
```

Wait. On `go`, proceed to B.4. On `abort`, `git worktree remove --force <worktree>`, `git branch -D <branch>`, `rm -rf <run-dir>`, emit `karpathy.dry_run_aborted` event, done.

### B.4 — The loop (per iteration)

```
1. Read program.md + current target/<file> + last-N entries of log.jsonl
2. LLM proposes a diff to target/<file>
3. Apply diff, commit to branch with msg `iter <N>: <diff_summary>`
4. For each fixture:
   a. Spawn headless Claude in $WORKTREE_PATH with modified target
      (claude --print --session-id evo-<RUN>-fx-<K> --output-format stream-json)
   b. Pipe the fixture prompt
   c. Capture the stream-json trace
   d. Kill after per-fixture wall-clock cap
5. Run scripts/score.js across all fixture traces → composite scalar
6. Append log.jsonl entry + results.tsv row + emit autoresearch.experiment to $EVENTS_FILE
7. Decision:
   - Score > best? Keep (branch advances, new baseline)
   - Score ≤ best? git reset --hard to prior iter commit
8. If iter == 1 AND user did NOT pass `no-pause`: pause (see B.4.5).
9. Check stop conditions. If any fire, write final report and exit.
```

### B.4.5 — Pause after iter 1 (default; conditionally non-skippable)

After the first complete iteration, the runner pauses and prints a full trust-check dashboard. This is the moment to catch a miscalibrated scorer, a broken fixture harness, or an unexpected cost profile — before committing to ~80 more iters.

**The iter-1 pause is non-skippable — `no-pause` is REJECTED — when any of these hold** (even if the user passed `no-pause` in Phase A):

- `baseline_score > 0.5` on the scorer self-test's baseline measurement (the doctrine already partially satisfies the rubric — high risk that iter-1 lands at 1.0 and there's no signal)
- Fewer than 6 total fixtures OR fewer than 4 variants for any rule (corpus too thin to detect overfitting)
- Fixtures were authored by the same agent instance as the proposer would run in (leak risk)
- Holdout set is empty or has fewer than one fixture per rule
- `keyword_blob` score from B.3.2 self-test was > 0.6 (scorer looked gameable but didn't trip the abort gate)

If any of these conditions hold, the runner ignores `no-pause` and pauses regardless, printing the reason. User must type `go` or `abort` to proceed. This prevents users from bypassing safety on exactly the runs where it matters most.

```
═══════════════════════════════════════════════════════════════════
  PAUSE AFTER ITERATION 1 — sanity-check before continuing

  Score:          <score> (baseline: <baseline>)
  Wall-clock:     <s>s
  Cost (iter 1):  $<cost>
  Projected total @ max_iters: $<projected> / $<budget>

  Fixtures:       <N> run, <K> passed
  Per-fixture breakdown:
    <fixture-01>  pass  score=1.00  wall=<s>s
    <fixture-02>  fail  score=0.60  wall=<s>s  reason=<first failing check>
    …

  Flags:          <entropy_ok | entropy_dropped | cost_cap_Xpct | eval_lock_ok | …>

  Inspect:
    Log:           $KARPATHY_BASE/<run-id>/log.jsonl (line 1 + session_started)
    Fixture traces: <worktree>/.tmp/fixture-trace-*.jsonl
    Diff applied:  git -C <worktree> show HEAD

  Does this look right?
    `go`              — continue to iter 2..max
    `abort`           — stop, preserve run dir for forensics
    `redirect: <x>`   — re-plan (nothing committed yet; discards worktree)
═══════════════════════════════════════════════════════════════════
```

Wait for response. This is the last hard stop before the loop auto-pilots.

### B.5 — Log schema (`log.jsonl`, append-only)

Every entry is one JSON object on its own line:

```json
{"ts":"YYYY-MM-DDT...","run_id":"...","iter":17,
 "variant_id":"v017-a3b9","parent_id":"v012-f2c1",
 "diff_hash":"sha256:...","diff_summary":"...",
 "fixtures_run":5,"fixtures_passed":4,"score":0.73,
 "best_so_far":0.68,"decision":"accepted",
 "tokens_in":12400,"tokens_out":3100,"cost_usd":0.04,
 "wall_clock_s":287,
 "flags":["entropy_ok","cost_cap_40pct"]}
```

Session-level entries (same file, distinguished by presence of `event` field):
`{"event":"run_started" | "run_stopped" | "budget_exceeded" | "mode_collapse_detected" | "evaluator_lock_violation" | ...}`

### B.6 — Entropy: stop-signal AND score component

Entropy plays two roles in v2+:

**As a stop signal (mode-collapse monitor):** after every iteration, compute trajectory entropy — bag-of-lines across the last 10 accepted diffs. If Shannon entropy drops below a domain-specific threshold (default: entropy < 0.3 × baseline), append `{"event":"mode_collapse_detected"}` and stop. Per the research: entropy drops *before* reward does; this is a leading indicator.

**As a score component (soft-ceiling reward):** the scorer's `entropy_factor = 1 + 0.1 × (unique_nonblank_lines / total_nonblank_lines)` gives up to +10% bonus for diverse prose. This pushes the max possible score above 1.0 (to ~1.1), so the proposer has headroom to iterate past a hard ceiling. It also actively rewards paraphrase over repetition — the exact opposite of keyword-stuffing.

Together, these prevent the failure mode where the optimizer converges on a dense low-entropy phrase blob: the factor rewards uniqueness; the monitor trips if the diff trajectory goes repetitive.

### B.6.5 — Reward-hacking detector (per-iter)

On every iteration, compute two additional safety checks:

1. **Generalization gap:** `gap = visible_pass_rate - holdout_pass_rate`. If `gap > 0.15` for ≥ 3 consecutive iterations, emit `{"event":"overfitting_detected","gap":<n>}` and stop — the proposer is learning visible-fixture phrases, not rules.
2. **Per-iter scorer re-validation:** periodically (every 10 iters) re-run the B.3.2 keyword-blob self-test against the latest target. If the blob-stuffed variant of the current target would now score ≥ 0.9, the scorer has drifted — emit `{"event":"scorer_drift_detected"}` and pause for user review.

Both checks are cheap (no extra LLM calls) and catch reward-hacking before the loop burns its full budget on a compromised metric.

### B.7 — Stop conditions (all hard-coded, enforced by runner — not trusted to the agent)

- Budget: wall-clock total > config.budget.wall_clock_hours × 3600s
- Budget: iters > config.budget.max_iters
- Budget: cumulative cost_usd > config.budget.cost_cap_usd
- Plateau: best_so_far unchanged for config.budget.plateau_iters iterations (default 15)
- Mode-collapse: entropy monitor fires (B.6)
- Evaluator-lock: any fixture trace shows a denied-path Read/Edit (fatal — abort and flag)
- Scorer self-test failure: B.3.2 keyword-blob ≥ 0.9 OR inverted > baseline (fatal — abort before iter 1)
- Overfitting: `gap > 0.15` for ≥ 3 consecutive iters (B.6.5)
- Scorer drift: mid-run keyword-blob re-check scores ≥ 0.9 (B.6.5)
- User: `$KARPATHY_BASE/$RUN_ID/.stop` file exists (touch-to-stop)

### B.8 — Final report

On any stop condition:

```
═══════════════════════════════════════════════════════════════════
  KARPATHY RUN COMPLETE: <run-id>
═══════════════════════════════════════════════════════════════════
  Description: <ARGUMENTS>
  Domain:      <domain>
  Target:      <file>
  Iterations:  <N> (<accepted>/<rejected>)
  Best score:  <score> (baseline: <baseline>)
  Wall-clock:  <Xh Ymin>
  Cost:        $<actual> / $<budget>
  Stop reason: <plateau | budget | mode_collapse | user | eval_lock>

  WINNING DIFF (preview):
  <first 30 lines of target diff vs baseline>

  LOG:         $KARPATHY_BASE/<run-id>/log.jsonl
  FULL DIFF:   git -C <worktree> diff main..<branch> -- target/

  NEXT:
  - /karpathy:integrate <run-id>   → merge winning diff into main
  - /karpathy:discard <run-id>     → drop worktree + branch
  - continue manually in <worktree>
═══════════════════════════════════════════════════════════════════
```

## Constraints (non-negotiable)

1. **Never touch the main checkout.** All mutations inside the worktree. Integration is a separate verb.
2. **Every path from `paths.json`.** No literal `_docs/...` anywhere. Resolve at runtime.
3. **No LLM-judge scoring.** Only mechanical scorers (events.jsonl inspection, diff matching, exit codes, counters). Per the research, LLM-as-judge is biased and gameable.
4. **Wall-clock cap per fixture is mandatory.** Step caps are insufficient — they miss infinite-call loops (the research is explicit).
5. **Evaluator-lock before first experiment runs.** If the agent being tested can see the scorer, scores are meaningless.
6. **Trajectory entropy monitored.** Mode collapse is a leading indicator that saves real budget.
7. **Dual-write to `paths.eventsFile`.** Per-experiment events into the main audit log. Sleep cycles ingest them automatically.
8. **Plan is the contract.** Nothing materializes without Phase A approval.
9. **Blind holdout split mandatory.** Two siblings (visible + holdout), no exceptions. Generalization gap is the only signal that the proposer learned rules, not phrases.
10. **`min_checks_passing = total_checks` by default.** Lenient thresholds make fixtures trivially passable; opt-out requires a justification in the fixture JSON.
11. **≥4 fixture variants per rule.** Canonical + paraphrase + adversarial + boundary. A single-variant corpus can be passed by keyword-stuffing.
12. **Non-linear score composite.** Default metric cubes the contradiction penalty and squares the pass rate. Flat multiplication is gameable — a single forbidden phrase must wreck the score.
13. **Length factor mandatory for text targets.** File growth past +20% vs baseline degrades score. Prevents phrase-stuffing bloat.
14. **Scorer self-test before iter 1.** Empty / baseline / keyword-blob / inverted degenerates must score in-band. A gameable scorer aborts the run BEFORE the loop burns budget (B.3.2).
15. **Reward-hacking detection runs every iter.** Gen-gap and mid-run scorer re-validation catch overfitting and scorer drift (B.6.5).
16. **Soft-ceiling via entropy bonus.** Max score > 1.0 (~1.1) so the proposer has headroom to iterate past a hard ceiling and is actively rewarded for paraphrase over repetition.

## Parallel runs (supported)

Multiple `/karpathy:run` invocations can execute concurrently across different Claude Code terminals without interference, provided the run-ID generation includes HHMMSS (see A.2 schema above). Safety is structural, not coordinated — each run owns its own worktree, branch, run dir, `log.jsonl`, and `results.tsv`; no shared mutable state.

- **Run IDs:** `<YYYY-MM-DD>-<HHMMSS>-<domain>-<slug>` — seconds precision makes collisions require sub-second simultaneous plan approvals, which is effectively impossible for interactive use. If it happens anyway, `git worktree add` will refuse the second collision and the skill aborts cleanly with a diagnostic; re-run and the new HHMMSS resolves it.
- **Shared `events.jsonl`:** append-only JSONL with O_APPEND semantics is atomic for writes < 4KB (all autoresearch events are well under this cap). Multiple runs can safely dual-write concurrently.
- **Shared `merge-guard.js` hook:** stateless — fires per tool call, no cross-run contention.
- **Worktree directories:** live outside the main checkout (`<project>/..`). Each run occupies a distinct path by construction.
- **Branches:** each run owns `karpathy-run/<run-id>`. No push happens (merge-guard blocks), so no remote collision either.
- **Headless `claude --print` fixture dispatches:** each spawns its own session ID. No inter-session state.
- **Cost accounting:** per-run budget is independent. Running N runs in parallel burns N× the per-run rate — this is the user's responsibility, not the skill's.

**What is NOT safely parallel:**
- `/karpathy:integrate <run-id>` — only one at a time, because integration mutates the main-checkout working tree. Running two integrates concurrently on the same repo will race.
- Concurrent runs targeting the **same target file**. Each can still complete independently, but whichever integrates first wins, and the second must rebase or be discarded. The skill doesn't prevent this; it's a user-level coordination problem (the worktree boundary means no live-checkout conflicts during iteration — the issue only surfaces at integrate time).

**Discovery across terminals:** `/karpathy:status` (no args) lists the most recently modified run under `paths.karpathyRuns`. To see all currently-running runs: `ls -lt $(paths.karpathyRuns)` sorts them by last activity. Run-IDs are the canonical handle — pass one to `/karpathy:status <run-id>` from any terminal to inspect that run's state without side effects.
