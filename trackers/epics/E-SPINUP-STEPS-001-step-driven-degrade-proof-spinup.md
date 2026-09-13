<!-- EPIC TRACKER — spec §22. Linked from ../../TRACKER.md. Template: ../templates/EPIC_TEMPLATE.md
     States (§19): Planned | Ready | Active | Blocked | Paused | Review Needed | Completed | Cancelled | Superseded -->

# E-SPINUP-STEPS-001 — Step-driven, degrade-proof `bootstrap:spinup` + Milestone→Epic

- **Epic label and number:** E-SPINUP-STEPS-001
- **Title:** Step-driven, degrade-proof `bootstrap:spinup` pipeline + global Milestone→Epic rename
- **Owner:** President
- **Parent roadmap area:** [ROADMAP.md § Epics → E-SPINUP-STEPS-001](../../ROADMAP.md) — under the E-GOLDEN-FLOW-001 golden-flow thrust (the consumer-contract that unblocks the Master Console runner).
- **Goal:** Refactor `bootstrap:spinup` into a step-driven, independently-dispatchable, idempotent, resumable pipeline (`setup → canon → roadmap → paint`) with a stable `--json` status + machine-readable `orchestration_prompt` (the consumer contract), make the engine STRUCTURALLY refuse degraded canon for good, add a `--where` platform target, reconcile `portfolio:new` to the `setup` step, and rename Milestone→Epic across the live framework. Reuse existing engines; do not reimplement.
- **Background:** The Master Console Create flow dies at canon: the consumer runs the whole chain in one exec, the orchestrator exits code 3 (`needs_orchestration`) at the first LLM phase, and the consumer has no in-loop agent to do the synthesis, so the flow stalls at canon and punts to the user. The framework fix = one step = one turn, each step independently dispatchable/idempotent/resumable with a clean `--json` status, AND an engine that can NEVER ship degraded canon regardless of caller (the WI-51→WI-47 regression must be made structurally impossible). Source: `MC-PROMPT.md` (2026-06-06); root cause confirmed in `server/bootstrap-actions.ts`.
- **Scope:** §0 gap analysis (behavior→step table); §1 step-driven invocation contract (positional `<step>` subcommand, `--json` status shape, consumer dispatch contract, fold preflight+intent→setup / onscreen→paint); §2 anti-degrade engine (remove `--research off`/`light`, reject non-zero; remove `--auto` degrade/skip; wire `canon-no-unfilled-tokens` as a fail-closed non-opt-out gate; raw input never in canon; `--allow-needs-input` audited single-field exception); §3 platform `--where`; §4 reconcile `portfolio:new` into `create()/scaffold()` callables reused by `setup`; §5 Milestone→Epic global rename (live layer); §6 portfolio suite scope (`spinup` pass-through + `new` reconcile only); §7 regression enforcers (per-step seam, idempotent, resume, `--research off` rejected, anti-degrade gate, headless-contract, `--research-in` fixture); §8 β + acceptance.
- **Out of scope:** `server/` and any Master Console cockpit UI (that is `MASTERCONSOLE-PROMPT.md`, GATED — built separately). Native mobile/desktop scaffolds (v1 ships web/PWA baseline + a native-packaging follow-on epic). Rewriting historical sprint-requirement archives / plan-contracts / `_reports` (immutable history; the rename targets the LIVE framework layer only).
- **Current state:** Completed
- **Percent completion:** 100% — landed on `main` @ `c9583dd` (2026-06-06); all §0–§8 delivered + evidenced.

