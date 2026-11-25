# Decision Policy

The single source of truth for who decides what, what triggers escalation, how to score competing options, and when a new dependency is allowed.

Read on every Beta invocation (after `judgement-model.md`). In solo mode, Alpha consults this directly via `CLAUDE.md`.



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

### Class C — Ask the operator

Only the three triggers in § Escalation red lines. Beta returns ESCALATE with **one recommended answer**, not a menu. Alpha asks the user only after this verdict.

Examples:
- Pricing, positioning, a public launch, a compliance posture users are promised — each is a new public surface
- Payment architecture or a vendor contract that costs $5 or more
- Deleting data, retention that destroys records, exposing a credential — each is irreversible

**State-conditional resolution.** A legitimate
Class C resolution is to **defer the call to the decision point and make it
state-conditional** — "decided at launch-time based on the state then" — rather than
pre-committing to a premature binary now. β returns this (with one recommended answer)
when the right choice genuinely depends on state that does not exist yet (e.g. a call
that depends on the product's state at launch: decided at launch-time, not pre-committed).
Requirement: name **the state that will drive it** and **the decision point** at which
it resolves. This is a real resolution, not a punt — do not force an early binary just
to "close" the question.

---

## Escalation red lines (Class C triggers)

Only these three go to the operator:

- **A new public surface** — a release not yet approved (a package, a deploy, a post), a new public repo, a visibility change, a new registry, pricing, positioning or compliance claims (promises about user data included); see the push and publish rule below
- **Spend of $5 or more** — API costs, paid plans already signed up for
- **An irreversible action** — deleting data, rewriting history, force-pushing, exposing a credential, a secret or a user's data off this machine

**Never allowed** (`CLAUDE.md` § Autonomy) — signing up for services, making purchases, deleting backup branches. These are not asked about; they are not done.

**Everything else is decided internally.** An internal, undoable call that β would approve goes ahead; the operator gets one line saying what was decided and its real undo: a revert, a backup id or a command that exists, never an abstract claim that it can be undone. One β would refuse is not made. An ESCALATE costs hours when the operator is away, so when unsure about an internal undoable call, take the more reversible option and report it.

**The push and publish rule** (`CLAUDE.md` § Autonomy carries the same three parts):
1. Pushing green work to the operator's own repos, private or public (branches and main), does not ask. A push whose destination is public first passes the zero-personal-content check and carries a security read of what is new since that repo's last public state.
2. Publishing a release the operator already approved by name does not ask again; it goes through the project's release or publish command after its content checks.
3. Asked once: a release not yet approved, a new public repo, a visibility change, a new registry, pricing, positioning or compliance claims. These are what "a new public surface" means.

**Unratified views are advice.** A pending item in `paths.judgmentModel` is cited and labelled as unratified, never as the reason a call goes to the operator.

### Build-the-seam on a missing dependency — NOT an escalation

A **missing external credential / account / service is NOT an escalation and NOT a stop.** On a missing dependency, β directs **building the interface seam** (interface + adapter + deferred-credential/stub path) and **continuing the run**; the actual signup/purchase stays **operator-owned** and is surfaced as a **non-blocking deferred lastmile item**, never a mid-run halt.

This does **not** touch the never-allowed hard ceiling: **building the seam is not signing up.** "Sign up for services / make purchases" remains operator-only (`CLAUDE.md` § Autonomy), and the never-allowed list above stands unchanged — this clause only forbids treating the *absence* of a credential/account as a reason to halt. It **removes an escalation path; it adds no authority.** Composes with `CLAUDE.md` "Never escalate"; this pins the *missing-dependency* case specifically.

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

**Completeness bar for "migration/inventory complete" or "all callers handled" DECIDEs** (a verification-rigor check, not a new red line). Before returning DECIDE that a migration, rename, or inventory is *complete* — or that *all* callers/uses of a target are handled — require evidence that:

1. **Every surface form of the target was searched** — literal key + prose/informal mention (e.g. bold-backtick `**`role`**` dispatch) + alias + indirect reference. A single-surface-form scan is a lower bound, not a count. (Forward-search analog of the Refactor-Hygiene "grep ALL occurrences of the OLD literal" rule.)
2. **Any retired-identifier guard backing the claim is scoped to the no-legitimate-residual class** — partition old/`was` names into (a) fully-retired-no-legitimate-use and (b) still-valid-elsewhere, and fail-flag only (a). An over-broad detector floods false-reds and gets dismissed (the false-green inverse).

This complements — and is distinct from — the rename-hygiene rule (which is about the OLD literal specifically): this bar is about completeness of the *forward* search and the *precision* of the backing detector.

**Policy-key-must-fire bar for "this policy is enforced" DECIDEs** (a verification-rigor check, not a new red line). A policy/registry KEY (e.g. a security `second_pass` / `third_pass` field, a role→provider map, a `requires_*` flag) enforces **nothing** unless a dispatch/execution loop actually **reads and fires it**. Before returning DECIDE that a policy is *enforced* — or that a declared "N passes / all 3 providers / required step" actually happens — require evidence that a **runtime consumer reads the key and acts on it**, not merely that an enforcer/validator *checks the key is present*. A field read only by validators (model-chain / role-parity) but never by a dispatch loop is a **declarative lie** — the same false-green class as a lying enforcer and the project-wide Policy-Enforcement-Hygiene rule ("every policy needs a named enforcer" applies to the *firing*, not just the *declaration*). β treats a policy key with no firing consumer as unenforced.

---

## Severity discriminator — report-vs-store falsehood

When rating a dishonesty/incoherence finding, name the discriminator BEFORE rating, then rate at source:
a **store-state falsehood** — the SYSTEM is in a broken or other-than-reported state and the report hides it —
is **HIGH**; **report-field incoherence over an honest store** — the system is fine, only the report about it
contradicts itself or a sibling surface — is **MEDIUM**. Fixed here so it is not re-derived differently per
sprint. Consumer: β loads this file on every invocation and carries the bar.

## Review and hold rules

The one home of these rules; ε, γ, δ, the leads, reviewers and fixers point here.

1. One review round per unit, readers in parallel, depth sized to the change's risk.
2. Only three things hold a unit: a security hole an outsider could use, data loss, or a false claim about a user's data. Every other finding, at any severity, becomes one known-issues row (in the lane's status file and the result's `risks_remaining`) and is fixed afterwards.
3. A finding that needs an attacker who can already edit the project (its files, PATH or settings) is a known issue, not a hold.
4. After a fix, check the fix against the finding it answers. Do not re-read the whole unit.
5. Two rounds is the ceiling, and the second needs a product reason stated in one sentence.
6. A finding holds only the unit it blames. Units that passed land.
7. No rule stops a whole lane, and a lane writes no stop rule for itself in advance.
8. Every "on hold" report starts with one plain sentence saying what is broken.

A unit still held after the ceiling is set aside with its finding's row (carrying rule 8's sentence), and the rest of the lane goes on.

