---
description: Specification consistency, coverage, and drift — static audit, change-driven propagation check, or pending-drift review
---

# /scan:requirements — Requirements Health

Single owner for "Are the specs consistent, complete, and up to date with the code?"

## Engine

Five backing modules under `scripts/requirements/`:

| Tool | Purpose |
|------|---------|
| `node scripts/requirements/graph-build.js` | Rebuild `_requirements/_index/requirements.graph.json` from PRDs + STORIES + HL-STORIES + contracts. Use `--check` for staleness gate. |
| `node scripts/requirements/gate.js` | Freshness Gate. Exit 0 green / 1 yellow / 2 red. Wired into merge-guard and preflight. |
| `node scripts/requirements/review.js` | Coverage report — orphans, duplicates, stale_pending_review counts, per-feature verification ratios. |
| `node scripts/requirements/apply-rco.js --auto-expire 30` | Auto-close open RCOs older than 30 days (Class C exempt). Run during `/learn:integrate`. |
| `node scripts/requirements/stage-rco.js --backfill` | Migrate legacy staged-drift entries to schema v2. |

The slash-command modes below remain. They wrap and complement the engine.

Three modes:
- **static** — full audit across all features (use before agent runs or periodic health check)
- **drift** — what changed this session, did specs propagate? (embedded in `/oneshot:retro`)
- **review** — batch-review pending drift entries staged by `edit-watcher`
## Input

`$ARGUMENTS` — Mode selection:
- No args — `static` full audit
- `drift` — session-diff propagation check
- `review` — pending drift review
- `<feature-name>` — scope static or drift to one feature
- `<feature-name> --drift` — combine: feature-scoped drift check
- `review --compact` — one-line summary per pending entry (triage mode)
- `review <feature>` — review only entries for a specific feature
- `--json` — raw JSON output

---

## Files to read (all modes)

1. `.claude/paths.json` — canonical paths
2. `.claude/manifest.json` — `build.features[]`, `projectPaths.specs`, `build.featureIdToDir`
3. Resolve spec directory: `manifest.projectPaths.specs` (default `_requirements/04-features/`, fallback `_requirements/04-features/`)
4. Requirement standards (if present): `_requirements/_standards/`, `_requirements/03-architecture/`, `_requirements/00-canonical/`
5. Foundation files from `manifest.fileOwnership.foundation`

If no manifest exists, scan the features directory dynamically.

---

## Mode: static — Full Audit

Spawn an Explore agent. Reads ALL spec files for ALL features.

### Per-feature required reads

For each feature in manifest:
- `{specs}/{feature}/PRD.md`
- `{specs}/{feature}/HL-STORIES.md`
- `{specs}/{feature}/STORIES.md`
- `{specs}/{feature}/INPUTS.md` (if present)
- `{specs}/{feature}/COPY.md` (if present)

### Consistency checks (R-series)

- **R1 Feature ID consistency** — PRD title, folder name, STORIES references all use the same ID
- **R2 Golden paths coverage** — every path in `00-canonical/GOLDEN_PATHS.md` has at least one story
- **R3 Failure states covered** — every state in `FAILURE_STATES.md` has a story or error-recovery path
- **R4 Glossary alignment** — terms in `GLOSSARY.md` used consistently across features; no synonyms drift
- **R5 Cohort coverage** — every cohort in `USER_COHORTS.md` has at least one story covering their journey
- **R6 HL-STORIES ↔ STORIES** — each HL story has granular stories; each granular story traces to an HL
- **R7 STORIES acceptance criteria** — every story has testable criteria (not "user feels confident", "UI looks clean")
- **R8 STORIES data traceability** — `Data:` fields reference types or fields that exist
- **R9 COPY coverage** — every story surface with user-facing text has a COPY entry
- **R10 PRD → HL-STORIES → STORIES dependency** — no orphan HL stories, no granular stories without an HL parent

### Coverage checks

