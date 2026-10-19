# Current Stage

**Stage:** _(not set: replace this placeholder with one stage token from the list below)_

The declarative source of truth for the product's current **lifecycle stage** (the
canonical 5-phase model in `.claude/project/reference/product-lifecycle.md`). β loads this
file on every invocation, and the decision policy's scoring rubric weights options by the
stage declared here. The Director of Product (its `lifecycle-aware-judgment` principle) and
the Quality Lead ground their stage-aware calls in it.

**Stage tokens:** `research` · `pre-mvp` · `launch` · `finding-pmf` · `pmf`
(`pre-mvp` = "Early Development / Pre-Launch" — building 0-to-1 toward an MVP.)

This file ships as a blank seed. Until the Stage field above holds a token,
`node scripts/mc/lifecycle-stage.js` resolves the stage as `unknown` (unless
`MC_LIFECYCLE_STAGE` is set), and the Director of Product infers the stage from evidence and
says so.

## How to set the stage

- **Persistent (the SoT):** replace the placeholder in the Stage field at the top with one
  stage token in backticks, and commit. ← do this on a real transition.
- **Quick override:** set the `MC_LIFECYCLE_STAGE` env var (session / CI, or
  `.claude/settings.json#env` for persistence). It takes precedence over this file.
- **Resolve it anywhere:** `node scripts/mc/lifecycle-stage.js` (env → this file → `unknown`).
  Subagents can't read env, so the orchestrator resolves the stage and passes it on dispatch.
- *(Optional mirror: `productStage`/`mc.version`-adjacent fields in `.claude/manifest.json` may mirror this for tooling; this file + the resolver are authoritative.)*

---

## Current stage

_(Fill in once the stage is set: one or two sentences on where the product is and what the
stage means for how work is judged. The stage definitions table below is the starting point.)_

### What "good" looks like at this stage
_(The outcome that counts as progress at this stage.)_
- **A win:** _(an example of work that counts as a win at this stage)_
- **Not a win:** _(examples of work that looks productive but does not count at this stage)_

### Priorities (ranked) at this stage
1. _(highest priority)_
2. _(next priority)_
3. _(add as many as the stage needs, in rank order)_

### Avoid at this stage
- _(work to defer or refuse at this stage; the four-condition rule in `paths.decisionPolicy`
  applies to any new service, framework, database, queue, vendor or major dependency)_

---

## When to update

Stage flips on triggers, not vibes (full per-phase detail in `product-lifecycle.md`):

| Transition | Trigger |
|---|---|
| `research` → `pre-mvp` | Problem / audience / business strategy settled — you know what to build |
| `pre-mvp` → `launch` | MVP is real and shipping to the first real (non-friends) users |
| `launch` → `finding-pmf` | First users are in; you're iterating on retention/pull signals + metric check |
| `finding-pmf` → `pmf` | The metric check passes for your product/category — durable pull |

On a transition: (1) set the Stage field at the top, (2) refresh the "good / priorities / avoid"
to the new phase, (3) commit. Beta + the Directors pick it up on next invocation.

## Stage definitions (reference — see product-lifecycle.md for metrics)

| Stage | What "good" looks like | Avoid |
|---|---|---|
| `research` | Learning if there's a problem worth solving, for whom, how it pays. | Building before the bet is settled. |
| `pre-mvp` | Smallest core loop proving the bet, for a few real users. | Scale/edge hardening, breadth, vendor lock-in, premature abstraction. |
| `launch` | MVP shipped; collect data, talk to users, hotfix; win Activation + D0/D7. | Big new features over fixing the FTUE / glaring early bugs. |
| `finding-pmf` | Iterate to pass the metric check (retention, DAU/MAU, CAC, organic). | Scaling or breadth before pull is proven; ignoring user data. |
| `pmf` | Durable pull; now hardening, reliability, scale earn their cost. | Rewrites; feature velocity that costs the working loop. |

The shift between stages is not a feature checklist — it's what changes count as wins.
