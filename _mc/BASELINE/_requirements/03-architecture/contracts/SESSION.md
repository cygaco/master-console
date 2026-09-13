<!-- generated 2026-04-30 by Phase 3G — keep `id` and section names stable, edit content freely -->
# Contract: SESSION

- **id:** SESSION
- **owner:** auth
- **introducedIn:** 2026-04-30
- **status:** active
- **version:** 2.0.0
- **changeType:** major
- **used by:** auth, dashboard, profile, subscription

> **2.0.0 (breaking, 2026-05-04):** shape rewritten to reflect product-specific session contract promoted into canonical at v0.2.0. Consumers that depended on the framework-template SessionContract must adopt the new shape.

## 1. Shape

```typescript
interface SessionContract {
  // Cookie configuration
  cookieName: "__Host-Session";
  cookieOptions: { httpOnly: true; secure: true; sameSite: "lax"; path: "/" };

  // JWT payload claims
  payload: {
    sub: string;     // User UUID
    scp: string[];   // e.g., ["user", "premium"]
    jti: string;     // Unique token identifier for revocation
    exp: number;     // 7-day TTL (seconds since epoch)
  };
}
```

## 2. Producers

- `packages/shared/auth.ts` (JWT signing and cookie serialization)
- `services/backend/src/routes/auth.ts` (login / registration handlers)

## 3. Consumers

- `src/middleware.ts` (Next.js Edge route protection)
- `services/backend/src/middleware/auth.ts` (API route protection)
- `src/lib/auth-client.ts` (frontend session parser)

## 4. Breaking changes

- Removing the `__Host-` prefix from the cookie name
- Changing `exp` TTL semantics or removing `jti`
- Modifying the JWT signing algorithm (e.g., HS256 → RS256) without dual-support rollover
- Adding fields to `payload` that bloat the cookie beyond 4096 bytes

## 5. Required tests

- JWT encode/decode round-trip verification
- Enforced rejection of expired tokens
- Validation that non-HTTPS environments reject `__Host-` cookies (except localhost bypass)

## 6. Drift gate

- `packages/shared/auth.ts`
- `services/backend/src/routes/auth.ts`
- `src/middleware.ts`

## 7. Versioning and compatibility

- Patch: clarification only; no consumer migration.
- Minor: backward-compatible field addition with default handling.
- Major: cookie name, token claims, signing algorithm, or expiry semantics change.
- On any version bump, notify: auth, dashboard, profile, subscription.