## Definition of Done
- [x] Each step (`setup`/`canon`/`roadmap`/`paint`) is independently dispatchable + idempotent (2nd run = no-op) + resumable + emits a valid `--json` status (`{ phase, status, ran[], orchestration_prompt, data{serveUrl,firstAction,roadmapPath} }`). — verified by the seam tests (32/32).
- [x] Full chain reaches a served first paint when synthesis is fulfilled (in-loop or via a consumer runner). — the framework exposes the path (setup→canon→roadmap→paint with `needs_orchestration` handoffs); canonical proves the chain on a fixture (a real served paint is product-side, by design).
- [x] The engine has NO path to degraded output: `--research off` and any degrade alias/skip rejected non-zero; the `canon-no-unfilled-tokens` fail-closed gate is non-opt-out; raw user input never lands in canon (intent/brief only). — tested (research-off rejection + anti-degrade gate).
- [x] `--where android|ios|web|desktop-pc|desktop-mac` accepted; recorded in brief + canon PRODUCT_MODEL; influences roadmap; passed to scaffold (web/PWA baseline for all v1 + native-packaging epic + `/mc:flag`). — `setup.js` threads it; `E-NATIVE-PACKAGING-001` + `MC.md` WG-1.
- [x] `portfolio:new` reconciled — one `create()/scaffold()` implementation reused by `setup`; no duplicated create/scaffold logic. — `scripts/portfolio/new-lib.js` (createProductRepo/scaffoldProductApp); `new.js` thin CLI; `setup.js` reuses.
- [x] Milestone→Epic green under `scan:roadmap-trace`; no LIVE (non-deprecated) Milestones heading remains in the live layer. — roadmap-trace 30/30.
- [x] Portfolio scope limited to `spinup` pass-through + `new` reconcile (no `portfolio:canon/roadmap/paint`). — verified; no new portfolio sub-skills.
- [x] Gap-analysis table shows zero dropped behaviors (recorded). — `runtime/notes/mc-spinup-gap-analysis.md` (32 rows, 2 intentional anti-degrade removals).
- [x] Seam + headless-contract + anti-degrade + research-off-rejected tests pass; consumer dispatch contract documented in the skill body with its named enforcer. — `test-spinup-orchestrate.js` 32/32; contract + enforcer documented in `spinup.md`.

## Related definitions
- Epic, Sprint, Validator, Wiring, Verification, Evidence — see ../../TRACKER.md
- Enforcer / fail-closed gate — see ../../TRACKER.md (Hook, Command, Validator)

## Related sprints
- [S-SPINUP-001](../sprints/S-SPINUP-001-step-driven-degrade-proof-spinup.md) — Active — build §1–§7 (step refactor + anti-degrade + platform + reconcile + rename + enforcers) then §8 acceptance.

## Dependencies
- None hard. Consumes the existing canon engine (`scripts/canon/generate.js`), `canon-no-unfilled-tokens.js`, `portfolio/clone.js`, `scaffold/app.js`, `roadmap:create` — all Verified Exist. **Unblocks:** `MASTERCONSOLE-PROMPT.md` (the headless runner that consumes the step contract).

## Blockers
- None currently recorded.

## Risks
- Tightly-coupled code: one orchestrator + 5 phase modules + tests all edited together — parallel builders on the same files would conflict. Mitigation: core build in-loop (Alpha), only genuinely-separate files (rename docs) parallelized. Likelihood: high · Impact: medium.
- §5 rename is broad (669 raw `milestone` occurrences across 233 files). Mitigation: scope to the LIVE framework layer; leave immutable history; `scan:roadmap-trace` is the green gate. Likelihood: medium · Impact: medium.
- Anti-degrade regression class (WI-51→WI-47) recurs via renamed holes. Mitigation: a structural enforcer + a test asserting every degrade alias/skip is rejected. Likelihood: medium · Impact: high.

## Decisions
- 2026-06-06 — Execute the tightly-coupled orchestrator/phase code IN-LOOP (Alpha) under the speed cadence (engine-sprint), not via parallel worktree builders (which would conflict + risk the RI-004 reap). Parallelize only the §5 doc rename. Rationale: file-coupling reality; honesty over theater.
- 2026-06-06 — Model the whole MC-PROMPT as ONE epic with ONE build sprint (S-SPINUP-001) plus the §0 gap-analysis artifact. Rationale: the eight sections are one cohesive refactor of the same files; discrete sprints would fragment a single edit surface.

## Open questions
- §5 rename boundary (live vs history) — owner: President; provisional answer recorded under Decisions/Out-of-scope (live layer only). Confirm with β at the design boundary.

