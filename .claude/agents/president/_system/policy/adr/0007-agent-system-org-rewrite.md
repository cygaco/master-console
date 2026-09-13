# ADR 0007 — Agent-System Org Rewrite: department tree, mode-agnostic workers, role-registry keystone, and the model-routing map

**Date:** 2026-06-04
**Status:** accepted
**Class:** B (architectural impact)

---

## Decision

Rewrite the MC agent system from four mode-coupled folders (`00-alex/`, `01-adhoc/`, `02-oneshot/`, `03-managers/`) into **one department-mirroring tree** (`president/ · product/ · engineering/ · growth/ · _system/`) of **mode-agnostic** roles, governed by a single **role registry** (the keystone every router and enforcer reads from) carrying each role's `name · call_sign · true_name? · home · tier · provider/model/effort · dispatch authority · review scope · enforcer · spec path · multiplicity`.

- **Alex = the President**; α/β/γ/δ/ε are his mode-selected **faces** (α run · β check · γ adhoc-deliver · δ oneshot-deliver · ε sprint-deliver), not separate org titles. `"Alex"` is the hidden true-name.
- Three **departments** report to the President: **Product** (ζ Director · κ Product Lead · μ Design Lead · θ Quality Lead), **Engineering** (η Director · Frontend/Backend/Security Leads → each dispatches Builder + Reviewer + Fixer), **Growth** (ι Director · λ Research · ν Copy · ο Conversion · ξ Marketing Leads). Shared `_knowledge/` is DATA fed by the leads.
- **Dispatched-reviewer model:** no monolithic `qa`/`redteam` agents — a Lead dispatches Reviewers parameterized by scope (Security Lead → Security Reviewers; Quality Lead → QA Reviewers).
- **Independence invariant (load-bearing):** no agent renders a verdict on work *it authored*; the Lead/dispatcher **cannot override a FAIL** (enforced by `scripts/checks/adhoc-fail-override.js` / `/scan:adhoc-fail-override` — it reads the GAMMA_RESULT verdict CONTENT and rejects a binding FAIL coexisting with a declared `status:pass`/`features_completed`, closing the verdict-value blind spot `gauntlet-verify.js`'s presence-only check leaves open); the reviewer roster is **registry-fixed**.
- **Multiplicity:** the **manager tier** (faces · Directors · Leads) is **single-instance / persistent**; the **worker tier** (Builders · Reviewers · Fixers) **fans out** N-at-a-time, each in its own worktree, each rendering its own binding verdict.
- **Mode-agnostic workers:** one spec per role; what changes per mode is the **orchestration** (the conducting face γ/δ/ε · the lifecycle · the composition · the autonomy posture), never the worker. This is what collapses the `01-adhoc/ ↔ 02-oneshot/` duplication.

Encode the operator-ruled **model-routing map** (§ below) into the registry.

## Context

The live agent system grew mode-first and is now structurally unsafe to extend:

- **Duplication:** two spec files per build role (`01-adhoc/` + `02-oneshot/`) — rename hazard, drift.
- **Product content in the framework spec:** `.system.md` (1433L) + oneshot `.system/*` carry a downstream product's content (session data, scraping + payment provider keys) baked into the framework tree.
- **Un-routed managers:** all 10 managers are spec-only (`agent: null` in org-map never flipped; no skill invokes `subagent_type:<manager>`; named enforcers "design, not built"). The judgment layer is **un-ROUTED, not under-built**.
- **Prose rules that get skipped:** the dispatch guide is duplicated + drifted + stale (old 7-role model), and most of its rules have no enforcer.
- **Silent false-greens (TIER-1):** `gauntlet-verify.js --roles reviewer,compliance,qa,redteam` is hardcoded in both `gamma.md`/`delta.md`; provider maps key by role NAME across `providers.js`/`catalog.js`/`state.js`; `store-validator.js` enforces a `heartbeat.agent` role enum; `scope-contract-guard.js` hardcodes `req-reviewer` — every one breaks **silently** on a rename.

The org was designed 2026-06-03 over many operator passes and **design-locked**. The complete, self-contained, deep-audited implementation spec is `runtime/notes/agent-system-rewrite-plan.md` (org §1 · folders §2 · diff §3 · checklist §4 · the §4.5 open model decision · build sequence §5 · blast-radius §6/TIER-6 · strategy §7 · skill-hook-in registry §8). This ADR records the **decision**; that plan is the **implementation**. It **supersedes the org portions** of `runtime/notes/agent-org-sprint-mode-spec.md` and the σ/COO/Chief-of-Staff naming of `runtime/notes/sprint-hook-points-design.md` (whose hook-point *mechanics* are retained for Phase D).

What changed that made this necessary: MC is now the engine under Master Console's imminent launch and the build/maintain engine for every portfolio product — the agent system has to be reliable and renamable-by-registry, not a tangle of mode-coupled hardcodes.

## Options considered

1. **Department tree + mode-agnostic workers + a single role registry (CHOSEN).** Folders mirror the org; one spec per role; faces dispatch into them per mode; everything (routers, enforcers, RESULT schemas) reads role → config from one registry, so a rename/swap is one edit.
2. **Patch the mode-coupled folders in place.** Keep `01-adhoc/ ↔ 02-oneshot/`; rename roles file-by-file; leave routing lists hardcoded. Rejected — the duplication, product-content leakage, and ~6 parallel hardcoded role-lists are exactly the bug-class; patching preserves it.
3. **Flat single-folder roster (no departments).** One `agents/` dir, no department grouping. Rejected — loses the org legibility (the "company you run" model the operator designs to), and doesn't give the manager/worker tier distinction a structural home.

## Decision criteria

Scored against the rubric in `paths.decisionPolicy` (criteria that mattered most):

| Criterion | A — dept tree + registry | B — patch in place | C — flat roster |
|---|---|---|---|
| Enforceability (no silent false-greens) | high | low | medium |
| Refactor hygiene (rename = one edit) | high | low | medium |
| Org legibility (the company model) | high | medium | low |
| Simplicity (of the result) | high | low | medium |
| Reversibility | medium | high | medium |
| Migration risk (blast radius) | medium | low | medium |

## Why this option won

A wins on the criteria that caused the pain: **enforceability** and **refactor hygiene**. The whole class of TIER-1 silent-false-greens exists because role identity is duplicated across ~6 routing/role-list files plus `gauntlet-verify.js` and the RESULT schemas; a single registry that all of them READ FROM makes those breaks **structurally impossible** (the parity scans verify registry ↔ specs ↔ routing) and turns every future rename into one edit. B scores highest only on reversibility/migration-risk — but B *is* the status quo that produced the bug class, so its low enforceability is disqualifying. Tiebreaker: the operator designed the org as a legible "company you run," which A expresses directly and C discards.

## The model-routing map (resolves rewrite-plan §4.5 — the one open decision)

Operator rules: (1) reviewers "smarter" than doers **and** on a different provider; (2) doers & fixers may share a model if (1) holds; (3) President is the smartest — **α is LOCKED at the top**, exceptions allowed for other faces; (4) **one** product role (dir/lead/designer) must be **gpt-5.5**; (+) mix effort/thinking per dispatch. **Effort policy (operator override 2026-06-04):** avoid `max` in most places — `max` is reserved for very big projects **and only the top face (α)**; everything else caps at the model's high-water mark; gpt-5.5's ceiling is `xhigh`.

Consulted β (Class B, confidence 0.88 — reasoned, not canned). β returned **DECIDE**, both forks resolved:
- **FORK-1 → reading (A):** cross-provider-**flagship** diversity. Doers stay on the **strongest** model (Opus); reviewers are peer-flagships on a **different provider** at top effort. Reading (B) — Sonnet on builders to force a literal "tier up" — was rejected as deliberately handicapping the artifact that ships; "smarter than" = independent + ≥-capable on a different provider (different blind spots), which is what the cross-provider rule was always for.
- **FORK-2 → μ Design-Lead = gpt-5.5:** bullseye on the operator's stated reason ("best at product design / UX / flows" = the Design Lead's job). ζ DoP would satisfy the letter and miss the why.

