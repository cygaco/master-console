# Skill-dispatch benchmark pack — "is it worth it + are the results good?"

> **SCHEMAS + EXAMPLES — this directory holds the replayable task-set and benchset schemas plus one worked example of each. It contains NO measurements (every number in the examples is a clearly-marked placeholder).**

A ping smoke test proves a subprocess skill *runs* headless.
This pack is the *second gate*: it proves subprocessing a skill is actually
**beneficial** — that it **saves meaningful tokens/context AND the results are as good as
inline**. A skill is finalized as `execution: subprocess` only when BOTH gates pass,
measured per-skill, never assumed.

A measurement runner (not shipped in this pack) would read a *benchset*
(`bench-result.schema.json`) — the per-task A/B token MEASUREMENTS + thresholds + judge
metadata — compute both axes, and on a BOTH-pass **finalize** the skill in the skill-weight registry by setting the STRICT
`subprocess_verified: true` (the value `dispatch-contract.js#skillExecution` requires to
actually route subprocess) plus an `earn_it` block `{ tokens_saved, quality_verdict,
context_needed?, measured_at, run_id, axis1, axis2 }`. **Two-gate ladder:** the ping
stamp is an OBJECT (`subprocess_verified:{date,run_id,…}`) → proves runnable but, being
`!== true`, still routes inline; the A/B runner is what flips it to the strict `true`. Fail-closed:
either axis failing → not finalized → the skill stays inline.

This cannot be judged from a single run (retries, summarization,
review churn, and stale-context failures hide the true cost). So the A/B measurement requires a small
**replayable task set** with baseline inline runs, subprocess runs, gold/human
expectations, anonymized cross-provider judging, and explicit thresholds.

---

## The two axes (both must pass — fail-closed)

### Axis 1 — token/context savings (the premise check)
A/B the **orchestrator-side** cost:

- **INLINE** — the full skill output enters Alpha's context.
- **SUBPROCESS** — only the ≤8-line envelope enters Alpha's context.

```
net_savings = inline_orchestrator_tokens − (envelope_tokens + dispatch_overhead)
dispatch_overhead = background-task notification + envelope read + completion-record check
```

Qualify a skill only when `net_savings` clears **both** thresholds
(`min_tokens_saved` AND `min_pct_saved`). **Light skills whose output is already small
save ≈nothing (envelope ≈ inline) → they stay inline.** Measurement model = the
`oneshot-token-guide` orchestrator-tokens-per-activity table.

### Axis 2 — result quality ("are the results good?")
Run the skill INLINE and SUBPROCESS on the **same representative input**; compare. A fresh
subprocess lacks Alpha's live conversation, so some skills degrade.

- Score equivalence with an **independent cross-provider judge** (no self-grading — the
  diff-model-review pattern). Pass = subprocess quality ≥ inline quality
  within `quality_tolerance`.
- The cross-provider judge is for **independent review / high-risk routing / calibration —
  NOT the sole quality oracle for every test**. Where a gold expectation exists,
  grade against it first; use the judge for the subjective delta.
- On fail: either keep the skill inline, OR feed the missing context into the dispatch
  prompt and re-test (it may then pass — and the registry records `context_needed`).

### Decision rule (fail-closed)
Finalize `execution: subprocess` ONLY when BOTH hold — saves meaningful tokens/context
**AND** results are as-good. Otherwise → `inline` (or `inline-required`). Stamp the
skill-weight registry per skill:

```
{ subprocess_verified, tokens_saved, quality_verdict, context_needed?, measured_at, run_id }
```

---

## Layout

```
benchmark-pack/
  README.md                   ← this file (the contract)
  task-set.schema.json        ← schema for the INPUT side: a replayable task set (tasks + thresholds)
  task-set.example.json       ← worked EXAMPLE task set (illustrative; NOT a measurement)
  bench-result.schema.json    ← schema for the MEASURED side: a benchset a measurement runner consumes/produces
  bench-result.example.json   ← worked EXAMPLE benchset (SYNTHETIC placeholder counts; NOT a measurement)
  task-sets/                  ← optional: one <skill>.json task set per skill under measurement
  runs/                       ← optional: raw inline/subprocess run artifacts, per task
  results/                    ← optional: computed savings + quality verdicts, per skill
```

