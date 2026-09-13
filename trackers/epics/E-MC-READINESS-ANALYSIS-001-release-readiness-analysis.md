<!-- EPIC TRACKER — spec §22. Linked from ../../TRACKER.md. Template: ../templates/EPIC_TEMPLATE.md
     States (§19): Planned | Ready | Active | Blocked | Paused | Review Needed | Completed | Cancelled | Superseded -->

# E-MC-READINESS-ANALYSIS-001 — Masterconsole Release-Readiness: ANALYSIS (findings-only)

- **Epic label and number:** E-MC-READINESS-ANALYSIS-001
- **Title:** Masterconsole Release-Readiness: ANALYSIS (findings-only, no changes)
- **Owner:** President Agent
- **Parent roadmap area:** [../../ROADMAP.md](../../ROADMAP.md) § Epics → Active epics (⭐⭐ TOP)
- **Goal:** Produce ONE consolidated, evidence-grounded findings set across every release-readiness dimension BEFORE any hardening change, so the execution epic burns down a frozen target. Analysis-only — read/simulate/audit/predict/report; modify nothing.
- **Background:** Operator-directed 2026-06-07 to prep the external masterconsole launch. Strategy (operator): all analysis first (one pass per dimension) → consolidate into this epic; a SECOND epic (E-MC-READINESS-EXECUTION-001) executes the findings — so we never change things as we go.
- **Scope (6 analysis sprints, each → a findings doc):**
  1. Hardening simulation — intense simulation in an extremely isolated env; every command + every flow exercised; catalog breaks/fragilities. (Extends the sealed-capsule lifecycle to the full shipped-command surface.)
  2. Security hardening — TRIPLE-pass torture test, cross-checked: (a) planned (threat-model + redteam:full), (b) Director-of-Engineering's security team (DoE dispatches security-reviewer(s)), (c) α's own pass. Reconcile; divergence = signal.
  3. Advanced edge-case prediction — insanity-level enumeration of pathological/adversarial/rare inputs, states, races per flow.
  4. Release-pipeline analysis — root of why gaps slip through (WI-50 / tracker-gap / hand-maintained ASSET_DIRS); the final-fix design.
  5. Project/file-organization analysis — agents-folder de-dot (.system/_system/.system.md), the 13-file 03-managers cutover-staleness (ED-026), the two-manifest (ownership vs ship) reconciliation; target structure + migration plan.
  6. Expectations-vs-reality / prose-vs-enforcement audit — every policy/contract/claim vs what's actually enforced (aspirational-vs-enforced; CLAUDE.md Policy-&-Enforcement-Hygiene + enforcement-debt register); each gap → named enforcer or logged debt.
- **Out of scope:** ANY fix/change (that is E-MC-READINESS-EXECUTION-001).
- **Current state:** Completed
- **Percent completion:** 100% (SP-20260618-002, 2026-06-18 — gauntlet GREEN). **VERIFY-DON'T-INHERIT RECONCILE:** the prior "~15% (2026-06-16), 1 of 6 tracks + 1 partial" was materially STALE — ground-truthing found 4 of 6 tracks already had COMPLETE findings docs the tracker under-credited. Actual track status: **Track-2 (security) DONE** (`_reports/E-MC-READINESS-track2-security.md` — 14 findings, 2 high/5 med/7 clean; tracker never listed it); **Track-3 (edge-cases) DONE** (`_reports/E-MC-READINESS-track3-edge-cases.md` — 31 cases under 5 structural classes C1-C5, 10 high; tracker never listed it); **Track-4 (release-pipeline) DONE** (the ASSET_DIRS slip-through class); **Track-6 (prose-vs-enforcement) DONE** (`_reports/E-MC-READINESS-track6-prose-vs-enforcement.md` — 30 claims, 5 NEW gaps N-1..N-5, marquee N-1 `scan:tools`/ED-033; was mislabeled "partial"); **Track-1 (hardening-sim) DONE this sprint** (`_reports/E-MC-READINESS-track1-hardening-simulation.md` — 12 findings incl. the load-bearing A1-F4 mutating-spine false-confidence; Claude sealed-probe + GPT 2-source); **Track-5 (file-org) SUPERSEDED** — absorbed into E-SYSTEM-ORG-001 (~99% Completed), EXCEPT the ED-026 cutover-completeness tail (carried as register R25). **DoD#2 DELIVERED:** `_reports/E-MC-READINESS-findings-register.md` — the single prioritized register (26 rows R1-R26: 5 P0, 7 P1, 14 P2; positive-coverage verified; NO orphan findings). Analysis-only invariant HELD + ENFORCED (the diff-scope close-gate, GREEN; runtime/sp-20260618-002/analysis-only-diff-gate.js, self-test 9/9). Conducted by Alex ε (SP-20260618-002), β-gated at all 4 boundaries.

