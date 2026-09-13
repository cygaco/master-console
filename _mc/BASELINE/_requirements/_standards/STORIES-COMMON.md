# Pantry Pilot — Shared Granular Stories

## Purpose

Cross-cutting behaviors that repeat across multiple features. Feature stories reference these by ID (`Inherits: CS-XXX`) instead of re-specifying the behavior. This ensures consistent implementation and prevents drift between features.

Shared stories are **not standalone** — they are inherited by feature-specific stories that supply the concrete context (which data, which step, which prompt).

---

## CS-001: Encrypted Session Persistence

> As a System, I want modified data to be persisted to encrypted session storage immediately on confirmation, so that no user input is lost between steps.

**Acceptance Criteria:**

- Data is saved to AES-GCM encrypted localStorage via `saveSession()`
- Persistence completes before the next step renders
- If persistence fails, the user is shown an error and does not advance
- Stale or partial data from a previous session does not silently overwrite newer data

**Verifiable by:** `localStorage` contains encrypted blob; decrypted `SessionData` includes the expected field with correct value.

---

## CS-002: Loading State During AI Operation

> As a User, I want to see a progress indicator while the system is processing an AI request, so that I know the system is working and not frozen.

**Acceptance Criteria:**

- A progress indicator is displayed immediately when the AI operation begins
- The indicator is removed when the operation completes or fails
- The user cannot trigger the same operation again while it is in progress
- A cancel action is available for operations exceeding 5 seconds

**Verifiable by:** Progress element is visible during API call; primary action is disabled; progress element is removed after response.

---

## CS-003: Validation Error Display

> As a System, I want to display a clear error message when user input fails validation, so that the user understands what to fix without guessing.

**Acceptance Criteria:**

- The error message names the specific field and the validation rule that failed
- The error is displayed adjacent to the field that caused it
- The error clears when the user corrects the input
- The system does not submit data that failed validation

**Verifiable by:** Error element is visible adjacent to the invalid field; error text names the field; error disappears on valid input; form submission was blocked.

---

## CS-004: Disabled Action During Incomplete State

> As a System, I want to disable the primary advancement action when required data is missing, so that the user cannot proceed with an incomplete state.

**Acceptance Criteria:**

- The primary action is visually disabled and non-interactive when prerequisites are unmet
- The action becomes enabled as soon as all prerequisites are satisfied
- No partial or empty data is submitted via a disabled action

**Verifiable by:** Primary action element has `disabled` attribute when prerequisites are unmet; attribute is removed when prerequisites are met.

---

## CS-005: Field-Level Data Binding

> As a System, I want form field values to be bound to session state, so that edits are reflected in the data model immediately and survive re-renders.

**Acceptance Criteria:**

- Editing a field updates the corresponding session state value
- Re-rendering the component restores the field to its session state value
- Fields with no session state value render as empty, not as stale data from a previous step

**Verifiable by:** Edit field → read session state → value matches; re-render component → field value matches session state.

---

## CS-006: Plan Entitlement Guard

> As a System, I want to verify the household's plan entitlement before executing a gated operation, so that plan limits cannot be bypassed.

**Acceptance Criteria:**

- The entitlement check occurs server-side before the operation executes
- An over-limit request returns an error naming the plan limit and the current usage
- No partial work is performed or persisted when the household is over its limit
- The usage increment is atomic — usage is not incremented if the operation fails

**Verifiable by:** API returns 402 with `{ limit, used }` when the household is over its plan limit; usage unchanged after failed operation; usage incremented by exactly one after successful operation.

---

## CS-007: Rate Limit Enforcement

> As a System, I want to enforce per-IP rate limits on API endpoints, so that abuse does not degrade the service for other users.

**Acceptance Criteria:**

- Requests exceeding the rate limit receive a 429 response with a `Retry-After` header
- Rate-limited requests do not count against plan usage or trigger downstream processing
- Rate limits reset after the specified window

**Verifiable by:** Nth+1 request within window returns 429; `Retry-After` header is present; plan usage unchanged for rate-limited requests.

---

## CS-008: callClaude Response Contract

> As a System, I want all features that call `callClaude()` from `src/lib/api.ts` to receive a **string** return value, so that builders do not accidentally double-parse the response.

**Acceptance Criteria:**

- The foundation `api.ts` already handles the JSON envelope extraction (`res.json()` → `.text`)
- Builders MUST NOT call `res.text()` or `res.json()` themselves on Claude responses — use the `callClaude()` helper which returns the extracted text directly

**Inherits:** Any story with `AI call: callClaude(...)` in its Data contract.

**Verifiable by:** Unit test confirming callClaude returns typeof string, not an object or JSON string.

---

## CS-009: complete() Data Contract Integrity

> As a System, I want every step component that calls `complete(stepNumber, data)` to include ALL fields that the step produces, so that downstream steps are never broken by missing data.

**Acceptance Criteria:**

- The `data` argument MUST include ALL fields that the step produces as listed in `.claude/agents/INTEGRATION-MAP.md`
- Omitting a field (even one not displayed on screen) breaks downstream steps that read it

**Inherits:** Any story that produces session data via complete().

**Verifiable by:** For each step, compare the fields in the complete() call against INTEGRATION-MAP.md — every listed WRITE field must be present.
