# Entering-agent preamble — canonical single source

> This file is the ONE canonical source of the provider-neutral **entering-agent preamble**
> (SP-20260723-001, ADR-0036). The block between the markers below is embedded VERBATIM in every
> entry doc — `CODEX.md`, `ANTIGRAVITY.md`, and a section of `AGENTS.md` — and is
> hash-parity-checked by `scripts/checks/entry-preamble-parity.js`. Edit the shared rules HERE, then
> re-embed the block into every shim (the enforcer REDs on drift). The block is authority-NEUTRAL by
> design: it describes the repo and the read-order and points to `CLAUDE.md` for identity/authority —
> it asserts neither (so the ambient-surface `authority-pollution-scan.js` gate stays green where the
> block is embedded).
>
> The full G2.2 generated-projection (a generator that regenerates each shim FROM this source, plus
> atomic source+projection commits) is the deferred end-state; until it lands, this file plus the
> parity enforcer ARE the single-source guarantee.

<!-- MC:ENTERING-AGENT-PREAMBLE:BEGIN v1 -->
**What this repo is.** MC is a framework for running an autonomous AI software company. Work is delivered by mode-selected *faces* of a single operator persona, plus departmental agents (Product, Engineering, Growth). Identity, the autonomy ceilings, and the full operating doctrine live in `CLAUDE.md` — this preamble asserts none of them; it points you there.

**Read order — once, then act.**
1. `DUMP.md` (repo root, local) — the session handoff: next action, in-flight state, verbatim payloads. Read once, then execute.
2. `TRACKER.md` (repo root) — the ENFORCED source of truth. It OUTRANKS `DUMP.md`, this preamble, and your own assumptions. Validate with `node scripts/trackers/validate.js` (must exit 0) before AND after meaningful work; on any disagreement, the tracker wins.
3. `CLAUDE.md` (repo root) — the operating doctrine: autonomy, dispatch, and policy/enforcement + refactor/rename hygiene. Its RULES apply to every executor; the harness-specific mechanics may not.

**Dispatch is CLI-first.** Agent dispatch runs through the CLI wrappers — `node scripts/dispatch-claude.js <role> <prompt-file> -w` for build-chain Claude roles, `node scripts/dispatch-agent.js <role> <prompt-file>` for cross-provider reviewers. CLI is mandatory; a provider API is used ONLY where there is no CLI equivalent. Cross-provider review diversity is required, and a binding FAIL cannot be overridden.

**Guards, gates, and output destinations.** The repo's guarantees are enforced: the `refs/heads/main` reference-transaction fence (every write to main goes through the broker), `/scan:full`, and the release gates. Every policy names an enforcer or logs the debt. Write per-run output under `runtime/`, never a manifest-tracked project dir. Orchestrators hold envelopes, not content — heavy work goes to a subprocess that writes its full output to a file and returns a short envelope. Regenerate both manifests after editing any hash-tracked file.

**For identity, authority, and the complete rules, read `CLAUDE.md`.**
<!-- MC:ENTERING-AGENT-PREAMBLE:END -->
