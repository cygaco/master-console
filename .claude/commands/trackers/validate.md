---
description: Fail-closed validator for the enforced tracker system (_planning/tracker-system-improvements.md §28.7). Asserts TRACKER.md carries all 34 §5 sections with no blank section, no broken intra-repo links, active epics/sprints link to real /trackers/ files, active items have a next action, completed items have evidence and are 100%, 100% items are marked completed, sprints name a parent epic, no §21 ambiguous-state language, no undefined §8 operational terms, and the §33 required paths exist. A validator that errors must never read green.
---

# /trackers:validate — Does the tracker tell the truth?

The tracker system (`_planning/tracker-system-improvements.md`) exists to make long-running work **resumable, auditable, and truthful** across sessions — and §28.7 mandates a validation process so the rules don't live only in prose. This skill is that process: a deterministic, **fail-closed** check that refuses the tracker's core failure classes — a missing required section, a blank section that hides ambiguity, a link to a file that isn't there, an "active" item with no next action, a "completed" item with no evidence or below 100%, a 100% item still marked in-progress, a sprint with no parent epic, "probably done"-style language, an operational term used without a §8 definition, and a §33 required path that doesn't exist.

The discipline is the same as the rest of the suite: a **pure `evaluate()` core** (every seam injected — no disk, no cwd) wrapped in a thin FS reader, with an in-file **bite-test** that fires every check both PASS and FAIL. The validator roots itself at the canonical repo, not the working directory, so it is correct even when run from a stale worktree.

## Run

```bash
node scripts/trackers/validate.js            # human-readable report
node scripts/trackers/validate.js --json      # machine-readable result
node scripts/trackers/validate.js --selftest   # in-file bite-test (every check, both ways)
```

## What it asserts (fail-closed)

Each named check returns `PASS`/`FAIL` with details:

- **(a) sections-present** — `TRACKER.md` contains all **34 §5 sections**.
- **(b) no-blank-section** — every present required section has content or the explicit `None currently recorded.` sentinel (§5 prohibits blank sections).
- **(c) broken-links** — every intra-repo link target in `TRACKER.md` resolves to a real file.
- **(d) active-tracker-files** — every **Active** epic/sprint links to an existing file under `/trackers/`.
- **(e) active-next-action** — every active item names a next action (§28.7).
- **(f) completed-evidence** — every completed item records evidence (§26).
- **(g) completed-100** — every completed item is **100%** (§20).
- **(h) hundred-completed** — every 100% item is marked **completed** (the §20 inverse).
- **(i) sprint-parent-epic** — every sprint names a parent epic (§30 hierarchy).
- **(j) ambiguous-language** — no §21 prohibited ambiguous-state phrase ("probably complete", "should be fine", "seems done", …) appears.
- **(k) undefined-terms** — no core §8 operational term is used in the body but absent from the **Definitions** section.
- **(l) required-paths** — the §33 required files, directories, and templates exist (`TRACKER.md`, `ROADMAP.md`, `UNTRACKED_WORK.md`, `/trackers/{epics,sprints,templates}/`, and the 9 templates).

**Fail-closed contract.** `evaluate()` never throws on malformed tracker content — bad input surfaces as a `FAIL`, never a silent pass. An **unverified** link or **unprobed** required path is treated as broken/missing (it cannot read green without proof). A genuine runner/parse error exits **2**.

Exit `0` all checks pass · `1` at least one check failed · `2` usage / runner error (**fail-closed** — a validator that errors must never read green).

## When to run

- After any edit to `TRACKER.md`, an epic/sprint tracker, the roadmap's epic structure, or the `/trackers/` templates — the fast way to confirm the tracker stayed honest.
- Before claiming a sprint or epic complete (the §28.6 completion gate consults the same invariants).
- At session handoff / before context compaction — prove the written state is resumable, not just remembered.

## Reference

- Engine: `scripts/trackers/validate.js` — pure `evaluate({ tracker, items, linkTargets, pathExists })` + thin FS `run()` + in-file bite-test (`--selftest`, 30 cases: positive + checks a–l firing both ways + fail-closed).
- Spec: `_planning/tracker-system-improvements.md` — §5 (34 sections) · §8 (definitions) · §19 (states) · §20 (percent rules) · §21 (language) · §28.7 (validation enforcement) · §33 (required paths).
