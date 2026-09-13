# Release Readiness Checklist

This checklist wraps the Phase 4 release gates with product-shipping checks. A MC release is ready only when every required line is green or explicitly waived by ADR.

## Checklist

| Check | Evidence |
|---|---|
| Tests pass | `npm run build`, required Playwright suites, hook fixtures |
| Security pass | Secret scan, permission model, authz-sensitive review |
| Requirements fresh | Requirements graph and freshness gate pass |
| System coherent | `/scan:coherence` has no red findings |
| Known risks listed | Release notes name remaining risks and mitigations |
| Rollback available | Git rollback path, release capsule, and migration reversal notes |
| Analytics present | Standard events registered or explicitly not applicable |
| Docs updated | User-facing and operator docs reflect the release |
| Human-visible changes summarized | Final report lists what changed and what was rejected |
| Production baseline satisfied | Production, accessibility, and disaster recovery docs pass checks |

## Report Shape

Human-facing release reports use this order:

1. Verdict
2. What changed
3. Why
4. Risks remaining
5. What was rejected
6. What was tested
7. What needs human decision
8. Recommended next action
