# [Product] — Shared Granular Stories

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

**Verifiable by:** the product's persisted session (as its storage helper writes it) includes the expected field with the correct value.

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

## CS-006: Usage Cost Guard

> As a System, I want to verify sufficient credit balance before executing a paid operation, so that the credit system cannot be bypassed.

**Acceptance Criteria:**

- Balance check occurs server-side before the operation executes
- Insufficient balance returns an error with the required cost and remaining balance
- No partial work is performed or persisted when balance is insufficient
- The debit is atomic — balance is not reduced if the operation fails

**Verifiable by:** API returns 402 with `{ required, remaining }` when balance is insufficient; balance unchanged after failed operation; balance reduced by exact cost after successful operation.

---

## CS-007: Rate Limit Enforcement

> As a System, I want to enforce per-IP rate limits on API endpoints, so that abuse does not degrade the service for other users.

**Acceptance Criteria:**

- Requests exceeding the rate limit receive a 429 response with a `Retry-After` header
- Rate-limited requests do not consume credits or trigger downstream processing
- Rate limits reset after the specified window

**Verifiable by:** Nth+1 request within window returns 429; `Retry-After` header is present; credit balance unchanged for rate-limited requests.

---

## CS-008: Model-Call Response Contract

> Applies when the product has a shared model-call helper. As a System, I want every feature that calls that helper to receive a **string** return value, so that builders do not accidentally double-parse the response.

**Acceptance Criteria:**

- The helper handles the provider's response envelope and returns the extracted text
- Builders MUST NOT call `res.text()` or `res.json()` themselves on model responses — they call the helper

**Inherits:** Any story whose Data contract names a model call.

**Verifiable by:** Unit test confirming the helper returns typeof string, not an object or JSON string.

---

## CS-009: complete() Data Contract Integrity

> As a System, I want every step component that calls `complete(stepNumber, data)` to include ALL fields that the step produces, so that downstream steps are never broken by missing data.

**Acceptance Criteria:**

- The `data` argument MUST include ALL fields that the step produces as listed in `.claude/agents/president/_system/oneshot/integration-map.md`
- Omitting a field (even one not displayed on screen) breaks downstream steps that read it

**Inherits:** Any story that produces session data via complete().

**Verifiable by:** For each step, compare the fields in the complete() call against INTEGRATION-MAP.md — every listed WRITE field must be present.
