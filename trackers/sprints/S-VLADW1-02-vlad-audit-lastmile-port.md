# S-VLADW1-02 — Vlad Wave-1 AUDIT: port the lastmile audit into the engine (epic label SP-VLAD-W1-AUDIT)

- **Sprint label and number:** S-VLADW1-02 (epic label `SP-VLAD-W1-AUDIT`; the label form is schema-invalid as an id — see Decisions)
- **Title:** Job #1 — port lastmile detect/score/adapters into the Vlad engine, adopt `score.js` as the one readiness number, and produce receipt-schema evidence from portfolio dogfood
- **Owner:** Alex ε (sprint conductor), under Alex α
- **Parent epic:** [E-VLAD-001](../epics/E-VLAD-001-vlad-v1-agent-mcp-cofounder.md) — see that epic's § Related sprints, which names this id
- **Goal:** Give the engine its first real job: detect a repo's stack, score its readiness, and emit a receipt — porting the existing lastmile audit rather than rewriting it, with exactly ONE readiness number in the product repo.
- **Scope:** Port detect/score/adapters into the engine; remove the MC-specific refusals in the ported copy; an intake fallback for undetectable stacks; adopt `score.js` as the single readiness number; fill the receipt-schema interior that ENGINE leaves untyped, and mint receipt v1 from real dogfood data.
- **Out of scope:** The write path (Wave 2). The agent face and installer (Wave 2). Porting the checklist readiness proxy — see the J3 decision below; that is a deliberate NON-port, not an omission.
- **Current state:** Designed, build queued (as of 2026-08-11) — full design artifacts complete and β-cleared (`5313a68b`, 2026-08-03: D-2 with the falsifier-corrected not-port-the-penalty-pass mechanic, AC-9.4 expected-divergence disclosure, the any-disposition aggregate amendment per β `e2a7c5b8`); the dogfood-corpus gate CLEARED 2026-08-04 by dated operator act (dreamteam/companycam/almanac, READ-ONLY, purpose-scoped — written into this tracker + `PC-20260730-0084`, the four prior permission denials superseded). Build is deliberately SEQUENCED BEHIND S-VLADW1-01's custody lane (shared repo surface); no build dispatch has been made for this sprint.
- **Percent completion:** 30% (as of 2026-08-11) — plan + full design complete and β-cleared, all gates cleared; no build work dispatched.