- **R11 Every `build.features[].id` has a folder with all 5 required files** — `PRD.md`, `HL-STORIES.md`, `STORIES.md`, `INPUTS.md`, `COPY.md` must all exist. Missing any one → ERROR. **Exemption: `phase=0` features (foundation infrastructure)** are not user-facing product features and don't have spec folders by design — their canonical home is `manifest.fileOwnership.foundation`, not `_requirements/04-features/`. Skip the 5-file requirement when `feature.phase === 0`. Severity ERROR for phase ≥ 1; phase=0 is exempt. No exemptions for "thin" product features.
- **R12 No orphan spec folders** — every folder under `{specs}/` matches a manifest feature (or is explicitly archived). Severity: ERROR.
- **R13 Foundation files mentioned** — every `fileOwnership.foundation` file referenced by at least one spec that justifies its shared status. Severity: WARN.
- **R16 No orphan code files** — every TypeScript file under `src/components/`, `src/app/api/`, `src/lib/`, `src/hooks/`, `extension/` MUST be owned by exactly one of: (a) some `store.features[<id>].files[]` array, or (b) `manifest.fileOwnership.foundation`, or (c) explicitly listed in a `manifest.fileOwnership.shared` allowlist (if defined). Build the union of all owned file paths from store + foundation; glob the actual src/ tree; symmetric diff. Files-on-disk-not-owned → ERROR: "`<path>` exists in code but no feature owns it; either add to `store.features[<owner>].files[]` or to `fileOwnership.foundation`." Files-owned-not-on-disk are caught by I11 (knownStubs exist). Rationale: Orphan code is dangerous because (1) builders can't know to update it during runs (no spec drives it), (2) gut-mode skips it (not in any feature's files[]), (3) it accumulates as drift weight. Severity: ERROR. Exemptions: files prefixed `.` or under `__tests__/`, `*.test.ts(x)`, `*.spec.ts(x)`, `*.stories.tsx`.

### Drift indicators (static signal)

- **R14 STALE banners in specs** — `<!-- STALE -->` markers indicate unprocessed drift (see `drift` mode to process)
- **R15 Recent foundation changes** — if `git log --since=7days -- <foundation files>` has commits, check if specs were updated in same window

### Output

```markdown
# Requirements Health — static audit

## Coverage
| Feature | Required files | Extras | STORIES count | Coverage score |
|---------|---------------|--------|---------------|----------------|

## Findings
### Critical (blocks builds)
### High (consistency broken)
### Medium (gaps, ambiguity)
### Low (style, polish)

## Pending drift (handoff to `review` mode)
{count of pending entries in requirements-staged.jsonl}
```

---

## Mode: drift — Session Diff Propagation

After a coding session (or embedded in `/oneshot:retro`), checks whether code edits that affect specs were propagated to the spec files.

### Step 1: Load session signal

- `git diff HEAD~N..HEAD` for the session's commits
- `paths.events/code.jsonl` since session start (resolve session ID from `paths.runtime/.session-id`)

### Step 2: Match edits to specs

For each code edit, resolve:
- Which feature(s) this file belongs to (from `manifest.fileOwnership`)
- Which spec files would describe this behavior (PRD, STORIES, COPY)
- Has the spec been edited in the same window?

### Step 3: Classify drift

- **overwrite** — code behavior replaces what a story claimed; spec needs update
- **extension** — new behavior added; stories/PRD need a new entry
- **new_behavior** — code does something no spec mentions; ambiguous (maybe stub, maybe unspecced)
- **removal** — code removed behavior a spec references; spec should remove the claim
- **matching** — spec already updated; no action

### Step 4: Stage for review

Append pending entries to `paths.events/requirements-staged.jsonl` via `appendFileSync`:

```json
{
  "id": "DRIFT-<sessionId>-<counter>",
  "ts": "<ISO>",
  "type": "<overwrite|extension|new_behavior|removal>",
  "status": "pending",
  "feature": "<feature-id>",
  "group": "<changeset-id — edits within 60s share a group>",
  "file": "<code-file>",
  "spec_file": "<target-spec-file>",
  "edit_how": "<what changed in code>",
  "edit_why": "<commit message or session context>",
  "spec_excerpt": "<relevant snippet from current spec>",
  "suggested_update": "<proposed new spec text>",
  "confidence": "<high|medium|low|timeout>"
}
```

Then hand off: `"Use /scan:requirements review to process {N} pending drift entries."`

---

## Mode: review — Batch Drift Review

Process pending drift entries staged by the `drift` mode or by the `edit-watcher` hook.

### Step 1: Load pending entries

Use the reconciler at `scripts/lib/staged-drift-reconciler.js`:

```js
const { reconcile } = require("./scripts/lib/staged-drift-reconciler");
const r = reconcile(".claude/project/events/requirements-staged.jsonl");
// r.pending = entries whose latest status_update (or envelope.status if no
// update yet) resolves to "pending". Joined cross the audit trail — does NOT
// trust the original envelope's frozen `data.status: "pending"` field.
```