## Definition of Done
- [x] All 6 analysis sprints complete, each with an evidence-grounded findings doc (no fixes applied) — **DONE**: Tracks 1/2/3/4/6 have complete findings docs in `_reports/E-MC-READINESS-track{1,2,3,4,6}-*.md`; Track-5 SUPERSEDED (absorbed into E-SYSTEM-ORG-001, except the ED-026 tail = register R25). (Tracks 2/3/4/6 ran as autonomous passes 2026-06-16; Track-1 minted + conducted as SP-20260618-002.)
- [x] Findings consolidated into a single prioritized register the execution epic can burn down — **DONE**: `_reports/E-MC-READINESS-findings-register.md` (26 rows R1-R26: 5 P0/7 P1/14 P2; positive-coverage verified across all source tracks; every row routes to EXECUTION or is accepted/no-action — no orphan findings).
- [x] Bundling resolved (which existing epics feed which findings track) — **DONE**: recorded in the register + ROADMAP § priority-ordering: track-1←E-GOLDEN-FLOW-001 (Completed), track-4←E-CONTENT-DELIVERY-001 (Completed), track-5←E-SYSTEM-ORG-001 (~99%), E-TEST-SUITE-001 standalone, E-DISPATCH-INTEGRITY F-4/F-5 consolidated under E-SYSTEM-ORG-001.
- [x] No system changes made under this epic (analysis-only invariant held) — **DONE + ENFORCED**: the diff-scope close-gate (`git diff --name-only main...HEAD` ⊆ {_reports/ + the tracker/ROADMAP/TRACKER + runtime/} ∪ regenerated-manifests) ran GREEN; β-ratified (DECIDE B 0.89), fail-closed, self-test 9/9. The sprint diff touched ONLY `_reports/` docs + this reconcile + runtime/ — zero product/framework/scripts edits.

## Related definitions
- Verification, Evidence, Wiring, Validator — see ../../TRACKER.md

## Related sprints
- Hardening-simulation-analysis — Planned
- Security-triple-pass-analysis — Planned
- Edge-case-prediction-analysis — Planned
- Release-pipeline-analysis — Planned
- File-organization-analysis — Planned (absorbs the 03-managers/ED-026 + agents-folder de-dot survey)
- Prose-vs-reality/enforcement-audit — Planned

## Dependencies
- None. Consumes existing diagnoses as inputs: E-DISPATCH-INTEGRITY-001 (dispatch RCA, done), E-CONTENT-DELIVERY-001 (ship-coverage), E-GOLDEN-FLOW-001 (consumer-contract), E-TEST-SUITE-001 (regression seed).

## Blockers
- None currently recorded.

## Risks
- Analysis sprawl / never-converging — likelihood medium · mitigation: each sprint is time-boxed to a findings doc, not exhaustive perfection; the prose-vs-reality + hardening passes are the highest-signal, run first.
- Cross-provider/team passes diverge (security triple-pass) — that is the DESIGN (divergence = signal); reconcile on grounding, not vote.
- Analysis-only invariant violated (someone fixes as they go) — mitigation: the epic's DoD asserts no changes; fixes route to the execution epic.

## Decisions
- 2026-06-07: two-epic split (analysis → execution) per operator — freeze the target before changing it (decide-then-do).

## Open questions
- Bundling boundaries — deferred to /roadmap:prioritize (director-of-product) to confirm which existing epics fold in as analysis inputs vs stay standalone.

