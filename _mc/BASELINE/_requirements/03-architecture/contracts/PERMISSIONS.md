<!-- generated 2026-04-30 by Phase 3G — keep `id` and section names stable, edit content freely -->
# Contract: PERMISSIONS

- **id:** PERMISSIONS
- **owner:** auth
- **introducedIn:** 2026-04-30
- **status:** active
- **version:** 1.0.0
- **changeType:** none
- **used by:** auth, backend, test-kitchen, shell

## 1. Shape

```typescript
type Scope = "user" | "admin" | "webhook" | "dev";

interface PermissionModel {
  // Redis cache layout
  cacheKey: `scope:${string}`;          // scope:{userId}
  cacheValue: Scope[];                  // Array of scopes
  cacheTtlSeconds: 30;

  // Postgres canonical store
  authoritative: "admin_users.scopes";  // table.column

  // Security assertion
  requiresWebAuthn: (scope: Scope) => boolean;  // true for "admin"
}
```

## 2. Producers

- `services/backend/src/middleware/scope.ts` (permission evaluation logic)
- `services/backend/src/routes/admin.ts` (role assignment and WebAuthn validation)

## 3. Consumers

- `services/backend/src/routes/*` (all restricted endpoints)
- `src/app/admin/layout.tsx` (admin panel gate)

## 4. Breaking changes

- Removing the `admin` scope isolation
- Disabling the hardware WebAuthn requirement for `admin` elevation
- Changing the Redis cache key format, causing widespread cache misses and auth fallback
- Injecting roles implicitly instead of requiring exact scope strings

## 5. Required tests

- Verification that WebAuthn challenge / response is mandatory for `admin` routes
- Redis cache invalidation tests upon role downgrades
- 403 Forbidden enforcement on missing scopes

## 6. Drift gate

- `services/backend/src/middleware/scope.ts`
- `services/backend/src/routes/admin.ts`

## 7. Versioning and compatibility

- Patch: permission documentation only.
- Minor: new permission that defaults to denied until explicitly granted.
- Major: changed allow/deny semantics, scope inheritance, admin behavior, or tenant boundary.
- On any version bump, notify: auth, backend, test-kitchen, shell.
