---
description: Fold new information, constraints, bugs, or scope into an EXISTING epic intelligently — classify the item against the 14-class taxonomy, detect conflicts with stable commitments (flag, never silently overwrite), and append a provenance Change Log entry. Idempotent.
user-invocable: true
---

# /epic:fold — Fold into an Epic

Fold new information / new constraints / new bugs / new scope into an **existing
epic** intelligently, *without breaking already-planned items*. The mechanical
half (classify · conflict-detect · provenance-append · idempotency) is in
`scripts/epic/fold.js`; the judgment half (deciding the classification, whether
an item genuinely supersedes a stable decision, and whether it needs operator
approval) is yours.

## When to use

- New information arrives about an in-flight epic: a clarification, a new
  constraint or risk, a bug that reshapes scope, a dependency, a sprint
  candidate, a tracker correction, an enforcement requirement, a blast-radius
  finding, a compatibility warning, or an operator taste call.
- You must integrate it **without** silently overwriting already-planned scope or
  stable decisions.

## Inputs

```text
/epic:fold --epic <epic-file> --text "<the new item>" \
  [--type <class>] [--source <who/where>] [--date <YYYY-MM-DD>] \
  [--conflicts-with "<substring of a stable commitment>"] [--supersedes]
```

- `--type` — one of the 14 classes (below). If omitted, a deterministic keyword
  classifier picks one; prefer passing it explicitly after your own reasoning.
- `--source` + `--date` — the provenance (who/where + when). Recorded verbatim.
- `--conflicts-with` — a substring of a stable commitment you believe this item
  contradicts; the strongest conflict signal.
- `--supersedes` — assert the item explicitly supersedes a stable decision. Even
  then the fold does NOT auto-edit Scope/Decisions — it records the supersession
  with provenance and flags it for a deliberate follow-up edit + approval.

## The 14-class taxonomy

`clarification` · `scope-addition` · `scope-reduction` · `acceptance-criterion` ·
`constraint` · `risk` · `dependency` · `sprint-candidate` · `tracker-correction` ·
`open-question` · `user-preference` · `enforcement-requirement` ·
`blast-radius-finding` · `compatibility-warning`.

(Source: `_planning/ingest/mc-lifecycle.md` §G `/epic:fold`.)

## Procedure

### Step 1 — Locate + read the epic (read-before-write)
Resolve `--epic` to the existing `trackers/epics/<id>-<slug>.md`. The script
refuses (exit 3) if the file is absent. Read the current plan before changing it.

### Step 2 — Classify the item
Identify the item's relationship to the epic and pick one of the 14 classes. Pass
it as `--type`; otherwise the deterministic fallback classifies by keyword.

### Step 3 — Detect conflicts with stable commitments
The script compares the item against the epic's **stable commitments** (the
frontmatter Scope / Out of scope bullets + the `## Decisions` section). A conflict
is **FLAGGED, never silently applied** — Scope/Decisions are never edited by a
fold. Stable decisions are preserved unless the item carries `--supersedes`, and
even then the supersession is only recorded (+ flagged for approval), not applied.

### Step 4 — Append a provenance Change Log entry
Run:

```bash
node scripts/epic/fold.js --epic <epic-file> --text "<item>" \
  --type <class> --source "<who>" --date <YYYY-MM-DD> [--conflicts-with "..."] [--supersedes]
```

The script appends a `### <date> — fold (<class>) — source: <who>` entry to the
epic's `## Change log` with: the folded text, the classification, the provenance
line, a conflict flag (if any), and an approval flag (for taste/irreversible
classes). It carries an idempotency marker (`<!-- fold:<hash> -->`), so re-folding
the same item is a **no-op**.

### Step 5 — Read the report + resolve conflicts/approvals
The JSON envelope reports `{ classification, conflict, conflict_with,
already_applied, requires_approval, provenance, report }`. The CLI exits **4**
(non-fatal signal) when a conflict was flagged — surface it and resolve the
conflict (or obtain approval) in a deliberate, separate edit. Do NOT bulldoze a
stable commitment inside a fold.

## Outputs

| Artifact | Where |
|---|---|
| Provenance Change Log entry | appended to `## Change log` in the epic file |
| Fold report (JSON envelope) | stdout |

Exit codes: `0` folded / no-op · `1` fold failed · `2` bad usage · `3` epic not
found · `4` folded **and a conflict was flagged** (resolve before any plan-item change).

## Backing logic

`scripts/epic/fold.js` — pure cores `classify` / `detectConflict` /
`stableCommitmentText` / `buildFoldEntry` / `foldIntoEpic` + a read-before-write
CLI. Taxonomy + the keyword classifier live in `scripts/epic/lib.js`
(`FOLD_CLASSES`, `classifyFold`).
