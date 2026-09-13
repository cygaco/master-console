<!-- requirement-format-legacy -->
# bootstrap:lastmile — Acceptance Criteria (verification map)

**Sprint:** SP-20260525-025 — Product Last-Mile Foundry
**Built:** 2026-05-25 · engine sprint (parallel-authored + green-e2e + ff-merge close, per RI-001)

> Maps each acceptance criterion from the build request to the evidence that
> verifies it. The executable suite is
> `scripts/bootstrap/lastmile/test-orchestrate.js` (25 assertions, green).

| # | Acceptance criterion | verified_by |
|---|---|---|
| AC-1 | Exists + follows MC command/skill conventions | `.claude/commands/bootstrap/lastmile.md` frontmatter (description + user-invocable) ; appears in `.claude/runtime/skill-catalog.json` ; mirrors `bootstrap:spinup` (single-file skill + `scripts/bootstrap/lastmile/` engine) |
| AC-2 | Runs in a product repo → Last-Mile Gap Report + readiness score | `scripts/bootstrap/lastmile/phases/audit.js` ; `test-orchestrate.js` :: "audit: writes gap-report.md product-side (non-dry-run)" + "audit: returns score + 8 module detections" |
| AC-3 | Generates sprint-ready roadmap items, not just advice | `phases/inject.js` (needs_orchestration → `/sprint:plan` + `/roadmap:add`) ; `test-orchestrate.js` :: "inject: needs_orchestration with a concrete prompt" |
| AC-4 | Dispatches/recommends implementation sprints via existing workflow | `phases/execute.js` ; `test-orchestrate.js` :: "execute: needs_orchestration" |
| AC-5 | Human-approval gates for risky production actions | `lib/approval-gates.js` (7 gates) ; `test-orchestrate.js` :: "plan: surfaces the stripe-live approval gate" |
| AC-6 | Security/privacy/compliance escalation rules | `modules/security.js` (HARD STOP) + `lib/score.js` caps ; `test-orchestrate.js` :: "security adapter: escalates + status absent on sensitive data" + "score: sensitive data caps privacy + security ≤40" |
| AC-7 | Tests/fixtures/holdout cases for representative product states | `fixtures.js` (7 holdout cases) ; `test-orchestrate.js` :: 7× "fixture <name> — gap detected" |
| AC-8 | Updates docs, command registry/manifest, tests, release artifacts | `_mc/MANIFEST.json` + `.claude/framework-manifest.json` regenerated ; `framework/templates/lastmile/*` ; ROADMAP entry (Sprints ledger + Shipped) |
| AC-9 | Avoids stale docs; respects `_mc/` architecture | framework/product boundary enforced (gap-report/launch-plan/etc are RUNTIME outputs into the consumer product, NOT committed in canonical) ; `framework-purity` clean on lastmile files ; `views regenerate --check` OK |
| AC-10 | Ends with a clear final report | `phases/handoff.js` (last-mile-handoff.md) + the session final report (files changed, behavior, tests, risks, follow-ups, how to use) |

## Holdout fixtures → gap proven

| Fixture | Gap it proves the audit catches |
|---|---|
| `no-auth` | prototype with persistence but no auth |
| `auth-no-payments` | accounts present, no monetization |
| `stripe-no-webhook-verify` | payments without verified webhooks (forgeable events) |
| `db-no-deletion-path` | data with no deletion/export (privacy gap) |
| `no-funnel` | API/app with no conversion funnel |
| `mobile-appstore` | mobile app needing app-store readiness |
| `sensitive-data-redflag` | sensitive data → forces escalation (RED gate) |

> Run `node scripts/bootstrap/lastmile/test-orchestrate.js` to re-verify (exit 0 = all pass).
