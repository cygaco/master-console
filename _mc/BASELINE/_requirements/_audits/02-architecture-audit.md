# Architecture Audit Report

**Date:** 2026-03-30
**Docs audited:** 19 (18 architecture docs + AGENT_GUIDE.md)

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 3 |
| HIGH | 6 |
| MEDIUM | 6 |
| LOW | 4 |

## Agent Risk Assessment

If agents used these docs as-is, the top risks are: (1) Field name mismatch `searchQueries` vs `generatedQueries` will cause data wiring failures in market-research builders, (2) missing `PROMPTS.md` reference will leave agents unable to find Chrome prompt structure, and (3) two-phase market pipeline not fully described in FLOW_SPEC will cause single-phase implementations.

## Findings

### 1. Fitness for Purpose

13/18 docs PASS, 5 PARTIAL:

| # | Severity | Doc | Finding | Suggested Fix |
|---|---|---|---|---|
| 1 | MEDIUM | VALIDATION_RULES.md | Missing Step 2 preferences validation (direction, location, employment types) | Add form validation rules for all preference substeps |
| 2 | MEDIUM | VALIDATION_RULES.md | Rate limit response format not specified (429 body/headers) | Document response shape |
| 3 | LOW | DATA-CONTRACTS.md | No centralized master contract table — only pointers to 10 INPUTS.md files | Create master summary table |
| 4 | LOW | DATA_FLOW.md | References "INVALIDATION_MAP" but doesn't provide it | Provide actual map or link to code |
| 5 | LOW | API_SURFACE.md | Rate limit retry-after header behavior not documented | Add response format section |
| 6 | LOW | ENV_VARS.md | No guidance on what happens if required var missing at runtime | Add startup validation notes |

### 2. Overlap and Redundancy

| # | Docs involved | Overlap area | Recommendation |
|---|---|---|---|
| 1 | AUTH_SCHEMAS.md, SECURITY.md | JWT, cookies, OAuth described in both | **Cross-reference**: SECURITY.md → AUTH_SCHEMAS.md for implementation details |
| 2 | PERSISTENCE.md, AUTH_SCHEMAS.md | Server-side sessions (key format, TTL, Redis) nearly identical | **Scope-clarify**: AUTH = lifecycle, PERSISTENCE = storage mechanism; add cross-refs |
| 3 | VALIDATION_RULES.md, API_SURFACE.md | Password 8-128 char constraint in both | **Cross-reference**: API_SURFACE → VALIDATION_RULES.md for details |
| 4 | DATA_FLOW.md, PIPELINES.md | Same pipelines described with different granularity | **OK (complementary)**: Add cross-ref DATA_FLOW → PIPELINES for error handling |
| 5 | PROMPT_TEMPLATES.md, DATA-CONTRACTS.md | Prompt input contracts in PROMPT_TEMPLATES + feature-level in INPUTS.md | **OK (by design)**: Add cross-ref in DATA-CONTRACTS → PROMPT_TEMPLATES master table |
| 6 | ENV_VARS.md, CLAUDE.md | Both list environment variables | **Cross-reference**: CLAUDE.md is canonical overview; ENV_VARS.md is detailed catalog |

### 3. Conflicts and Contradictions

| # | Severity | Doc A | Doc B | Conflict | Resolution |
|---|---|---|---|---|---|
| 1 | CRITICAL | FLOW_SPEC.md (line 73) | market-research/STORIES.md GS-MKT-01 | `searchQueries` vs `generatedQueries` — different field names for same data | Standardize on `generatedQueries` (matches types.ts); update FLOW_SPEC |
| 2 | CRITICAL | PROMPT_TEMPLATES.md (lines 3, 284) | Filesystem | References `PROMPTS.md` which does not exist | Create PROMPTS.md or remove references |
| 3 | CRITICAL | FLOW_SPEC.md (line 82) | market-research/STORIES.md GS-MKT-11 | Step 5 says "Run two-phase market pipeline" but doesn't mention `marketPrepReport` intermediate field | Update FLOW_SPEC to show both pipeline phases and field names |
| 4 | HIGH | FLOW_SPEC.md entry states | meal-plans/STORIES.md | Different entry state vocabulary ("Has master plan" vs "Fresh"/"Async-complete"/"Returning") | Add standard vocabulary definition to FLOW_SPEC or AGENT_GUIDE |
| 5 | HIGH | COMPONENT_HIERARCHY.md | src/components/steps/ | Component naming debt: Step10Plans = Step 8, Step11Export = Step 9, etc. | Add explicit "Component File column is source of truth" note |

