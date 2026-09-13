# design-interaction_feedback_states — research synthesis (engines)

**Date:** 2026-06-01
**Method:** Real deep research per the research:deep contract.

**Engines:**
- Claude 3-round WebSearch + WebFetch — **SUCCEEDED** (primary-source verified; see `claude-report.md`). Completed Phase 1 (Landscape, 408s) of the OpenAI run before the org quota was exhausted.
- OpenAI o3-deep-research 4-phase — **BLOCKED (insufficient_quota)**. Phase 1 (Landscape) completed for this topic but the assembled report never wrote because Phase 2 hit the exhausted org OpenAI billing quota (shared across the three parallel design jobs); o3 then o4-mini fallback both returned `insufficient_quota`. Confirmed with a minimal `gpt-4o-mini` probe. Billing top-up is operator-owned — not retried. See `openai-error-*.log`.
- Gemini Deep Research — **SKIPPED** (down, per operator directive for this run).

**Cost:** ~$0 incremental. Claude WebSearch/WebFetch included in session. The one OpenAI phase that completed did not assemble into a final billable report → net OpenAI spend negligible (≈ $0–$0.50 worst case for the single completed Landscape phase).

**Outcome:** Guide authored to full depth from the Claude engine + cited primary sources (NN/g 10 heuristics + Response Time Limits + Microinteractions, Laws of UX Doherty, MDN ARIA status/alert roles, W3C ARIA22). The OpenAI report is absent this run; foldable later if billing is restored.
