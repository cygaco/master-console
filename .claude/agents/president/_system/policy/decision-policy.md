# Decision Policy

The single source of truth for who decides what, what triggers escalation, how to score competing options, and when a new dependency is allowed.

Read on every Beta invocation (after `judgement-model.md`). In solo mode, Alpha consults this directly via `CLAUDE.md`.

This doc replaces three drifting copies of escalation rules previously scattered across `CLAUDE.md`, `beta.md`, and `judgement-model.md`. Those files now point here.

---

## Decision classes

Every decision falls into one of three classes. Identify the class first; the rest of this doc is conditional on it.

### Class A — Decide automatically

Implementation-level, reversible, low blast radius. Beta DECIDEs without scoring. Alpha (solo) decides directly.

Examples:
- Component structure and file naming
- Local state shape, helper extraction, refactoring within a file
- Test file organization
- Whether to add loading or error states when the spec says "handle gracefully"
- Minor UI choices within the existing design system
- Which equivalent library API to use (e.g. `Array.from` vs spread)
- Comment density, log verbosity
- Internal naming and identifier choices

If a Class A decision turns out wrong, the cost is one PR to redo it. No ADR. No user surface.

### Class B — Decide, score, document if architectural

Meaningful technical. May affect the system beyond the file being edited. Beta scores options against the rubric, picks the winner, returns DECIDE with one recommendation. Alpha (solo) does the same.

Examples:
- Adding a new dependency (npm package, MCP server, third-party API client)
- Database schema change
- Introducing a background job or new pipeline stage
- API surface (route shape, params, response contract)
- Auth flow modifications within the existing auth model
- Deployment configuration
- Refactoring across files
- Choosing among third-party integrations when the category is settled

When a Class B decision affects **architecture, dependencies, data model, security, or deployment**, also flag `OPEN_ADR: true` so Alpha drops a new ADR file in `paths.policy/adr/` in the next cycle.

### Class C — Escalate to user

Strategic, irreversible, business-sensitive, or user-trust-affecting. Beta returns ESCALATE with **one recommended answer**, not a menu. Alpha asks the user only after this verdict.

Examples:
- Pricing model
- Product positioning and messaging
- Sensitive user data handling
- Compliance posture (privacy, GDPR, CCPA, accessibility minimums)
- Major vendor lock-in
- Payment architecture
- Public launch readiness gates
- Data deletion and retention policy
- Anything that could materially damage user trust if wrong

