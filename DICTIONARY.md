# Dictionary

Project glossary. Alphabetized. Short entries, example-anchored. Add terms as they come up.

---

## Activation

The first "aha" moment — when a new user gets the product's core value for the first time. The **leading indicator of retention**, so it's the headline activation metric at Launch. Distinct from sign-up (account created) and onboarding completion (finished setup). See `.claude/project/reference/product-lifecycle.md`.

## Beta consultation

The mechanism by which Alpha (the architect) consults Alex β (the judgment model) before surfacing a non-trivial decision to the user. β returns `DECIDE` (proceed), `DIRECTIVE` (proceed with named adjustment), or `ESCALATE` (surface to user with `ESCALATE:` prefix). Enforced by the beta-gate hook — Alpha cannot call `AskUserQuestion` in adhoc mode without a prior β consult. Full protocol in `paths.decisionPolicy`.

## CAC / CPI

**CAC** (Customer Acquisition Cost) — total spend to acquire one customer. **CPI** (Cost Per Install) — the install-funnel analog. Both are Finding-PMF metrics weighed against retention and organic growth: cheap acquisition that doesn't retain isn't fit. Target values are product/category-specific. See `.claude/project/reference/product-lifecycle.md`.

## Capsule

A versioned snapshot of MC shippable under `framework/releases/<X.Y.Z>/`. Each capsule carries `release.json`, a manifest snapshot, and the canonical source files needed for a downstream consumer to run `/mc:update --to X.Y.Z --apply`. A version bump in `version.json` without a corresponding capsule is a "hollow rung" — `/mc:update` will fail when downstream reaches for it.

## Contractless productization

The root anti-pattern behind MC's recurring "downstream always missing / install broken" class: there is **no hard boundary between the framework's authoring state and its shipped runtime contract**. The same `.claude/` + `scripts/` tree is at once the source, the test bed, the release artifact, and the only fully-exercised install — so what a clean consumer actually *receives and can run* is never tested as a separate thing. Symptoms: fresh-install partial wiring, two-manifest drift, version-quorum disagreement, repo-role-blind guards (a canonical-only check firing in a product, or vice-versa), and fail-open false-green. The fix is **artifact-first, contract-tested releases** — build one sealed capsule from a single bill-of-materials, install *only that capsule* into a disposable out-of-tree repo, and run an executable consumer contract (`setup → scan:install → a real sprint → dispatch telemetry → update`) under both repo roles before shipping.

