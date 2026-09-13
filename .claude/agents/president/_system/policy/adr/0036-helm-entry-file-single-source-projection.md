# ADR-0036 — Helm entry-file single-source projection: ship thin-shims + hash-parity enforcer, defer the G2.2 generated-projection

**Status:** Accepted (2026-07-23; β DECIDE B/0.89 at the SP-20260723-001 plan→design boundary, `open_adr:true`, msg_id `36960cd3-5701-459e-97b6-50a5a91ff61d`).
**Relates to:** E-DISPATCH-SHAPE-001 (the dispatch-shape fold; G2.2 is the deferred end-state named there). ADR-0031 (remove-legacy-gemini-cli-wiring — the gemini sunset this tombstone tracks).

## Context

The helm trials (pickup #1 the agy block, #2 the GPT-5.6-helm experiment) put a non-Claude executor in a conductor seat. A trial against a stale/missing entry doc tests the doc, not the helm. At sprint start: CODEX.md was stale (2026-06-11, pointing at a closed fix-cycle SP-20260611-002); ANTIGRAVITY.md and GEMINI.md did not exist; AGENTS.md had no entering-agent preamble; and the shared "operating rules that don't change" were DUPLICATED in prose per shim.

The E-DISPATCH-SHAPE-001 fold (2026-06-11 design, plan-only) specified a full **generated-projection** end-state (G2.2): ONE canonical instruction source, a generator that EMITS each per-executor shim from it, a drift-check gate, and atomic source+projection commits — so a shim can never be hand-drifted from the source. That generator is unbuilt. The operator ruled this sprint FIRST as the helm-trial enabler, with an explicit *don't gold-plate* directive: ship the minimum that unblocks the trials honestly.

## Decision

Ship the **minimum honest version** now; defer the generator.

1. **Single canonical source** — `.claude/project/reference/entry-preamble.md` carries the provider-neutral entering-agent preamble inside an HTML-comment marked region (`<!-- MC:ENTERING-AGENT-PREAMBLE:BEGIN v1 -->` … `:END`). Authority-neutral (points to CLAUDE.md for identity; asserts none — authority-pollution-scan.js stays green).
2. **Thin shims** — CODEX.md (refresh), ANTIGRAVITY.md (create), GEMINI.md (create, sunset-tombstone), and an additive AGENTS.md section each EMBED the identical marked region + a bounded provider-delta.
3. **Named parity enforcer** — `scripts/checks/entry-preamble-parity.js` keys on REAL FILE BYTES (never a self-declared field): all entry files exist, each embedder's marked region is present + hash-parity-equal to the canonical source (normalized: bytes strictly between the marker lines, CRLF→LF, edge-newline trim, sha256; the canonical source is the SOLE hash oracle), and each thin shim's provider-delta stays within its size tier. Exit 0/1/2 → release-gate green/RED/RED; wired into /scan:full AND scripts/mc/release-gates.js. First run GREEN on the shipped bytes; its test plants the hardest failures (semantic edit → RED, CRLF-only reformat → GREEN, missing file → RED, oversized delta → RED, absent region → RED).

**DEFER (the G2.2 end-state, not lost — tracked under E-DISPATCH-SHAPE-001):** the generator that regenerates each shim from the canonical source (making hand-drift impossible rather than merely detected), plus atomic source+projection commits. Hash-parity DETECTS drift now; the generator would PREVENT it — a strictly-stronger property deferred as gold-plating for a pre-trial enabler.

## Consequences

- The single-source guarantee is live NOW: a drifted preamble REDs at /scan:full and blocks the release gate, without the generator.
- **Enforcer maintenance contract:** adding or refreshing an executor entry shim = embed the marked region verbatim + keep the provider-delta within tier. Drift / fat / missing / absent-region all fail loudly at scan + release. Bumping the shared block = edit the canonical source once; every shim must be re-embedded to match (the deferred generator would automate this).
- **GEMINI.md role + removal-trigger (pinned):** the `gemini` CLI's legacy wiring was already REMOVED for 1.0 (ADR-0031) — Gemini-family lab work routes through `agy`; the security-reviewer's verifiable binding floor is OpenAI (agy served-model proof open, ED-230). GEMINI.md is therefore a CONVENTION REDIRECT (parallel to CODEX.md/ANTIGRAVITY.md), not a claim of a live `gemini` CLI route. Removal-trigger: DROP GEMINI.md + its enforcer must-exist entry + its `build.js` allowlist line once the Gemini family is fully retired (no agy/Gemini lane) or the per-executor-entrypoint convention drops a dedicated Gemini shim. [Corrected in the SP-20260723-001 gauntlet fix cycle: the original "still live-wired via the gemini CLI" framing was inherited from stale 2026-07-20-era memory and caught by the qa-reviewer + a live `provider:"antigravity"` dispatch record — the verify-don't-inherit trap.]
- **Deferred residual:** the G2.2 generator + atomic source+projection commits (E-DISPATCH-SHAPE-001). Until it lands, the enforcer's hash-parity is the single-source guarantee.