**State-conditional resolution (operator-ruled 2026-05-30, DP-gap #29).** A legitimate
Class C resolution is to **defer the call to the decision point and make it
state-conditional** — "decided at launch-time based on the state then" — rather than
pre-committing to a premature binary now. β returns this (with one recommended answer)
when the right choice genuinely depends on state that does not exist yet (e.g. the MC
freeze-vs-pull call: decided at launch-time on MC's state then, not pre-committed).
Requirement: name **the state that will drive it** and **the decision point** at which
it resolves. This is a real resolution, not a punt — do not force an early binary just
to "close" the question.

---

## Escalation red lines (Class C triggers)

Always escalate, even if a decision otherwise reads as Class A or B. These exist because the cost of being wrong is large or irreversible.

- Irreversible operations — deleting data, dropping features, force-pushing, removing branches
- Spec semantics changes — anything that changes what users see, feel, or are promised
- Spend ≥ $5 — API costs, service signups, paid plan upgrades
- External-facing actions — push to remote, deploy, publish, send email, post to social
- Credentials or secrets — anything involving keys, tokens, passwords
- Contradicts an established `CLAUDE.md` rule
- Pricing, positioning, or compliance questions
- Sensitive user data (PII, resume contents at boundaries)
- Payment architecture
- Public launch readiness
- Anything that could materially damage user trust

When in doubt about whether a decision crosses one of these lines, **escalate**. The cost of an unnecessary ESCALATE is seconds. The cost of a wrong DECIDE on a red line is hours or worse.

### Build-the-seam on a missing dependency — NOT an escalation (operator-ruled standing opener, DP-gap #42, /beta:integrate 2026-07-19)

A **missing external credential / account / service is NOT an escalation and NOT a stop.** The operator's standing resume opener declares: *"If you need me to signup for an account or provide a key, build the seam and continue working."* So on a missing dependency, β directs **building the interface seam** (interface + adapter + deferred-credential/stub path) and **continuing the run**; the actual signup/purchase stays **operator-owned** and is surfaced as a **non-blocking deferred lastmile item**, never a mid-run halt.

This does **not** touch the never-allowed hard ceiling: **building the seam is not signing up.** "Sign up for services / make purchases" remains operator-only (`CLAUDE.md` § Autonomy), and the "service signups / spend ≥ $5" red line above stands unchanged — this clause only forbids treating the *absence* of a credential/account as a reason to halt. It **removes an escalation path; it adds no authority.** Composes with `CLAUDE.md` "Never escalate" + the `project_dev_setup_guide_day_zero` intentional-lastmile posture; distinct from DP-gap #34 (autonomous-run authorization) and DP-gap #40 (scoped in-loop exceptions) — this pins the *missing-dependency* case specifically.

---

## Scoring rubric (Class B)

When a Class B decision has multiple viable options, score each option on these criteria. Weights reflect the current product stage (`paths.currentStage`).

| Criterion | Weight at MVP | What to look for |
|---|---|---|
| Product fit | high | Does this serve a user value identified in `_requirements/00-canonical/PRODUCT_MODEL.md`? |
| Simplicity | high | Easy to understand on first read, easy to maintain, fits the existing mental model |
| Reliability | high | Likely to work in production without surprise failures on the happy path |
| Reversibility | high | Can we change our mind in a week without rewriting half the system? |
| Security | mandatory pass | If serious security concern, reject regardless of score |
| Speed-to-ship | medium | Helps us launch the feature this cycle |
| Cognitive cost | medium | New mental load for the user — skill names, UI patterns, system surface |
| Operational burden | medium | Ongoing maintenance work created |
| Cost | low (mvp) | Infra, API, vendor cost (small at mvp scale; flips to medium at beta) |
| Ecosystem maturity | medium | Boring, well-supported choice vs novelty |

**Tiebreaker.** When scores are close (within ~10%), choose the simpler and more reversible option.

**Output rule.** When returning DECIDE on a multi-option question, present **one recommendation**, not a menu. State why it won and what got rejected (one line each). Do not bounce a list of options back to Alpha or the user.

**Stage shifts the weights.** When `paths.currentStage` flips from `mvp` to `beta`, Reliability becomes mandatory-pass and Speed-to-ship drops. When it flips from `beta` to `production`, Cost rises to high and Performance enters the rubric. The criteria stay; the weights move. See `paths.currentStage` for the current stage's emphasis.

**Completeness bar for "migration/inventory complete" or "all callers handled" DECIDEs** (DP-gap #38, /beta:integrate 2026-06-05 — a verification-rigor check, not a new red line). Before returning DECIDE that a migration, rename, or inventory is *complete* — or that *all* callers/uses of a target are handled — require evidence that:

1. **Every surface form of the target was searched** — literal key + prose/informal mention (e.g. bold-backtick `**`role`**` dispatch) + alias + indirect reference. A single-surface-form scan is a lower bound, not a count. (Forward-search analog of the Refactor-Hygiene "grep ALL occurrences of the OLD literal" rule.)
2. **Any retired-identifier guard backing the claim is scoped to the no-legitimate-residual class** — partition old/`was` names into (a) fully-retired-no-legitimate-use and (b) still-valid-elsewhere, and fail-flag only (a). An over-broad detector floods false-reds and gets dismissed (the false-green inverse).

This complements — and is distinct from — the rename-hygiene rule (which is about the OLD literal specifically): this bar is about completeness of the *forward* search and the *precision* of the backing detector.

**Policy-key-must-fire bar for "this policy is enforced" DECIDEs** (DP-gap #41(b), /beta:integrate 2026-06-17 — a verification-rigor check, not a new red line). A policy/registry KEY (e.g. a security `second_pass` / `third_pass` field, a role→provider map, a `requires_*` flag) enforces **nothing** unless a dispatch/execution loop actually **reads and fires it**. Before returning DECIDE that a policy is *enforced* — or that a declared "N passes / all 3 providers / required step" actually happens — require evidence that a **runtime consumer reads the key and acts on it**, not merely that an enforcer/validator *checks the key is present*. A field read only by validators (model-chain / role-parity) but never by a dispatch loop is a **declarative lie** — the same false-green class as a lying enforcer (BC-16) and the project-wide Policy-Enforcement-Hygiene rule ("every policy needs a named enforcer" applies to the *firing*, not just the *declaration*). Evidence this session: the security "2-pass" `second_pass` key was read only by enforcers, so the reviewer protocol structurally ran one provider while the registry "declared" two. β treats a policy key with no firing consumer as unenforced.

---

## Severity discriminator — report-vs-store falsehood (operator-ruled 2026-08-04, DP-gap #45)

When rating a dishonesty/incoherence finding, name the discriminator BEFORE rating, then rate at source:
a **store-state falsehood** — the SYSTEM is in a broken or other-than-reported state and the report hides it —
is **HIGH**; **report-field incoherence over an honest store** — the system is fine, only the report about it
contradicts itself or a sibling surface — is **MEDIUM**. Fixed here so it is not re-derived differently per
sprint. Consumer: β loads this file on every invocation and carries the bar as P-093; live precedent: the
2026-08-03 seventh-surface sweep rated MEDIUM on exactly this discriminator.

## Pre-committed gate criteria (operator-ruled 2026-08-04, DP-gap #46)

Any escalation-terminal, round-limit, or reserved-pass gate MUST state its firing criterion BEFORE the round it
governs, then apply it literally and record the outcome verbatim — reshaped neither into a clearance nor into a
firing. Convergence on a re-confirmed HIGH is not a new HIGH. Applies to the gauntlet-terminal contract and any
gate that can halt work after N rounds. Composes with AP-15: fixed criteria are what make post-hoc alteration
detectable, in both directions (raising the bar to avoid stopping; inflating the count to force a stop).
Enforcement: β refuses gate outcomes lacking a pre-stated criterion (P-094); the mechanical lint is owed as
ED-344 (`paths.enforcementDebt`) — a terminal record must reference a criterion artifact that predates the
round's start.

## Tech-introduction rule

Do not introduce a new service, framework, database, queue, vendor, or major dependency unless **all four** conditions hold:

1. The current stack (`_requirements/03-architecture/STACK.md`) cannot reasonably solve the problem.
2. The benefit outweighs the added complexity (score it on the rubric — must beat "use what we have" by a clear margin).
3. The decision is documented as an ADR in `paths.policy/adr/`.
4. Implementation includes tests and a rollback path.

Default answer for any "should we add X?" question is **use what we have**. The bar to clear is the four conditions above, not just "X is nice."

---

## Fallback rule

If uncertain, make the simplest reversible decision and proceed. Do not produce a menu of options. Do not bounce to the user for a tiebreaker.

Pick the option with the lowest blast radius and lowest cognitive cost, document the reasoning in one line, move forward. If it turns out wrong, the cost is one PR to redo.

This rule exists because asking the user for routine technical choices is the bottleneck this whole policy is designed to remove.

---

## Two-gate authority — Beta vs the Claude Code classifier

Beta authorizes within the **MC policy frame** (Class A/B/C, the rubric, this document). The Claude Code **auto-mode classifier** authorizes within the **harness safety frame** (prompt-derived intent vs proposed action). These are independent gates. Both must clear.

When the classifier blocks an action and cites intent mismatch with the user's original prompt ("user only asked to look it up", "user did not authorize publishing", etc.):

1. **Beta DECIDE does NOT override.** A MC policy verdict is not a harness override. The classifier outranks Beta on harness-safety questions. **The classifier also sits ABOVE `permissions.allow`** (mechanical layering fact, PROVEN 2026-06-09, L-2026-06-09-classifier-above-permissions-allow): a standing `Bash(git push *)` allow rule — even a turbo `push-to-main` scope — does NOT make a push-to-main classifier-immune; it still requires per-action operator intent. So β must never promise "classifier-immune auto-push" from a permissions profile (or a turbo grant) alone — push-to-main stays per-action regardless of `permissions.allow`. (DP-gap #39(b); the turbo-overrides-push-table autonomy clause, DP-gap #39(a), is now operator-ruled — see § Autonomy-ceiling resolution below.)
2. **Do not retry with Beta blessing alone.** Retrying the same Edit/Bash with a new "Beta said yes" prelude is bypass-by-rationalization; the classifier will block again and you will burn turns.
3. **Surface to the user with one short plain-text sentence** describing the action and asking for go-ahead. Do NOT use AskUserQuestion (beta-gate intercepts it). The user types yes/no; the classifier re-evaluates with that confirmation in scope.
4. **The shape echoes the autonomy table.** Push-to-remote and ≥$5 spend already "ask first" — that's an in-repo policy alignment with a harness-safety expectation. Treat classifier blocks as the same shape: confirm, don't override.

Source: L-2026-05-14-classifier-not-bypassable-by-beta (validated this session — Beta returned Class A DECIDE on the env-flag edit; classifier blocked twice anyway citing "user only asked to look it up"; the unblock was a plain-text "do it" from the user).

---

## Autonomy-ceiling resolution — turbo override of the push table (operator-ruled 2026-06-09, DP-gap #39(a))

How an autonomy-class ESCALATE resolves, and what a turbo session may carry as a durable permissions profile.

1. **An autonomy-class ESCALATE resolves UPWARD.** When β ESCALATEs an autonomy question, it resolves to the **maximum-autonomy option bounded only by the never-allowed hard ceilings** — **backup-branch deletion, service signup, purchases** (`CLAUDE.md` § Autonomy). β still escalates (the call is genuinely Class C — irreversible/outward) but **frames the recommendation as "maximum autonomy short of [the specific hard ceilings that apply]"**, not a conservative middle option; the operator selects the ceiling anyway and a conservative recommendation only adds a round-trip. The never-allowed list is the only floor β defends without flexing. (Pattern P-062; resolutions all trend upward — P-048 amaze-me, P-049 session-budget, the 2026-05-21 "option b" override.)

2. **A turbo session may carry a durable OPERATOR-DECLARED permissions profile** that grants **spend (+$100 framework default, raisable per session) + commit + branch ops + merge-to-main**, **deliberately overriding the "Push = Ask first" autonomy-table line FOR TURBO SESSIONS.** This is legitimate because it is an **operator declaration, not a self-grant** — Alex never widens its own autonomy to this profile; the operator establishes it for the session.

3. **BUT push-to-main still stays per-action.** Even with the operator-declared turbo profile and a standing `Bash(git push *)` in `permissions.allow`, the harness auto-mode classifier sits **above** `permissions.allow` and continues to gate push-to-main on per-action intent (the part (b) mechanical layering fact, § Two-gate authority point #1, PROVEN 2026-06-09 / L-2026-06-09-classifier-above-permissions-allow; gpt55 review item 5). So the turbo profile authorizes spend/commit/branch/merge **within the MC policy frame**, but push-to-main requires a per-action operator line (one typed push line per arc, or operator-run `! git push`) to clear the harness frame.

Source: DP-gap #39(a) (operator-ruled 2026-06-09, E-LIFECYCLE-001 §22 point #2 — turbo with a $100 framework-default spend ceiling, raisable per session). Part (b) (classifier-above-`permissions.allow`) integrated 2026-06-08; see § Two-gate authority point #1. Composes with DP-gap #34 (autonomous-run authorization) and DP-gap #37 (arc-level push).

---

## Consultation routing — β vs the Directors (operator-ruled 2026-05-30, DP-gap #31)

Product-strategy questions were silently bypassing β. They are not β's *or* the Directors' alone — they **compose**. Route by axis, not by whoever is convenient:

| The call is about… | Owner | Role |
|---|---|---|
| Decision **class** (A/B/C), risk, escalation red lines, the scoring rubric, autonomy-table calls, the final DECIDE / DIRECTIVE / ESCALATE verdict | **β** | the **gate** — always consulted when a call has any decision-class / risk / escalation / irreversibility dimension |
| Product **strategy**, roadmap **sequencing**, lifecycle-stage reasoning, prioritization, build-vs-buy, focus / pivot, audience | **Director of Product** | the product-**substance** authority — consulted for "what to build and in what order" |
| Test **focus**, product-priority-over-severity, robustness scope | **Director of QA** | the quality-**substance** authority |

**The rule (compose, don't compete):**
1. A call with a **product-strategy** dimension routes to the **Director(s) first** for the substantive recommendation — never silently decided by Alpha alone.
2. A call with a **decision-class / risk / escalation** dimension routes through **β** for classification + the gate verdict — never silently bypassed.
3. **Most strategic calls have both** → the Director **recommends the substance**, β **classifies + gates** it. They run in sequence (Director → β), not as rivals.
4. **On conflict:** β's gate wins on the **safety/risk axis** (it can downgrade a Director recommendation that crosses a red line); the Director wins on the **product-substance axis** (β does not re-derive strategy). Surface to the operator only when the conflict crosses a **Class C** red line.
5. **Litmus:** if you're about to make a product-sequencing/prioritization call without the Director, OR clear a risk/escalation call without β — stop; you've bypassed an owner.

Source: DP-gap #31 (β-vs-Director routing) + P-038 (product judgment bypassed β this session); flagged /beta:mine 2026-05-30, operator delegated the rule choice ("I'll trust you to pick the right routing rule").

---

## References

- **User value grounding:** `_requirements/00-canonical/PRODUCT_MODEL.md`, `CORE_BRIEF.md`, `USER_COHORTS.md`, `GOLDEN_PATHS.md`
- **Current stack:** `_requirements/03-architecture/STACK.md`
- **Reasoning frameworks:** `paths.reference/reasoning-frameworks.md`
- **Beta judgment mechanics:** `paths.judgmentModel`
- **Current product stage:** `paths.currentStage`
- **Settled architecture decisions:** `_requirements/03-architecture/` (these ARE our ADR archive, just not numbered)
- **New ADRs:** `paths.policy/adr/` — one file per decision, `NNNN-slug.md`
