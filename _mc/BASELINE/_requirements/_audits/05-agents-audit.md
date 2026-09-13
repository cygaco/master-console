# Agent System Audit Report

**Date:** 2026-03-30
**Agent system docs:** migrated to .claude/agents/.system/
**Agent definitions:** 3 checked (builder, evaluator, security)
**Retro runs:** 3 (01, 02, 03)

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 2 |
| HIGH | 2 |
| MEDIUM | 3 |
| LOW | 3 |

## Agent Risk Assessment

If we launched a regen run now: (1) Builders reading AGENTS.md would not see utils.ts and prompts.ts as foundation-owned, risking accidental modifications. (2) Boss would fail at Phase 4+ gate checks because scripts/validate-gates.js doesn't exist. (3) PlanPage coordination rule (deep-dive-qa + ingredient-curation must not be parallel) has no automated enforcement.

## Findings

### 1. Task Manifest

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | PASS | 14 feature slugs match _requirements/04-features/ directories | N/A |
| 2 | PASS | Build phases 0-7 are acyclic | N/A |
| 3 | MEDIUM | Phase 4+5 PlanPage coordination rules documented but no automated enforcement | Add store field tracking dispatch mode; add check in boss prompt |

### 2. File Ownership

| # | Severity | Finding | Fix |
|---|---|---|---|
| 4 | PASS | Glob spot-check: all sampled file paths exist | N/A |
| 5 | PASS | No orphan components found in src/components/ | N/A |
| 6 | PASS | No ownership conflicts (no file claimed by 2 features) | N/A |

### 3. Integration Map

| # | Severity | Finding | Fix |
|---|---|---|---|
| 7 | PASS | All SessionData fields in contracts exist in types.ts | N/A |
| 8 | MEDIUM | Readiness "uncapped" scoring (targeted plans 25%) documented but tiers should be verified against code | Verify readiness.ts tier definitions handle >100 |

### 4. Store State

| # | Severity | Finding | Fix |
|---|---|---|---|
| 9 | PASS | Valid JSON, 14 features present, all status values valid | N/A |
| 10 | HIGH | store.json has 6 top-level fields (bugDataset, conflictDataset, compliance, snapshots, knownStubs, runLog) added retroactively — verify AGENT-SYSTEM.md Section 6 lists all | Verify schema definition is complete |

### 5. Agent Definitions

| # | Severity | Finding | Fix |
|---|---|---|---|
| 11 | PASS | All agent defs reference latest HYGIENE (run 03) | N/A |
| 12 | PASS | File paths in agent definitions verified | N/A |
| 13 | MEDIUM | PROMPT-TEMPLATES.md uses {{FEATURE_DIR}} but usage→usage-economy mapping only documented in TASK-MANIFEST | Add mapping note to BOSS-PROMPT |

### 6. Boss Prompt

| # | Severity | Finding | Fix |
|---|---|---|---|
| 14 | HIGH | References `scripts/validate-gates.js` which does not exist | Create the script or remove reference |
| 15 | PASS | Feature count (14) and phase count (8) match TASK-MANIFEST | N/A |

### 7. Fixtures

| # | Severity | Finding | Fix |
|---|---|---|---|
| 16 | PASS | step-expectations.json valid, 12 step records, field names match types.ts | N/A |

### 8. Retro Docs

| # | Severity | Finding | Fix |
|---|---|---|---|
| 17 | PASS | HYGIENE rule numbers sequential: 1-11 (run 01), 12-21 (run 02), 22-28 (run 03) | N/A |
| 18 | PASS | Cross-references valid (BUG sources → HYGIENE rules) | N/A |

### 9. Root AGENTS.md

| # | Severity | Finding | Fix |
|---|---|---|---|
| 19 | CRITICAL | AGENTS.md foundation files list missing utils.ts, prompts.ts (lists 7, should be 12) — builders won't know these are read-only | Update to match FILE-OWNERSHIP.md |
| 20 | HIGH | AGENTS.md vs AGENT-SYSTEM.md relationship undefined — both claim authority with overlapping content | Add header: "Quick Reference — see AGENT-SYSTEM.md for full spec" |
| 21 | LOW | Cross-references use "section X" without anchor links — ambiguous | Use anchor links or line numbers |

## Top 5 Actions Before Next Run

1. **Update AGENTS.md foundation files list** to include all 12 files from FILE-OWNERSHIP.md — builders will modify read-only files without this (1 finding)
2. **Create scripts/validate-gates.js** or remove reference from BOSS-PROMPT — boss will fail at phase advancement (1 finding)
3. **Clarify AGENTS.md ↔ AGENT-SYSTEM.md relationship** — add explicit header declaring AGENTS.md as quick reference (1 finding)
4. **Add PlanPage coordination enforcement** — store field or automated check for Phase 4+5 dispatch mode (1 finding)
5. **Verify AGENT-SYSTEM.md Section 6 schema** lists all 6 retroactively added store.json fields (1 finding)
