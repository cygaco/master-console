# ADR 0006 — Sealed-capsule executable consumer-contract gate

**Date:** 2026-06-02
**Status:** accepted
**Class:** B (architectural impact — promotion/release architecture)

---

## Decision

The artifact-first release gate verifies a release by **materializing the capsule into a self-contained sealed payload, installing ONLY that payload into a disposable out-of-tree repo where canonical MC is unreachable, then executing the real consumer lifecycle** (setup → scan:install → a real sprint → dispatch telemetry → update) under both repo roles across cold + warm paths — with **typed success** (green = action occurred AND a well-formed telemetry record exists). We build the full **sealed-capsule** gate now, not the lighter certified-snapshot.

## Context

MC's #1 recurring disease is "downstream always missing something" — code that ships in the framework manifest but secretly reaches back into canonical-only state that never ships (e.g. the 100 dangling `seeded_from` manifest pointers found 2026-06-01). The cheap leading-indicator slice already shipped (`scripts/mc/test-fresh-install-smoke.js`), but it installs via `warp-setup.js`, which **copies file bytes from canonical `REPO_ROOT`** — canonical stays reachable, so a snapshot test structurally **cannot** catch reach-back. The capsule (`framework/releases/X.Y.Z/`) ships a *manifest* (file list + hashes) plus `release.json`/`checksums.json`, but **not the file bytes** — today the installer sources bytes from canonical. To prove a release stands on its own, we must remove canonical from the equation entirely.

Operator decision (verbatim, 2026-06-02): *"It's worth curing the new bug now"* → build the full sealed-capsule gate, not the lighter certified-snapshot.

## Options considered

1. **Option A — Certified snapshot (canonical reachable):** install via `warp-setup` source-clone, run the consumer checks. Cheap, already half-built. **Cannot catch reach-back** — the bug class we most need to catch.
2. **Option B — Sealed capsule (canonical unreachable):** materialize a self-contained payload from the capsule manifest, install it into an out-of-tree disposable repo with canonical pathed-out, run the executable consumer contract under both roles, cold + warm.
3. **Option C — Published-artifact gate (network registry):** publish the capsule to a real registry and install from there. Truest fidelity but requires hosting/auth/spend not yet in place; premature.

## Decision criteria

Score against the rubric in `paths.decisionPolicy`. The criteria that mattered:

| Criterion | A (snapshot) | B (sealed capsule) | C (published) |
|---|---|---|---|
| Catches reach-back (product fit) | **low** | **high** | high |
| Simplicity | high | medium | low |
| Reliability of signal | low | high | high |
| Reversibility | high | high | medium |
| Cost / no new infra | high | high | low |

## Why this option won

Option B is the only choice that scores **high on the one criterion that justifies building the gate at all** — catching code that reaches back into canonical. A is cheaper but its signal is structurally blind to the disease (false comfort is worse than no gate). C has the same detection power as B but demands hosting/auth/spend MC does not have today, so it is premature. B reaches C's detection fidelity with zero new infra by making the local filesystem enforce the boundary (out-of-tree temp repo + canonical pathed-out). The operator explicitly chose to cure the root bug now, which breaks the tie decisively toward B over A.

## Risks

1. **Sealing is incomplete** — if the materialization step copies from canonical lazily or leaves a path back, the "isolation" is fake and the gate is false-green (the exact enforcer-class false-green that bit every lane last session).
2. **Role-semantics-at-seal-vs-runtime** — the capsule is sealed in a canonical-role repo but installed into a consumer-role repo; a guard that resolves repo-role at the wrong moment can misclassify and skip checks.
3. **Telemetry cwd drift** — dispatch completion records can land in the worktree/temp `.claude/runtime` instead of canonical (ED-016 class), making typed-success read no-record falsely.
4. **Flaky/slow** — a full lifecycle (setup→sprint→update) per role per path is heavy; timeouts could make the gate flaky and get it disabled.

## Mitigations

1. The sealed payload is built **only** from the capsule's `framework-manifest.json` enumeration; the gate asserts canonical is unreachable from the temp repo (no abs path, env scrubbed) and runs the full lifecycle there — any reach-back **breaks loudly** rather than silently passing. Harden with the cross-provider gauntlet (it caught false-greens on every enforcer lane last session).
2. Role-semantics resolved through the single-source resolver `scripts/mc/repo-role.js` with **explicit override threading** (the resolver's arg precedence exists for exactly this) — α's Class-A design call, documented in the build spec.
3. Typed success via `scripts/dispatch/gauntlet-verify.js` against **canonical-anchored** telemetry (ED-016 fixed); fail-closed: runner-error → non-zero, malformed → fail-closed, no-record → fail.
4. Scope the lifecycle to the minimum that exercises each seam; allow the heavy full-matrix run to be a promotion-gate (0.18.0 boundary), with the cheap smoke remaining the per-commit signal.

## Reversal plan

If the sealed gate proves too slow/flaky to keep in the promotion path, fall back to the already-shipped per-commit smoke (`test-fresh-install-smoke.js`) as the floor and run the sealed gate on-demand / pre-release only. Cost of reversal: low (the smoke already exists; the gate is additive). Trigger signal: gate wall-time pushing release latency unacceptably, or a sustained false-positive rate that erodes trust.

## References

- DUMP.md task #5 (keystone handoff, 2026-06-02)
- ROADMAP §"Root-cause deepening" / 0.18.0 stable-promotion boundary
- Building blocks (all merged to `main`): `scripts/mc/repo-role.js` (ED-009), `scripts/dispatch/gauntlet-verify.js` (BC-16, ED-016 fixed), `scripts/mc/test-fresh-install-smoke.js` (leading-indicator slice)
- Related: ADR-0001 (warp-promote-location), ADR-0002 (multi-sprint parallel lanes)
- Implementation: this cycle's keystone sprint (commit TBD)
