# Pantry Pilot — Extension Spec (Regen Spec)

Chrome extension for FreshCart Quick Add automation (FreshCart is the fictional online grocery store used throughout this example). All files in `extension/`.

---

## Manifest (manifest.json)

| Field                  | Value                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| Manifest version       | 3                                                                     |
| Name                   | Pantry Pilot Cart Assistant                                           |
| Version                | 0.1.0                                                                 |
| Permissions            | `activeTab`, `storage`, `tabs`, `scripting`                           |
| Host permissions       | `https://www.freshcart.example/*`                                     |
| Background             | Service worker: `background.js`                                       |
| Content scripts        | `content.js` on `https://www.freshcart.example/shop/*`, `document_idle` |
| Action                 | Popup: `popup.html`, icons: 48px + 128px                              |
| Externally connectable | `https://*.pantrypilot.example/*`                                     |

**Pre-publish checklist:** Remove `http://localhost/*` from `externally_connectable` before Chrome Web Store submission. Currently needed for dev/testing.

---

## Architecture

```
Web App (Step13Cart.tsx)
  │  chrome.runtime.sendMessage (external)
  ▼
Background (background.js) — service worker
  │  chrome.storage.local (session + status)
  │  chrome.tabs (navigate, create)
  ▼
Content Script (content.js) — injected on FreshCart shop pages
  │  DOM manipulation (scan, triage, fill, add)
  │  chrome.runtime.sendMessage (internal)
  ▼
Popup (popup.html/js/css) — extension popup UI
     chrome.storage.local (read status)
     chrome.runtime.sendMessage (start/pause/stop)
```

---

## Storage Keys

| Key                    | Type   | Contents                                                          |
| ---------------------- | ------ | ----------------------------------------------------------------- |
| `pantrypilot_session`  | Object | Full payload: queries, profile, heuristics, plans, preferences    |
| `pantrypilot_status`   | Object | Current state, stats, current item, timestamps                    |

### Session Shape

```javascript
{
  queries: [{ keywords, store, fulfillment, availability, categories, quickAdd }],
  profile: { name, email, phone, address, ... },
  heuristics: { addIf: [], skipIf: [], fireThreshold, substitutionGuidance },
  preferences: { fulfillmentTypes, mealTypes, dealBreakers, unitPriceCeiling, weeklyBudget, preferredStore },
  answers: { fieldLabel: value },  // Checkout answer map
  targetedPlans: [],
  substitutionGuidance: "",
  originTabId: number,
  storeTabId: number,
  receivedAt: timestamp,
}
```

### Status Shape

```javascript
{
  state: 'idle' | 'scanning' | 'adding' | 'paused' | 'complete' | 'error',
  currentItem: { name, store } | null,
  stats: { added: 0, skipped: 0, failed: 0, total: 0 },
  currentQueryIndex: 0,
  currentPage: 1,
  error: null | string,
  startedAt: timestamp | null,
  updatedAt: timestamp | null,
}
```

---

## Message Protocol

### Origin Validation

All message handlers validate the sender before processing:

**External messages** (`onMessageExternal`): `sender.origin` must match one of:

- `https://pantrypilot.example`
- `https://www.pantrypilot.example`
- `http://localhost:3000` (dev)
- `https://localhost:3000` (dev)

Unauthorized origins receive `{ status: 'error', error: 'Unauthorized origin' }`.

**Internal messages** (`onMessage`): If `sender.url` is present, it must start with `https://www.freshcart.example/` OR `sender.id` must equal `chrome.runtime.id` (the extension itself, e.g., popup). This prevents injected scripts on non-store pages from sending commands.

### External Messages (Web App → Background)

| Type          | Payload              | Response                           |
| ------------- | -------------------- | ---------------------------------- |
| `ping`        | —                    | `{ status: 'ok', version }`        |
| `start_cart`  | Full session payload | `{ status: 'ok', tabId }` or error |
| `get_status`  | —                    | `{ status: 'ok', data: Status }`   |
| `pause`       | —                    | `{ status: 'ok' }`                 |
| `resume`      | —                    | `{ status: 'ok' }`                 |
| `stop`        | —                    | `{ status: 'ok' }`                 |