Three things are not review findings and are never deferred: nothing personal ships (the no-personal-content rule and its check stay fail-closed), anything going public gets its security read first, and tests and the build pass before a unit lands.

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

1. **Beta DECIDE does NOT override.** A MC policy verdict is not a harness override. The classifier outranks Beta on harness-safety questions. **The classifier also sits ABOVE `permissions.allow`** (mechanical layering fact): a project allow rule or a turbo grant does not clear it; only the operator's own settings do. When it refuses a push, report "the safety check refused it" and never reshape the command.
2. **Do not retry with Beta blessing alone.** Retrying the same Edit/Bash with a new "Beta said yes" prelude is bypass-by-rationalization; the classifier will block again and you will burn turns.
3. **Surface it to the operator as one `⚠️ DECISION NEEDED`** (`CLAUDE.md` § Talking to the Operator): the action and one recommendation, the question last. The user types yes/no; the classifier re-evaluates with that confirmation in scope.
---

## Autonomy-ceiling resolution

**An autonomy-class ESCALATE resolves UPWARD.** When β ESCALATEs an autonomy question, it recommends the **maximum-autonomy option bounded only by the never-allowed hard ceilings** — **backup-branch deletion, service signup, purchases** (`CLAUDE.md` § Autonomy) — not a conservative middle option; a conservative recommendation only adds a round-trip. The never-allowed list is the only floor β defends without flexing.

**A turbo session may carry an OPERATOR-DECLARED permissions profile** granting spend (+$100 framework default, raisable per session), commit, branch ops and merge-to-main — an operator declaration, never a self-grant. Pushes need no turbo profile: a push of green work to the operator's own repos is the lead's call in every session.

---

## Consultation routing — β vs the Directors

Product-strategy questions are not β's *or* the Directors' alone — they **compose**. Route by axis, not by whoever is convenient:

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

---

## References

- **User value grounding:** `_requirements/00-canonical/PRODUCT_MODEL.md`, `CORE_BRIEF.md`, `USER_COHORTS.md`, `GOLDEN_PATHS.md`
- **Current stack:** `_requirements/03-architecture/STACK.md`
- **Reasoning frameworks:** `paths.reference/reasoning-frameworks.md`
- **Beta judgment mechanics:** `paths.judgmentModel`
- **Current product stage:** `paths.currentStage`
- **Settled architecture decisions:** `_requirements/03-architecture/` (these ARE our ADR archive, just not numbered)
- **New ADRs:** `paths.policy/adr/` — one file per decision, `NNNN-slug.md`
