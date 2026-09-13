---
description: Iterate a winning creative/message against a conversion/engagement scalar — thin wrapper over karpathy:run + parallel variation fan-out. Data picks winners.
---

# /growth:iterate — Iterate the Winner (data picks)

Take a *proven* winner and improve it: fan out ~20 variations (hooks/angles/scenes), test,
and let **data** pick the next winner. "Money loves speed"; fan out the winner, not the
guesses. A thin wrapper over `karpathy:run` (optimize an editable artifact against a scalar)
+ MC parallel subagents (the literal replacement for serial "give me 20 variations").

> **SCAFFOLD (S2.2).** Procedure outline, not a full implementation.

## Input

`$ARGUMENTS` — the winning artifact to iterate (a `message_brief`, advertorial, landing page,
or ad creative) + the scalar metric to optimize against (CVR / engagement / CPA / LTV:CAC),
plus:
- `--variations <N>` — how many to fan out (default ~20)
- `--metric <name>` — the conversion/engagement scalar

## Reuses (do not re-derive)

- **`karpathy:run`** — the optimize-against-a-scalar autoresearch loop, run in an isolated
  worktree with a score curve + stop conditions. This IS the iterate engine; `growth:iterate`
  is a thin domain wrapper that frames the artifact + metric for it.
- **Parallel subagents** (default-to-parallel) — fan out all N variations concurrently, not
  serially. This is MC's single biggest edge over a serial Cowork flow.
- **The speed gate** — owns `money-loves-speed` + the winner-fan-out gate: iteration may only fan
  out from an artifact with **real metric data** attached (no opinion-driven scaling); ranks the
  resulting variations. Resolve the agent from the skill-hook registry at call time and dispatch
  what it returns (do NOT hardcode a role name; the registry tracks the current persona):
  `node scripts/skills/skill-hook-points.js resolve growth:iterate speed-gate` (the `speed-gate` hook).

## Procedure (outline)

### Step 1: Confirm there is a real winner with data
The Growth Lead gates this: fan-out requires a winning artifact with attached real metric data
(inherited `evidence-over-invention`). No data → no fan-out; say what data is needed.

### Step 2: Frame the karpathy experiment
Define the editable artifact + the scalar metric + the stop condition; hand to `karpathy:run`.

### Step 3: Parallel variation fan-out
Generate ~N variations (hooks / angles / scenes / layouts) of the winner concurrently via
parallel subagents; keep them on-message (each still derives from the `message_brief`).

### Step 4: Score + pick
`karpathy:run` scores against the scalar; the Growth Lead ranks; the next winner is promoted.
Record the result (a `decision_record`) under `paths.content`.

## Enforcer (no-opinion-scaling — DESIGN; α wires)

A check that FAILS an iterate run whose source artifact has no attached real metric data — you
do not scale on opinion (the no-invented-data discipline applied to the iterate loop). The
resonance/conversion-quality eval scores the variations so winners aren't merely "valid but
generic."
