# Cross-Layer Audit Report

**Date:** 2026-03-30
**Scope:** Seams between requirements, architecture, security, foundation, agents, skills, and hooks

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 7 |
| MEDIUM | 4 |
| LOW | 2 |

*Post-verification: Entry State downgraded (only market-research needs it). searchQueries FIXED. Per-user spend limit downgraded to HIGH (spec vs code gap, not security-critical).*

## Agent Risk Assessment

Cross-layer seams are the #1 source of agent run failures. Top risks: (1) market-research stories (28) have no Entry State for Steps 4-5 despite FLOW_SPEC defining states — builders will implement only happy paths, (2) ~~field name `searchQueries` FIXED~~, (3) hooks don't enforce file ownership defined in FILE-OWNERSHIP.md — builders can corrupt each other's work.

## Findings

### Cross-Check 1: Requirements x Architecture

| # | Severity | Finding | Docs | Fix |
|---|---|---|---|---|
| 1 | HIGH | market-research stories (28) have no Entry State for Steps 4-5 despite FLOW_SPEC defining states | FLOW_SPEC.md vs market-research/STORIES.md | Add Entry State to 28 stories per FLOW_SPEC Step 4-5 tables |
| 2 | ~~CRITICAL~~ FIXED | ~~FLOW_SPEC used `searchQueries`~~ → corrected to `generatedQueries` | FLOW_SPEC.md line 73 | Fixed 2026-03-30 20:30 |
| 3 | HIGH | FLOW_SPEC Step 5 says "Run two-phase market pipeline" without naming intermediate field `marketPrepReport` — stories describe two distinct phases, architecture doc abstracts them into one | FLOW_SPEC.md vs market-research/STORIES.md GS-MKT-11 | Update FLOW_SPEC to show both phases with field names |
| 4 | HIGH | Stories reference prompt names (PARSE, PROFILE, etc.) but PROMPT_TEMPLATES.md references non-existent PROMPTS.md for "catalog-level docs" — broken cross-reference | STORIES.md (multiple) vs PROMPT_TEMPLATES.md | Create PROMPTS.md or inline catalog into PROMPT_TEMPLATES |
| 5 | MEDIUM | Meal-plans readiness formula in PRD §11 doesn't match scoring implementation details in INTEGRATION-MAP.md weighted factors table — denominator ambiguous | meal-plans/PRD.md vs INTEGRATION-MAP.md | Clarify scoring formula with examples |

### Cross-Check 2: Requirements x Security

| # | Severity | Finding | Docs | Fix |
|---|---|---|---|---|
| 6 | HIGH | Billable operation stories (TARGETED, EXPORT, MENU_PREP rerun) lack security acceptance criteria for insufficient-balance rejection (402 response) | Feature STORIES.md vs SECURITY.md usage economy section | Add security AC: "Given balance < cost, return 402 with {required, remaining}" |
| 7 | HIGH | Auth stories (GS-ATH-23/24) specify OAuth "coming soon" states but SECURITY.md doesn't document the env-var-gated OAuth flow as a security boundary | auth/STORIES.md vs SECURITY.md | Add OAuth visibility env-var check to SECURITY.md |
| 8 | MEDIUM | Extension auto-cart stories describe heuristics but SECURITY.md doesn't reference the human-in-the-loop requirement from EXTENSION_SPEC.md | auto-cart/STORIES.md vs SECURITY.md vs EXTENSION_SPEC.md | Cross-reference EXTENSION_SPEC human-in-the-loop in SECURITY.md |

### Cross-Check 3: Architecture x Security

| # | Severity | Finding | Docs | Fix |
|---|---|---|---|---|
| 9 | HIGH | SECURITY.md specifies 500 usage units/day per-user spend limit, but API_SURFACE.md and actual code only enforce global daily limits — no per-user enforcement exists | SECURITY.md vs API_SURFACE.md vs /api/claude code | Implement per-user daily counter or remove claim from SECURITY.md |
| 10 | MEDIUM | AUTH_SCHEMAS.md documents OAuth state-based CSRF but SECURITY.md doesn't flag single-use enforcement gap (state replay vulnerability) | AUTH_SCHEMAS.md vs SECURITY.md | Add single-use state requirement to both docs |

### Cross-Check 4: Skills x Hooks

| # | Severity | Finding | Docs | Fix |
|---|---|---|---|---|
| 11 | HIGH | FILE-OWNERSHIP.md defines which agent owns which files, but no hook enforces this — ownership-guard.js is missing | FILE-OWNERSHIP.md vs .claude/settings.json hooks | Create ownership-guard.js PreToolUse hook |
| 12 | MEDIUM | /hooks skill and /audit --hooks have overlapping scope — both audit hook correctness but from different angles, with no documented boundary | .claude/commands/hooks.md vs .claude/commands/audit/hooks.md | Add scope clarification: /hooks = operational, /audit --hooks = diagnostic |
| 13 | LOW | /preflight reads FLOW_SPEC entry states but doesn't cross-check against feature stories' Entry State metadata — the disconnect (Finding #1) would not be caught by preflight | .claude/commands/preflight.md vs FLOW_SPEC.md | Add cross-check to preflight Pass 1 |
| 14 | LOW | AGENT_GUIDE.md is not linked from CLAUDE.md — agents must discover it independently | AGENT_GUIDE.md vs CLAUDE.md | Add link to CLAUDE.md Key Files section |

## Top 5 Actions Before Next Run

1. **Add Entry State metadata to market-research** (28 stories for Steps 4-5) — the only step-component feature missing it (1 finding)
2. ~~**Fix `searchQueries` → `generatedQueries`**~~ — **FIXED** 2026-03-30 20:30
3. **Create ownership-guard.js hook** — FILE-OWNERSHIP defines rules but nothing enforces them (1 finding)
4. **Add security AC to billable stories** — requirements don't cover the 402 rejection path that security requires (1 finding)
5. **Resolve SECURITY.md per-user spend limit claim** — either implement or remove the unenforceable 500/day claim (1 finding)
