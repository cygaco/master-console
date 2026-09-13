---
description: Seed warm-start data (founder-allowlist session, sample events, FOUNDERS_CHECKLIST.md) into the live admin-preview instance so the in-app founder panel renders non-empty. READS the instance pointer written by admin:preview; never scaffolds its own instance and never targets MC itself.
user-invocable: true
namespace: admin
reads: [scripts/admin/seed.js, .claude/runtime/admin-preview.json, scripts/scaffold/founders-checklist.js]
writes: [runtime/admin-preview/instance/**]
---

# /admin:seed — warm-start data for the founder admin panel

Seeds the in-app founder admin panel so it renders warm-start instead of empty.
It READS the single instance pointer (`.claude/runtime/admin-preview.json`) that
`/admin:preview` writes, discovers the throwaway `instanceDir`, and seeds INTO
that reused instance ONLY:

- a founder-allowlist session marker (panel renders authenticated),
- a small set of sample events (panel renders non-empty),
- a `FOUNDERS_CHECKLIST.md` rendered via the shared
  `scripts/scaffold/founders-checklist.js#renderFoundersChecklist` producer
  (launch-readiness renders warm-start).

```bash
node scripts/admin/seed.js          # seed into the pointed instance
node scripts/admin/seed.js --json   # machine-readable result
```

## Invariants

- **Reader, not writer of the pointer.** `seed.js` NEVER writes
  `.claude/runtime/admin-preview.json` — `admin:preview` is the SOLE writer
  (single-writer invariant, AC-R3c). Seed only reads it.
- **No live pointer → fail clear.** If no pointer exists, it fails with
  "run /admin:preview first" and exits non-zero — it never scaffolds a second
  instance.
- **Idempotent.** Running twice produces no duplicate checklist, founder session,
  or sample events.
- **Never MC.** The same `refuseIfTargetIsMC` guard applies to the seed
  target — it refuses if the resolved instance dir is the MC canonical root.

Run `/admin:preview` first to boot the throwaway instance, then `/admin:seed` to
warm it, then `/admin:readiness` or `/admin:guides` to open a sub-route.
