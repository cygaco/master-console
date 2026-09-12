# WarpOS System Update — FINAL PLAN (v1.1 — GPT‑5.5-reviewed)

_2026-05-30. **Execution target: a NEW session.** This session produces the plan + the `/session:dump` handoff; the next session executes._
_Supporting docs (read alongside): `_planning/ORG.md`, `_planning/MODES-RECONCILE.md`, `_planning/consult-gpt55-summary.md`, `_planning/ingest/SYNTHESIS.md`, `_planning/ingest/{videos,gdocs-A,gdocs-B,higgsfield}.md`, `_planning/sources/SOURCES.md`._

## 0. How to use this (new session)
Read this + `DUMP.md`. Execute **Wave 0 (chassis) → Wave 1 (modes) → Wave 2 (domain agents, parallel) → Wave 3 (pilot)**. Edit `.claude/` (authoritative in canonical), `scripts/`, `_requirements/`, `framework/templates/`; **regen both manifests last** (`node scripts/generate-framework-manifest.js && node scripts/warpos/manifest/build.js`). Enforcer-first: ship no manager/policy without its enforcer.
**Wave 0 has an internal gate:** do **S0A (contracts + org map) before S0B (enforcers/scaffold/etc/Higgsfield)** — see §6. Do **not** create any agent before its input/output artifacts and the scans that validate them exist.

## 1. North star (the reframe)
WarpOS is a great autonomous **engineering team** and a poor **go-to-market engine**. This update completes it into an autonomous **product studio** by adding the three missing functions — **Design, Marketing/Growth, Audience-Research** — plus the **org** and **modes** to run them.
**Convergence insight:** the original complaint ("our sites are vibe-coded; *clarity is king; clear beats witty*") and an external brand-building methodology's (paid course, not redistributed) ("*copy > creative, clarity > cleverness, message-first*") are the **same principle**. The whole update is ONE discipline — **research → message → creative → iterate** — of which converting design/app UX is the *output*. The unit of work shifts from **feature → launch.**
**The spine is the `message_brief`** (the winning message). Audience dossiers feed it; offer/conversion, design, build, and every ad/advertorial/landing artifact derive from it. Build the **artifact/eval spine first** — it is the durable value; the org vocabulary is in service of it.

## 2. The org (v1 — operator-blessed)
```
 α  (orchestrator)        β  — referee across ALL domains: cross-domain conflict, risk, final ship gate
 ┌───────────────────────────┬────────────────────────────┬───────────────────────────┐
 DIRECTOR OF PRODUCT MGMT     DIRECTOR OF MARKETING          DIRECTOR OF ENGINEERING
 ├─ Product Lead              ├─ Growth Lead                 ├─ Frontend Builder
 │   └─ Product Designer      │   (media-buyer; EQ;          ├─ Backend Builder
 │      (app UI/UX)           │    SCALE/TEST/SKIP)          │   (+Foundation/Integration if needed)
 ├─ QA Lead                   ├─ Copy Lead                   └─ Code-QC gauntlet:
 │   (product-driven;         │   (Agora/E5 voice;              Reviewer · Compliance · Red-Team · Fixer
 │    directs QA scanner)     │    owns the "Chief" review)
 └─ Research/Insight Lead     └─ Web/Conversion Designer
     (deep audience layer)        (landing pages that convert)
```
**Decision model:** per-domain owners decide in-domain; **β is the gate/referee** (cross-domain conflict, risk, final ship). **Shared Manager Principles base** (clarity is king + de-duplicated director principles) inherited by every Director/Lead.
**Design authority (v1.1, was a v1 gap GPT flagged):** consistency across app-design (Product) & web-design (Marketing) is owned by a **design-quality gauntlet** that approves tokens, component usage, visual hierarchy, mobile/responsive, accessibility, and design handoff — *a component library alone is not an owner; libraries don't make judgment calls.* The gauntlet IS the named approver. (Whether to instead restore a human-style **Design Lead** role is flagged for the operator — §10c.) Full detail: `_planning/ORG.md`.
**Claims boundary:** Marketing owns the **market promise** (`message_brief`); Product owns the **product-verifiable claim** (`offer_brief`) — they must not blur, and security/compliance review stays **independent of Product/Marketing pressure** (its own gauntlet lane).

