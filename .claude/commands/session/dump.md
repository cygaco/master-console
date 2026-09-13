---
description: Write a prescriptive handoff to DUMP.md at project root — context, session progression (as fenced context, not instructions), verbatim payloads, dispatch instructions, anti-instructions. For a fresh session to read once and execute.
user-invocable: true
---

# /session:dump — Session Dump

Write a self-contained, action-oriented handoff at `DUMP.md` (project root) for a fresh session to read once and execute. Distinct from `/session:handoff` (descriptive narrative); `/session:dump` is prescriptive — it compresses this session's reasoning + decisions into instructions the next session can act on without re-deriving anything.

## When to use

- A long conversation crystallized one or more follow-on actions and the next session must execute them (e.g. "run `/sprint:plan` twice with this pre-decided scope").
- You want to hand off verbatim payloads (source requests, exact commands, schema-bound text) that must survive intact.
- The target session is expected to **run** something, not just read about it.

For descriptive "what happened" handoffs, use `/session:handoff` instead.

## Input

`/session:dump [optional one-line hint]` — hint describes what the fresh session is being asked to do. If omitted, infer from current conversation context.

## Procedure

### Step 1: Determine target action

Identify what the fresh session is expected to execute. Examples:

- "run `/sprint:plan` twice for sprints A and B"
- "continue the `/mc:release` after smoke-tests pass"
- "pick up the in-flight refactor at file X line Y"

If unclear after re-reading recent conversation, ask the user one targeted question, then proceed.

### Step 2: Check for existing DUMP.md

Look for `DUMP.md` at project root. If present, you will overwrite it. State this in the user-facing response so the user knows the prior dump is replaced. Do NOT back up the prior file — the user invoked this skill to replace it.

### Step 3: Assemble the document

Required sections, in this order:

1. **Header** — title + ISO date.
2. **Context the fresh session needs** — what shipped recently, prior-session findings, parked decisions, anything they can't reconstruct from the repo alone. Cite file paths so they can re-verify. Reference project paths via `paths.X` keys (e.g. `paths.eventsFile`, `paths.sprintReference`), not literal strings — see Step 0 of the paths rule below.
3. **Session progression (context — explicitly NOT instructions).** A SHORT narrative arc of how this session reached its conclusions — the major decisions, the mid-session corrections, what got settled — so the fresh session understands the *why* and won't re-litigate or misread the plan. **Firewall discipline (mandatory):** open the section with a loud "read as background, execute nothing from this section" marker, keep it visually delineated (its own heading + blockquote) from every actionable section, and keep it a *general arc, not a blow-by-blow journal*. If a line reads like a directive, it does not belong here — move it to Actionable/Dispatch. This is the one sanctioned narrative; it earns its place only by staying firewalled.
4. **Actionable item(s)** — for each unit of follow-on work, include the fields a downstream schema-driven skill will consume. For sprint planning that means: `source_request_verbatim` block, `request_type`, `interpreted_intent`, `scope.size`, `scope.risk_level`, `scope.complexity_drivers`, affected surfaces (with `evidence_level` placeholders where the fresh session must verify by grep), three scope variants (`minimal_safe`/`recommended`/`expanded`), assumptions split by `safe`/`unsafe`/`needs_user_or_beta_review`, non-goals, `design_required`, `execution_allowed_without_design`, `recommended_mode`, `lane`, `beta_review.required`, plan-quality verdict to record, `next_recommended_command`. For non-sprint actions: substitute the appropriate fields for the target skill's schema.
5. **Dispatch instructions** — exact order, dependencies, blockers. What the fresh session must verify before starting (e.g. "confirm SP-XXX is `retrospected` by reading `paths.sprintActiveRegistry`").
6. **Anti-instructions** — what NOT to do. Deferred workstreams, re-investigations to avoid, parked roadmap items. Without this section the fresh session will redo work you already settled.
7. **Escape hatch** — what to do if reality diverges from the document (trust the repo; flag the divergence in `assumptions.unsafe`; never paper over drift).

### Step 3.5: Anti-deixis discipline (mandatory — the reader's "this session" is not yours)