**Example.** The 2026-05-26 MC.md reconciliation: of ~50 gaps four products flagged, ~half were already fixed upstream (the registers reflect each product's *installed* version, not canonical), and the framework blocked its own maintainer twice mid-fix — framework-purity refused a commit, the requirements gate refused a merge — because both guards were repo-role-blind. Coined 2026-05-26 via `/fix:deep` + a GPT-5.5 cross-provider consult; full record at `runtime/notes/mc-reconcile-root-cause-2026-05-26.md`.

## DAU / MAU

Daily / Monthly Active Users — the usage-breadth metrics tracked from Finding-PMF onward. Their ratio (DAU/MAU) is a rough stickiness signal. Healthy thresholds depend on the product and its category. See `.claude/project/reference/product-lifecycle.md`.

## Forcing function

A constraint or structural setup that makes you face a decision you've been avoiding. Not a hammer or a deadline — the value isn't pressure, it's the removal of your ability to keep dodging. The output is clarity, not the artifact the forcing function produces.

**Example.** Standing up an `@mc/cli` npm-package shape of MC in parallel to the current canonical-clone model. Even if the npm version is never adopted, building it forces the question *"which of our current sprints would be wasted under that shape?"* — a question easy to deflect when only the current shape exists. The parallel build doesn't have to succeed; its job is to make the comparison unavoidable.

## Funnel metrics

The top-of-funnel Launch metrics: **Sign-Ups** (count), **Sign-Up rate** (visitors → accounts), and **Onboarding Completion** (accounts → finished setup). They precede Activation in the funnel and are the first things to watch and hotfix at Launch. See `.claude/project/reference/product-lifecycle.md`.

## Ledger discipline

The rule that every sprint and every release writes a row to two canonical repo-root docs: `ROADMAP.md` (sprints, planned/in-flight/closed) and `RELEASES.md` (version bumps with capsules). The ledgers are auto-managed by `scripts/sprint/ledger.js` — manual edits remain valid but may be overwritten on the next `/sprint:*` or `/mc:release` invocation. Enforced by the policy "every policy needs a named enforcer" — see `CLAUDE.md#Policy & Enforcement Hygiene`.

## Organic growth

Growth from users who arrive without paid acquisition (word of mouth, referrals, search). A Finding-PMF metric — tracked in absolute terms **and as a % of total monthly installs**; a rising organic share is one of the strongest PMF signals. See `.claude/project/reference/product-lifecycle.md`.

## Pivot

A deliberate reset of the product (and possibly its lifecycle phase) in pursuit of PMF — changing the problem, audience, or approach when the metric check won't pass. Reaching PMF often requires pivoting, **sometimes more than once**. Institutional memory survives a pivot; the phase clock may not. See `.claude/project/reference/product-lifecycle.md`.

## Plan Contract

The structured artifact produced by `/sprint:plan` that turns a plain-language request into evidence-labeled assumptions, scope variants, and a plan-quality verdict. Lives at `paths.sprintPlanContracts/PC-YYYYMMDD-NNNN.yaml`. Carries `source_request_verbatim` (never paraphrased), affected surfaces with `evidence_level`, safe vs unsafe assumptions, ESD candidates, approval boundaries, and a `plan_quality.status` of `pass | needs_design | needs_user_clarification | blocked`. The contract is what downstream phases (design, execute, release) inherit.

## Product lifecycle

The operator's canonical five-phase model for taking a product from idea to product-market fit: **1 Research → 2 Early Development (Pre-Launch) → 3 Launch → 4 Finding PMF → 5 PMF**, plus a transient **Revenue** phase and the reality that **pivots** happen (sometimes repeatedly). MC and Master Console are scoped to get products **to PMF (1→5)** — scaling is out of scope. Full model, per-phase priorities, and metrics in `.claude/project/reference/product-lifecycle.md`; the Director of Product agent's Principle #2 judges against it.

## Product-market fit (PMF)

Phase 5 — a product that correctly solves the problem and **passes the metric check** (Launch funnel + Activation + D0/D7/D14/D30 retention + DAU/MAU + CPI/CAC + organic-growth %, at product/category-appropriate thresholds). The goal state MC / Master Console drive toward; next is scale (out of scope). **Revenue** may or may not qualify PMF depending on product type. See `.claude/project/reference/product-lifecycle.md`.

## Retention (D0 / D7 / D14 / D30)

The share of users still active N days after first use — **D0** (same-day return) and **D7** are watched from Launch; **D14** and **D30** join the Finding-PMF metric check. Cohort retention is the core PMF signal: does the product create *pull*? Healthy curves are product/category-specific. See `.claude/project/reference/product-lifecycle.md`.

## Revenue (phase)

A transient lifecycle phase — a **proven monetization system**. Some products treat it as a PMF qualifier; for others PMF is clear before monetization is built out. **Revenue is required to *scale*** — it's the in-demand proof that justifies growth to outsiders. Don't conflate "no revenue yet" with "no PMF." See `.claude/project/reference/product-lifecycle.md`.

## Routing policy

The mapping from sprint phase → required model class and diff-review requirement, declared at `paths.sprintRouting`. Phases: planning (`strongest_reasoning`), design (`strong_reasoning`), execution (`economical_coder`), qa, redteam, release. Each phase's `diff_review` flag triggers a cross-vendor review when available. Routing is **enforced**, not aspirational — traces are recorded to `paths.sprintDecisions/routing-trace.jsonl` and `/sprint:release` refuses to ship when a required phase lacks a trace (SP-20260514-002).

## Sprint

A bounded unit of work managed by the four `/sprint:*` skills (`plan`, `design`, `execute`, `release`). Identified by `SP-YYYYMMDD-NNN`. Each sprint has its own Plan Contract, requirements bundle, tickets, ralph loops, checkpoints, and final report. Active sprints are tracked in `paths.sprintActiveRegistry` with one designated as `primary`. Per-sprint state under `paths.sprintSprints/<SP-id>/`.
