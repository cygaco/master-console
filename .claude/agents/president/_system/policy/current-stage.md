# Current Stage

**Stage:** `pre-mvp`

The declarative source of truth for the product's current **lifecycle stage** (the
canonical 5-phase model in `.claude/project/reference/product-lifecycle.md`). Beta and
the decision policy read this every invocation; the Director of Product / Director of QA
ground their lifecycle-aware judgment (Principle #2) in it.

**Stage tokens:** `research` · `pre-mvp` · `launch` · `finding-pmf` · `pmf`
(`pre-mvp` = "Early Development / Pre-Launch" — building 0-to-1 toward an MVP.)

## How to set the stage

- **Persistent (the SoT):** edit the `**Stage:**` value above and commit. ← do this on a real transition.
- **Quick override:** set the `MC_LIFECYCLE_STAGE` env var (session / CI, or
  `.claude/settings.json#env` for persistence). It takes precedence over this file.
- **Resolve it anywhere:** `node scripts/mc/lifecycle-stage.js` (env → this file → `unknown`).
  Subagents can't read env, so the orchestrator resolves the stage and passes it on dispatch.
- *(Optional mirror: `productStage`/`mc.version`-adjacent fields in `.claude/manifest.json` may mirror this for tooling; this file + the resolver are authoritative.)*

---

## MC — current stage: `pre-mvp`

Operator-declared 2026-05-29. MC (and the Master Console product it is the engine
for) is **pre-MVP / Early Development**: building 0-to-1 toward a productized MVP. Judge
work by Principle #1 (Lean) at **maximum intensity** and Principle #2 (the cold-start /
FTUE path is where it's won).

### What "good" looks like at `pre-mvp`
The smallest end-to-end **core loop** that proves the central bet, usable by a handful of
real users. Lean, throwaway-OK, no scale/edge/hardening for its own sake.
- **A win:** the golden path works end-to-end for a real user; you learned something
  concrete about what they need next; just enough infra to support that — nothing more.
- **Not a win:** a latency win on a route nobody hits; a refactor that changes no user
  outcome; a new dependency to save a few lines you already understand; breadth over depth
  on the core loop; hardening a system no user exercises yet.

### Priorities (ranked) at `pre-mvp`
1. **Core-loop value** — does this move the central bet toward a usable MVP?
2. **Speed-to-ship** — can it land this cycle?
3. **Simplicity / reversibility** — easy to understand, cheap to throw away.
4. **Reliability** — happy path works; degrades gracefully off it (don't gold-plate edges).
5. **Polish** — only when it changes adoption / the first impression (FTUE).
6. **Scale** — explicitly deferred; do not optimize.

### Avoid at `pre-mvp`
- Premature scale optimization, custom infra, new vendors (the four-condition rule in
  `paths.decisionPolicy` + Principle #3 Build-over-Buy apply).
- Complex abstractions for hypothetical future scale; performance work with no real complaint.
- Feature breadth — depth on the core loop beats surface breadth.

> **Engine-vs-product reliability carve-out (MC-specific; operator-ruled 2026-05-30, DP-gap #30):**
> MC is the *engine* under Master Console. Even at `pre-mvp`, work that keeps the engine
> reliable *enough to not break the imminent Master Console launch* (the artifact-first
> contract slice + the install/release/dispatch path products actually hit) is **core-loop
> work, not gold-plating** — because the "user" of the engine artifact is the launching
> product. This overrides the default "don't gold-plate reliability at pre-mvp" priority
> #4 for engine-reliability-that-protects-a-dependent-launch. The Director reconciles the
> tension; β does not score such work down as premature hardening. The operator affirmed
> this and directed a **torture-level reliability sprint** (ROADMAP §0.18.1 / #30).

---

## When to update

Stage flips on triggers, not vibes (full per-phase detail in `product-lifecycle.md`):

| Transition | Trigger |
|---|---|
| `research` → `pre-mvp` | Problem / audience / business strategy settled — you know what to build |
| `pre-mvp` → `launch` | MVP is real and shipping to the first real (non-friends) users |
| `launch` → `finding-pmf` | First users are in; you're iterating on retention/pull signals + metric check |
| `finding-pmf` → `pmf` | The metric check passes for your product/category — durable pull |

On a transition: (1) edit `**Stage:**` above, (2) refresh the "good / priorities / avoid"
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
