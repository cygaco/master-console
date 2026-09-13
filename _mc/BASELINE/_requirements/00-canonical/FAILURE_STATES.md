# Pantry Pilot — Failure States

Unacceptable states organized by domain. If any of these states occur, it is a bug that must be fixed.

---

## Data Integrity

| Failure State                                | Why It's Unacceptable                                              |
| -------------------------------------------- | ------------------------------------------------------------------ |
| Session data lost without user action        | User loses all progress. Trust destroyed.                          |
| Downstream data persists after upstream edit | Stale lists, wrong quantities, misleading prices.                  |
| Plan includes a declared allergen            | Health risk, ethical violation, household harm.                    |
| List contains excluded ingredients           | User explicitly removed them. Violates user control.               |
| Encrypted data decrypted by wrong device     | Security breach. (Should not be possible with device fingerprint.) |
| Session loads with corrupted/partial data    | App in inconsistent state. Undefined behavior.                     |

---

## API & Pipeline

| Failure State                                                    | Why It's Unacceptable                                                 |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| Model API key exposed to client                                  | Security breach. Key compromise.                                      |
| API call fails silently (no error shown)                         | User stuck in loading state forever.                                  |
| Fresh Feed catalog fetch hangs with no timeout                   | User waits indefinitely. No recourse.                                 |
| Price analysis uses synthetic/fake catalog data in production    | Entire product value proposition is real store data. Fake data = fraud. |
| PLAN_PREP and PLAN both fail with no fallback                    | User cannot proceed past step 5. Dead end.                            |
| Prompt injection succeeds (external data alters AI behavior)     | Security vulnerability. Could produce harmful output.                 |
| Rate limit hit with no feedback                                  | User retries, gets more errors. Frustrating.                          |

---

## Subscription & Limits

| Failure State                                    | Why It's Unacceptable                          |
| ------------------------------------------------ | ---------------------------------------------- |
| Plan slot consumed but generation fails          | User pays for nothing. Trust destroyed.        |
| Paid operation runs without a tier check         | Revenue leak. Free access to paid features.    |
| Free-tier meal counter goes negative             | Accounting inconsistency.                      |
| Upgrade completes but tier doesn't unlock        | User confused, may pay again.                  |
| Free tier blocked before the 3-meal limit is hit | Breaks free tier promise.                      |
| Family tier billed at Plus rates                 | User overcharged.                              |

---

## List Generation

| Failure State                                      | Why It's Unacceptable                    |
| -------------------------------------------------- | ---------------------------------------- |
| Store list generated without a master list         | No base to apply diff to. Broken output. |
| List diff adds items no recipe calls for           | Fabrication risk.                        |
| PDF export produces a corrupted file               | User can't use the output they paid for. |
| Non-ASCII characters in the store-import list      | May break the store app's import parser. |
| Nutrition facts shown when nutritionVisibility is "hide" | User privacy / preference violation. |

---

## Auto-Cart

| Failure State                                    | Why It's Unacceptable                              |
| ------------------------------------------------ | -------------------------------------------------- |
| Order placed without user review                 | Compliance violation. Core product promise broken. |
| Wrong store list selected for the trip           | Cart quality degraded.                             |
| Delivery address or slot entered incorrectly     | Broken order. Groceries never arrive.              |
| Extension bypasses CAPTCHA checks                | Violates bot detection systems.                    |
| More than 60 items added in one session          | Rate abuse. Store account banning risk.            |

---

## Authentication

| Failure State                                      | Why It's Unacceptable                      |
| -------------------------------------------------- | ------------------------------------------ |
| Auth state lost after page refresh                 | User must sign in again unexpectedly.      |
| Soft gate blocks progress permanently              | User can't continue. Dead end.             |
| JWT expires during active session with no recovery | User loses in-progress work.               |
| OAuth redirect fails silently                      | User clicked Sign In and nothing happened. |

---

## UI / UX

| Failure State                                                      | Why It's Unacceptable                                      |
| ------------------------------------------------------------------ | ---------------------------------------------------------- |
| User can navigate to step with unmet prerequisites                 | App in inconsistent state. Missing data.                   |
| Loading state shown indefinitely (spinner of death)                | User stuck. No escape hatch.                               |
| Error message gives no recovery action                             | User doesn't know what to do.                              |
| Backward navigation clears data without confirmation               | Violates user control. Data loss.                          |
| Readiness score decreases without explanation                      | Confusing. User did something "right" but score went down. |
| Celebration triggers for trivial changes                           | Erodes celebration meaning.                                |
| Modal cannot be dismissed (no close, no escape, no backdrop click) | User trapped.                                              |

---

## Performance

| Failure State                                         | Why It's Unacceptable                                |
| ----------------------------------------------------- | ---------------------------------------------------- |
| Vercel function timeout on routine operation          | User gets 504 error. Must retry.                     |
| localStorage exceeds 5MB quota                        | Session save fails silently. Data loss on next load. |
| Multiple concurrent model API calls from same session | Unnecessary cost, potential rate limiting.           |
| Memory leak from pipeline trace buffer                | Browser tab slows down over long sessions.           |

---

## Dev Tools (Test Kitchen)

| Failure State                                               | Why It's Unacceptable                         |
| ----------------------------------------------------------- | --------------------------------------------- |
| TestKitchen accessible without env gate                     | Production users see dev tools.               |
| TestKitchen removed from context provider position          | All child `useTK()` calls break. App crashes. |
| Prep Bowl data contaminates production session              | Real user data overwritten with test data.    |
| Test API endpoint accessible in production without env gate | Information disclosure.                       |

---

## Data Integrity (Returning Users)

| Failure State                                                      | Why It's Unacceptable                                      |
| ------------------------------------------------------------------ | ---------------------------------------------------------- |
| Session loads with schema version mismatch and no migration path   | User loses data or app enters undefined state.             |
| Schema migration runs but silently drops fields                    | User's progress vanishes without explanation.              |
| Returning user hits a step that assumes data from a newer schema   | Crash or blank UI on a step the user previously completed. |
