---
description: Turn a messy plain-language epic request into a durable, validate-shape epic tracker file plus a companion plan artifact (AC, sprint candidates, dependency/risk maps, tracker linkage). The epic equivalent of /sprint:plan.
user-invocable: true
---

# /epic:plan — Epic Plan

Front door for the epic workflow. Turn brief, messy founder/operator intent
(a prompt like this one) into TWO durable, round-trip-linked artifacts:

1. A **validate-shape epic tracker file** at `trackers/epics/<E-id>-<slug>.md`
   — every frontmatter bullet + every required §-section the tracker validator
   and `EPIC_TEMPLATE.md` expect (so it slots straight into the enforced tracker
   system).
2. A **companion plan artifact** at `_planning/epics/<E-id>.md` — the durable
   plan (acceptance criteria, sprint candidates, dependency map, risk map,
   required agents/modes/team/hooks, execution gates, approval points,
   blast-radius) carrying a **tracker-linkage pointer back to the epic file**.

`/epic:plan` is **planning only**. It does not mint sprints, switch modes, or
start a build. It is the epic-level analogue of `/sprint:plan`.

> Convention tie — the `trackers/epics/<id>.md` ⇄ `_planning/epics/<id>.md`
> round-trip linkage is formalized by S-LC-08 in `_planning/README.md`. This
> skill only **references** `_planning/epics/` as a path (the backing script
> mkdir-p's it defensively); it does not author the dir contract.

## When to use

- The operator gives you messy, plain-language intent that is clearly an **epic**
  (multi-sprint, spans waves, needs a durable plan) rather than a single sprint.
- You need to convert "make MC do X across many sprints" into a durable,
  tracker-linked plan with acceptance criteria and sprint candidates BEFORE any
  `/sprint:plan` is minted.

## Inputs

```text
/epic:plan "<messy plain-language epic request>" [--id <E-SEGMENT-###>] [--force]
```

- `--id` — the epic ID (e.g. `E-LIFECYCLE-001`). If omitted, propose one from the
  request (segment from the theme + the next free number) and confirm it — the
  epic ID + title is a taste/semi-irreversible call (a § Human Approval Point).
- `--force` — overwrite an existing epic file (read-before-write: the script
  refuses to clobber without it; a re-run with the same payload is idempotent).

## Procedure

### Step 1 — Preserve the request verbatim
Capture `$ARGUMENTS` exactly. The cleaned-up version becomes the plan's Goal/
Background; the verbatim text is the provenance anchor.

### Step 2 — Reason the epic into structured fields
Do the planning reasoning (this is the model's job; the backing script is dumb
plumbing). Produce, at minimum:
- `epicId`, `slug`, `title`, `owner`, `roadmapArea`, `goal`, `background`,
  `scope`, `outOfScope`.
- `definitionOfDone[]` — concrete, checkable, each later provable (≥1 required;
  an empty DoD is a blank required section and the script refuses it).
- `acceptanceCriteria[]` — free-form AC. The plan artifact ALSO auto-scaffolds the
  **20 enforcement-criteria categories** (S-LC-11, PLAN §11) as a checklist in
  `## 4. Acceptance criteria`, single-sourced from `scripts/sprint/ac-categories.js`
  (each category a `proof: TODO` stub for the author to fill; `/scan:ac-coverage
  --categories` flags unproven ones report-only). The scaffold is deterministic, so
  a `--force` re-run reproduces it byte-identically (no duplication).
- `sprintCandidates[]` — `{ id, goal, state }`; sequenced into waves.
- `dependencyMap[]`, `riskMap[]`, `decisions[]`, `openQuestions[]`.
- `requiredAgents`, `requiredModes`, `teamBehavior`, `lifecycleHooks`.
- `executionGates[]`, `approvalPoints[]`, `blastRadius[]`.
- `date`, `sessionId`, `agent`.

### Step 3 — Inspect the repo just enough to avoid fantasy
Bounded inspection only — enough to label scope/dependencies honestly and to
pick a non-colliding epic ID. Do NOT broad-scan; do NOT start any build.

### Step 4 — Surface taste/irreversible calls for approval
The epic ID + title, any scope-reduction of currently-allowed behavior, and any
paid/destructive/deploy dependency are § Human Approval Points. Surface them; in
adhoc mode consult Beta first per `paths.decisionPolicy`.

### Step 5 — Write the artifacts
Build the structured payload as JSON, write it to a temp file, and run:

```bash
node scripts/epic/plan.js --payload <tmpfile> [--force]
```

The script:
- Validates the payload (epicId shape, title, non-empty DoD).
- Builds the epic markdown (all frontmatter bullets + all 14 §-sections) and the
  companion plan markdown.
- Runs `verifyEpicMarkdown()` (section-completeness) + asserts the round-trip
  linkage before writing — it refuses a non-section-complete epic.
- Read-before-write: refuses to clobber an existing epic file without `--force`.
- `mkdir -p`s `trackers/epics/` and `_planning/epics/` defensively, then writes
  both files.
- Prints a JSON envelope: `{ ok, epicId, epic, plan, sections_complete, linkage }`.

### Step 6 — Verify + hand off
- Confirm the JSON envelope shows `sections_complete: true` and both linkage
  flags true.
- The epic is NOT yet wired into `ROADMAP § Epics` + the `TRACKER.md` header — that
  reconciliation (and manifest/map regen) is α's at integration. Report the two
  artifact paths and the pending wiring.

## Outputs

| Artifact | Path |
|---|---|
| Epic tracker file (validate-shape) | `trackers/epics/<E-id>-<slug>.md` |
| Companion plan artifact | `_planning/epics/<E-id>.md` |
| JSON envelope (stdout) | `{ ok, epicId, epic, plan, sections_complete, linkage }` |

## Backing logic

`scripts/epic/plan.js` (pure cores `buildEpic` / `buildEpicMarkdown` /
`buildPlanMarkdown` + a thin read-before-write CLI) and the shared helpers in
`scripts/epic/lib.js` (`verifyEpicMarkdown`, section lists, `slugify`,
`isValidEpicId`). Section parsing is single-sourced from
`scripts/trackers/validate.js#splitSections` — the epic file this skill emits is
parsed by the same code the validator uses to judge it.

## Relationship to the tracker / planning systems

- `TRACKER.md` is authority; `ROADMAP.md § Epics` is the epic registry;
  `trackers/epics/<id>.md` is the per-epic detail (state lives here);
  `_planning/epics/<id>.md` is the durable plan artifact the epic links to.
- Round-trip linkage: the epic file names the plan; the plan names the epic file.
- `/epic:fold` later folds new info/scope/bugs into the epic with provenance +
  conflict detection.
