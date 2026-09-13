---
description: Learning integrator — promote validated high-score learnings into actual system enforcement (hooks, rules, skills, agent specs, reference docs)
---

# /learn:integrate — Turn Learnings Into Enforcement

The missing closing loop. `/learn:deep` *captures* learnings (from conversation + event log + oneshot retro files). `/learn:integrate` *applies* them — promoting **validated, high-score, unimplemented** learnings into concrete changes in the codebase.

Without this skill, learnings accumulate as dormant text that nobody acts on. Injected ≠ Informed ≠ Implemented (see `/learn:deep` Phase A.2 status audit). This skill advances entries from advisory to enforced.

## Input

`$ARGUMENTS` — Optional filter:
- No args: process all promotion candidates (`score ≥ 0.7`, not `implemented`, not `logged`)
- `--threshold 0.8` — raise score cutoff
- `--intent security_audit` — filter by intent category
- `--id N` — integrate one specific learning (1-indexed line in learnings.jsonl)
- `--dry-run` — plan only, no writes
- `--unsafe` — allow creating new hooks/rules without user confirmation (default: prompt on risky integrations)

## Procedure

### Phase A — Survey (find candidates)

1. Read `paths.learningsFile` (`.claude/project/memory/learnings.jsonl`).
2. Apply filter: default = `score ≥ 0.7 AND status != "implemented" AND status != "logged" AND !implemented_by`.
3. For each candidate, classify **integration target** using the intent-to-target matrix:

| Intent | Likely target |
|---|---|
| `bug_fix`, `audit` | hook (block/warn) or rule in CLAUDE.md |
| `architecture`, `spec_work` | rule in CLAUDE.md / AGENTS.md, reference doc |
| `security_audit` | hook, agent spec, reference doc |
| `meta`, `process` | skill update, CLAUDE.md rule, USER_GUIDE |
| `build`, `deployment`, `testing` | hook, agent spec, skill |
| `ux`, `privacy` | rule in CLAUDE.md, reference doc |
| `external_learning` | reference doc under `paths.reference` |

The matrix is guidance, not law — pick what actually enforces the learning.

### Phase B — Plan

For each candidate, draft a **concrete integration**:

```
Learning #N [intent, score=X]
  Tip: <tip>
  Target: <hook|rule|skill|agent|reference|path>:<specific-location>
  Change: <exactly what will be added/modified>
  Risk: <safe|medium|risky>
```

**Risk classification:**

| Risk | Examples | Action |
|---|---|---|
| **safe** | Append example to reference doc, add path key, update learning status | Auto-apply |
| **medium** | Edit existing skill, edit existing hook, update CLAUDE.md existing section | Show diff, apply unless `--dry-run` |
| **risky** | Create new hook, add new CLAUDE.md rule section, create new agent | Prompt user (or consult Alex β in adhoc mode) unless `--unsafe` |

Present the full plan grouped by target type before any writes.

### Phase C — Apply

Execute integrations in order: safe → medium → risky.

**For each applied integration:**

1. Make the code/doc change via Edit or Write.
2. Record the integration target identifier (e.g., `hook:memory-guard`, `rule:CLAUDE.md§Paths`, `skill:scan:environment`, `reference:reasoning-frameworks.md`).
3. Log an integration event:
   ```js
   const { log } = require("./scripts/hooks/lib/logger");
   log({ cat: "integration", source: "learn:integrate", learning_id: N, target: "<id>", tip: "<first 100 chars>" });
   ```

### Phase D — Attest

For each successfully integrated learning, update the entry in `paths.learningsFile`:

- Set `status: "implemented"`
- Add `implemented_by: "<target>"` (e.g., `"hook:path-guard"`, `"rule:CLAUDE.md§Paths SSoT"`, `"skill:scan:full"`)
- Add `implemented_at: "<ISO date>"`
- Bump `score` by +0.1 (cap at 1.0)

Use **Edit tool** to modify the jsonl line in place — never `writeFileSync` (memory-guard blocks it).

### Phase E — Report

```
/learn:integrate complete

CANDIDATES:  {N} high-score unimplemented learnings scanned
PROPOSED:    {N} integrations drafted
APPLIED:     {N} ({safe}/{medium}/{risky})
SKIPPED:     {N} (user rejected / --dry-run)

BY TARGET:
  hook:        N (created: N, modified: N)
  rule:        N
  skill:       N (created: N, modified: N)
  agent:       N
  reference:   N
  path:        N

STATUS MIGRATION:
  validated → implemented: N
  logged → discarded: 0    (never integrate from "logged" — insufficient evidence)

NEXT:
  Run `/scan:full` to verify new enforcement doesn't regress existing behavior.
  Run `/learn:deep --events-only --since 1d` after a day of use to see if integrations fired.
```

---

## Rules

- **Never integrate a learning with `status: "logged"`** — requires `validated` or manually-promoted entry. If high-score but still `logged`, tell the user and let them run `/learn:deep` Phase A.3 (quality maintenance) first.
- **Never create a hook without user confirmation** unless `--unsafe`. Hooks are load-bearing; a bad one can block all tool calls.
- **CLAUDE.md edits are high-stakes.** Every entry there binds all future sessions. Prefer reference docs for knowledge, CLAUDE.md only for hard rules.
- **Don't duplicate enforcement.** If a learning maps to an existing hook, extend it; don't create a parallel one.
- **Respect `paths.X`.** Any file reference in a new hook/skill/agent uses `paths.*` keys per CLAUDE.md Paths SSoT.
- **One learning can spawn multiple integrations** (e.g., a rule in CLAUDE.md + an example in USER_GUIDE). Record all targets in `implemented_by` as an array.
- **If the integration is wrong, roll back.** Use git to revert the change and restore the learning's prior status. Don't leave half-applied integrations.

## Example walkthrough

**Learning #47** (`score: 0.9, status: validated, intent: bug_fix`):
> "memory-guard false-positive class: filename-string matching (isProtectedFile) fires on `2>&1` fd redirects because the string '2>&1' contains characters it pattern-matches"

**Classification:** intent=bug_fix → hook target.
**Inspection:** `scripts/hooks/memory-guard.js` exists. The fix is already in code from this session.
**Integration:** Mark as `implemented` with `implemented_by: "hook:memory-guard"`. No new write needed — just attestation.

**Learning #52** (`score: 0.9, status: validated, intent: architecture`):
> "MC-for-us (development) and MC-for-clients (product) must be separate branches"

**Classification:** intent=architecture → CLAUDE.md rule.
**Inspection:** No existing rule. Check if `AGENTS.md` would be a better fit (agent-internal) vs CLAUDE.md (project-wide).
**Integration:** Append to CLAUDE.md a "Cross-repo parity" section. Mark `implemented_by: "rule:CLAUDE.md§Cross-repo parity"`. Risk: risky — new CLAUDE.md section → prompt user.

## Why this skill exists

The system was extracting learnings for months with no closing loop. The Phase A.2 status audit (in `/learn:deep`) calls out "promotion candidates" but stops there. This skill is the next step.

**The whole chain:** `/learn:deep` (conversation + events + retros, dedupe) → `/learn:integrate` (enforce) → optional `/learn:ingest` for external knowledge.
