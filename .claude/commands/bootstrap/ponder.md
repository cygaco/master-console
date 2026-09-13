---
description: Exploratory pondering of a project — surface tensions, patterns, JTBD drift, and one forcing question
---

# /bootstrap:ponder — Sit With the Project

Exploratory pondering of the current project. Not a bug fix, not a feature plan, not a sprint. The output is observations + one forcing question — the kind of question that, once answered, reorders the rest of the backlog. Invoke when you want me to genuinely sit with project state instead of executing on it.

## Input

`$ARGUMENTS` — no required args. Optional flags:

- `--deep` — force the structured `/reasoning:run`-style pass after the natural ponder.
- `--shallow` — skip the structured pass entirely (natural ponder only).
- `--focus <topic>` — narrow to a sub-question (e.g. `--focus distribution-shape`, `--focus validation-loop`). Without `--focus`, ponder broadly.

## Phase 1: Load context

Read whichever of these exist; skip silently if missing. Internalize — don't dump content back to the user.

- `PROJECT.md` (project-specific context)
- `ROADMAP.md` at repo root (current backlog / shipping ladder)
- `AGENTS.md` (agent system shape)
- `paths.sprintActiveRegistry` — what sprints are active/closed/retrospected
- tail of `paths.learningsFile` (last 5–10 entries) — what's been learned recently
- tail of `paths.tracesFile` (last 5 entries) — what's been reasoned about recently
- sleep journal under `paths.memory` (e.g. `sleep-journal.md`) if present
- `paths.eventsFile` last day — only if needed for a specific signal (β bypass counts, dispatch failures); don't load the whole log

Time-box this phase. Goal: enough context to think *with*, not exhaustive coverage.

## Phase 2: Natural ponder

Default ON unless `--shallow`. The associative, exploratory pass.

Surface **4–7 observations**. Each must:

- Name a real artifact — file path, sprint id (`SP-NNNNNN-NNN`), learning id (`L-...`), trace id (`RT-NNN`), an event count from a real window, a commit sha.
- Identify one of: a **tension** (two priorities pulling against each other), a **pattern** (something repeating that should be one structural fix), an **emergent gap** (a hole created by recent work), or a **question** worth posing back.
- Be ~1 paragraph. Not a bullet, not an essay.

What does *not* belong:

- Recitation of PROJECT.md / ROADMAP.md content. That's quoting, not pondering.
- Feature lists. We're not auditing what exists.
- Recommendations, sprint proposals, fix briefs. The natural pass observes; it does not prescribe.
- "The project is healthy" / "everything looks good" summaries. If nothing surfaced, ponder again — something always surfaces.

End the natural pass with **"If this project were a little different…"** — one paragraph proposing *one* alternative shape (different distribution model, different scope, different identity). This is a forcing function, not a pivot proposal — the value is the contrast it exposes, not adopting the alternative.

## Phase 3: Structured pass (conditional)

Run this **only if**:

- `--deep` was passed, OR
- the natural pass surfaced an ambiguity that benefits from steelmaning (user's intent vs. observed behavior diverge, or a tension can't be resolved without a deliberate frame).

Otherwise skip to Phase 4.

When run, follow `/reasoning:run` Deep Mode:

1. **First Impulse.** One-sentence obvious read.
2. **Steelman the opposite.** Assume the impulse is wrong; argue the other side genuinely.
3. **What am I missing?** Assumption, would-change-my-mind evidence, dissent.
4. **Framework lens** — pick 1–2 (not all). Recommended for project-level pondering:
   - **JTBD** — what job is the project hired for? Has it drifted to a different job?
   - **Eisenhower** — is the current work-queue in Q1 (urgent+important) or Q2 (important not urgent)? Be honest.
   - **Second-Order** — if the next N units of work look like the last N, what state is the project in?
   - **5 Whys** — when an observation feels like a symptom, drill 5 levels.
   - **SWOT** — only if the project is at a directional crossroads.
5. **Zoom out, then zoom in.** Meta-question, then concrete next move.
6. **Decide.** Answer / confidence / what changed / remaining uncertainty.

Append a trace to `paths.tracesFile` as `RT-NNN` with `source: "bootstrap:ponder"`. Required: `id`, `ts`, `framework_selected`, `framework_rationale`, `problem` (the meta-question), `root_cause`, `fix` (may be "no action, surface to user"), `quality_score: null`, `open_question` (matches Phase 4 output).

## Phase 4: Forcing question

End with the single open question whose answer reorders everything else. One paragraph. The question should:

- Name an ambiguity that **the user alone can resolve** (not something to look up).
- Be answerable in one phrase or one branch-choice — `yes / no`, `A or B`, `keep going / pause for N days`. Not a paragraph-essay.
- Make the rest of the conversation cheaper once answered.

Phrase it directly. Example: *"Is this project the framework-for-product or the product itself? The answer determines whether the current trajectory is correct or self-indulgent."*

## Phase 5: Optional debt log

If the natural ponder surfaced a policy/convention that lacks a named enforcer (per CLAUDE.md § Policy & Enforcement Hygiene), invoke `/enforcement:log` inline with the relevant fields. Don't manufacture debt — only log gaps that genuinely surfaced.

## Anti-patterns

- **Don't recite.** Reading PROJECT.md aloud isn't pondering. If the user wanted PROJECT.md, they'd `cat` it.
- **Don't prescribe.** Observations + one question is the output. Sprint plans / fix briefs / refactors are NOT in scope; if one surfaces, save it for after the user answers the forcing question.
- **Don't interview.** "What do you want to ponder?" defeats the point. Pick the angle yourself.
- **Don't perform the framework structure when `--shallow`.** The natural pass alone is valid output.
- **Don't run more than one structured pass per invocation.** If the natural ponder surfaces 3 ambiguities, pick the load-bearing one; the rest become future invocations.

## Worked example

`RT-011` in `paths.tracesFile` is canonical. Invoked when the user asked "ponder this project." Natural ponder surfaced 8 observations (recursion / framework-as-product drift, aspirational-vs-enforced as a class, β bypass diagnosis, accumulation-without-validation, hollow-ladder rungs, alternative single-binary shape, JTBD drift, velocity-vs-cohesion). Structured pass ran in Deep mode with JTBD + Eisenhower + Second-order. Forcing question: *"Is MC the framework-for-product or the product itself?"* — the answer reorders everything else.

## Related

- `/reasoning:run` — for a *specific* problem. `/bootstrap:ponder` is broader, meta-direction.
- `/discover:systems`, `/scan:full` — surface *state*. `/bootstrap:ponder` surfaces *direction*.
- `/sleep:deep` — REM-phase speculative reasoning. `/bootstrap:ponder` is awake, deliberate, single-pass.
- `bootstrap:spinup` — companion entry-point: bootstrap a product brief from a guided discussion (run *before* pondering on a fresh project).
- `/enforcement:log` — log any aspirational policy that surfaced.