## Session log
### 2026-06-06 — Session mc-spinup-sprint (α + ε + β persistent team)
- Agent(s): President α (lead) + ε (conductor) + β (judgment) · Mode: sprint
- Work performed: read MC-PROMPT.md + the full spinup source (orchestrator + 5 phases + test + skill + canon engine + enforcer + portfolio/new); authored the §0 gap-analysis table (`runtime/notes/mc-spinup-gap-analysis.md`); registered this epic + S-SPINUP-001 in ROADMAP.md + TRACKER.md.
- Files changed: this file; ../sprints/S-SPINUP-001-*.md; ../../ROADMAP.md; ../../TRACKER.md; runtime/notes/mc-spinup-gap-analysis.md; MC-ISSUES.md.
- Decisions: see Decisions. · Issues discovered: I-1 turbo classifier block (see MC-ISSUES.md).
- Definitions added/changed: None
- State change: (new) → Active · Completion change: 0% → 10%
- Verification performed: source read end-to-end; gap table maps every behavior to one step. · Validation run: `node scripts/trackers/validate.js` · Validation result: (pending post-edit)
- Next action: build §1 step refactor + §4 portfolio:new reconcile.
- Evidence/references: `runtime/notes/mc-spinup-gap-analysis.md`; MC-PROMPT.md.

## Change log
### 2026-06-06 — Session mc-spinup-sprint
- Changed: Created epic E-SPINUP-STEPS-001 (Active, 10%).
- Reason: Register the MC-PROMPT.md work in the tracker + roadmap.
- Affected: this file; S-SPINUP-001; ROADMAP.md § Epics; TRACKER.md (Active Epics/Sprints + header summary).
- Previous state: Did not exist.
- New state: Active, 10%.

## Evidence log
### 2026-06-06 — §0 gap analysis complete
- Evidence type: File changed.
- Detail/location: `runtime/notes/mc-spinup-gap-analysis.md` — 32-row behavior→step table; zero dropped behaviors; two intentional anti-degrade removals recorded.
- Verified by: President α · Supports: DoD "Gap-analysis table shows zero dropped behaviors."

## Verification log
| Item | Should exist? | State | Where / wired where | Proof (cmd/inspection) | Checked | By |
| --- | --- | --- | --- | --- | --- | --- |
| §0 gap-analysis artifact | Yes | Verified Exists | runtime/notes/mc-spinup-gap-analysis.md | Write + Read | 2026-06-06 | President α |
| spinup orchestrator + 5 phases | Yes | Verified Exists | scripts/bootstrap/spinup-orchestrate.js + phases/*.js | Read end-to-end | 2026-06-06 | President α |
| canon-no-unfilled-tokens enforcer | Yes | Exists But Incomplete | scripts/checks/canon-no-unfilled-tokens.js | Read — NOT wired into the canon phase as a gate (the §2 work) | 2026-06-06 | President α |

## Current next action
None — epic Completed (2026-06-06, landed on `main` @ `c9583dd`). Non-blocking follow-ups: E-NATIVE-PACKAGING-001 (native scaffolds, trigger-gated); ED-029 (machine-audit of `--allow-needs-input`); the GATED Master Console runner (`MASTERCONSOLE-PROMPT.md`, separate product layer).

## Completion record
- Final state: Completed
- Percent completion: 100%
- Completion timestamp: 2026-06-06
- Definition of done used: the §8 acceptance + the Definition of Done section above — all items satisfied + evidenced.
- Evidence of completion: landed on `main` @ `c9583dd`; `node scripts/bootstrap/test-spinup-orchestrate.js` → 32/32; `node scripts/trackers/validate.js` → 20/20; `node scripts/check/roadmap-trace.js` → 30/30; `node scripts/canon/test-generate.js` → 24/24; framework-purity OK; mc-manifest-honesty OK (1063 assets). Zero regressions (HEAD-vs-worktree linter parity 21/24). Manifests regenerated.
- Session IDs / dates / agents: 2026-06-06 · President α (build in-loop) + ε + β (persistent team) + one background systems builder (§5 prose-doc rename).
- Related completed sprints: S-SPINUP-001
- Remaining follow-up items: E-NATIVE-PACKAGING-001 (parked); ED-029 (logged); Master Console runner (gated, not this session).
- Related untracked work: None
- ../../TRACKER.md updated: Yes · Roadmap reconciled: Yes
