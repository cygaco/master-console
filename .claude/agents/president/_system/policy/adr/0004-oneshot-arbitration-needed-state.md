# ADR 0004 — Oneshot arbitration-needed state + per-mode director participation

- **Date:** 2026-05-31
- **Status:** accepted
- **Class:** B (β DECIDE, conf 0.89 — `EVT-s1-2-hard-halt-arbitration-beta-001`)
- **Sprint:** S1.2 (Wave 1 — modes generalization)
- **Supersedes:** —

## Context

MC modes were engineering-only; Wave 1 generalizes them to **work modes** (Solo / Adhoc / Oneshot) so the product-studio org can run in each. Directors/Leads participate differently per mode, and the hard problem is **oneshot**: a full autonomous launch with **no α and no β in the room**. FINAL-PLAN §3 requires that when contracts conflict or confidence is low, the oneshot must **fail closed to an "arbitration-needed" record — never silently green** (the oneshot stand-in for α/β escalation), and that "in autonomous mode a manager only exists as an enforcer."

S0.2 already shipped the **data model**: `decision_record.schema.json` (`arbitration_needed:boolean`, shape-compatible with betaEvents but a distinct file — the oneshot clean-room invariant) + the precedence model (global integer ranks; the contract validator REJECTS duplicate ranks). What remained — the S1.2 β hard-halt — was the **state-machine wiring** + the per-mode participation model.

## Decision (β-ratified)

**1. Granularity — per-unit park-and-continue (β Q1).** A unit of work (feature/artifact) that hits arbitration emits a `decision_record{arbitration_needed:true}` and is **parked**; the oneshot continues other units. Whole-run halt is a regression from the adhoc model it mirrors (α/β park one ambiguous unit and keep going).

**2. Triggers — enforcer-declared, fail-closed default (β Q2).** A per-domain enforcer emits arbitration when: (a) a semantic conflict exists between artifacts at *different* precedence ranks where the lower-rank one raises a blocking concern (duplicate-rank is already a hard validator reject, not arbitration); (b) its own confidence is low; (c) a cross-gauntlet deadlock (e.g. design-quality FAIL vs build_spec PASS); (d) a required upstream artifact is missing/contradictory. Confidence is **enforcer-declared with NO global threshold** (cross-domain calibration of a single number is false precision before the pilot reveals real conflict patterns — same reasoning that chose global integer ranks in `EVT-sp20260530-001`). The default is **fail-closed: when uncertain, emit `arbitration_needed:true`.** (`scripts/arbitration/emit.js`: `arbitration_needed` is true unless an enforcer EXPLICITLY passes `false`.)

**3. Resolution — fail-closed at run-end (β Q3).** A run with ≥1 open arbitration record is **NOT ship-ready**. The `arbitration_resolver` (`scripts/arbitration/resolver.js`) is the run-end gate: it exits non-zero while any unit is parked. Annotate-only would be a linter, not an enforcer (FINAL-PLAN §3 forbids ceremonial checklists). It surfaces parked units live to α/β in adhoc, and as a post-run gate in oneshot that **ties into the S3.1 pilot exit gate**. Internal error ⇒ exit 2 (a resolver that errors must never read green).

**4. Resolver bundles PER-UNIT, precedence-ordered (β ADR delta — the detail this ADR pins).** When multiple parked records share a unit (e.g. design-quality parks it for one reason AND build_spec for another), the resolver presents them as a **single per-unit bundle** — NOT per-enforcer — with **all** contributing records listed, ordered by the artifact's **precedence integer rank DESC** (highest-rank concern leads). This prevents α/β from resolving the design concern without seeing the build concern in the same view. (`emit.js` carries `artifact_precedence`; `resolver.bundlePerUnit` orders by it.)

**5. Nothing operator-owned (β Q4).** No pricing/compliance/credentials/external-facing surface in this design — α-resolvable Class B.

**Per-mode director participation** (the other half of S1.2):
- **Adhoc** — Directors/Leads are **live-consulted** via SendMessage (the same channel as β); arbitration surfaces immediately to α/β.
- **Oneshot** — Directors/Leads are **encoded AS enforcers** (the per-domain gauntlets + PL-as-enforcer, chiefing/no-invented-data, the resonance/conversion eval runner, the design-quality gauntlet). Each calls `arbitration/emit.js` when it cannot resolve; the `arbitration_resolver` is their only escalation path. A manager that can't reject is theater (FINAL-PLAN §3) — so each is wired reject-not-lint, fail-closed.

## Consequences

- New mechanism: `scripts/arbitration/{emit,resolver}.js` + bite-test `arbitration.test.js` (6/6: emit shape, fail-closed default, per-unit precedence bundling, run-end-gate input). Per-run records live under `runtime/arbitration/` (walk-skipped; per-run emissions never land in `.claude/project/`).
- The per-domain enforcers (S2.x deferred wiring) become real by emitting through `emit.js`; the resolver becomes the oneshot run-end + S3.1 pilot ship gate.
- Confidence has no global threshold — calibration is deferred to post-pilot evidence (revisit if conflict patterns show a number is warranted).

## References

- `EVT-s1-2-hard-halt-arbitration-beta-001` (this decision) · `EVT-program-preclearance-beta-001` (Q4/Q5 named hard-halt + ADR debt) · `EVT-sp20260530-001` (precedence integer-rank precedent).
- `schemas/contracts/decision_record.schema.json` · `_requirements/10-contracts/ARTIFACT-CONTRACTS.md` §3–4 · FINAL-PLAN §3.
