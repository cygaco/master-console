# Generated App Production Baseline

MC-generated applications are not considered production-ready until every area below has an explicit implementation, documented exception, or accepted ADR.

## Required Areas

| Area | Minimum bar | Evidence |
|---|---|---|
| Auth and sessions | Login, logout, session renewal, cookie/token expiry, and server-side auth checks are defined. | Auth contract, route middleware, tests |
| Authorization | User, workspace, and admin permissions are enforced server-side. | Permission contract, negative tests |
| Data ownership | Every stored record has an owner or tenant boundary. | Data model, access tests |
| Migrations | Schema changes have reversible migration plans. | Migration files, release notes |
| Error handling | User-visible errors are safe, specific, and recoverable. | Error copy, route tests |
| Logging and observability | Important actions emit structured events without secrets. | Event taxonomy, logs |
| Security headers | CSP, frame, referrer, content-type, and cookie flags are set. | Config, security scan |
| Secrets management | Secrets are server-only and never logged or sent to clients. | Env docs, secret scan |
| Backup and restore | Backup cadence, restore steps, RPO, and RTO are documented. | Disaster recovery doc |
| Test strategy | Unit, integration, E2E, fixture, and manual gaps are listed. | Test plan, CI |
| Accessibility | Keyboard, focus, labels, contrast, and announcements are covered. | Accessibility baseline |
| Deployment and rollback | Release, health check, and rollback path are documented. | Release readiness doc |
| Rate limiting | Expensive or abuse-prone routes are rate limited. | Middleware, tests |
| Privacy and retention | Data retention, export, deletion, and consent are documented. | Privacy policy or ADR |

## Gate Behavior

`scripts/checks/production-baseline.js` verifies that this baseline and its companion docs exist and include the required areas. `/scan:architecture` and `/oneshot:preflight` should treat a missing area as a production-readiness failure.

## Exception Rule

An exception must name the area, explain why the baseline does not apply, identify the risk owner, and include a review date. Open-ended exceptions are not allowed.
