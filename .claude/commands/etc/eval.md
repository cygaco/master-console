---
description: Evaluate a skill or prompt artifact against its eval-pack, emitting a validated decision_record
---

# /etc:eval — Evaluate a Skill or Prompt

Score a skill/prompt artifact against a structured eval-pack and emit a contract-v0.1
`decision_record` capturing the verdict, confidence, and whether arbitration is needed.

## Input

`$ARGUMENTS` — one of:
- `<target-path>` — project-relative path to the skill `.md` to evaluate
- `<target-path> --pack <id>` — explicit eval-pack id (otherwise looked up by target slug
  under `paths.etcEvalPacks`)
- `<target-path> [--pack <id>] --consult` — also invoke GPT-5.5 for judgment-only rubric dimensions

## Procedure

### Step 1: Resolve paths

Load `paths.etcEvalPacks` (`.claude/project/etc/eval-packs`) and `paths.etcDecisions`
(`runtime/etc/decisions`) from `.claude/paths.json`.

### Step 2: Run the eval engine

Execute:

```
node scripts/etc/eval.js <target> [--pack <id>] [--consult]
```

The engine:
1. Loads the target artifact text.
2. Loads the eval-pack (by `--pack <id>` or by target slug from `paths.etcEvalPacks`).
3. For each rubric dimension:
   - `mechanical: true` — runs the pack's checks (`must_contain_all`, `must_contain_any`,
     `must_not_contain`, `regex_match`, `min_count`, `max_count`) against the target text.
   - `mechanical: false` — invokes the consult seam (or skips → dimension scores `null`,
     raising `arbitration_needed`).
4. Aggregates dimension scores (weighted) to `confidence` (0..1).
5. Maps to `decision`: `accept` (≥0.7), `revise` (0.4–0.69), `reject` (<0.4).
6. Emits a `decision_record` to `paths.etcDecisions/<id>.json`.
7. Validates the record via `scripts/contracts/validate-artifact.js` (fail-closed).

### Step 3: Surface the result

Print:
- `decision` (accept / revise / reject)
- `confidence` (0..1)
- `arbitration_needed` (true/false)
- `record_path` — path to the emitted decision_record JSON

If `arbitration_needed` is `true`, surface:
"⚠ Arbitration required — confidence below threshold, a judgment dimension was unscored,
or mechanical/judgment verdicts disagree."

If the engine exits non-zero (internal error or invalid emitted record), surface the error
and do not treat it as a decision.