## Session log
### 2026-06-18 — SP-20260618-002 (Track-1 hardening-sim + consolidation + reconcile — epic CLOSED)
- Agent(s): Alex ε (sprint conductor) + α (DoE/A1-analyst relay + merge) + β (4 boundary DECIDEs) + Claude A1 analyst + GPT-5.5 2nd-pass · Mode: sprint
- Work performed: Conducted SP-20260618-002 to close the analysis epic. VERIFY-DON'T-INHERIT caught the tracker materially stale (claimed ~15%; 4 of 6 tracks already had complete findings docs — same endemic stale-tracker class as E-CONTENT-DELIVERY). **A1** — Track-1 hardening-simulation: a Claude analyst extended the Completed sealed-capsule gate to the consumer-reachable command FLOW with a real BOM-injected sealed probe (P1/P2/P3, 0 writes outside tmp), 12 findings incl. the load-bearing **A1-F4** (the certified gate runs `update.js --status` ONLY → the 1311-asset GREEN is false confidence on the mutating update spine; C1/C2/C5 unverified by construction); GPT-5.5 2-source divergence cross-check (gemini tier-dead) re-ranked 3 + added 4 NEW in the scoped-out verbs; verify-don't-inherit WIN — 3 of Track-3's HIGHs REFUTED at flow level (fixed by `8339e0b5` after Track-3's snapshot). **A2** — the consolidated findings register (DoD#2): 26 rows R1-R26, positive-coverage verified across all 6 tracks, NO orphan findings. **A3** — this reconcile + the ANALYSIS-ONLY diff-scope close-gate (β-ratified, fail-closed, 9/9 self-test, GREEN).
- Files changed: `_reports/E-MC-READINESS-track1-hardening-simulation.md` (new), `_reports/E-MC-READINESS-findings-register.md` (new), this tracker, ROADMAP.md, TRACKER.md, runtime/sp-20260618-002/** (the diff-gate helper + evidence). ZERO product/framework/scripts source edits (analysis-only ENFORCED by the gate).
- Decisions: analysis-only invariant enforced as a runtime/ diff-scope gate (β DECIDE B 0.89; permanent enforcer = an EXECUTION finding R26, NOT scope-contract-guard — wrong seam). Track-5 SUPERSEDED into E-SYSTEM-ORG-001 (auditable; ED-026 tail = R25). gemini tier-dead → GPT+Claude 2-source (honest debt, ED-060).
- Issues discovered: stale-tracker class (this epic's ~15%→~65-70%→100% reconcile) recurred — recurring-issue for retro. The marquee R4/N-1 (`scan:tools` doctrine without an enforcer, ED-033) is a prose-asserts-a-guard-that-isn't-there hazard.
- State change: Active ~15% → **Completed 100%** · Verification: gauntlet GREEN (diff-scope gate + register positive-coverage cross-check + 2-source security reconciliation); `node scripts/trackers/validate.js` PASS.
- Next action: hand to α for convergence + merge (operator-granted push). The EXECUTION epic (E-MC-READINESS-EXECUTION-001) now has a frozen target — the register's R1-R26.
- Evidence/references: register `_reports/E-MC-READINESS-findings-register.md`; commit chain c5a3a58e(A1)→4c7f69f9(A2)→this; β events EVT-sp20260618-002-{plan-design,design-build}-1.

### 2026-06-16 — Track 4 release-pipeline analysis (autonomous)
- Agent(s): Alex α (Opus 4.8), autonomous · Mode: sprint
- Work performed: authored the Track-4 release-pipeline slip-through findings doc (`_reports/E-MC-READINESS-track4-release-pipeline-analysis.md`), evidence-grounded in this session's live ship-coverage RED (the panels/admin/cockpit backing scripts shipped to nobody → broke `release --strict`, fixed `c7e97610`). Root cause: (1) `ASSET_DIRS` is a hand-maintained INCLUDE list (≥4 recurring slip instances); (2) `mc-ship-coverage` runs at release + on-demand but NOT per-commit (verified absent from linters/testsuite/hooks) — a gap is invisible from commit→release. Proposed Fix A (invert `ASSET_DIRS` to auto-detect + EXCLUDE list) + Fix B (ship-coverage per-commit, report-only→ramp). Analysis-only, no change applied.
- State change: 0% → ~15% (Track 4 done + Track 6 partial via the audit). · Next action: the hardening-sim / security / edge-case / file-org tracks (read-only); the recommended fixes belong to the EXECUTION epic.
- Evidence/references: `_reports/E-MC-READINESS-track4-release-pipeline-analysis.md`; `runtime/roadmap-audit/` (Track-6 partial); commit `c7e97610`.

### 2026-06-07 — Session session/2026-06-07 (epic authored)
- Agent(s): President Agent (α) · Mode: solo/α-foreground
- Work performed: Authored this analysis epic + the execution epic at ROADMAP § Active epics ⭐⭐ TOP, per operator's masterconsole-release-readiness directive + analysis-then-execution strategy. Captured the 6 analysis dimensions (incl. the operator's prose-vs-reality addition + security triple-pass).
- Files changed: ../../ROADMAP.md (2 epic entries + priority-ordering); this tracker + the execution tracker.
- State change: (new) → Active · Completion 0%.
- Next action: mint the 6 analysis sprints (start hardening-simulation + prose-vs-reality); run /roadmap:prioritize to bundle.
- Evidence/references: operator directive 2026-06-07; cross-session inbox "dispatch layer is the blocking hard-enforcement gate on 0.15.2 ship readiness."

## Change log
### 2026-06-07 — Epic created (President α)
- Changed: Created E-MC-READINESS-ANALYSIS-001 (Active, 0%, ⭐⭐ TOP).
- Reason: operator-directed masterconsole-release-readiness prep with an analysis-first (frozen-target) strategy.
- Affected: ../../ROADMAP.md; this tracker; the execution epic tracker.
- Previous → New: no release-readiness epic existed → a two-epic (analysis→execution) structure at the top.

## Evidence log
### 2026-06-07 — epic authored
- Evidence type: Existence confirmation.
- Detail/location: ROADMAP § Epics → E-MC-READINESS-ANALYSIS-001; this file.
- Verified by: President Agent. Supports: the 0% Active state.

## Verification log
| Item | Should exist? | State | Where | Proof | Checked | By |
| --- | --- | --- | --- | --- | --- | --- |
| This epic in ROADMAP | Yes | Verified Exists | ROADMAP § Active epics | authored 2026-06-07 | 2026-06-07 | President Agent |
| 6 analysis sprints | Yes (planned) | Missing But Required | trackers/sprints/ (to mint) | next action | 2026-06-07 | President Agent |

## Current next action
None — analysis epic COMPLETED by SP-20260618-002 (2026-06-18). The frozen target is delivered:
`_reports/E-MC-READINESS-findings-register.md` (R1-R26). NEXT for the program: **E-MC-READINESS-EXECUTION-001**
(currently Planned/blocked-on-this) is now UNBLOCKED — it burns down the register, P0 first (R1 mutating
warm cell, R2/R3 admin session, R4 scan:tools honesty, R5 capsule provenance). Residual analysis follow-up:
none (track-5's ED-026 tail is captured as register R25 for EXECUTION).

## Completion record
- Final state: Completed
- Percent completion: 100%
- Completion timestamp: 2026-06-18
- Definition of done used: see Definition of Done above — all 4 checked + evidenced
- Evidence of completion: SP-20260618-002 gauntlet GREEN. 6 tracks accounted for (1/2/3/4/6 findings docs + 5 superseded); DoD#2 register `_reports/E-MC-READINESS-findings-register.md` (26 rows, positive-coverage verified, no orphans); bundling recorded; analysis-only invariant ENFORCED (diff-scope gate GREEN, 9/9 self-test). Commit chain c5a3a58e(A1)→4c7f69f9(A2)→A3-reconcile.
- Session IDs / dates / agents: SP-20260618-002 / 2026-06-18 / Alex ε (conductor) + α (relay+merge) + β (boundaries) + Claude A1 analyst + GPT-5.5 2nd-pass; epic authored session/2026-06-07 / President Agent
- Related completed sprints: SP-20260618-002 (this); the autonomous Track-2/3/4/6 passes (2026-06-16)
- Remaining follow-up items: none for ANALYSIS; the register (R1-R26) is the EXECUTION epic's backlog
- Related untracked work: None
- ../../TRACKER.md updated: yes (this reconcile) · Roadmap reconciled: yes (⭐⭐ TOP entry + priority-ordering; epic → Completed)