| Role(s) | Provider | Model | Effort |
|---|---|---|---|
| **α** (run) | claude | claude-opus-4-8 | **max** ← the sole `max` (top + big-project) |
| **β** (check, binding) | claude | claude-opus-4-8 | xhigh |
| **γ / δ / ε** (deliver) | claude | claude-opus-4-8 | high |
| **ζ** DoP · **η** DoE · **ι** DoG | claude | claude-opus-4-8 | high |
| **κ** Product Lead · **θ** Quality Lead | claude | claude-opus-4-8 | high |
| **μ** Design Lead | **openai** | **gpt-5.5** | xhigh |
| Frontend / Backend / Security **Leads** | claude | claude-opus-4-8 | high |
| FE / BE / Security **Builders + Fixers** (doers) | claude | claude-opus-4-8 | **high** (not max) |
| FE / BE **Reviewers** · **QA Reviewer** · **Security Reviewer #2** | openai | gpt-5.5 | xhigh |
| **Security Reviewer #1** | gemini | gemini-3.1-pro-preview | thinking-on (no flag) |
| **learner** | openai | gpt-5.5 | xhigh |
| **λ** Research · **ν** Copy · **ο** Conversion · **ξ** Marketing | claude | claude-opus-4-8 | high |
| **design-quality** · **visual-review** | claude (PINNED) | claude-opus-4-8 | high |
| **test-runner** · **stub-scaffold** | claude | claude-sonnet-4-6 | medium |

