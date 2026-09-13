# Skills Audit Report

**Date:** 2026-03-30
**Skills audited:** 16 primary + 11 audit sub-commands

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 3 |
| MEDIUM | 7 |
| LOW | 5 |

## Agent Risk Assessment

Skills ecosystem is well-structured but has 3 workflow gaps. Missing `/feature init` means manual scaffolding errors. `/hooks` vs `/audit --hooks` overlap causes confusion about which to run. No `/test` skill means developers skip automated testing.

## Findings

### 1. Overlap Detection

| # | Severity | Skills | Overlap | Recommendation |
|---|---|---|---|---|
| 1 | HIGH | /preflight vs /audit --skills | Both audit quality gates from different angles | Document decision tree: preflight=pre-run, audit=pre-release |
| 2 | HIGH | /hooks vs /audit --hooks | Nearly identical scope; /hooks is operational, /audit --hooks is diagnostic | Clarify in /hooks.md: "operational" vs "diagnostic" |
| 3 | LOW | /dm vs /audit --tooling | Both check DM; /dm is focused, /audit --tooling is broad | Keep both — healthy specialization |
| 4 | LOW | /lens vs /audit --architecture | Both check consistency; /lens=code, /audit=docs | Keep both — complementary |
| 5 | LOW | /status, /handoff, /deploy | Multiple skills re-query git state | Document /status as canonical git source |

### 2. Gaps

| # | Severity | Gap | Impact | Recommendation |
|---|---|---|---|---|
| 6 | HIGH | No /feature init {slug} skill | Manual scaffolding is error-prone; devs forget PHASE_DISPLAY, components | Create skill that reads PRD and scaffolds files |
| 7 | MEDIUM | No /test skill | No unified test runner; devs skip tests | Create /test with unit/e2e/coverage modes |
| 8 | MEDIUM | No /review skill | PR prep is manual; no diff analysis | Create /review that audits diff and suggests PR description |
| 9 | LOW | No /lint --fix shorthand | Developers must run npm scripts directly | Create lint wrapper skill |

### 3. Consistency

| # | Severity | Finding | Fix |
|---|---|---|---|
| 10 | MEDIUM | Argument patterns inconsistent (flags vs positional vs mixed) | Standardize on hybrid positional syntax |
| 11 | LOW | Output format varies (prose vs tables vs JSON) | Standardize: summary + table + next steps |

### 4. Quality Issues

| # | Severity | Skill | Finding | Fix |
|---|---|---|---|---|
| 12 | MEDIUM | /preflight | 500+ line agent prompts may exceed context budget | Add token budget estimates per pass |
| 13 | MEDIUM | /preflight | AUTO-FIXABLE not clearly defined per pass | Define what's auto-fixable vs manual per pass |
| 14 | MEDIUM | /handoff | Reimplements git queries; doesn't warn about CLAUDE.md staleness | Call /status internally; add freshness check |
| 15 | MEDIUM | /lens | "Prompt drift" check is vague; execution depth unspecified | Define which prompts to check and how |

### 5. Wiring Opportunities

| # | Severity | Opportunity | Benefit |
|---|---|---|---|
| 16 | MEDIUM | /audit --all execution order suboptimal — infrastructure (skills/hooks) should come before seams | Foundation fixes prevent seam issues |
| 17 | MEDIUM | Missing hook-to-skill automation (auto-test on build, auto-lint on edit) | Prevents human error |
| 18 | LOW | /handoff should call /status internally | DRY principle |

## Top 5 Actions Before Next Run

1. **Clarify /hooks vs /audit --hooks** — document operational vs diagnostic distinction (1 finding)
2. **Create /feature init skill** — scaffolds component files, updates constants, creates branch (1 finding)
3. **Create /test skill** — unified test runner with unit/e2e/coverage modes (1 finding)
4. **Define AUTO-FIXABLE scope in /preflight** — each pass should declare what it can auto-fix (1 finding)
5. **Standardize argument patterns** — adopt hybrid positional syntax across all skills (1 finding)
