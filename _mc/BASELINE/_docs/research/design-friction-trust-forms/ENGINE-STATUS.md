# Deep-research engine status (2026-06-01)

- **Claude (3-round WebSearch+WebFetch): SUCCEEDED.** See `claude-report.md` — this is the grounding the guide was authored from (primary W3C / WebAIM / Baymard / NN/g / CXL / Laws of UX / MDN sources; thresholds verified against W3C Understanding docs via WebFetch).
- **OpenAI o3-deep-research / o4-mini-deep-research: FAILED — `insufficient_quota`.** The org's deep-research budget was exhausted this session. The forms topic got through phase 1 (Landscape) on o3, then phase 2 returned "exceeded your current quota / check your plan and billing." Accessibility + conversion never completed (initial parallel launch hit the shared 200k TPM limit; the sequential retry was aborted once quota exhaustion was confirmed — no point re-hitting the same wall).
- **Gemini: SKIPPED** per the operator directive (engine down this run).

Net: the guide is fully grounded by the Claude engine + verified primary sources. The OpenAI deep-research artifact is absent for billing reasons, not research-quality reasons. Re-run the OpenAI 4-phase curl (`_docs/research/.run-openai-dr.sh <OUTDIR>`) once the OpenAI plan/quota is topped up to add a second corroborating engine.