### 4. Gaps

| # | Severity | Missing item | Impact on agents | Suggested action |
|---|---|---|---|---|
| 1 | HIGH | AGENT_GUIDE.md not linked from CLAUDE.md or any index | Agents may not find it; miss read order and common mistakes | Link from CLAUDE.md § Key Files |
| 2 | HIGH | KitchenConsole outermost-wrapper constraint missing from COMPONENT_HIERARCHY.md | Agents might refactor it as sibling | Add bolded constraint note |
| 3 | MEDIUM | State persistence architecture not documented as unified doc | Agents unclear on when/how to save/load state | Create STATE_PERSISTENCE.md or expand PERSISTENCE.md |
| 4 | MEDIUM | DATA-CONTRACTS.md has no backlinks to feature INPUTS.md files | Agents can't find actual contract tables | Add table linking features to their INPUTS.md |
| 5 | MEDIUM | SECURITY.md prompt injection section doesn't cross-ref PROMPT_TEMPLATES.md | Agents may miss detailed injection defense | Add cross-reference |
| 6 | MEDIUM | No _requirements/03-architecture/README.md or "Start Here" index | 19 docs with no reading guide | Create README.md pointing to AGENT_GUIDE.md |

### 5. Condensation Opportunities

| # | Action | Docs | Rationale |
|---|---|---|---|
| 1 | Merge or cross-ref | AUTH_SCHEMAS.md ↔ SECURITY.md auth sections | Same info in both; SECURITY should reference AUTH_SCHEMAS |
| 2 | Merge or cross-ref | PERSISTENCE.md ↔ AUTH_SCHEMAS.md session sections | Nearly identical session storage descriptions |
| 3 | Create index | New README.md | 19 docs need a reading guide per feature type |
| 4 | Resolve or remove | PROMPTS.md reference | Either create the doc or remove the dangling references |

### 6. Agent-Readiness

| # | Severity | Doc | Issue | Fix |
|---|---|---|---|---|
| 1 | HIGH | PROMPT_TEMPLATES.md | Not standalone — references missing PROMPTS.md | Create or inline the missing content |
| 2 | MEDIUM | FLOW_SPEC.md | Two-phase market pipeline not fully spelled out | Add field names and intermediate step |
| 3 | MEDIUM | DATA-CONTRACTS.md | Requires reading 10 external files to verify wires | Add master summary table |
| 4 | LOW | DESIGN_TOKENS.md | Extension popup tokens use slightly different values than app | Document intentional divergence |
| 5 | LOW | ENV_VARS.md | Inconsistent formatting ("Note:" vs "**Note:**") | Standardize to bold |

## Top 5 Actions Before Next Run

1. **Fix `searchQueries` → `generatedQueries` in FLOW_SPEC.md** — agents will wire wrong field name (1 finding)
2. **Resolve PROMPTS.md reference** — either create the doc or remove dangling references from PROMPT_TEMPLATES.md (1 finding)
3. **Update FLOW_SPEC Step 5** to show two-phase pipeline with `marketPrepReport` → `marketAnalysis` field names (1 finding)
4. **Link AGENT_GUIDE.md from CLAUDE.md** and add entry state vocabulary definition (2 findings)
5. **Add cross-references** between overlapping docs (AUTH↔SECURITY, PERSISTENCE↔AUTH, DATA-CONTRACTS→INPUTS files) (6 findings)
