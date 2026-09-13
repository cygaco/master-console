# ADR 0002 — Multi-sprint parallelism via per-sprint state + lanes

**Date:** 2026-05-12
**Status:** accepted
**Class:** B (architectural — state shape, isolation primitive, dependency-graph behavior).

---

## Decision

MC Sprint Workflow lifts the single-current-sprint constraint by (1) replacing the two singleton tracker yamls with a top-level `active-sprints.yaml` registry plus per-sprint subdirs `sprints/<SP-id>/{current,progress}.yaml`, and (2) introducing a `lane` field on Plan Contract / current-sprint that lets `/sprint:execute` run Ralph loops inside a git worktree when isolation is needed.

Concurrency is advisory in v0.2 (`max_lanes: 2` in `sprint-routing.json`); no coordinator process, no cross-sprint dependency graph, no lane-aware Beta. Those land in a follow-up sprint if the two-lane case proves valuable.

## Context

Sprint Workflow v0.1 (shipped 2026-05-11) encoded a single-active-sprint design directly into two yaml singletons (`paths.sprintCurrent`, `paths.sprintProgress`) and a schema description that read "Always exactly one current-sprint.yaml per downstream repo". Every helper in `scripts/sprint/` read and wrote those singletons by file path.

The founder request (2026-05-12) was literal: "A way to run multiple sprints in parallel." Two senses needed disentangling — (a) multiple sprints *open* at once (paused/active) and (b) multiple sprints *executing* simultaneously without colliding on tracker state or git history. Beta consultation at plan time (EVT-s-sp-20260512-001-beta-001, DECIDE confidence 0.82) ruled that (b) is the intended reading; (a)-only would generate a follow-up complaint.

The constraint set: MC is at MVP stage (`paths.currentStage`) — simplicity and reversibility dominate. No new dependencies. Reuse existing isolation primitives (the `Agent(isolation: "worktree")` flow proven by oneshot/builders).

## Options considered

1. **Option A — minimal_safe (state-shape only).** Replace the two singletons with per-sprint subdirs + `active-sprints.yaml`. Helpers gain `--sprint <SP-id>`. No concurrent execution — Ralph still runs one sprint at a time, but many can be "open."

2. **Option B — recommended (state + lanes + concurrent execution).** Option A plus: `lane` field on Plan Contract / current-sprint declares isolation type (`default | worktree | branch`); `/sprint:execute` honors `lane.type === "worktree"` by chdir-ing into the lane's worktree; conflict-check refuses to launch a second sprint whose `affected_surfaces` overlap with a live sprint's; append singletons (`events.jsonl`, decision-ledger, beta events, `issues.md`) tag every new row with `sprint_id`; new `/sprint:status` lists active lanes.

3. **Option C — expanded (coordinator + cross-sprint deps + dashboard).** Option B plus an always-on `sprint-coordinator` process, `sprint.requires: [SP-X]` cross-sprint dependency graph, lane-aware Beta, aggregated cost telemetry.

## Decision criteria

Rubric scoring at MVP stage (high weights: Product fit, Simplicity, Reliability, Reversibility):

| Criterion | A (minimal_safe) | B (recommended) | C (expanded) |
|---|---|---|---|
| Product fit | low — answers "open" not "parallel" | **high** — actually parallel | high |
| Simplicity | high | medium (worktree + conflict-check) | low (coordinator + graph) |
| Reliability | high | medium-high (reuses known primitives) | low (new always-on process) |
| Reversibility | high | high — lanes can be stripped without registry change | medium |
| Speed-to-ship | high | medium | low |
| Operational burden | low | low-medium (worktree hygiene) | high (coordinator failure modes) |
| Cognitive cost | low | medium | high |

## Why this option won

