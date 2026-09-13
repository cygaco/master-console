<!-- generated 2026-04-30 by Phase 3G — keep `id` and section names stable, edit content freely -->
# Contract: WORKSPACE

- **id:** WORKSPACE
- **owner:** onboarding
- **introducedIn:** 2026-04-30
- **status:** active
- **version:** 1.0.0
- **changeType:** none
- **used by:** onboarding, list-generation, auto-cart, dashboard

## 1. Shape

```typescript
interface WorkspaceState {
  userId: string;
  onboardingProgress: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;  // 7-step onboarding gate
  savedLists: Array<{
    id: string;
    title: string;
    s3Key: string;
  }>;
  cartHistory: Array<{
    listId: string;
    status: "PLAN" | "PREP" | "SHOP" | "SKIPPED";
    ranAt: string;
  }>;
  profileVector: Record<string, number>;  // Embedding vector for ingredient matching
}
```

## 2. Producers

- `services/backend/src/routes/workspace.ts` (workspace CRUD)
- `services/backend/src/routes/onboarding.ts` (progress incrementor)

## 3. Consumers

- `src/app/dashboard/page.tsx` (determines PLAN / PREP / SHOP layout)
- `src/components/workspace/*` (UI rendering)
- `services/backend/src/services/auto-cart.ts`

## 4. Breaking changes

- Altering the 0-7 `onboardingProgress` scale (adds / removes steps without migration)
- Changing cart status enums from the PLAN / PREP / SHOP domain model
- Changing `profileVector` from a key-value embedding shape to an array

## 5. Required tests

- State machine transitions for `cartHistory` statuses
- Enforced validation that `profileVector` meets expected dimensionality bounds
- Schema validation mapping exact JSON response fields to frontend types

## 6. Drift gate

- `services/backend/src/routes/workspace.ts`
- `packages/shared/types/workspace.ts`

## 7. Versioning and compatibility

- Patch: documentation or display-only field.
- Minor: optional field with default values and no permission change.
- Major: onboarding progress scale, cart status, saved list shape, or profile vector semantics change.
- On any version bump, notify: onboarding, list-generation, auto-cart, dashboard.
