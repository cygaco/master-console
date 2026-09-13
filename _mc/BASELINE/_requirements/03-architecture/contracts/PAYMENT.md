<!-- generated 2026-04-30 by Phase 3G — keep `id` and section names stable, edit content freely -->
# Contract: PAYMENT

- **id:** PAYMENT
- **owner:** subscription
- **introducedIn:** 2026-04-30
- **status:** active
- **version:** 1.0.0
- **changeType:** none
- **used by:** subscription, test-kitchen, shell

## 1. Shape

```typescript
interface LedgerEntry {
  transactionId: string;                                    // Internal UUID
  userId: string;
  amount: number;                                           // Fiat amount in cents
  currency: "USD";
  quotaCredited: number;                                    // Exact conversion injected
  stripeEventId: string;                                    // Unique Stripe idempotency key
  status: "pending" | "completed" | "refunded" | "failed";
}
```

## 2. Producers

- `services/backend/src/routes/webhooks/stripe.ts` (Stripe event ingestion)
- `packages/shared/db/ledger.ts` (ledger record creation)

## 3. Consumers

- `services/backend/src/models/user.ts` (syncs ledger with `User.balance` quota)
- `src/app/settings/billing/page.tsx` (purchase history)

## 4. Breaking changes

- Changing fiat amount representation from integer cents to float
- Modifying the status enum state machine
- Ignoring `stripeEventId`, resulting in non-idempotent quota crediting
- Modifying webhook signature validation requirements

## 5. Required tests

- Cryptographic signature validation of incoming Stripe webhook payloads
- Strict idempotency checks preventing double-crediting of `stripeEventId`
- Rollback transaction testing if `quotaCredited` fails to apply to the User

## 6. Drift gate

- `services/backend/src/routes/webhooks/stripe.ts`
- `packages/shared/db/ledger.ts`

## 7. Versioning and compatibility

- Patch: documentation or event wording only.
- Minor: backward-compatible metadata field or optional receipt data.
- Major: checkout state, ledger semantics, idempotency, balance mutation, or webhook verification change.
- On any version bump, notify: subscription, test-kitchen, shell.
