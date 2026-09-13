---
description: Coverage + freshness enforcer for the admin:* dev-tooling suite — each admin skill resolves, every admin-panel registry row's opener resolves to a real script/skill (no orphan/phantom), and preview.js carries the refuseIfTargetIsMC precondition. Fail-CLOSED on a malformed registry; wired REPORT-ONLY into /scan:full.
---

# /scan:admin-suite-coverage

The coverage + freshness enforcer for the **admin:* dev-tooling suite** (SP-20260614-002, AC-R5a). The admin sibling of `/scan:skill-hook-coverage`: a **static** (no events) check made self-detecting on the admin skill ↔ registry ↔ keystone surface.

Runs `scripts/checks/admin-suite-coverage.js`.

## The checks

**(i) SKILL RESOLUTION.** Each `admin:*` skill (`preview`, `readiness`, `guides`, `seed`) resolves via `node scripts/dispatch-skill.js --resolve --skill admin:<name> --json` → `found:true`. A skill whose command file EXISTS but does not resolve is `skill_unresolved`.

**(ii) REGISTRY shape + opener resolution.** Every row in `framework/admin-panel-registry.json`'s `panels` map is `{ route, opener, description }` (all strings — else `malformed_panel_row`), and each row's `opener` resolves to a **real backing target**: a `node <script>` opener's script must exist; a `/ns:name` opener's skill must resolve. An opener pointing at nothing is `orphan_opener`; a `panels` map missing entirely is `registry_no_panels`.

**(iii) MC GUARD.** `scripts/admin/preview.js` source contains the `refuseIfTargetIsMC` precondition assertion (the never-run-against-MC-itself guard). A present preview.js missing the token is `missing_mc_guard`.

## Tolerance (skip-with-note, pre-integration)

This check runs while the suite is built across parallel gauntlet lanes. When a skill `.md`, an opener `scripts/admin/*` script, or `preview.js` is **absent in the current worktree**, that row is **SKIPPED-with-note** (counted in `skipped`, not a finding) so the gate is green post-build but pre-integration. The integrated tree must have all four skills, both `scripts/admin/*` scripts, and the `refuseIfTargetIsMC` guard present — at which point every check is enforced (no skips). A target that EXISTS but is broken (skill resolves false, opener orphaned, guard missing) is always a hard finding regardless.

## Exit codes

- `0` — every present check passes (skips allowed pre-integration).
- `1` — ≥1 hard finding (`skill_unresolved`, `malformed_panel_row`, `orphan_opener`, `unrecognized_opener`, `registry_no_panels`, `missing_mc_guard`).
- `2` — fail-closed (unreadable/malformed `admin-panel-registry.json`).

## Output

`--json` emits `{ ok, checked, skipped, findings[], skippedDetail[] }`. Default is a human summary; a FAIL lists the findings.