## 3. Modes reconciliation (the integration seam)
Modes = *how a run executes* (Solo / Adhoc / Oneshot); the org = *the cast*. The friction: modes are **engineering-only** today. Reconcile by generalizing **build → work modes**:
- **Solo** unchanged. **Adhoc** = org's live home (β gates, Director/Lead judges live, γ dispatches the domain's doers through that domain's gauntlet). **Oneshot** = autonomous full-pipeline launch (the pilot).
- **Directors participate differently per mode:** *live-consulted* in adhoc; *encoded as contracts + enforced gauntlet checks* in oneshot (no α/β there). → **in autonomous mode a manager only exists as an enforcer.**
- **Enforcers must reject bad work, not lint it.** Generic "manager principles" encoded as checklists become ceremonial. Oneshot enforcers must be specific enough to fail real defects, and must have an explicit **fail-closed → "arbitration-needed" record** state when contracts conflict or confidence is low (the oneshot stand-in for α/β escalation). Artifact contracts must declare **precedence** so per-domain gauntlets can't deadlock.
- Work: generalize γ/δ to **domain-aware dispatch**; **per-domain gauntlets**; **repartition agents by domain** (today `01-adhoc/`+`02-oneshot/` duplicate each role — don't 2× every new role); extend role registry/team-guard. **One manifest/check owns role parity** (repartitioning by domain creates registry drift otherwise). Full detail: `_planning/MODES-RECONCILE.md`.

## 4. Reconciled scope (every ask → structure)
| Original / added ask | Lands in |
|---|---|
| Multi-manager decisions; shared principles; hierarchy; Dir of Marketing | **Org + decision routing + enforcer** (Wave 0) |
| Deep audience layer ("everything about them") | **Research/Insight + audience mining** (= Mark's research engine) |
| Product Designer (app UI/UX) | **Product domain** |
| Web/conversion design + marketing + Mark's funnel | **Marketing domain + growth skill-pack** |
| "Integrated but unused" UI frameworks | **Component-library scaffold wiring** (Wave 0 / S0B) |
| Split builder FE/BE | **Engineering domain** |
| /etc skill | **Authoring+eval harness** (Wave 0 / S0B) |
| Higgsfield "use it from here" | **Embed via MCP/CLI — COMMITTED (operator 2026-05-30), Wave 2 (S2.2 creative step); MUST land before the pilot finishes** |
| Integrate into bootstrap/portfolio/lastmile | **Pilot wires the pipeline into lastmile/spinup/portfolio** (Wave 3) |
| Higgsfield-as-platform blueprint | **W-Platform — deferred (post-pilot)** |

## 5. Sequencing philosophy
**Prove, not position.** **Enforcer-first** (GPT‑5.5 + ponder + system history: managers without enforcers = theater; and in oneshot a manager *is* its enforcer). Build the chassis + contracts + scaffold **before** expanding agents; then prove ONE product end-to-end; expand only after the loop works. Build the **minimum org needed to run the pilot without ambiguity** — not the full vocabulary up front. Don't "mine everything" (segment-level, source-attributed, confidence-scored, no PII; synthetic claims labeled). Don't make /etc a chain-of-thought warehouse.

## 6. The parallel sprint plan
**Wave 0 — Chassis & Contracts.** Internal gate: **S0A first (the shared interface), then S0B (built against S0A's contracts).** Publish the org-map + artifact-contract schemas (S0A) before anything in S0B hardens.

**Wave 0A — Contracts + org map (land first):**
| Sprint | Goal | Touches |
|---|---|---|
| **S0.2** Artifact contracts **+ decision-record schema** (the spine) | schema v0.1 for the chain `audience_dossier → message_brief → offer_brief/conversion_brief → design_brief → build_spec → ad/advertorial/landing` (owner+consumers+required fields+**precedence**); `message_brief` is the central artifact; decision-record schema; **validator skeleton** | `_requirements/`, schemas, contract validator |
| **S0.1** Manager base + org + routing **enforcer** | shared principles base; machine-readable org/domain map (QA Lead under Product, etc.); per-domain routing contract; enforcer = hook + `/scan:*` + failing tests — **tests target the S0.2 contract shapes** | `.claude/agents/03-managers/*`, `decision-policy.md`, `scripts/hooks/*`, new scan skill |

**Wave 0B — Enforcers / scaffold / harness (built against S0A contract v0.1):**
| Sprint | Goal | Touches |
|---|---|---|
| **S0.3** Component-library scaffold wiring | actually install/scaffold Next+Tailwind+Radix+shadcn+Lucide in `portfolio:new` + `bootstrap:spinup` + builder contract (kills "vibe-coded") — its **acceptance contract waits on `design_brief`/`build_spec`** from S0.2 | `scripts/portfolio/*`, `scripts/bootstrap/*`, `framework/templates/*` |
| **S0.4** `/etc` authoring+eval harness | prompt/skill authoring + eval (procedures/rubrics/examples/counterexamples/decision-records) **against provisional contract v0.1 — must not invent its own authoring format**; GPT‑5.5 consult wired | `.claude/commands/etc/*`, dispatch |
| **S0.5 → RELOCATED to Wave 2 (S2.2)** | Higgsfield is **COMMITTED, not optional** (operator 2026-05-30; §10c resolved): wire Higgsfield MCP/CLI as the creative image/video production step inside the `growth:` pack — **must land before the Wave 3 pilot finishes** (pilot exit criteria exercises it) | mcp config, integration notes |
| **S0.6** Untrusted-content firewall | hook + `/scan:*` that treats all externally-ingested content (web/research/provider/MCP outputs, audience sources) as **data**, REJECTS embedded action-directives (publish/export/install/run/mirror), and never lets fetched content drive tool calls — the research/ingest/creative steps are live injection surfaces. Forward-looking design, not an incident response | `scripts/hooks/*`, new scan skill |

**Wave 1 — Modes generalization** (depends on Wave 0 contracts):
| Sprint | Goal |
|---|---|
| **S1.1** Work-modes chassis | γ/δ domain-aware dispatch + per-domain gauntlets + repartition agents by domain + role registry/team-guard (**one manifest/check owns role parity**) |
| **S1.2** Per-mode director participation | live-consult wiring (adhoc) + judgment-as-enforcers (oneshot) + **oneshot fail-closed "arbitration-needed" state** when contracts conflict / confidence low |
| **S1.3** Integration ownership | **Gamma owns an explicit integration phase** — shared files, generated types, env, contracts, smoke tests, FE/BE merge behavior — with acceptance gates (do **not** wait for the pilot to discover shared-file pain) |

**Wave 2 — Domain agents** (parallel across domains; consume Wave-0 contracts + Wave-1 chassis):
| Sprint | Goal |
|---|---|
| **S2.1** Product domain | Director of Product Mgmt (extend), Product Lead, Product Designer (principles: build-for-audience incl. limitations, KISS, clarity, iconography), QA Lead (move DoQA under Product; direct QA scanner), Research/Insight Lead + audience mining pipeline |
| **S2.2** Marketing domain | Director of Marketing, Growth Lead, Copy Lead, Web/Conversion Designer + `growth:` skill-pack (product-finder · angles · message-brief · advertorial · landing-page · ad-images · ad-video · iterate) reusing `research:deep` + `karpathy:run` + cross-provider dispatch + `content` render + Higgsfield; chiefing/no-invented-data enforcers + **resonance/conversion-quality evals** (message clarity · proof strength · audience specificity · visual hierarchy · objection handling · conversion hypothesis) |
| **S2.3** Engineering domain | Director of Engineering; split `builder` → `frontend-builder` + `backend-builder`; gauntlet stays builder-agnostic; design-quality gauntlet (§2) wired as the cross-domain visual/UX approver |

**Wave 3 — The pilot (prove it end-to-end)**:
| Sprint | Goal |
|---|---|
| **S3.1** Cross-domain oneshot pilot | one pilot product, full loop research→message→design→build→creative→iterate → ONE converting artifact; wire pipeline into `bootstrap:lastmile` + `spinup` + `portfolio`; feed pilot defects back into the contracts before scaling. **Exit criteria (not just "artifacts exist"):** the system produces one artifact AND passes contract validation + routing validation + visual/mobile QA (where relevant) + evidence/no-invented-data checks + resonance/conversion-quality evals, **AND the creative loop exercises the Higgsfield image/video integration (a real generated asset in the converting artifact)**, AND records contract defects to revise v0.1. |

**Deferred (post-pilot, NOT committed here):** W-Platform (`warpos` external CLI + first-party MCP server — Master Console as platform); breadth/position expansion.

Parallelism: Wave 0A = 2 lanes (S0.2 leads, S0.1 in parallel against its shapes); Wave 0B = 3 lanes; Wave 2 = 3 lanes. Wave 1 + Wave 3 are sequential gates.

## 7. Defaulted decisions (adjustable in the new session)
- **3 peer Directors** (Product Mgmt · Marketing · Engineering). *Alt: single Director of Product Mgmt over all (max product-led).*
- **2 builders (FE/BE) to start**; integration is owned now by a **Gamma integration phase** (S1.3), not deferred to the pilot; add Foundation/Integration roles only if that phase proves insufficient.
- **Research/Insight = a named Lead** under Product.
- **β = cross-domain referee + risk + ship gate** (not a domain owner).
- **Marketing = peer to Product** (Research/Insight dossiers are the shared bridge).
- **Design authority = a design-quality gauntlet** (named approver), not a standalone person — *operator may override to a Design Lead role (§10c).*
- **Growth skills namespace = `growth:`** (supersedes the ingest agents' `ecom:`/`content:` split).

## 8. Open items / re-share / top risks
- **Re-share:** D1's nested hyperlinks + the **GETHOOKD** swipe library + 2 research docs in D5 (txt export stripped URLs).
- **Top risks (do-nots):** decision theater (unenforced/ceremonial managers) · generic design (no component lib / visual-QA / evidence / resonance-evals) · FE/BE integration on shared files · hallucinated audience psychographics · "mine everything" → surveillance · /etc as CoT warehouse · agents created before their artifacts+scans exist · creating an agent's role across registries without one parity check · untrusted-content injection (ingested content carrying action-directives) — mitigated by the S0.6 firewall.
- **Branding boundary:** product-facing output never says "WarpOS"; design/web output must not leak "WarpOS" branding; distribution capsule-internal, not public npx.

## 9. Status
v1.1 written; **GPT‑5.5 final review folded in** (see §10), then high-level surface + `/session:dump`.

## 10. GPT‑5.5 final review — deltas (v1.1)

### (a) VERDICT
**Conditional Go** — execute after the edits below are reflected (they now are, except the flagged judgment calls). Architecture is "directionally strong"; GPT's residual risk is *not concept, it is ambiguity at handoff time.* (No numeric confidence given; tenor = high confidence in direction, low tolerance for executing the v1 ambiguities blind.)

### (b) CHANGES APPLIED
- **Wave 0 split into 0A (contracts + org map) → 0B (enforcers/scaffold/etc/Higgsfield)** with an explicit internal gate — §0, §6. Folds in: S0.2 lands before S0.1/S0.3/S0.4 harden; S0.1 tests target S0.2 shapes; S0.3 acceptance waits on `design_brief`/`build_spec`; S0.4 builds against contract v0.1 (no bespoke authoring format).
- **`message_brief` promoted to the central artifact/spine**, with the explicit chain `audience_dossier → message_brief → offer_brief/conversion_brief → design_brief → build_spec → ad/advertorial/landing` — §1, §6 (S0.2). (Renamed the vague "ad/advertorial_spec" anchor.)
- **Design authority restored as a named approver** — a **design-quality gauntlet** (tokens, component usage, visual hierarchy, mobile, accessibility, handoff approval); states explicitly that a component library is not an owner — §2, S2.3. (The role-vs-gauntlet choice is flagged — §10c.)
- **Integration ownership made explicit now** — new **S1.3: Gamma integration phase** owns shared files, generated types, env, contracts, smoke tests, FE/BE merge, with acceptance gates — §6, §7.
- **Pilot exit criteria added** — S3.1 now completes on validation passing (contract + routing + visual/mobile QA + evidence + resonance evals) and contract-defect capture, not on "artifacts exist" — §6.
- **Oneshot enforcers must reject (not lint) + fail-closed "arbitration-needed" state**; artifact contracts declare **precedence**; one manifest/check owns **role parity** — §3, S1.1, S1.2.
- **Resonance/conversion-quality evals added** (message clarity · proof strength · audience specificity · visual hierarchy · objection handling · conversion hypothesis) — §6 (S2.2), S3.1; the named under-build fix.
- **Claims boundary + compliance independence** — Marketing owns the market promise (`message_brief`), Product owns the product-verifiable claim (`offer_brief`); security/compliance stays independent of Product/Marketing pressure — §2.
- **Handoff landmines hardened** — "don't create agents before their artifacts+scans," role-parity, "no WarpOS branding leak in design/web," confidence-scored audience data — §0, §8.

### (c) JUDGMENT CALLS FLAGGED for the operator
- **Design authority shape.** GPT: restore a named design authority — *either* a human-style **Design Lead** role *or* a **design-quality gauntlet**. v1 (operator-blessed) explicitly removed the standalone Design Lead. **GPT's rec:** a real owner either way; I defaulted to the **gauntlet** (compatible with "no person"). Operator: keep gauntlet, or reinstate a Design Lead?
- **Higgsfield placement. → RESOLVED 2026-05-30 (operator directive):** Higgsfield is **COMMITTED — not optional — and MUST be implemented before the pilot finishes.** Placement: **Wave 2 (S2.2 creative step)**; **S0.5 relocated** out of Wave 0B; the **Wave 3 pilot exit criteria exercise it** (a real generated asset). GPT's "not foundational / move to Wave 2" rec is honored on *placement*; the operator overrode the *"optional"* framing → committed.
- **Integration phase placement & whether to add roles.** GPT: put the Gamma integration phase in **Wave 1 or Wave 2**. **GPT's rec:** name it now (done as S1.3); decide later if dedicated Foundation/Integration *roles* are warranted. Operator: S1.3 (Wave 1) vs folding into Wave 2?
- **Org breadth before the pilot.** GPT (over-build): the full org vocabulary — 3 directors, leads, specialists, gauntlets, domain repartition — may be more than the pilot needs. **GPT's rec:** build the *minimum* org to run the pilot unambiguously, expand after. Operator: trim Wave 2 to pilot-minimum, or keep full v1 org?

### (d) ONE over-build + ONE under-build (GPT-named)
- **OVER-BUILD:** the full org vocabulary before the pilot (3 directors + leads + specialists + gauntlets + domain repartition) — durable value is the artifact/eval spine; build minimum org to run the pilot.
- **UNDER-BUILD:** evaluation of **resonance/conversion quality** — WarpOS checks correctness but not message clarity, proof strength, audience specificity, visual hierarchy, objection handling, or conversion hypothesis; without these it ships *valid artifacts that still feel generic.* (Applied as a required eval in S2.2/S3.1.)

### (e) BIGGEST landmine for the new session
**Ambiguity at handoff, not concept.** The new session must NOT be allowed to infer: the Wave 0 internal order (contracts/org-map first, enforcement against those contracts second), the exact authoritative edit surfaces (`.claude/`, `scripts/`, `_requirements/`, `framework/templates/`; regen both manifests last), the exact role-registry files touched when adding/splitting roles, and the hard rule **do not create an agent before its input/output artifacts and validating scans exist.** The `/session:dump` must make every one of these explicit.

## 11. Session refinements — 2026-05-30 (β-decided, pre-execution review)
Org-design questions resolved by **β (Class B)** during pre-execution review. **These refine S0.1 / S2.1 scope; apply at execution.** Logged to betaEvents: `EVT-org-reqauthoring-beta-001`, `EVT-org-roadmap-principles-beta-001`.

**R1 — Requirement-authoring owner (β DECIDE, conf 0.87).** **Product Lead** owns requirement authoring (build_spec / PRD) — NOT a new role, NOT the Product Designer (altitude: requirements = product-scoping decision = Lead tier; Designer = doer/craft tier). The *activity* already has machinery: `/sprint:design` authors PRD/stories/acceptance/TRACE; `req-reviewer` (adhoc + oneshot) verifies behavior↔requirement↔code↔test traceability — **no new *artifact family*** (but S2.1 must still add the Product-Lead-as-enforcer binding into oneshot build_spec validation — enforcer-first, not zero-effort). **Encode as a Product Lead deliverable in S2.1.** Oneshot: Product-Lead-as-enforcer validates the build_spec contract (reject-not-lint, fail-closed) + `req-reviewer` gate.

**R2 — Roadmap ownership = altitude split (β DECIDE, conf 0.86).** Per-product backlog ranking + within-sprint sequencing → **Product Lead** (when built, S2.1). Strategic / cross-product / lifecycle-phase-shift calls → **Director of PM**. Fallback until the Lead agent exists (incl. WarpOS's own framework roadmap): Director = current behavior, **no regression**. "Lead-based" ≠ less product judgment — the Lead *inherits* the Director's principles (see R4) and applies them at execution altitude.

**R3 — Roadmap-skill tuning.**
- *Ungated quick-win (Class A, do anytime / S0.1-first):* fix the stale inline principle list in `roadmap/prioritize.md` (~line 7) — reference the DoP spec by pointer, don't enumerate. Already rotted: lists 7/10 principles + includes the QA-earmarked one. **This `prioritize.md` pointer fix is the ONLY edit allowed before S0.2** — not permission to start S0.1 machinery before the S0.2 contract shapes exist.
- *Gated on S2.1:* make `prioritize` / `ideas` / `next` / `create` **role-aware** (single-product → Product Lead; cross-product/strategic → Director). Until S2.1, keep `subagent_type: director-of-product` as the sole dispatch — no regression, no debt.

**R4 — Principle ownership = inheritance model (β DECIDE, conf 0.86; OPEN_ADR false).** Chain: **shared base → Director (domain principles) → Lead (inherits + execution principles) → specialist (inherits + craft principles).** "Ownership" = where a principle is *rooted*; inheritance propagates it down. Distribution:
- **Shared base (build in S0.1):** Clarity-is-King · Map-the-User-Journey · evidence-over-invention.
- **Director of PM:** Lean PD · Lifecycle-Aware · Build-over-Buy · Focus · Pivot · Audience-is-King.
- **Product Lead** (inherits Director's): FTUE/NUX · Cold-vs-Warm-Start.
- **Product Designer** (inherits Lead's): build-for-audience-incl-limitations · KISS · clear-iconography.
- **QA Lead:** Product-Priority-over-Severity (natural home) + its 6 QA principles.
- **Research/Insight Lead:** Audience-is-King (deepest / emotional-layers form) · no-invented-data / confidence-scored / no-PII.
- **Marketing** (clone the programmable-principles pattern): Dir-Mktg = copy>creative · clarity>cleverness · message-first; Growth Lead = EQ / SCALE-TEST-SKIP · money-loves-speed · LTV:CAC≥3; Copy Lead = Agora/E5 "argument not copy" · hooks-are-90% · owns Chief-coherence; Web/Conversion Designer = clarity + conversion-hierarchy.

**Three cleanups — log as S0.1 pre-work (do NOT build the shared base outside S0.1 — drift vector):**
1. Remove **DoP Principle #7** (Product-Priority-over-Severity) — QA owns it (DoQA #1); the DoP spec already earmarks the move. **Sequencing constraint (β): assign stable principle IDs (slugs) BEFORE removing #7** — `director-of-qa.md:57` cross-references "Director of Product's Principle #7" by ordinal; removing it first breaks that reference silently (refactor-hygiene bug class).
2. Promote **Map-the-User-Journey** to the shared base (it IS the duplicate across DoP #10 / DoQA #7); **add Clarity-is-King as a NEW shared-base principle** — *not* an existing DoP/DoQA named principle (don't hunt for a duplicate; sourced from the plan's "clarity is king" + the convergence insight). *[GPT-5.5 re-review caught the false-duplicate wording.]*
3. **FTUE/NUX + Cold-vs-Warm-Start → Product Lead tier at S2.1**, but **keep them on the DoP spec with an inheritance annotation until the Lead agent exists** — deleting now with no Lead carrier = a principles gap.

*OPEN_ADR false: these are convention assignments; the inheritance mechanism is itself the S0.1 build (its ADR rides with S0.1). A second ADR now would be premature documentation.*

**R5 — Higgsfield COMMITTED (operator directive 2026-05-30; resolves §10c).** Higgsfield is **no longer optional** — it MUST be implemented before the pilot finishes. Placement: **Wave 2 (S2.2 creative step)** inside the `growth:` pack (image/video production); **S0.5 relocated** out of Wave 0B. The **Wave 3 pilot exit criteria now require the creative loop to exercise the Higgsfield integration** (a real generated asset in the converting artifact). Direct operator authority — not a β decision.

### 11.A — GPT-5.5 re-review deltas (2026-05-30; folded; β-ratified `EVT-org-gpt-rereview-beta-001`)
GPT-5.5 re-reviewed the updated DUMP → **CONDITIONAL-GO** on both handoff + R1–R4. All deltas folded; β confirmed Class A except two judgment items (both β DECIDE, conf 0.88). Raw review: `_planning/dump-review-gpt55-out.json`.

**Doc-bug corrections (applied above + in DUMP):**
- §1 **Higgsfield contradiction** removed — it is **Wave 2** (default #2), not a 0B item.
- **Pre-S0.2 edit list** = ONLY the `prioritize.md` pointer fix; no S0.1 machinery before S0.2 contracts.
- **Escape-hatch** reworded — trust repo for *paths / current implementation*, the plan for *intended target*.
- **R1** "zero enforcement debt" → "no new artifact family; S2.1 still adds the PL-enforcer binding."
- **R4** — only Map-the-User-Journey is the DoP#10/DoQA#7 duplicate; **Clarity-is-King is a NEW shared-base principle, not a duplicate.**

**S0.1 acceptance requirements added (the inheritance *enforcer* — β(B) DECIDE; OPEN_ADR stays false):**
- Build the inheritance **mechanism**, not just the convention: a `manager-principles-base` carrier + schema fields `owned_principles` / `inherits_from` / `inherited_principles` (β-verified: none exist today) **+ a scan that REJECTS duplicate-owned and missing-inherited principles** (the named enforcer — "every policy needs an enforcer").
- **Stable principle IDs (slugs), not ordinals; slug BEFORE removing DoP #7** (sequencing constraint, above).
- **S0.1 order:** carrier + schema + scan FIRST → then move/promote principles. Keep the base **MINIMAL** (file + schema + scan; no over-abstraction before contracts exist — GPT over-build guard).
- Promote **`claims-boundary` / source-grounded-claims** to a shared manager principle (it crosses Product / Marketing / Research / Compliance).

**S2.1 additions:**
- **Intra-Product conflict routing (β(A) DECIDE, conf 0.88):** Product Lead owns backlog/product sequencing; QA Lead owns QA/fix-priority under product-priority-over-severity; unresolved → **Director of PM**. **β enters ONLY for ship-gate or cross-domain conflicts** — not every intra-Product disagreement (keeps β from becoming an intra-domain appeal court). Default for when both Lead agents exist.
- **QA Lead rename:** keep a `director-of-qa` dispatch **alias** until all registry/skill refs migrate (role-registry-parity, §1.5).
- **Marketing dedup pass** vs the shared base — root clarity once; Marketing roles add domain applications (message-first · proof · hooks · conversion-hierarchy), not a third "clarity."
- **`roadmap/add.md` stays role-neutral** (mechanical appender, no `subagent_type` dispatch) — excluded from the role-aware set; role-aware = `prioritize` / `ideas` / `next` / `create`.