## Definition of Done
- [ ] Plan contract authored and accepted (`scripts/sprint/plan.js`), with β consulted at the plan→design boundary. **Authoring done 2026-07-30** — `PC-20260730-0084`, `scripts/sprint/validate.js` exit 0. Unchecked pending the β verdict.
- [x] `/sprint:design` artifacts exist and the design→build gate is cleared by the operator. **CLEARED 2026-08-04.** Artifacts: `.claude/project/sprint/requirements/S-VLADW1-02/` (committed `5313a68b`). **Clearing act:** operator ruling 2026-08-04, verbatim *"yes to all"*, answering the three-part question β drafted at its escalation. *(Provenance: relayed to ε by team-lead; ε did not receive the operator's words directly.)* **Chain:** this DoD item → β `d7f31a68-9c24-4e05-b3a7-16e8f4d02b59` (ESCALATE, class C, 0.89, betaEvents row 297) → operator act 2026-08-04, which **postdates** the design commit and so satisfies β's predates-the-artifacts objection in the form β specified. The prior CLEARED-ON-CONDITION reading was disputed and is **superseded, not revived**.
- [ ] detect/score/adapters run inside the engine against a named portfolio corpus of ≥3 repos.
- [ ] Exactly ONE readiness number exists in the product repo: `score.js` adopted, the checklist proxy NOT ported, and the `FOUNDERS_CHECKLIST.md`-dependent dimension resolved by β's **decision rule** (verdict `7c4e2b96`, B2) rather than by picking whichever option is convenient: **re-source ONLY IF the substitute signal measures the SAME underlying property.** If it measures something merely adjacent, do NOT re-source — swapping the input while keeping the dimension's name is a **silent redefinition**, and the receipt would then score something other than what it claims. If no true proxy exists, **remove the dimension from the default receipt for stranger repos** rather than displaying it permanently unscored: a dimension NOT SCORED for essentially every target repo is not honesty, it is a blank that reads as malfunction. Reserve NOT SCORED for the case where the input is *sometimes* present and happens to be missing here.
- [ ] **However the receipt handles a dimension it does not score for a given repo — NOT SCORED, REMOVED from the default set, or any future disposition — that handling is stated on the receipt** (β B2). An unscored dimension folded into an average as zero, or quietly dropped so the denominator shrinks without saying so, is a **fabricated number**. Where removal changes the dimension set, two repos' readiness numbers are computed over different sets and are not comparable unless the receipt says so. *(AMENDED 2026-08-03 per β `e2a7c5b8`, DECIDE class A, 0.90, betaEvents row 296 — wording applied verbatim. The prior clause governed only NOT SCORED, but D-2 moved the live case to REMOVED, so the aggregate obligation would have addressed a disposition this sprint no longer uses. Prior wording preserved: "How NOT SCORED propagates into any aggregate is stated on the receipt (β B2). An unscored dimension folded into an average as zero, or quietly dropped so the denominator shrinks without saying so, is a fabricated number — the arithmetic form of the same dishonesty the 'NOT verified' rule exists to prevent.")*
- [ ] Honest degradation reads as **information, not breakage** (β B1). A check that could not run reports could-not-run, never a pass — and under the ELI5 voice rule the form is a statement about *us* plus an action for *them* ("we couldn't check this because the project has no tests yet; adding one test in <area> would let us score it"), not a bare status token. A founder reads a bare "NOT verified" as a malfunction.
- [ ] An enforcer exists that fails the build if a second readiness number appears.
- [ ] Receipt schema v1 minted from real dogfood data, filling the untyped interior ENGINE emits.
- [ ] Every ported path and line reference verified against the source repo before porting (see Risks).

## Related definitions
- Validator, Verification, Evidence, Completion — see ../../TRACKER.md

## Tasks
- [x] Marshal the banked product-lead substance into a schema-valid plan-contract payload (`runtime/vlad-w1/w1-planning-inputs.md` §2, schema gotchas in §4.2). Done 2026-07-30 — payload `runtime/vlad-w1/payload-S-VLADW1-02-audit.json`, contract `PC-20260730-0084`.
- [ ] β consult at plan→design, front-loaded, on the named surfaces: the credential-custody enforcer and the honest-degradation ("NOT verified") language.
- [ ] Obtain the named portfolio corpus (≥3 repos) WITH explicit read-only authorization recorded in writing.
- [ ] Restate the readiness DoD item per J3 so it cannot regrow, and name its enforcer.
- [ ] Verify each cited port source before porting — the transferability inventory's references are `inferred_from_repo`, not verified.

## Files expected to change
- No **product-side** files in this repository — those live in the sibling repo, which does not exist yet (operator-gated).
- MC-side planning artifacts DO change during the plan phase: the plan contract and its report, the sprint store, the payload, and this tracker. Recorded explicitly so the "None in this repository" claim is not read wider than it is true.

## Files actually changed
- `.claude/project/sprint/plan-contracts/PC-20260730-0084.yaml` — the plan contract (new).
- `.claude/project/sprint/plan-contracts/PC-20260730-0084.report.md` — companion report (new).
- `.claude/project/sprint/sprints/S-VLADW1-02/current.yaml` — plan-contract pointer, status `planning`, risk `medium`, external services identified.
- `runtime/vlad-w1/payload-S-VLADW1-02-audit.json` — the authored payload, kept as durable provenance for the contract.
- This tracker.
- No product-side file. None may be written before the design→build gate clears.

## Paths expected to exist
- The sibling product repo (name and slug pending operator sign-off).

## Paths verified to exist
- `.claude/project/sprint/plan-contracts/PC-20260730-0084.yaml` — Verified Exists 2026-07-30, schema-valid against `mc/sprint/plan-contract/v1`.
- `.claude/project/sprint/sprints/S-VLADW1-02/current.yaml` — Verified Exists 2026-07-30, schema-valid against `mc/sprint/current-sprint/v1`.
- The sibling product repo: still NOT created — see Paths verified nonexistent.

## Paths verified nonexistent
- The sibling product repo — Verified Nonexistent 2026-07-29 (operator gate #1 unresolved; no path assigned).

## Wirings expected
- Engine → detect/score/adapters (in-engine call, not a shell-out).
- Engine → receipt journal (the interior ENGINE leaves untyped, filled here).

## Wirings verified
- None.

## Dependencies
- **S-VLADW1-01 (ENGINE)** — for the receipt/journal seam only. The dependency is narrow and deliberately so: see the J4 circularity decision.
- A named portfolio corpus of ≥3 repositories with recorded read-only authorization.

## Blockers
**UPDATED 2026-08-01 — two of three CLEARED; ONE remains.** Struck in place rather than deleted so each clearance is auditable:

1. ~~**Sibling repo name + slug + creation sign-off** — inherited from the epic's first approval point.~~ **CLEARED 2026-08-01** — the sibling repo exists as `vlad`, scaffolded via `/portfolio:new`. Verified by direct inspection, not inherited from a report.
2. ~~**STILL OPEN — the only remaining external input on this sprint. Named portfolio corpus (≥3 repos) + explicit read-only authorization**, reconciled against the standing MC-only rule. Dogfood was accepted verbally in grill round 3 but never reconciled with "open these three directories." **2026-08-01 status:** α proposes a corpus on operator delegation, with a standing operator veto window open rather than a blocking question. **This tracker deliberately does not name the proposed repositories** — see the note below.~~ **CLEARED 2026-08-04 by a direct operator act.** The authorized dogfood corpus is **`dreamteam`, `companycam`, `almanac`** — **READ-ONLY at all times**. **Clearing act:** operator ruling 2026-08-04, verbatim *"yes to all"*, answering a three-part question that **listed these three repositories explicitly**, so the naming is the operator's own and not an agent's proposal. *(Provenance: relayed to ε by team-lead.)* **Why this closes a gate four prior write-attempts could not:** the blocker's own note required "an operator-run edit or an explicit permission grant" and warned that a delegation message must not be read as closing it. This is neither a delegation nor an inference — it is a dated operator answer to a question naming the repos. The four earlier denials were the MC-only rule working correctly against an *agent-asserted* authorization; they are superseded by an *operator-given* one. **Standing constraint, not softened:** read-only means read-only — no write, no branch, no commit, no push, in any of the three, at any point in this sprint.

**SCOPE OF THE AUTHORIZATION, stated so it cannot be over-read (β rider, 2026-08-04):** this authorizes **three named repositories (`dreamteam`, `companycam`, `almanac`), READ-ONLY, for this purpose** — the Wave-1 dogfood audit. It is **NOT a general lift of the standing never-touch-other-projects rule.** That rule remains in force for every other repository and for any other purpose, including these three. A future reader must not cite this row as precedent for touching a sibling project.

**And read-only is a mechanism here, not an intention:** the control that makes it true of the *running system* is **AC-4.2's per-registered-kind write-confinement** — every registered job kind is executed and asserted to write only under Vlad's own operational-data root, leaving target-repo contents unchanged. That is the difference between promising read-only and observing it after the run (the same settable-label distinction β drew at `a91c46e2`: a job kind *labelled* read-only is not a control until something checks the world afterwards).
3. ~~**API spend envelope** for dev/test — trips two autonomy rows (signup/purchase not allowed; ≥$5 ask-first). Inherited from S-VLADW1-01's model-access seam rather than introduced here.~~ **CLEARED 2026-08-01** — operator granted **$50** dev/test, **vlad lane only**; spend beyond that envelope remains ask-first.

> **RESOLVED 2026-08-04 — the note below is preserved as the record of why this gate held, and it held correctly.** Its own stated release condition ("an operator-run edit or an explicit permission grant") is what arrived: a dated operator act naming the three repositories. The corpus names were written to this tracker and to `PC-20260730-0084` on 2026-08-04 **without any permission-layer denial** — the same write that was refused four times when an agent was the one asserting the authorization. That contrast is the point: the layer was distinguishing *who was making the claim*, not blocking the content. **Original note, unaltered:**
>
> > **UNRESOLVED — flagged for the operator, not worked around.** During the 2026-08-01 propagation sweep, every attempt to write the *specific proposed corpus repositories* and their read-only authorization into this tracker and into `PC-20260730-0084` was **denied by the permission layer** (four separate denials across both files, all on statements recording cross-repository access or relaxing an approval boundary). That is the standing MC-only rule doing its job: an agent asserting "these other repos are authorized" is exactly the claim that should require the operator, not a sweep. **The corpus gate therefore remains recorded as OPEN here regardless of any delegation upstream**, and naming it needs either an operator-run edit or an explicit permission grant. Do not treat a delegation message as having closed this gate in the trackers.

**Reclassified 2026-07-30 — was gate #3, no longer an operator gate:** "Ratification of the J3 convergence reframe." J3 has been folded into the parent epic's Definition of Done (item on the readiness number, which now carries the adoption-not-convergence restatement verbatim) as an α-altitude Class B scoping call. Verified by reading the epic tracker directly, not inherited from a report. J3 is therefore **recorded, not awaiting an answer** — surfaced to the operator for objection rather than held as a blocker. Reclassifying it does not reduce the sprint's real exposure: the enforcer that must fail the build if a second readiness number appears is still unbuilt, and that is what actually keeps J3 from regrowing.

Product-lead assessment carried forward: this sprint is **better-evidenced than ENGINE and its blockers are INPUTS, not unknowns** — it clears to `pass` without re-authoring once the four are answered.

## Risks
- **Second readiness number regrows / likelihood medium / impact medium** — "converge the two scores" invites porting both and reconciling them, which is a hidden second sprint. Mitigation: J3's restatement plus a build-failing enforcer, not prose.
- **Porting against unverified references / likelihood high / impact medium** — every port source in the transferability inventory is marked `inferred_from_repo`, never `verified_from_repo`, and the inventory flags its own maps as trailing live values. Mitigation: a builder verifies each path and line reference before porting; treat the inventory as a lead, not a citation.
- **Receipt-schema churn / likelihood medium / impact medium** — see J4; mitigated only if ENGINE ships the untyped-interior envelope.

## Decisions
- **2026-08-03 — D-2: β's B2 rule applied to the `FOUNDERS_CHECKLIST`-dependent dimension → REMOVE it from the default stranger-repo receipt.** Do not re-source; do not ship it as permanently NOT SCORED. Settled at `/sprint:design` by the **quality-lead** consult (`claude-opus-4-8`, in-process). **The argument is class-level:** the dimension's input is a human-maintained *declaration of task completions* — its measurement mechanism is "read what the founder asserts they have done". Every candidate substitute in a stranger repo (README, LICENSE, CI config, deploy config, `.env.example`, docs dir, release tags) is an *observation of an artifact*. Declared-completion and observed-artifact are **different property classes**, not two sources for one property — so substituting one while keeping the dimension's name is exactly the **silent redefinition** B2 bars. **Why not NOT SCORED — and the obvious rationale is INVERTED (β source-read, 2026-08-04):** the file is a MC/Vlad-scaffold artifact a stranger repo has essentially never, which tempts the inference that the logic simply does not fire there and is harmless. **Backwards.** Absence fires the *harshest* branch: `applyFoundersChecklist` **caps `dimensions.product` at 60 AND pushes the gap string "FOUNDERS_CHECKLIST.md missing - human-only launch work is not tracked" into the receipt**, on every stranger repo, every run. **The reason not to port the pass is that it FIRES** — ported unchanged it would penalise a founder for lacking a MC scaffold file they have never heard of and print a MC-internal artifact name into their receipt as a finding about their project. An inverted rationale is more dangerous than a vague one because it sounds specific: "it never fires" invites a future contributor to port it back as harmless. **NOT YET VERIFIED — a named falsifier is owed:** nobody has read `FOUNDERS_CHECKLIST.md` or the dimension definition (every port surface is `inferred_from_repo`). Flip to re-source **if and only if** every scored row is independently observable in an arbitrary repo. That check rides free on the existing port-reference verification task; **D-2 must not be upgraded to "verified" in any artifact until it is recorded.** **The property is re-homed, not deleted:** founder-readiness has a legitimate same-property source — ask the founder — recorded as a Wave-2 intake-declared dimension that appears only when actually answered. Full text: `.claude/project/sprint/requirements/S-VLADW1-02/acceptance-criteria.md` § D-2.
- **2026-08-03 — the corpus-dependent DoD item is SPLIT so the sprint can close honestly.** (a) ungated: detect/score/adapters run against ≥3 **synthetic fixture** repos the sprint builds itself, zero MC refusals — buildable and testable now. (b) gated: the same against ≥3 **authorized real** repos, plus receipt-v1 minting — not designed against and not closeable until the operator corpus gate clears. Rationale: an unclosable DoD item under delivery pressure is how fudged evidence enters a record. **Stated limit, not softened:** synthetic fixtures are *weaker* evidence — they cannot surface real stack shapes, repo size/performance, or odd git states, which are precisely the surprises the plan contract's own `unsafe` assumption predicts. Fixtures unblock the build; they do **not** close the gate.
- 2026-07-29 — **Sprint id.** The epic's `SP-VLAD-W1-AUDIT` is schema-invalid against the registry pattern; registered as `S-VLADW1-02`, epic label preserved as the title. Minted AUDIT-first so `add-sprint.js`'s unconditional `reg.primary` write lands on the gating sprint (ENGINE) rather than here.
- 2026-07-30 — **β verdict at plan→design: DECIDE, Class B, confidence 0.88, OPEN_ADR true (narrow).** msg_id `7c4e2b96-5d81-4a37-b0f2-91e6c58a3d74`, answering ε's consult `063c75dd-36e4-4c2f-8c00-78de716a4ab0`. The claims boundary on honest degradation is **drawn in the right place**; three refinements are folded into the Definition of Done above (the B2 decision rule for the FOUNDERS_CHECKLIST dimension, the aggregate-propagation disclosure, and the ELI5 form of a could-not-run result). Full verdict staged at `runtime/vlad-w1/betaevents-staged-W1-plan-to-design.md`. Both surfaces are designable now — the pending API-key-only ratification does not gate them.
- **2026-08-01 — OPERATOR RULING: model access is SUBSCRIPTION-PRIMARY** (inherited constraint; this sprint consumes the seam rather than building it). Verbatim: *"We are in the clear. It's literally their subscription using an AGENT. And in most cases local MCP. Like, we are good. codify this, update the plan."* The operator's parse: the prohibition clause bars **the DEVELOPER's credentials proxying users' requests**, not a user running an agent/MCP locally on their OWN subscription. **New posture:** the user's own Claude subscription, an agent they themselves invoke, local MCP topology, no developer credentials in the path; the API-key seam (TypeScript Agent SDK) stays **ENGINEERED AND READY as the fallback** per β `7c4e2b96`'s auth-agnostic design, so a flip is a seam swap rather than a rework. **Residual risk, recorded not softened:** alternative parse available, policy explicitly in flux, enforce-without-notice reserved. **Mitigations:** the engineered fallback seam — **the SOLE recorded mitigation**. ~~plus a **parallel work item** — the Anthropic clarification/approval request.~~ **CANCELLED PERMANENTLY — standing operator rule 2026-08-10** (fold `f539e1e2`, commit `1b1b175e`; ADR-0041 Amendment 2). **Trigger:** if Anthropic closes or meters the seam, flip to API-key without rework. This supersedes the 2026-07-29 ToS NO-GO chain in which API-key was "primary and only". **Impact on THIS sprint is narrow:** the audit is read-only and seam-independent; what changes is the inherited dependency it consumes, not its scope, DoD or risk profile. Authoritative text: [E-VLAD-001](../epics/E-VLAD-001-vlad-v1-agent-mcp-cofounder.md) § Decisions (first entry) + Change-log fold `5b022ea9`.
- 2026-07-29 — **J3: this is an ADOPTION, not a convergence.** Adopt `score.js`; never port the checklist proxy, which concedes in its own code that it is an MVP stand-in; re-source the one `FOUNDERS_CHECKLIST.md`-dependent dimension or record it honestly as NOT SCORED. New repo, no legacy consumer, nothing to migrate — the word "converge" is the trap.

## Open questions
- ~~Blocking: all three operator gates above (sibling repo name+slug+sign-off; the named ≥3-repo corpus with written read-only authorization; the API spend envelope).~~ **UPDATED 2026-08-01 — ONE remains blocking:** the named ≥3-repo dogfood corpus with read-only authorization. The repo gate is cleared (`vlad` created) and the spend gate is cleared ($50, vlad lane only). See Blockers for why the corpus gate is still recorded open.
- Non-blocking: whether the re-sourced readiness dimension can be derived at all, or must ship as NOT SCORED.
- Non-blocking: whether the receipt interior minted from a three-repo corpus is versioned v1, or v0.9 with v1 reserved for a wider corpus. The envelope carries `schema_version` precisely so this can be answered late.
- Non-blocking (schema gap, no action owed by this sprint): the plan-contract schema's `recommended_mode` enum offers only `solo|adhoc|oneshot|no_recommendation` and has **no `sprint` value**, so `PC-20260730-0084` records `no_recommendation` despite being conducted in sprint mode. The enum predates sprint mode; the recorded value is the honest one.

## Session log
<!-- Append-only (§24). See SESSION_LOG_TEMPLATE.md for the full field set. -->
### 2026-07-30 00:00 UTC — Session 2026-07-29-release-and-pass
- Agent(s): Alex ε (conductor), Alex α (dispatcher) · Mode: sprint
- Work performed: Created this tracker as the sprint's durable source-of-truth home. `add-sprint.js` mints the registry entry, ROADMAP rows and the sprint STORES (`current.yaml`/`progress.yaml`) but NOT a tracker file; that gap was found while beginning the planning phase and is recorded here rather than worked around.
- Files changed: this file (new). · Paths changed: None. · Wirings changed: None.
- Decisions: Recorded the id resolution and the J3 reframe as Decisions rather than leaving them in the banked planning notes.
- Issues discovered: The tracker scaffold was missing for both Wave-1 sprints; `git ls-files` showed only the four store files.
- Definitions added/changed: None
- State change: (new) → Planning · Completion change: — → 0%
- Verification performed: Registry read directly — `primary: S-VLADW1-01`, both ids registered with pointers. · Validation run: `node scripts/trackers/validate.js` · Validation result: see Verification log
- Next action: Author the plan contract.
- Evidence/references: `runtime/vlad-w1/w1-planning-inputs.md`; registry `.claude/project/sprint/active-sprints.yaml`

### 2026-07-30 02:00 UTC — Session 2026-07-29-release-and-pass (Wave-1 plan contracts)
- Agent(s): Alex ε as "EpsilonW1" (scoped plan-contract lane) · Mode: sprint
- Work performed: Marshalled the banked product-lead substance into a schema-valid plan-contract payload and authored the contract. Authored **AUDIT first** so `add-sprint.js`'s unconditional `reg.primary` write ordering was preserved and `primary` stayed on the gating sprint; confirmed by direct read after both runs. Reclassified the former operator gate #3 (J3 ratification) after verifying the parent epic's Definition of Done already carries the adoption-not-convergence restatement.
- Files changed: `.claude/project/sprint/plan-contracts/PC-20260730-0084.yaml` (new), its `.report.md` (new), `.claude/project/sprint/sprints/S-VLADW1-02/current.yaml`, `runtime/vlad-w1/payload-S-VLADW1-02-audit.json` (new), this file. · Paths changed: None product-side. · Wirings changed: `current.yaml#plan_contract` → `PC-20260730-0084`.
- Decisions: Kept `plan_quality.status = needs_user_clarification` (not `blocked`) per J1 — "blocked" means an honest plan cannot be authored, not that execution cannot start. Recorded `recommended_mode: no_recommendation` because the schema enum has no `sprint` value.
- Issues discovered: (1) `plan.js` performs **no schema validation** — it is plumbing, so `scripts/sprint/validate.js` must be run separately or an invalid contract lands silently. (2) `scripts/sprint/conflict-check` flagged an affected-surface overlap with S-VLADW1-01 on "the sibling Vlad product repo"; warn-only and a true positive, since both sprints legitimately target the same unbuilt repo — it will need `--allow-overlap` at `/sprint:execute`, logged to the decision ledger.
- Definitions added/changed: None
- State change: Planning → Planning (held at plan→design) · Completion change: 0% → 10%
- Verification performed: `node scripts/sprint/validate.js` on the contract AND on the rewritten `current.yaml`, both exit 0; registry `primary` re-read after both authoring runs and unchanged at `S-VLADW1-01`; contract `sprint:` field read directly and confirmed `S-VLADW1-02`. · Validation run: `node scripts/trackers/validate.js` · Validation result: see Verification log
- Next action: β consult at the plan→design boundary, then HOLD.
- Evidence/references: `runtime/vlad-w1/payload-S-VLADW1-02-audit.json`; `.claude/project/sprint/plan-contracts/PC-20260730-0084.yaml`

### 2026-08-11 18:00 UTC — Session e2401456 (the 2026-08-03→11 arc, wrap entry)
- Agent(s): Alex ε (design conduct), Alex α (wrap author) · Mode: sprint
- Work performed: full design bundle authored and committed (`5313a68b`); D-2 falsifier RUN at source — conclusion confirmed, mechanic corrected to not-port-the-`applyFoundersChecklist`-penalty-pass (folds `1742df0a` + `7ec9f676`); AC-9.4 expected-divergence disclosure added (bounded to decision-traceable divergence); β `e2a7c5b8` any-disposition aggregate amendment applied verbatim to DoD line 18 + mirrored as AC-8.9; corpus gate cleared 2026-08-04 and written in (read-only, purpose-scoped, not a general lift).
- Files changed: this tracker; `.claude/project/sprint/requirements/S-VLADW1-02/*`; `PC-20260730-0084` (corpus + evidence_level).
- Decisions: fixture-vs-corpus evidence split (AC-9.1/9.2 ungated-synthetic vs gated-real, now both unlocked); build sequenced behind the engine sprint's custody lane.
- Issues discovered: None new this arc beyond those recorded in S-VLADW1-01 (shared-arc issues live there).
- Definitions added/changed: None
- State change: Planning → Designed (build queued) · Completion change: 10% → 30%
- Verification performed: requirement-format-guard exit 0 on the criteria files (2026-08-03/04). · Validation run: `node scripts/trackers/validate.js` · Validation result: green at the 2026-08-11 wrap

## Change log
### 2026-07-30 00:00 UTC — Session 2026-07-29-release-and-pass
- Created the tracker from `trackers/templates/SPRINT_TEMPLATE.md`, with `SP-20260725-002-memory-verify.md` as the section-discipline exemplar.

### 2026-08-01 — Subscription-primary ruling propagated (team-lead sweep)
- **Changed:** propagated the operator's 2026-08-01 SUBSCRIPTION-PRIMARY model-access ruling through this tracker — Current state, Decisions (new first entry recording the ruling as an inherited constraint), Blockers (repo and spend gates struck as CLEARED; corpus gate kept OPEN with a flagged note), Open questions, Current next action, and Remaining follow-up items.
- **Reason:** the operator ruled 2026-08-01 that model access is subscription-primary, superseding the 2026-07-29 ToS NO-GO → API-key-primary-and-only chain. Impact on this sprint is narrow — it consumes the seam rather than building it, and the audit itself is read-only and seam-independent.
- **Method:** SUPERSEDED/CLEARED-2026-08-01 strike-in-place markers; no NO-GO text deleted where it is load-bearing history. Authoritative source for the ruling's wording is the parent epic's § Decisions first entry + Change-log fold `5b022ea9`.
- **Flagged, not worked around:** attempts to name the proposed dogfood-corpus repositories and record their read-only authorization were denied by the permission layer in both this tracker and `PC-20260730-0084`. The corpus gate is consequently recorded as still OPEN. This is the standing MC-only rule behaving correctly; closing that gate needs an operator-run edit or an explicit permission grant.

### 2026-07-30 02:00 UTC — Session 2026-07-29-release-and-pass
- Plan contract `PC-20260730-0084` authored and validated. Blocker count corrected from four to three (J3 reclassified as folded into the epic DoD, not an operator gate). Files-changed sections corrected so "None in this repository" is no longer stated wider than it is true — MC-side planning artifacts DO change in the plan phase.

## Evidence log
### 2026-07-30 — The plan contract exists and is schema-valid
- Evidence: `node scripts/sprint/validate.js .claude/project/sprint/plan-contracts/PC-20260730-0084.yaml` → "valid against mc/sprint/plan-contract/v1", exit 0. The rewritten `.claude/project/sprint/sprints/S-VLADW1-02/current.yaml` independently validates against `mc/sprint/current-sprint/v1`, exit 0.

### 2026-07-30 — J3 is already folded into the parent epic, so it is not an operator gate
- Evidence: `trackers/epics/E-VLAD-001-vlad-v1-agent-mcp-cofounder.md` § Definition of Done carries the readiness-number item with the adoption-not-convergence restatement verbatim ("`score.js` adopted, the checklist proxy NOT ported, the FOUNDERS_CHECKLIST-dependent dimension re-sourced or honestly NOT SCORED … J3: this is an adoption, not a convergence"). Read directly from the epic rather than inherited from a prior report.

### 2026-07-29 — The sibling product repo does not exist
- Evidence: no path assigned; operator gate #1 (name + slug + sign-off) unresolved. Recorded as Verified Nonexistent rather than left implicit.

### 2026-07-29 — Registered but unstarted
- Evidence: `.claude/project/sprint/active-sprints.yaml` lists `S-VLADW1-02` with pointer `.claude/project/sprint/sprints/S-VLADW1-02`; that store holds only `current.yaml` and `progress.yaml`.

## Verification log
- `node scripts/trackers/validate.js` — run after creating this file; result recorded in the session log of the creating commit.
- 2026-07-30 — `node scripts/sprint/validate.js .claude/project/sprint/plan-contracts/PC-20260730-0084.yaml` → valid against `mc/sprint/plan-contract/v1`, exit 0.
- 2026-07-30 — `node scripts/sprint/validate.js .claude/project/sprint/sprints/S-VLADW1-02/current.yaml` → valid against `mc/sprint/current-sprint/v1`, exit 0.
- 2026-07-30 — `node scripts/trackers/validate.js` → all 20 checks pass (baseline taken before these edits was also 20/20, so the green is not masking a pre-existing red).

## Current next action
**β consulted and answered — DECIDE, Class B, 0.88, msg_id `7c4e2b96-5d81-4a37-b0f2-91e6c58a3d74` (2026-07-30). The plan→design boundary gate is satisfied for this sprint**, and β's three honest-degradation refinements are folded into the Definition of Done. `/sprint:design` may open once the operator gates clear, and it must open with the B2 decision rule rather than re-litigating it. **UPDATED 2026-08-01:** the sibling repo now exists (`vlad`) and the spend envelope is granted ($50, vlad lane only); the model-access seam this sprint inherits is settled as **subscription-primary** (see § Decisions). Prior text, preserved: *"Then HOLD at design→build: the build phase needs the sibling repo, and three operator gates are unresolved (repo name+slug+sign-off; the named ≥3-repo corpus with written read-only authorization; the API spend envelope)."* **The dogfood-corpus authorization is the ONE external input still outstanding** — and it is genuinely outstanding, not merely unrecorded (see the flagged note in Blockers). `/sprint:design` opens on fresh in-session operator authorization; no product-side work may begin before the design→build gate clears. Product-lead assessment carried forward — this sprint's blockers are INPUTS, not unknowns, so it clears to `plan_quality: pass` without re-authoring once the operator answers.

## Completion record
- Final state: Not yet complete
- Percent completion: 10%
- Completion timestamp: n/a
- Definition of done used: the Definition of Done above
- Evidence of completion: n/a
- Session IDs / dates / agents: 2026-07-29 — Alex ε (tracker creation); 2026-07-30 — Alex ε as "EpsilonW1" (plan contract `PC-20260730-0084`)
- Parent epic: E-VLAD-001
- Remaining follow-up items (UPDATED 2026-08-01): the **dogfood-corpus authorization** (the one operator gate still open — see the flagged note in Blockers); the readiness-number enforcer; the port-reference verification pass; the `--allow-overlap` decision at `/sprint:execute` for the shared sibling-repo surface. **DONE:** the β verdict on the honest-degradation language (`7c4e2b96`, folded into the DoD); the repo gate (`vlad` created 2026-08-01); the spend gate ($50 granted 2026-08-01, vlad lane only)
- Related untracked work: None
- ../../TRACKER.md updated: Yes (1.2.0 marker NEXT-ACTION item 4 names the Wave-1 conduct) · Roadmap reconciled: Yes (ROADMAP row added by the mint, `fd519ab1`)