Preserved invariants (β-verified): cross-provider diversity (≥1 reviewer off the builder's provider) ✓ · the 2nd-GPT security pass (Security Rev #1 Gemini corpus-diverse + #2 OpenAI jailbreak-tuned) ✓ · model-by-risk/effort ✓. All model IDs verified real & current in the live console (catalog.js).

## Carve-outs (recorded so a future parity scan does NOT "fix" them as violations)

1. **Claude-pinned visual review.** `design-quality` and `visual-review` are pinned to **Claude** because their judgment is *visual* (Playwright-MCP screenshots/computed-style), a capability only the Claude harness has. Their independence is the **binding verdict** (they grade, they don't author), **not** provider diversity. This is a deliberate, justified exception to the cross-provider-diversity rule — `scan:dispatch-routing-parity` / `scan:role-parity` must treat it as sanctioned, not a diversity defect.
2. **Cross-provider diversity is a dispatch property of the Reviewer**, not a separate agent type — a renamed/rehomed reviewer carries its provider assignment in the registry.

## Re-ratify-at-build items — RATIFIED 2026-06-04 (η + β)

1. **All-persistent residency.** Plan-of-record: managers are persistent singleton org members the sprint *assigns* (not re-spawns) at hook-points; the always-live in-process team is the thin α + β + ε spine. The earlier design was leaner (α + β + ε only persistent, managers ephemeral-by-composition). Build the reconciled form (persistent identity, materialized at hook-point; in-process for Claude managers, subprocess-consult for cross-provider ones like μ) and re-confirm.
2. **DoE-as-orchestrator.** η dispatches the engineering pods (inherits γ's dispatch independence); the invariant is "no agent judges work it authored + dispatcher can't override the verdict," NOT "judges don't dispatch." Confirmed by RT-2026-06-02-doe-dispatch-independence. The residual to encode: the gauntlet roster + scope is **registry-fixed, not DoE-chosen**. The "dispatcher can't override the verdict" half is now machine-enforced by `scripts/checks/adhoc-fail-override.js` (`/scan:adhoc-fail-override`) — a verdict-CONTENT check, distinct from `gauntlet-verify.js`'s record-presence check.

**Ratification (2026-06-04 — η + β, independent parallel consults under the P-043 real-verdict mandate; both verified claims on disk, not prose):**
- **Item 1 (residency) → DECIDE** (β 0.84 · η 0.85). The lock is on **identity/multiplicity**, which is already encoded reality: `role-registry.json` gives managers `multiplicity:singleton` / workers `fan-out`, and μ carries `dispatch_path: subprocess-consult`. The runtime materialization (assign-at-hook-point; the operational binding of "live vs dormant") is correctly **Phase D** — locking the contract before the runtime that reads it is the right dependency order, and reversibility is high (one registry edit per role).
- **Item 2 (DoE-as-orchestrator) → DECIDE** (β 0.87 · η 0.90). Both guardrails verified real: `adhoc-fail-override.js` does a genuine verdict-CONTENT check (fail-closed exit 2, bite-tested, hard gate in `/scan:full`); the gauntlet roster is **registry-derived** (`org-roles.expectedGauntletRoles`, no hardcoded `--roles`; `dispatch-route-guard` blocks dynamic reviewer lists; lead specs state "registry-fixed, not Lead-chosen"). η cannot hand-pick a friendly reviewer or override what it finds.
- **Reporting-line invariant** (operator 2026-06-04: *"reviewers can't report to doers; doers can report to reviewers; both can share a manager"*) **→ SATISFIED + now ENFORCED**. Verified satisfied in the authoritative source (every reviewer's `dispatchable_by` resolves to its Lead — a coordinator, never a doer). β DIRECTIVE built: `scripts/checks/role-parity-scan.js` now asserts no `kind:reviewer` role is `dispatchable_by` any doer (`kind∈{builder,fixer}` or `build_chain:true`), as a critical finding (non-zero exit), fail-closed, against the **role-registry** keystone (NOT the stale org-map) — proven by a violating fixture (`role-parity.test.js`, 23/23). Closes the silent-violability gap.
- **Riders logged (non-blocking):** ED-023 (`adhoc-fail-override` `REVIEWER_KEYS` literal-drift — the Tier-1 class inside the override enforcer), ED-024 (org-map engineering block stale vs the registry → the v0.2 structural migration), ED-025 (the override check covers the adhoc/γ path only; the ε/sprint/DoE path is **Phase D**). The two re-ratify items are now **decided + confirmed**; the residency runtime + the ε-path override coverage remain Phase-D build items, as planned.

## Risks

- **R1 — Silent false-greens during the rename.** `gauntlet-verify.js`, the provider maps, `store-validator.js`'s `heartbeat.agent` enum, `scope-contract-guard.js`'s `req-reviewer` hardcode, and the GAMMA/DELTA_RESULT `gate_checks` field names all key by literal role name and break **without erroring**.
- **R2 — Tier-3 behavior loss.** Unique logic (reviewer holdout-fixture + Check-7; req-reviewer's 6 traceability checks; compliance COPY exact-match; qa's 13 personas + `tools: Agent`; redteam's deterministic-scan + attack-chain + 2nd-GPT; the δ state-machine/heartbeat/learner loop) can be dropped in a clean rewrite.
- **R3 — Blast-radius miss.** ~60 `redteam` references + `qa`/`builder`/`fixer`/`compliance` across scripts/routing/maps/manifests/tests/sprint-artifacts; the file you forget is the whole bug class.
- **R4 — Hook no-op after rename.** ~65 hooks; a fail-open/advisory hook referencing a renamed role **no-ops silently** (false-green).
- **R5 — β model bump misread as "P-043 solved."** Upgrading β to Opus/xhigh does NOT fix the canned-verdict failure.
- **R6 — Cross-provider μ.** A gpt-5.5 Design Lead can't be an in-process Claude teammate.

## Mitigations

- **R1 →** Build the **one role registry** first; rewire `gauntlet-verify` + provider maps + store-validator + scope-contract-guard + RESULT schemas to READ from it; **extend `scan:role-parity` to scan hooks for hardcoded role literals**; gate on `scan:role-parity` + `scan:dispatch-routing-parity`. Read each flagged hook BEFORE the rename.
- **R2 →** Port every Tier-3 behavior **verbatim** with its renamed role (rewrite-plan §6 Tier-3 is the checklist); the holdout-fixture, the 6 traceability checks, the 13 personas (+ `tools: Agent` on the Quality Lead), the deterministic security scan, and the δ machinery travel with their roles.
- **R3 →** Grep the OLD literal everywhere (not just specs) per `refactor-hygiene`; update `org-map` + `org-roles` + `catalog` + `dispatch-route-guard` + `dispatch-claude` + the guide **together**.
- **R4 →** Rebuild the hook registry (`scripts/hooks/build.js`) + run `node scripts/hooks/test.js --all` GREEN, wired into `/scan:full`; verify each hook FIRES post-rename, don't assume.
- **R5 →** Keep the **β real-verdict honesty contract** (real per-consult reasoning + UNREASONED/abstain rule + `scan:sprint-beta-honesty` as a release gate) as its **own tracked build item** — the registry edit does not retire it.
- **R6 →** μ dispatches via the established `dispatch-agent.js` (`codex exec`) subprocess-consult path — the same pattern every reviewer/qa role already uses, and the context-preserving lever (rewrite-plan §2). Not a new mechanism.

**Cutover safety (hard gate):** the old tree is deleted **only when `/scan:full` is GREEN** (rewrite-plan §5 step 6). Foreground builds only — **no background `claude -p --agent builder`** until CP-B1 lands (RI-004). Converge: re-run the gates, don't single-pass.

## Reversal plan

The registry is JSON: any role's provider/model/effort/scope is **one edit**, instantly reversible (re-run the parity scans + regen manifests). The structural rewrite (folder collapse) is reversed via git — the old tree is preserved until `/scan:full` is green, so reversal before cutover is `git restore`; after cutover, the prior commit. Reversal triggers: a parity scan that can't be made green, a Tier-3 behavior that can't be ported faithfully, or a downstream consumer-contract break the clean-room sim catches.

## References

- **Implementation spec:** `runtime/notes/agent-system-rewrite-plan.md` (authoritative — §1–§8). Master plan + recovery anchor: `DUMP.md`. Visual org: `AGENT-STRUCTURE.md`.
- **Supersedes (org portions):** `runtime/notes/agent-org-sprint-mode-spec.md`; the naming in `runtime/notes/sprint-hook-points-design.md` (mechanics retained).
- **Related ADRs:** [0003](0003-manager-principles-inheritance.md) (manager-principles slug registry — the principles seed the keystone extends), [0004](0004-oneshot-arbitration-needed-state.md) (per-mode director participation), [0006](0006-sealed-capsule-consumer-contract-gate.md) (the consumer-contract gate the clean-room sim uses).
- **β consult:** EVT model-routing DECIDE (Class B, 0.88), 2026-06-04 — both forks resolved (FORK-1 → A, FORK-2 → μ); riders: keep β-honesty tracked, record the Claude-pin carve-out (done above).
- **Traces:** RT-2026-06-02-{judgment-pipeline-wiring, doe-dispatch-independence, ponder-engine-vs-product}.
- **Seed registries this keystone unifies:** `.claude/agents/03-managers/_org/org-map.json` (structure) + `.claude/agents/03-managers/_principles/registry.json` (principles).
- **Implementation:** branch `june-2` (this rewrite); commit TBD.