Two paired schemas:

- **`task-set.schema.json`** — the INPUT: per task a stable `task_id`, the skill + input,
  a `gold` expectation (or rubric), and the per-axis thresholds.
- **`bench-result.schema.json`** — the MEASURED side a measurement runner reads: per task the
  orchestrator token counts for both arms (`inline_orchestrator_tokens`, `envelope_tokens`),
  optional artifact digests, the thresholds, and the independent judge's `verdict`. The
  runner computes Axis 1 from these counts and reads Axis 2 from the judge verdict (it never
  self-grades).

See each `.schema.json` for the exact shape and the matching `*.example.json` for a filled
illustrative example. **Both examples carry placeholder/synthetic numbers, clearly marked —
neither is a real measurement.**

### Judge stubbing for fixtures

A measurement runner can stub the cross-provider judge deterministically on a fixture
benchset (no real judge dispatch, no spend). With **no** stub and no real judge wired,
Axis 2 is **UNGRADED** and the skill fails closed (never self-graded, never
assumed-good). This pack ships no runner.

---

## How to run a measurement

A real measurement is deliberate (the 6 heavy subprocess skills —
`scan:full`, `research:deep`, `qa:audit`, `redteam:full`, `sleep:deep`, `learn:deep` —
are heavy-by-design; a real A/B of each is expensive). To earn it for a specific skill:

1. **Prove it runs FIRST** — a real bounded headless spawn of the skill (it **spends**)
   that records `subprocess_verified` in the skill-weight registry. You cannot measure
   savings/quality until the skill runs headless.
2. **Author the task set** — `task-sets/<skill>.json` against `task-set.schema.json`: a
   handful of representative inputs with gold expectations + the two-axis thresholds.
3. **Run both arms per task** — capture INLINE orchestrator tokens and SUBPROCESS
   (envelope-only) orchestrator tokens; store raw artifacts under `runs/`. Record them
   into a *benchset* (`bench-result.schema.json`): one `measurements[]` entry per task
   with `inline_orchestrator_tokens` + `envelope_tokens` (+ optional artifact digests).
4. **Grade Axis 2** — gold-first, then an anonymized cross-provider judge for the
   subjective delta (the diff-model-review pattern; never self-grade); write the judge's
   `verdict` (+ optional signed `score`) into the benchset's `judge` block.
5. **Run a measurement harness** over the benchset and the skill-weight registry. It computes Axis 1 (`net_savings` per the formula, both
   thresholds) and reads Axis 2 from the judge verdict, then on a BOTH-pass **finalizes**
   the registry: sets the strict `subprocess_verified: true` + the `earn_it` block
   `{ tokens_saved, quality_verdict, context_needed?, measured_at, run_id, axis1, axis2 }`.
   A skill that fails either axis stays `inline` (exit 1, nothing stamped).
6. **Anti-rot** — re-measure on skill change.

> **Enforcer note (anti-rot):** `subprocess_verified` must be invalidated when a
> skill's `.md` changes (the `skill-catalog-regen` hook) and re-checked at `/scan:full`. A
> stale stamp (skill changed since) reverts to unverified — no "tested once, trusted
> forever." Treat any stamp as provisional until that invalidation is wired, and log the
> gap via `/enforcement:log`.

---

## Scope of this pack

- **The pack ships the schemas and the examples** — `task-set.schema.json`,
  `bench-result.schema.json`, and one example of each. It ships no runner and no
  measurements.
- **No real A/B measurement is included** — there are no run artifacts under `runs/` and no
  verdicts under `results/`. Every number in `task-set.example.json` and
  `bench-result.example.json` is an illustrative placeholder, clearly marked, not a
  measurement (the example benchset's zeros would in fact FAIL Axis 1 fail-closed).
- **A real measurement is expensive** — it replays the skill twice per task plus a real
  cross-provider judge call, so run it deliberately, one skill at a time, with a
  budget, starting with a real ping.
