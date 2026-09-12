# E-DISPATCH-PERFECT-001 W4: WarpOS Agent Framework Genericization Recon
## Product-Specific Vocabulary Sweep — Detailed Findings

**Date:** 2026-06-17
**Scope:** All agent specs under .claude/agents/**/*.md
**Task:** Map product-origin vocabulary & genericization opportunities

---

## Executive Summary

**Real hits found: 16 across 4 files**
- **Hard product references (scrub required):** 3
- **EXAMPLE patterns (genericize):** 10
- **False positives (continue-context):** 3

**Framework-purity.js status:** Catches literal slug tokens & purged file paths; WILL MISS domain vocabulary (step/feature sequences, data shapes, security taint sources).

**Recommendation:** Multi-pass hybrid sweep (detect hard refs in single pass; genericize examples in parallel-by-file-group).

---

## Detailed Findings by File

### 1. .claude/agents/_system/agent-system.md

**Hits: 3**

| Line | Term | Context | Type | Recommendation |
|------|------|---------|------|---|
| 1331 | debitRockets() | Pre-flight check for billing before AI calls | (a) Hard product ref | **SCRUB:** Rename to alidateCost() or checkBudget(); productize via param |
| 856 | Resume as example | "Every claim about user's experience traces to input resume" | (b) Example domain | **GENERICIZE:** Replace w/ "[primary input document]" or param $ |
| 928 | "LinkedIn" | Step 9 output example (AI/ML skills in LinkedIn) | (b) Example product feature | **GENERICIZE:** Replace w/ "[social profile platform]" or $ |

**Context notes:**
- Line 1331: debitRockets() is the origin-product-era billing abstraction. Framework agents should not hardcode product payment mechanics.
- Lines 856, 928, 945+: References to "resume" and "LinkedIn" appear in context-scoping tables, golden-fixture specs, and step-expectation docs. These are **examples from the resume-builder origin product**, not generic framework concepts. They should be parameterized.

---

### 2. .claude/agents/engineering/security/reviewer.md

**Hits: 2**

| Line | Term | Context | Type | Recommendation |
|------|------|---------|---|---|
| 158 | <untrusted_job_data> | Prompt-injection check wrapper; product-specific taint source | (a) Hard product ref | **SCRUB:** Rename to <untrusted_external_input> or <untrusted_{source_type}> |
| 424 | "job search, application, AI-assisted resume/cover letter generation" | Business-logic-attacker persona checkpoint | (b) Example flows | **GENERICIZE:** Replace w/ "[primary user workflows]" from product spec |

**Context notes:**
- Line 158: untrusted_job_data is a hardcoded origin-product security taint source.
- Line 424: Business-logic-attacker persona lists concrete product flows, not generic patterns.

---

### 3. .claude/agents/president/_system/oneshot/integration-map.md

**Hits: 9**

| Line Range | Term | Context | Type | Recommendation |
|------|------|---------|---|---|
| 11–153 | Step 1–10: Parse → Preferences → Profile → Query → Market → Deep-Dive QA → Curation → Resume-Gen → LinkedIn → Auto-Apply | Entire product pipeline | (b) Example orchestration | **GENERICIZE:** Replace w/ _requirements/ contract; build dynamic pipeline from manifest |
| 15–16 | esumeRaw, esumeStructured | SessionData field names | (b) Example schema | **GENERICIZE:** Parameterize via _requirements/ |
| 24 | callClaude("PARSE", resumeRaw) | Step 1 AI call | (b) Example task | **GENERICIZE:** Use dynamic step task name |
| 79–137 | marketAnalysis, profile, 	argetedResumes, miningResults | Data flows | (b) Example field names | **GENERICIZE:** Pull from product's SessionData |
| 161–261 | Billing: "Master 10%", "General 5%", "Targeted 25%" | Cost allocation | (b) Example pricing | **GENERICIZE:** Move to .warpos/config.json |

**Severity:** **HIGH** — Builders copy from this file. Genericizing it unblocks future products.

---

### 4. .claude/agents/president/_system/oneshot/skeleton-checklist.md

**Hits: 2**

| Line | Term | Context | Type | Recommendation |
|------|------|---------|---|---|
| 190 | "debitRockets()" | Skeleton instrumentation checklist | (a) Hard product ref | **SCRUB:** Replace w/ "[billing pre-flight]" from product config |
| 11 (implicit) | "Resume Parse" through "Auto-Apply Setup" | Skeleton step names | (b) Example feature names | **GENERICIZE:** Read from _requirements/STEPS.md |

---

## Framework-Purity.js Analysis

**What it currently catches:**
- CLIENT-SLUG: Literal token matching on hardcoded list (lines 66–76)
- ABS-PATH: Regex on maintainer home paths (lines 78–82)
- PROMOTE-RELIC: File paths and purged /warp:promote tokens (lines 100–107)
- ROOT-LEAK: Filesystem check for _requirements/, _docs/ at root (lines 109, 222–228)

**What it WILL MISS:**
1. Domain vocabulary: esume, job, LinkedIn, market-research — not in slug list
2. Hard-reference patterns: debitRockets(), untrusted_job_data — not on slug list
3. Data model assumptions: masterResume, 	argetedResumes, miningResults — assumed by framework
4. Business-logic assumptions: Security persona hardcodes threat model for job-application domain
5. Pricing logic: Step-level cost allocation hardcoded in examples

**Recommendation:** Expand CLIENT_SLUGS to include function/tag names; add optional domain-vocabulary linter.

---

## Sweep Strategy: Multi-Pass Hybrid

**Pass 1 (Single, blocking):** Hard references (2–4 hours)
- Rename debitRockets() → framework-neutral name
- Replace <untrusted_job_data> → <untrusted_external_input>
- Update framework-purity.js slug list
- Scope: security-reviewer.md, gent-system.md, skeleton-checklist.md

**Pass 2 (Parallel, non-blocking):** Example genericization (6–8 hours)
- Split by concern: data model, feature pipeline, billing
- Run in parallel; validate no regressions

**Pass 3 (Async, future):** Threat model decoupling
- Move security-reviewer threat list to product config
- Create threat-model template in _requirements/03-architecture/

---

## Summary: Real Hits by Category

**Hard references (3 occurrences, 2 unique terms):**
- debitRockets() — 4 lines across 2 files
- <untrusted_job_data> — 1 line

**Examples to genericize (10 groups across 50+ lines):**
- Feature names: esume-generation, linkedin, uto-apply, etc.
- Data fields: masterResume, 	argetedResumes, miningResults, marketAnalysis
- Step sequence: Parse → Preferences → Profile → Query → Market → ... → Auto-Apply
- Cost allocation: percentages per step
- Business logic: threat model hardcoded to job-application domain

**False positives (3):**
- "resume" meaning continue-work
- Historical "ATS" reference
- Labeled example in integration-seam-contract.md