Why the reconciler matters: the staged-drift file is append-only. When a drift entry is decided (approved / rejected / deferred), the decision lands as a separate `status_update` line — the original envelope keeps its `data.status: "pending"` forever. A naive read of envelopes shows hundreds of false-pending. `scripts/test-staged-drift-reconciler.js` verifies the reconciler.

If a `<feature>` argument was given, also filter `r.pending` by `feature`.

If zero pending: report `"No pending requirement changes."` and exit.

### Step 2: Group and sort

1. Group by `feature`, then by `group` (changeset ID)
2. Within each group, sort by drift type: `overwrite` → `extension` → `new_behavior` → `removal`
3. Within each type, sort by confidence: `high` → `medium` → `low` → `timeout`

### Step 3: Present review

For each feature group:

```
## {feature} ({N} pending changes)

### Changeset {group} ({M} edits)
Context: "{edit_why}"

1. **{DRIFT_TYPE}** [{confidence}] in {spec_file}
   Code edit: {edit_how}
   File: {file}
   Spec says: "{spec_excerpt}"
   Suggested: {suggested_update}
```

If `--compact`: one line per entry:
```
{feature} | {drift_type} | {confidence} | {file} → {spec_file} | {suggested_update}
```

### Step 4: Collect decisions (ESCALATE to user)

User chooses per entry or in batches:

- **approve** — accept suggested update, apply to spec file
- **reject** — mark intentionally divergent (code is right, spec stays). Prompt for a brief note.
- **defer** — skip for now, entry persists for next review
- **edit** — user provides custom update text before approving
- **batch approve low** — approve all low-confidence entries at once (reminders to verify)
- **batch dismiss low** — reject all low-confidence entries at once

**ALWAYS escalate to user — never auto-approve or auto-reject.**

### Step 5: Commit approved changes

For each approved entry:

1. Read target spec file (`spec_file`)
2. Find `spec_excerpt` (substring match; fuzzy fallback: strip whitespace + first 40 chars)
3. Show proposed Edit: old → new
4. Apply the Edit
5. If a `<!-- STALE -->` marker references the same source file, remove it
6. Append status update to `requirements-staged.jsonl` (use `appendFileSync`):

```bash
node -e "const fs=require('fs'); fs.appendFileSync('.claude/project/events/requirements-staged.jsonl', JSON.stringify({id:'ENTRY_ID', ts:new Date().toISOString(), type:'status_update', status:'approved', reviewed_at:new Date().toISOString(), reviewed_by:'user'}) + '\n')"
```

For rejected entries: `status: "rejected"` + include `review_note`.
For deferred entries: `status: "deferred"`.

**Each decision written immediately.** If the session crashes mid-review, already-decided entries keep their status.

### Step 6: Summary

```
/scan:requirements review — complete

  Approved: {N} (spec files updated)
  Rejected: {N} (intentional divergence documented)
  Deferred: {N} (will appear in next review)
  Remaining: {N} still pending

  Files updated: {list}
```

---

## Rules (all modes)

- Use `appendFileSync` for all JSONL writes (`memory-guard` requires it)
- Never write directly to `events.jsonl`, `learnings.jsonl`, `traces.jsonl`, or `systems.jsonl` — use `logger.js`
- Use paths from `paths.json`, not hardcoded strings
- In `review`, show high-confidence overwrites first (most important)
- In `review`, low-confidence entries should be batch-dismissable (they're reminders, not decisions)
- In `drift`, respect the 60-second group window — related edits get one review block

---

## When to run

- **Before starting a build session** — `static` (scoped to the feature you'll touch)
- **Embedded in `/oneshot:retro`** — `drift` (automatic)
- **After `edit-watcher` stages drift entries** — `review` (manual, when ready to process)
- **Weekly / on `/sleep:deep`** — `static` full audit for gradual drift
- **Before publishing a spec-facing release** — full `static` audit

## Related

- `/scan:architecture` — doc/agent consistency (pairs with this)
- `/scan:references` — raw file-path existence (subset of R1, R8)
- `/oneshot:retro` — runs `drift` mode automatically
- `/learn:deep` — finds spec-drift patterns across sessions (Phase B event-log mining)
- `edit-watcher` hook — auto-stages drift entries via paths.events/requirements-staged.jsonl
