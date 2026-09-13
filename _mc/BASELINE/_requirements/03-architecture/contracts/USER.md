<!-- generated 2026-04-30 by Phase 3G — keep `id` and section names stable, edit content freely -->
# Contract: USER

- **id:** USER
- **owner:** profile
- **introducedIn:** 2026-04-30
- **status:** active
- **version:** 2.0.0
- **changeType:** major
- **used by:** subscription, profile, auth, catalog-research

> **2.0.0 (breaking, 2026-05-04):** shape rewritten to reflect product-specific user contract promoted into canonical at v0.2.0. Consumers that depended on the framework-template UserAccount interface must adopt the new shape.

## 1. Shape

```typescript
interface UserAccount {
  id: string;               // UUID v4
  email: string;            // Normalized lowercase email
  balance: number;          // Integer, remaining quota (min 0)
  tier: "free" | "plus" | "family";  // Access tier
  usage: {
    cartsRun: number;
    searchesRun: number;
  };
  createdAt: string;        // ISO-8601 timestamp
  scope: string[];          // Merged scopes
  deleted: boolean;         // Soft delete flag
}
```

## 2. Producers

- `packages/shared/db/schema.ts` (Drizzle / Prisma schema definition)
- `services/backend/src/models/user.ts` (user creation and state mutations)

## 3. Consumers

- `services/backend/src/routes/usage.ts` (quota deductions)
- `src/app/(authenticated)/profile/page.tsx` (user view)
- `services/backend/src/routes/auth.ts` (identity hydration)

## 4. Breaking changes

- Renaming `balance` to a different quota label
- Changing `balance` type from integer to float / decimal
- Removing or renaming `usage` counters which heavily break gamification
- Bypassing the `deleted: true` soft-delete convention to hard-delete rows

## 5. Required tests

- DB serialization / deserialization precision for JSONB usage fields
- Constraints preventing `balance` from dropping below 0
- Safe serialization preventing password hashes from leaking into this shape

## 6. Drift gate

- `packages/shared/db/schema.ts`
- `packages/shared/types/user.ts`

## 7. Versioning and compatibility

- Patch: documentation or validation copy only.
- Minor: backward-compatible optional field with default serialization.
- Major: identity, email normalization, quota, tier, usage, or deletion semantics change.
- On any version bump, notify: subscription, profile, auth, catalog-research.