### Internal Messages (Content Script / Popup → Background)

| Type                  | Payload                              | Response                                            |
| --------------------- | ------------------------------------ | --------------------------------------------------- |
| `start_cart_internal` | Session or null                      | `{ status: 'ok', tabId }` or error                  |
| `get_session`         | —                                    | `{ status: 'ok', data: Session }`                   |
| `status_update`       | Status patch                         | `{ status: 'ok' }`                                  |
| `item_result`         | `{ result, name, store, reason }`    | `{ status: 'ok' }`                                  |
| `next_query`          | —                                    | `{ status: 'ok', url }` or `{ status: 'complete' }` |
| `next_page`           | —                                    | `{ status: 'ok', page }` or complete                |

### Background → Content Script

| Type     | Effect                                        |
| -------- | --------------------------------------------- |
| `pause`  | Sets `isPaused = true`                        |
| `resume` | Sets `isPaused = false`                       |
| `stop`   | Sets `isStopped = true`, removes status badge |

### Background → Web App (Relay)

Status updates are relayed to the web app tab via `chrome.tabs.sendMessage` as `{ type: 'pantrypilot_status_update', payload: Status }`.

---

## Store Search URL Builder

`buildStoreSearchUrl(query, page)` constructs FreshCart search URLs:

| Parameter    | Store Param | Values                                                                          |
| ------------ | ----------- | ------------------------------------------------------------------------------- |
| Keywords     | `q`         | Free text                                                                       |
| Store        | `store`     | Only set if fulfillment is NOT Delivery                                         |
| Availability | `f_AV`      | `r86400` (today), `r604800` (this week), `r2592000` (this month)                |
| Category     | `f_CT`      | `P` (Produce), `D` (Dairy), `G` (Grocery), `F` (Frozen), `B` (Bakery)           |
| Fulfillment  | `f_FT`      | `1` (In-store), `2` (Delivery), `3` (Pickup)                                    |
| Quick Add    | `f_QA`      | `true` (default on)                                                             |
| Pagination   | `start`     | `(page - 1) * 25`                                                               |

---

## Content Script: Cart Loop

### Flow

1. **Init:** Check for active session via `get_session` message
2. **Wait:** 2s for page to settle
3. **Scan:** Scroll through product list, scrape all cards (name, store, unit price, Quick Add status)
4. **Filter:** Quick Add only, not already in cart, not already processed
5. **For each card:**
   a. Open item detail (click card, wait for description)
   b. **Triage:** Evaluate against heuristics (see below)
   c. If `nogo` → skip, report result
   d. Click Quick Add button, wait for modal
   e. **Fill options form** (multi-step, up to 10 steps)
   f. **Pause for review** — show overlay, wait for user approve/skip
   g. If approved → click Add to Cart, report `added`
   h. If skipped → close modal, report `skipped`
6. **Paginate:** Request next page (max 3 pages per query), then next query
7. **Complete:** When all queries exhausted

### FreshCart DOM Selectors

Key selectors (defined in `SEL` object, content.js lines 22-62):

- **Product cards:** `.shop-search-results__list-item`, `.product-card-container`
- **Item detail:** `.product-description-content__text`, `#product-details`
- **Quick Add button:** `.shop-quick-add-button`, `button[aria-label*="Quick Add"]`
- **Modal:** `.shop-quick-add-modal`, `.fc-modal[role="dialog"]`
- **Form fields:** `.shop-quick-add-form-section__grouping`, `.fc-dash-form-element`
- **Navigation:** `button[aria-label="Continue to next step"]`, `button[aria-label="Add to cart"]`

---

## Triage Engine (content.js)

`triageItem(name, store, description, heuristics, itemAvailability, preferences)` returns `{ verdict, reason }`:

### Verdict Types

| Verdict  | Meaning                                 | Action              |
| -------- | --------------------------------------- | ------------------- |
| `fire`   | Strong match (addIf score >= threshold) | Proceed to add      |
| `review` | Partial match or no strong signal       | Show review overlay |
| `nogo`   | Matched skipIf or deal-breaker          | Auto-skip           |

