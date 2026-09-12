# Sprint spec — #5 0.18.1 dispatch-readiness slice (scope-cut)

- **Worktree:** `C:/Users/Vlad/Desktop/Claude/Projects/warpos-wt-0181-dispatch-readiness`
- **Branch:** `warp/s-0181-dispatch-readiness`
- **Risk:** medium
- **Role served:** BOTH. β-approved scope-cut: A1/A3 + E1 + E3-gate ONLY (defer E6/H4/G1/G2).
- **Close:** engine sprint → ff-merge to main, defer retro to milestone close, HALT before push.

## Objective
Wire the highest-leverage, lowest-cost reliability slice of the operator-directed 0.18.1 torture sprint: kill the presence-only dispatch false-green, stop shipping runtime logs, and gate skill↔script completeness.

## Why (grounding)
ROADMAP §"0.18.1 — Install/Release/Dispatch Reliability sprint". Director + β scoped to the three actionable items below; the orphaned `provider-smoke.js --per-role` preflight already exists but is unwired.

## Acceptance criteria
1. **A1/A3 — real per-provider×per-role dispatch-readiness preflight.** Wire the already-built `provider-smoke.js --per-role` into `/warp:health` + SessionStart + `/agents:test`. **Kill the presence-only false-green path** (`provider-health-check --summary` that returns green on mere CLI presence). Surface a **loud per-link verdict** (CLI / model / effort / perms / auth) per provider×role. *(mc WI-04/WI-13; ROADMAP G1.6.)*
2. **E1 — release-build runtime-exclusion gate.** `release-build.js` is a dumb snapshotter still shipping `owner=runtime` append-only logs (e.g. `beta/events.jsonl` ×5 in the 0.10.0 capsule). Add an `owner=runtime` / tracked-transients exclusion gate **at build time** (the manifest generator already excludes them; the build path does not). *(product-a W-8.)*
3. **E3-gate — skill↔script completeness gate.** `release-build` parses every shipped skill `.md` for `scripts/…` refs and **fails** if any referenced script isn't a manifest asset (structural fix behind E3 + WG-15). *(product-b.)*

## Definition of done
`/warp:health`, SessionStart, and `/agents:test` show the real per-role verdict (no presence-only green); a synthetic missing-auth link fails loudly. `release-build` refuses to ship `owner=runtime` files and refuses a capsule where any shipped skill references a non-asset script. Tests for each gate (incl. fail-closed: runner-error → non-zero, malformed → fail-closed — per the false-green-gauntlet lesson).

## Out of scope (deferred per scope-cut)
E6 (product-overlay path registry), H4 (roadmap:improve/ship port), G1 (glossary), G2 (gamma.md clarification).