Option B wins on Product fit, the dominant axis at MVP when the user states a capability requirement directly. Option A under-delivers ("open" sprints aren't what was asked for; founder will return asking why execution still serializes). Option C is premature: one founder with two real workstreams does not need a scheduler; the coordinator's failure modes (stalled lanes, deadlocked cross-sprint deps) introduce risk that the simpler B does not.

The Simplicity gap between A and B is bounded because lanes reuse the existing `Agent(isolation: "worktree")` primitive that builders and oneshot have used for months. The Reversibility for B is equivalent to A — lane semantics can be stripped from the registry without disturbing the state shape.

Beta confirmed the call at design-review time as well (EVT-s-sp-20260512-001-beta-002, DECIDE confidence 0.83), greenlighting four specific design choices: (i) `T-014` (sprint-id tagging) stays one ticket for atomicity; (ii) no sprint-level lock file in v0.2; (iii) worktree warm-up dispatch is always-fire (the leak is structural, not historical); (iv) migration approval level is `execution_approval_required` (confirmation lives inside `--apply`, not at sprint-execute kickoff).

## Risks

1. **Migration of live SP-20260512-001 corrupts tracker state.** Moving `current-sprint.yaml` + `sprint-progress.yaml` into `sprints/<SP-id>/` after the new schema/resolver landed could silently drop fields.

2. **Conflict-check under-detects overlap.** `affected_surfaces` is human-declared at plan time; an under-declared list slips a real conflict through and lets two Ralph loops commit to the same files.

3. **Worktree-lane drift.** Operator runs `git checkout` inside a worktree mid-Ralph, HEAD moves silently, Ralph's `record` phase commits against the wrong base.

4. **First-parallel-dispatch leak (LRN-2026-04-17).** When `/sprint:execute` spawns the first agent in a worktree lane, that dispatch can land on the primary repo HEAD instead of the lane's tree.

5. **Append-singleton interleave forensics.** Two sprints' rows in `events.jsonl` interleave; without `sprint_id` filtering, retros mis-attribute work.

6. **Schema drift.** The two `current-sprint.yaml.tmpl` validation errors (`null` defaults vs `string`-only schema; inline `{...}` flow mappings as strings) shipped silently in v0.1. Future schema changes could re-introduce similar mismatches.

## Mitigations

1. **Migration script (`scripts/sprint/migrate-v0.2.js`, T-20260512-004) ships with byte-equivalence verify on every moved field AND a pre-move backup directory under `.claude/runtime/migrate-v0.2-backup/`. Legacy-file deletion requires explicit operator confirmation (COPY C-7) — recorded as a pending approval (`AP-20260512-001`) that resolves at run time.**

2. **`/sprint:execute` does a second conflict-check at execute-entry (not just at plan-time warn). Override requires `--allow-overlap`, logged to the decision-ledger as `manual_allow_overlap`. A redteam probe (A-5) flags the limitation in `_docs/sprint/LANES.md`.**

3. **Drift detection: `execute.js` captures `git rev-parse HEAD` on lane entry; mismatch on next phase write triggers `stopped_unclear_intent` with drift detail in resume_notes.**

4. **Worktree warm-up dispatch (`T-20260512-011`): before the first real Ralph dispatch in a worktree lane, fire one no-op agent through the same `Agent(isolation: "worktree")` primitive. Logs TR-3 (`sprint.warmup_dispatch`). Always-fire on `lane.type === "worktree"`; skipped on `default`.**

5. **Sprint-id tagging (`T-20260512-014`) on every new row in `events.jsonl`, `decision-ledger.jsonl`, Beta events, and `issues.md` (markdown ledger gets a `[SP-…]` prefix). Pre-existing rows are forward-compatible — readers treat missing `sprint_id` as `null`, no retro-fill.**

6. **The init-template-vs-schema regression test in `scripts/test-sprint-hooks.js` (T-20260512-005) runs `init.js` end-to-end and validates the resulting tracker. Schema-loosening for `requirements.*` / `reports.*` / `plan_contract` to `["string","null"]` removes the existing trip-wire. The parseMiniYaml flow-mapping fix in `scripts/sprint/fs.js` prevents inline `{...}` round-tripping as strings.**

## Reversal plan

If multi-sprint proves a net cost (e.g., conflict-check creates more friction than it prevents; founder uses only one lane in practice), revert by:

1. Setting `active-sprints.yaml#primary` permanently and ignoring the `sprints[]` array.
2. Running `scripts/sprint/migrate-v0.2.js --rollback` to restore `current-sprint.yaml` + `sprint-progress.yaml` at `paths.sprintRoot`.
3. Removing the `lane` field from Plan Contract + current-sprint schemas (and dropping the `worktree` / `branch` enum values).
4. Removing `scripts/sprint/conflict-check.js`, `scripts/sprint/status.js`, `_docs/sprint/LANES.md`.

Estimated cost: one PR, half a day, no data loss (the registry preserves history). Trigger conditions: founder explicitly asks to remove the feature; OR conflict-check false-positive rate (`grep TR-4` in `events.jsonl`) exceeds 30% over a month with no true positives.

## References

- **Sprint Workflow doc:** `paths.sprintReference` (`.claude/project/reference/sprint-workflow.md`) — "Lanes & parallel sprints" section (T-20260512-017).
- **New design doc:** `_docs/sprint/LANES.md` (T-20260512-017).
- **Plan Contract:** `.claude/project/sprint/plan-contracts/PC-20260512-0001.yaml`.
- **PRD / stories / AC / QA / redteam / release plan:** `.claude/project/sprint/requirements/SP-20260512-001/`.
- **Beta consultations:**
  - `EVT-s-sp-20260512-001-beta-001` — scope variant pick, DECIDE confidence 0.82
  - `EVT-s-sp-20260512-001-beta-002` — design spot-check, DECIDE confidence 0.83
- **Underlying isolation primitive:** `Agent(isolation: "worktree")` documented in agent specs (builder, fixer, oneshot doctrine).
- **Existing dispatch concurrency:** `scripts/hooks/lib/concurrency-lock.js` + `.claude/runtime/dispatch-locks/` — handles provider-rate-limit slotting, reused by parallel-sprint execution without redesign.
- **Known leak workaround source:** `scripts/one-off-log-dispatch-issues.js` (LRN-2026-04-17, parallel-dispatch-first-leak).
- **Migration approval:** `.claude/project/sprint/approvals/AP-20260512-001.yaml` (state: pending; resolved inside `--apply`).