### Evaluation Order

1. **Fulfillment filter:** Delivery preference vs item availability
2. **Deal-breakers:** `out-of-stock`, `contains-allergen`, `over-budget`, `bulk-only`
3. **skipIf rules:** Each rule checked against combined text (name + store + description). First match → `nogo`
4. **addIf rules:** Each rule contributes weight to `fireScore`. Score >= threshold (default 1) → `fire`
5. **Default:** `review`

### Rule Format

Rules support both string and object format:

- String: `"contains peanuts"` — pattern matched against all text
- Object: `{ pattern, field, reason, weight }` — field-targeted matching

---

## Form Filling (content.js)

### Field Mapping

The extension maps form labels to profile values:

| Label Pattern                | Source                            |
| ---------------------------- | --------------------------------- |
| "first name"                 | `profile.firstName` or name split |
| "last name"                  | `profile.lastName` or name split  |
| "email"                      | `profile.email`                   |
| "phone" / "mobile"           | `profile.phone`                   |
| "city" / "address"           | `profile.address`                 |
| "apartment" / "unit"         | `profile.addressLine2`            |
| "loyalty" / "member number"  | `profile.loyaltyId`               |
| "quantity" / "how many"      | `item.quantity`                   |
| "budget" / "spend limit"     | `profile.weeklyBudget`            |
| "household" / "people"       | `profile.householdSize`           |

### Select Dropdowns

| Label Pattern              | Default Value                          |
| -------------------------- | -------------------------------------- |
| "country"                  | "United States"                        |
| "delivery window"          | "Earliest available"                   |
| "substitutions"            | Yes/No from `profile.allowSubstitutions` |
| "bag preference"           | "Reusable bags"                        |
| "contact-free"             | Yes/No from `profile.contactFreeDelivery` |
| "unit" / "measurement"     | "Imperial"                             |
| "tip"                      | "Prefer not to say"                    |
| "marketing" / "promotions" | "I don't wish to answer"               |

### Auto-Checked Checkboxes

Checkboxes with labels containing "agree", "terms", or "acknowledge" are auto-checked.

### ID Upload (age-restricted items)

Cannot be programmatically filled (browser security). Logged as a note — user must upload manually or complete verification in their store account.

### Input Filling Technique

Uses React-compatible event dispatching:

1. Set value via `HTMLInputElement.prototype.value` setter (bypasses React controlled component)
2. Dispatch `input`, `change`, `blur` events with `bubbles: true`

---

## Popup UI (popup.html/js/css)

### Tabs

| Tab          | Contents                                                                                |
| ------------ | --------------------------------------------------------------------------------------- |
| Status       | State label, stats (added/skipped/failed/total), progress bar, Start/Pause/Stop buttons |
| Instructions | Profile summary, search queries, editable addIf/skipIf rules, hard limits, Save button  |

### Connection Badge

- **Connected:** Session exists and is < 24h old
- **Disconnected:** No session or stale

### Sync Button

Finds Pantry Pilot web app tab (localhost:3000 or pantrypilot.example) → requests sync via `pantrypilot_request_sync` message.

### Status Polling

Reads `pantrypilot_status` from `chrome.storage.local` every 3s + on storage change events.

---

## Human-in-the-Loop

The extension **always pauses before checkout**. The review overlay shows:

- Item name and store
- Triage verdict and reason
- "Skip" and "Approve & Add" buttons

**CRITICAL: The extension MUST NOT place an order or complete checkout without explicit user approval.** The "Add to Cart" and checkout actions require a user click in the extension popup or review overlay. No order is placed without explicit user approval. This is a compliance requirement, not a preference.

---

## Pacing

| Action                 | Delay                 |
| ---------------------- | --------------------- |
| Between items          | 500-2000ms (random)   |
| After card click       | 1500ms                |
| After Quick Add click  | 1500ms                |
| Between form steps     | 800-1200ms            |
| After add to cart      | 2000ms                |
| Scroll per card        | 200ms                 |
| Generic random delay   | 500 + random(1500) ms |

All delays include +-500ms jitter for human-like behavior.
