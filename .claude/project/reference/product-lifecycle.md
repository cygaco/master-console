# Product Lifecycle — Phases, Priorities & Metrics

The operator-defined canonical model of how a product moves from idea to product-market fit. This is the single source of truth for **lifecycle-stage judgment** across the system — the Director of Product agent's Principle #2 grounds in it, `bootstrap:*` skills serve specific phases of it, and roadmap prioritization is graded against it.

> **Scope decision (operator, 2026-05-29):** MC — and Master Console, the productized version it powers — exist to **get products *to* PMF** (Phases 1→5). **Scaling (post-PMF) is explicitly out of scope** for now. Build the engine and the product for the idea→PMF journey first.

## The five phases

### 1 — Research
Find a **problem**, a **target audience**, and a **business strategy**. This is the "is there something here?" phase — before any building.
- **System coverage:** `bootstrap:spinup` `intent` (guided brief — problem, JTBDs, emotional drivers) + `canon` (generates `_requirements/00-canonical/*`: CORE_BRIEF, USER_COHORTS = audience, PRODUCT_MODEL = business/monetization model) with capped `research:*` fill, and `--clone` for competitor intel. *(Thin spot: explicit business-strategy / positioning beyond PRODUCT_MODEL.)*

### 2 — Early Development (Pre-Launch)
Go **0-to-1**: roadmap building, sprint planning, running sprints until you have an **MVP**. Build the **initial GTM strategy** — usually a **marketing plan + community plan**. If there's a community plan, **execution often starts before launch**.
- **System coverage:** `bootstrap:spinup` `roadmap`→`onscreen` + the `sprint:*` suite (build to MVP). `bootstrap:lastmile` (readiness audit → launch plan) covers the launch-prep / GTM tail. *(Gap: community-plan + marketing-plan authoring is not a first-class skill.)*

### 3 — Launch
The MVP **releases**, usually with the **first marketing campaign** + an **ongoing community campaign**. First real users arrive. **Priority: collect data, ask users about their experience, watch reviews, ship quick hotfixes** for glaring-but-easily-fixable problems.
- **Early metrics to optimize:** Sign-Ups · Sign-Up rate · Onboarding Completion · **Activation** (the first "aha" moment — the leading indicator of retention) · **D0 retention** · **D7 retention**.
- **System coverage:** **GAP** — no dedicated skill drives the launch data-collection / user-feedback / hotfix loop. (Master Console's cockpit + brain are the intended surface for this.)

### 4 — Finding PMF
**Tweak the product until you correctly solve the problem** and pass a **"metric check"**. Collect a *ton* of data; talk to a *bunch* of users.
- **Metric check** (on top of Phase-3 stats): **D14 retention · D30 retention · DAU · MAU · CPI · CAC · Organic Growth** (including organic as a **% of total monthly installs**). *Target thresholds depend entirely on the product and its category — there is no universal number.*
- **System coverage:** **GAP** — no skill drives the iterate-against-metrics + talk-to-users-at-scale loop.

### 5 — Product-Market Fit (PMF)
You did it — you have a product that will succeed. **Next is to scale** (out of scope here).

## Transient: Revenue
A **proven monetization system**. Some companies treat it as a **PMF qualifier**, some don't — for some product types PMF is "clear" *before* monetization is built out. **Revenue is definitely required for *scaling*** — it is the **proof to others** that the company is in-demand enough to grow. Treat it as a transient phase that may sit before, during, or after the PMF gate depending on the product.

## Pivot
Hitting PMF often requires **pivoting** — sometimes **multiple times**. A pivot resets the product (and possibly the phase) but not the institutional memory; the lifecycle is not strictly monotonic. Lifecycle-stage judgment must treat "we may need to pivot" as a live option in Phases 3–4, not a failure.

## Declaring the current stage
A product's current phase is **declared**, not guessed. Stage tokens map to the phases:
`research` · `pre-mvp` (= Early Development / Pre-Launch) · `launch` · `finding-pmf` · `pmf`.
- **Source of truth:** `paths.currentStage` (`.claude/agents/president/_system/policy/current-stage.md`) — the `**Stage:**` field. Edit + commit on a real transition.
- **Quick override:** the `MC_LIFECYCLE_STAGE` env var (session / CI / `.claude/settings.json#env`).
- **Resolve anywhere:** `node scripts/mc/lifecycle-stage.js` (precedence: env → file → `unknown`). Subagents can't read env, so the orchestrator resolves and passes the stage to the Directors on dispatch.

## How to use this
- **Director of Product (Principle #2):** situate every recommendation in the product's current phase; state the assumed phase + evidence; judge against *that phase's* priorities/metrics; let phase set the intensity of Principle #1 (Lean). Pre-MVP/Finding-PMF demand maximum leanness; the calculated-risk dial shifts toward durability only at/after PMF.
- **Roadmap prioritization:** grade items by *what the current phase needs* — Phase 3/4 reward instrumentation, data, and fast iteration over feature breadth or hardening.
- **Coverage map (today):** Phases 1–2 are skill-covered (`bootstrap:spinup` + `sprint:*` + `bootstrap:lastmile`); **Phases 3–5 are not** — the launch→PMF data/metric/iterate loop is the system's biggest lifecycle gap given the to-PMF scope.
