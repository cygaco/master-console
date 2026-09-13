# Security Audit Report

**Date:** 2026-03-30
**Scope:** Specs + architecture + spot-check code

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 3 |
| HIGH | 4 |
| MEDIUM | 6 |
| LOW | 0 |

## OWASP Coverage Matrix

| OWASP Category | Documented? | Spec'd in Stories? | Verified in Code? | Gap? |
|---|---|---|---|---|
| A01 Broken Access Control | Yes | Partial | Yes | Missing auth on /api/test; no per-user rate limits |
| A02 Cryptographic Failures | Yes | Yes | Yes | No gap |
| A03 Injection | Yes | Yes | Yes | No gap (prompt injection defense strong) |
| A04 Insecure Design | Yes | Partial | Partial | Daily spend limit not enforced per-user; race in local dev |
| A05 Security Misconfiguration | Yes | No | Partial | NEXT_PUBLIC_DUMMY_PLUG_CODE client-exposed |
| A06 Vulnerable Components | Yes | N/A | Yes | No gap |
| A07 Authentication Failures | Yes | Yes | Partial | OAuth state not single-use; password validation asymmetric |
| A08 Data Integrity | Yes | Yes | Partial | Stripe webhook userId unverified |
| A09 Logging & Monitoring | Partial | No | No | No structured security event logging |
| A10 SSRF | Yes | N/A | Yes | No gap |

## Agent Risk Assessment

If builders ran now: (1) /api/test would ship with client-discoverable gate value, (2) OAuth callbacks would be vulnerable to state replay, (3) no security event logging means incidents go undetected, (4) Stripe webhook could grant plan quota to the wrong user.

## Findings

### CRITICAL

| # | Category | Finding | Location | Fix |
|---|---|---|---|---|
| 1 | A05+A01 | Test API gated by client-exposed NEXT_PUBLIC_DUMMY_PLUG_CODE — attacker can extract from bundle | /api/test + env var | Use server-only ENABLE_TEST_API; add JWT auth |
| 2 | A01 | /api/test has no JWT verification or CSRF check | src/app/api/test/route.ts | Add requireAuth() + validateOrigin() |
| 3 | A07 | OAuth state tokens not single-use — replay attack possible | OAuth callback routes | Store state in Redis with single-use flag, reject re-presented tokens |

### HIGH

| # | Category | Finding | Location | Fix |
|---|---|---|---|---|
| 4 | A01 | No per-user rate limits; no role-based access for billable prompts | /api/claude, /api/recipes | Add per-user rate limits (10/min), role checks for BILLABLE_PROMPTS |
| 5 | A07 | Session nonce format-validated only, not server-bound (spec acknowledged as accepted risk) | /api/claude route | Document explicitly; optionally log nonce reuse for abuse detection |
| 6 | A08 | Stripe webhook trusts metadata.userId without verification | /api/stripe/webhook | Verify against Stripe Customer ID or HMAC-sign userId in checkout |
| 7 | A09 | No structured security event logging; console.error leaks stack traces | All API routes | Create centralized logSecurityEvent(); never log tokens/passwords/stacks |

### MEDIUM

| # | Category | Finding | Location | Fix |
|---|---|---|---|---|
| 8 | A04 | CSRF validateOrigin() missing on /api/auth/logout | src/app/api/auth/logout/route.ts | Add validateOrigin() call |
| 9 | A04 | Daily quota spend limit (500 units/day per user) specified but not enforced | /api/claude, /api/usage/debit | Add per-user daily counter in Redis |
| 10 | A04 | Concurrent quota debit race condition in in-memory fallback (local dev) | src/lib/usage.ts lines 183-190 | Require Redis in production; mark in-memory as dev-only |
| 11 | A07 | Password validation asymmetric: register enforces 8-128, login only rejects >128 | register + login routes | Both routes enforce 8 <= length <= 128 |
| 12 | A01 | Server session has 30-day TTL but no expiry audit logging | src/lib/auth.ts | Document behavior; optionally log session_expired |
| 13 | A04 | No abuse detection for anonymous endpoints (PARSE/PROFILE can be called without auth) | /api/claude | Spec future abuse detection story |

### Spec Gaps

| # | Finding | Fix |
|---|---|---|
| SG-1 | No security AC on quota-spending stories (TARGETED, EXPORT, MENU_PREP rerun) | Add 402 insufficient-balance AC to all billable stories |
| SG-2 | No CORS configuration documentation | Document CORS policy in SECURITY.md |
| SG-3 | No security checklist for extension content script DOM interaction | Add security checklist to EXTENSION_SPEC.md |
| SG-4 | No builder security checklist ("check these before marking done") | Add to AGENT_GUIDE.md or builder.md |

## Top 5 Actions Before Next Run

1. **Fix test API gate** — remove NEXT_PUBLIC_DUMMY_PLUG_CODE, use server-only gate + JWT auth (2 findings)
2. **Implement single-use OAuth state tokens** — store in Redis, reject replays (1 finding)
3. **Verify Stripe webhook userId** — link to Stripe Customer ID or HMAC-sign (1 finding)
4. **Create structured security event logger** — centralize logging, eliminate stack trace leaks (1 finding)
5. **Add security AC to billable stories** — ensure all quota-spending operations have 402 acceptance criteria (1 finding)
