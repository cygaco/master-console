# E-DISPATCH-PERFECT-001 W4 — Build Notes (product-agnostic agent genericization)

Date: 2026-06-17. Builder: backend-builder (worktree agent-a09759194d37707a9).

## Files changed (all within scopeContract.allowedFiles)

1. `.claude/agents/_system/agent-system.md` — 3 pedagogical-example swaps (recon-scoped hits only; lesson preserved):
   - L856 Grounding Check 2: "Every claim about the user's experience traces to the input **resume**" → "...traces to the user's **primary input document** (the source artifact the product ingests, e.g. an uploaded document or imported profile — see the product's canon for the concrete entity)." Lesson (grounding = trace every claim to input) intact.
   - L928 Golden-fixtures per-step table: step label "9 (**LinkedIn**)" → "9 (**Profile export**)"; prohibited-content example "the word **resume**" → "the name of an upstream artifact". Lesson (a step must not echo an upstream artifact's name) intact.
   - L1331 Existing-Primitives table: "Rocket pre-flight | `rockets.ts` | `**debitRockets()**` checks balance..." → "Billing pre-flight | billing module | `**chargeCredits()**` (the product's billing pre-flight) checks balance before AI calls. Always call it first." Lesson (call billing pre-flight before billable model calls) intact.
   - NOTE: agent-system.md is densely origin-product-specific beyond these 3 hits (the §11/§12/§22 resume pipeline, `masterResume` at L966, etc.). The recon scoped this file to exactly 3 hits; I swapped those and did NOT rewrite the broader pipeline (out of recon scope, would balloon the diff and risk the pedagogy). The residual `masterResume` etc. are surfaced by the new report-only domain_vocab advisory for a future scoped pass.

2. `.claude/agents/president/_system/oneshot/integration-map.md` — full rewrite into a product-NEUTRAL template. Kept the integration-map STRUCTURE (per-step Writes/Reads + model/API call, Producer/Consumer contract table, Cross-Cutting Integration blocks for Auth/Billing/Scoring, Foundation Utilities table, Cost Summary). Replaced concrete origin-product entities/steps/fields with `<placeholder>` / `<entity>` / `<core-action>()` parameterized names + a header note that real values come from the product's canon/manifest (`_requirements/00-canonical/STEPS.json`, product manifest). Dropped the two leading product-specific STALE comments (referenced `src/lib/rockets.ts` — a origin-product file; irrelevant to a template). Billing block uses generic `chargeCredits()`.

3. `.claude/agents/president/_system/oneshot/skeleton-checklist.md` — L190 `debitRockets()` → "the product's billing pre-flight (e.g. `chargeCredits()`) enforced before billable model calls". Added a top-of-file "Product-neutral template" note: the concrete dep list/folder structure/`Step*` names/env-var set are an ILLUSTRATIVE example; a real build reads the actual stack/steps/primitives from the product's canon/manifest, keeping the checklist SHAPE (config → deps → structure → env → instrumentation). Did NOT rewrite every concrete folder/env name (out of recon scope — recon flagged only L190 + the implicit step names; the note parameterizes them).

4. `scripts/checks/framework-purity.js` — CONSERVATIVE widening via a NEW report-only advisory detector `DOMAIN_VOCAB`, kept clearly separate from the hard `CLIENT_SLUGS` list:
   - `DOMAIN_VOCAB_TOKENS = ["debitRockets","untrusted_job_data","masterResume","targetedResumes"]` — narrow hard-ref identifiers only. Deliberately EXCLUDED broad English words ("resume"/"job"/"market") to avoid the false-positive storm ("resume" = continue-work).
   - Matched on word boundaries (`\b...\b`) so a superstring (e.g. `masterResumed`) doesn't trip it.
   - `findings.domain_vocab` is ADVISORY: explicitly EXCLUDED from `violationCount`, so it never flips `ok`/exit code. A pre-existing canonical occurrence outside an edit's scope cannot block an unrelated commit.
   - `ALLOW_DOMAIN_VOCAB_PATHS` suppresses the detector's own self-reference (framework-purity.js + its test).
   - Header doc, `--help` text, and human formatter updated to present the advisory in its own "report-only" section.

5. `scripts/checks/framework-purity.test.js` — NEW (no prior test existed). Follows the sibling `no-nul-bytes.test.js` fixture-harness style. Asserts:
   - clean product-neutral text (incl. the English word "resume" + generic `chargeCredits()`) → zero findings;
   - PLANTED HARD VIOLATION: a private-product client-slug → non-empty `client_slug` (fails the gate; satisfies P5.3);
   - PLANTED ADVISORY: each of `debitRockets`/`untrusted_job_data`/`masterResume`/`targetedResumes` → flagged in `domain_vocab`, and `debitRockets` is NOT mis-classified as a hard `client_slug`;
   - word-boundary: a benign superstring is NOT flagged;
   - broad English words (resume/job/market) are NEVER banned;
   - fail-closed: null content fails closed.

## Widening approach (summary)
Report-only advisory detector, NOT a hard ban. This is the only safe widening: the four identifiers already appear in ~dozen canonical files OUTSIDE my allowed scope (reviewer.md [W1-owned/forbidden], `_requirements/**`, `DUMP.md`, `ROADMAP.md`, `scripts/agent-dashboard.js`). A hard content-ban would red `--full` on files I'm forbidden to edit. The advisory surfaces all of them for future scoped cleanup without breaking the gate.

## Verify results
- `node scripts/checks/framework-purity.js` (default `--diff`) → exit 0 (`ok:true`; domain_vocab=1 advisory for residual `masterResume` in agent-system.md — does NOT fail the gate). Bare exit confirmed 0.
- `node scripts/checks/framework-purity.test.js` → exit 0, "7/7 passed (incl. 2 planted-violation/fail-closed assertion(s))". Planted hard-violation (client slug) correctly FAILS the gate; planted advisory identifiers correctly DETECTED.
- `--full` mode → exit 1, but this is PRE-EXISTING (canonical-unmodified `--full` = exit 1, client_slug 77; the `--full` inventory mode intentionally reds on the pre-scrub leak debt per `ROOT_LEAK_PENDING_SCRUB`). My change REDUCED client_slug 77→74 and the advisory domain_vocab=40 does not affect the exit code.
- `node scripts/checks/no-nul-bytes.js` → OK (no NUL bytes in 2130 files).
- Forbidden files untouched: git status shows only the 5 allowed files changed; reviewer.md / role-registry.json / dispatch-contract.json / catalog.js / providers.js all clean.

## Not committed (per instructions).
