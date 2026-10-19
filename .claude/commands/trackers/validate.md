---
description: Fail-closed validator for the enforced tracker system. Asserts TRACKER.md carries all 34 sections with no blank section, no broken intra-repo links, active epics/sprints link to real /trackers/ files, active items have a next action, completed items have evidence and are 100%, 100% items are marked completed, sprints name a parent epic, no ambiguous-state language, no undefined operational terms, and the required paths exist. A validator that errors must never read green.
says:
  - validate the tracker
  - is the tracker green
  - check tracker
  - trackers validate
---

# /trackers:validate — Does the tracker tell the truth?

The tracker system exists to make long-running work **resumable, auditable, and truthful** across sessions — and it needs a validation process so the rules don't live only in prose. This skill is that process: a deterministic, **fail-closed** check that refuses the tracker's core failure classes — a missing required section, a blank section that hides ambiguity, a link to a file that isn't there, an "active" item with no next action, a "completed" item with no evidence or below 100%, a 100% item still marked in-progress, a sprint with no parent epic, "probably done"-style language, an operational term used without a definition, and a required path that doesn't exist.

The discipline is the same as the rest of the suite: a **pure `evaluate()` core** (every seam injected — no disk, no cwd) wrapped in a thin FS reader, with an in-file **bite-test** that fires every check both PASS and FAIL. The validator roots itself at the canonical repo, not the working directory, so it is correct even when run from a stale worktree.

## Run

```bash
node scripts/trackers/validate.js            # human-readable report
node scripts/trackers/validate.js --json      # machine-readable result
node scripts/trackers/validate.js --selftest   # in-file bite-test (every check, both ways)
```

## What it asserts (fail-closed)

Each named check returns `PASS`/`FAIL` with details:

- **(a) sections-present** — `TRACKER.md` contains all **34 sections**.
- **(b) no-blank-section** — every present required section has content or the explicit `None currently recorded.` sentinel.
- **(c) broken-links** — every intra-repo link target in `TRACKER.md` resolves to a real file.
- **(d) active-tracker-files** — every **Active** epic/sprint links to an existing file under `/trackers/`.
- **(e) active-next-action** — every active item names a next action.
- **(f) completed-evidence** — every completed item records evidence.
- **(g) completed-100** — every completed item is **100%**.
- **(h) hundred-completed** — every 100% item is marked **completed** (the inverse).
- **(i) sprint-parent-epic** — every sprint names a parent epic.
- **(j) ambiguous-language** — no prohibited ambiguous-state phrase ("probably complete", "should be fine", "seems done", …) appears.
- **(k) undefined-terms** — no core operational term is used in the body but absent from the **Definitions** section.
- **(l) required-paths** — the required files, directories, and templates exist (`TRACKER.md`, `ROADMAP.md`, `UNTRACKED_WORK.md`, `/trackers/{epics,sprints,templates}/`, and the 9 templates).

**Fail-closed contract.** `evaluate()` never throws on malformed tracker content — bad input surfaces as a `FAIL`, never a silent pass. An **unverified** link or **unprobed** required path is treated as broken/missing (it cannot read green without proof). A genuine runner/parse error exits **2**.

Exit `0` all checks pass · `1` at least one check failed · `2` usage / runner error (**fail-closed** — a validator that errors must never read green).

## When to run

- After any edit to `TRACKER.md`, an epic/sprint tracker, the roadmap's epic structure, or the `/trackers/` templates — the fast way to confirm the tracker stayed honest.
- Before claiming a sprint or epic complete (the completion gate consults the same invariants).
- At session handoff / before context compaction — prove the written state is resumable, not just remembered.

## Reference

- Engine: `scripts/trackers/validate.js` — pure `evaluate({ tracker, items, linkTargets, pathExists })` + thin FS `run()` + in-file bite-test (`--selftest`, 30 cases: positive + checks a–l firing both ways + fail-closed).