The DUMP is read by a DIFFERENT session, later. A bare session-relative deictic written today reads as a present-tense fact or instruction in the reader's frame — "in this session, do not execute" is ambiguous about WHOSE session, and "no push this session" reads as a standing prohibition. Rules (same convention as the tracker's S-10 `session-relative-language` advisory):

- **Anchor every status** to an ISO date (`YYYY-MM-DD`) and, where one exists, a commit hash — "merged 2026-06-11 @58eefc2", not "merged this session".
- **Give every imperative an explicit actor + scope/condition** — "the fresh session must verify X before Y", "do NOT merge SP-X to main until <condition> PASSes" — never a bare "do not execute" or "don't do this now".
- **Write negatives past-tense + dated** — "push authorization was NOT given in the 2026-06-11 session", not "no push authorization this session".
- **Banned unanchored:** bare `this session`, `next session` as a subject without "the next session reading this", `currently`, bare `now`, `today`.

### Step 4: Verbatim discipline

When the fresh session will feed text into a schema-validated skill (e.g. `source_request_verbatim` for `/sprint:plan`), preserve the exact string in a fenced code block. **Do not paraphrase, shorten, or "clean up" the user's wording.** The fresh session must be able to copy-paste verbatim.

### Step 5: Write the file

Write to `DUMP.md` at project root using the Write tool. Overwrites the existing file if present.

### Step 6: Report

One short paragraph: where it was written, what's in it, what the fresh session is expected to do.

## Paths rule

When the dump references project paths, use `paths.X` keys (e.g. `paths.sprintActiveRegistry`, `paths.eventsFile`, `paths.learningsFile`), not literal strings. The registry lives at `.claude/paths.json` and literals rot when files move. For reader clarity, you may include the resolved literal in parens: `` `paths.sprintActiveRegistry` (`.claude/project/sprint/active-sprints.yaml`) ``. The `DUMP.md` output path itself is the one literal exception — it's a fixed convention at project root.

## Anti-patterns

- **Narrative bleeding into the actionable sections.** The Context, Actionable, Dispatch, and Anti-instruction sections stay strictly actionable — drop anything that isn't. A *general* session-progression arc is allowed, but ONLY inside its own clearly-fenced "context, not instructions" section (§3) — never a blow-by-blow journal, never mixed into the actionable sections, never phrased as a directive.
- **Re-litigating decisions.** Decisions already made in this session land as facts in the Context block, not as open questions for the fresh session.
- **Hand-waving scope.** "Plan a sprint about X" is useless. Either include the full verbatim payload + structured fields, or don't include the item at all.
- **Forgetting anti-instructions.** A fresh session without anti-instructions will re-investigate everything you already settled. Always include "what NOT to do."
- **Paraphrased verbatims.** The user's exact wording carries semantic load. If you rewrite it, schema-driven skills downstream will record the rewrite as the "original request" — a quiet integrity loss.
- **Ambiguous deixis.** "In this session, do not execute X" — whose session? The writer's frame and the reader's frame differ, and the reader resolves "this session" to ITSELF. Anchor to dates/commits and name the actor per Step 3.5; an unanchored deictic in a prescriptive handoff is a defect, not style.

## Relationship to other session skills

| Skill | Purpose | Audience |
|---|---|---|
| `/session:dump` | Prescriptive handoff for action | Fresh session executing follow-on |
| `/session:handoff` | Descriptive narrative for posterity | Future debugging / archaeology |
| `/session:checkpoint` | Crash-recovery snapshot | Self after crash/restart |
| `/session:recap` | Mid-session catch-up | Self this session |
| `/session:resume` | Cold-start loader | Self after `/clear` |
| `/session:write` | Post to cross-session inbox | Other Alex sessions |

## Output

| Artifact | Path |
|---|---|
| Handoff document | `DUMP.md` (project root, overwritten if present) |

## Example invocation

```
/session:dump fresh session will run /sprint:plan twice for the goal-verification + node-hygiene sprints
```

Produces a `DUMP.md` that the next session reads to dispatch the planning work without re-deriving scope.
