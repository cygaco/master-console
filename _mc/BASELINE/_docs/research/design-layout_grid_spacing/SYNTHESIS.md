# design-layout_grid_spacing — research synthesis (engines)

**Date:** 2026-06-01
**Method:** Real deep research per the research:deep contract.

**Engines:**
- Claude 3-round WebSearch + WebFetch — **SUCCEEDED** (primary-source verified; see `claude-report.md`). Completed Phase 1 (Landscape) of the OpenAI run before the org quota was exhausted.
- OpenAI o3-deep-research 4-phase — **BLOCKED (insufficient_quota)**. Reached Phase 2 (Mechanics, in_progress) then the org OpenAI billing quota was exhausted (shared across the three parallel design jobs); o3 then o4-mini fallback both returned `insufficient_quota`. Confirmed with a minimal `gpt-4o-mini` probe. Billing top-up is operator-owned — not retried. See `openai-error-*.log`.
- Gemini Deep Research — **SKIPPED** (down, per operator directive for this run).

**Cost:** ~$0 incremental. Claude WebSearch/WebFetch included in session. OpenAI deep-research run did not complete a billable report for this topic → net OpenAI spend ≈ $0.

**Outcome:** Guide authored to full depth from the Claude engine + cited primary sources (Design Systems, NN/g Proximity/Common Region/form white space, Laws of UX, Baymard line length, Material 3 8pt/4pt grid). The OpenAI report is absent this run; foldable later if billing is restored.
