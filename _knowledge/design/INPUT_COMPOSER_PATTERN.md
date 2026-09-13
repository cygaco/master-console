---
guide: INPUT_COMPOSER_PATTERN
anchor: none
shape: pattern
timing: reference
lead_time: "none"
tier: standard
trains: [design-lead, design-quality, visual-review, frontend-builder]
maps_to: [component-usage, visual-hierarchy, mobile-responsive, layout, a11y]
sources:
  - "internal: doogle CaptureComposer.tsx / RecordingBar.tsx / VoiceRecorder.tsx (source project, 2026-07)"
  - "reference bar: ChatGPT composer (GPT-unexpanded → GPT-expanded morph)"
  - "https://www.nngroup.com/articles/ten-usability-heuristics/"
  - "https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html"
---

# Input Composer — Pattern & Glossary

_A reusable, product-agnostic reference for building a ChatGPT-style bottom **composer**: the
"type or speak, then send" input surface that morphs on focus, records voice, and routes everything
through one save path. This is a **component pattern** doc (not a design principle) — it trains the
design-review roster to recognize a good composer and it is the reference the `frontend-builder` builds
against. The house reference implementation ships in `_mc/templates/app-scaffold`
(`src/components/composer/`). Product-specific names from the source project are called out inline;
everything else is portable._

> **Why this doc exists (the meta-lesson).** A spec-conformance gauntlet — "does it match the brief, is
> the button reachable, are tokens used" — is **structurally blind to resting-state taste**. On the source
> project, gotchas G-1/G-4/G-5 (below) all PASSED automated + screenshot review and were caught by the
> operator's eye in two seconds; G-5 was actively *rewarded* as "mic prominence achieved." §7 institutes
> the fix: a no-checklist **taste gate**. Read §7 even if you skim the rest.

---

## 1. What this element is called

The whole bottom input surface is a **composer** (a.k.a. "message composer," "compose bar," "input
bar") — the standard term across chat/messaging UIs (Slack, iMessage, ChatGPT). Pinned to the bottom
over scrolling content it is a **docked/floating composer**. The ChatGPT-style variant that expands on
focus is a **morphing composer**.

### Glossary — every element by name

| Element | Standard name | Reference testid (source project) | Notes |
|---|---|---|---|
| The bounding surface | **composer** / compose bar | `CaptureComposer` | The floating card holding everything |
| The card shell | **floating card** | `div.rounded-2xl.border.shadow-lg.bg-card` | Rounded, shadowed, `bg-card`; content scrolls UNDER it |
| The text field | **auto-grow (autosize) textarea** | `note-textarea` | Grows with content to a cap, then scrolls internally |
| The idle prompt | **placeholder** | `"Write a note…"` | Vertically centered in the collapsed row |
| The primary submit | **send button** | `save-btn` / `send-btn` | Filled circle; disabled on empty draft (`pointer-events-none`) |
| The voice trigger | **mic button** | `record-btn` | Icon-only circle; opens voice-to-text |
| The attachment trigger | **attach button** | `capture-attach-toggle` | Icon-only circle |
| The metadata control | **timestamp pill / "Now" pill** | `capture-timestamp-toggle` | `[Now ▾]` — opens a date/time selector; collapses to icon-only on narrow widths |
| Voice waveform | **waveform / level meter** | (recording state) | Live audio level during recording |
| Recording controls | **discard / pause / stop / send** | `recording-{discard,pause,stop,send}` | Replace the idle controls during recording |
| Point-of-use notice | **privacy disclosure** | `voice-privacy-disclosure` | Shown ONLY in recording/transcribing, not idle |
| The bottom nav | **tab bar / bottom navigation** | `BottomNav` | Separate element; the composer floats ABOVE it with a gap |

Keep the reference testids stable when you replicate — the deferred visual/taste lane and any product
e2e tests key off them.

---

## 2. The core patterns (the ones that make it feel right)

### P-1 · Single-row idle, two-tier on focus (the morph)
Idle = ONE horizontal row inside the floating card: `[Now ▾] [placeholder field] [mic] [attach] [send]`.
On focus/tap into the field, the card **morphs** to two tiers — text entry on top (full width), the
control row below. On blur with an empty draft it collapses back to one row; with text present it stays
expanded. This is the ChatGPT input pattern (`GPT-unexpanded` → `GPT-expanded`).

**Implementation that survives focus:** render ONE persistent set of elements and reflow them with CSS
`order`/`flex-basis` — **NEVER conditionally mount/unmount the textarea into two different parents.** If
you unmount+remount on focus, the browser drops focus and cursor position mid-transition and the morph
"doesn't fire." The single persistent `<textarea>` with `onFocus`/`onBlur` toggling an `isExpanded` state
that only swaps `order`/`basis` classes is the pattern.

### P-2 · Auto-grow with a cap
The textarea grows upward with content to a max height (~40vh or ~160px), then scrolls internally. Icons
stay pinned at the card's bottom row. Use an autosize hook that sets `style.height` from `scrollHeight`
clamped to `[MIN, MAX]`.

### P-3 · Floating card, not a docked strip
The composer is a rounded, shadowed card with **gutters on all sides** — horizontal margin (not
edge-to-edge) AND a vertical gap above the bottom nav. Content scrolls UNDER it. A card glued to the nav
or spanning edge-to-edge reads as a docked toolbar, not a floating composer. Give it `left/right` insets
+ a bottom offset of `navHeight + safe-area + gap`.

### P-4 · Borderless field on the card
The text field has NO border/ring of its own — the CARD carries the shape; the field is bare placeholder
text on `bg-card`. A bordered pill inside a bordered card is a double frame.

### P-5 · Icon-only circular controls, uniform size, prominence via FILL
Mic, attach, send are all the **same diameter** circles (≥44px for touch targets). The primary action
(mic or send depending on state) is prominent via **fill/color**, NOT via a larger diameter. Making one
circle bigger reads as inconsistency, not hierarchy — use a filled dark/primary circle vs outline/ghost
circles for the others. No text labels on the mic (icon + `aria-label`). No waveform "live-voice"
affordance unless you actually have live-voice mode (a different feature than voice-to-text).

### P-6 · Point-of-use disclosure only
Any "this audio is sent to <provider>" privacy line renders ONLY during recording/transcribing — never in
the idle bar. Idle stays a clean row. (Compliance copy stays verbatim; presentation copy like "uses your
browser's speech recognition" gets deleted when it's stale/wrong.)

---

## 3. The state machine (5 states)

| State | Bar shows | Trigger out |
|---|---|---|
| **idle** | `[Now ▾] [Write a note…] [mic] [attach] [send]` | focus → (expanded idle); mic → recording |
| **recording** | `[X-discard] [waveform] [pause] [stop] [send]` + disclosure | stop → transcribing; send → save (skip transcript display); X → idle |
| **transcribing** | `[X] [Transcribing… + throbber] [disabled stop/send]` + disclosure | complete → done (transcript in field) |
| **done / review** | transcript populated in the field, back to idle-style controls | send → save |
| **failed** | error copy by reason + retry + type-instead; audio retained | retry → re-POST same blob; type → idle |

**The single terminus (critical architecture).** Every path — typed send, voice-then-send,
transcript-then-edit-then-send — routes through ONE parent-owned save function (note-by-id), not several.
The child composer emits `onTranscript`/`onTextChange`/`onSend`; the **parent owns the write**. This
prevents the "two save paths drift apart" bug class. A single mutation-verified seam test (assert the save
fn is called exactly once per commit) guards it. In the reference implementation the commit decision is
extracted to a pure `terminus.ts` so "exactly one save per commit" is a pure assertion, not a
DOM-dependent one.

---

## 4. Voice → transcript pipeline (two backends behind a flag)

- **Flag-OFF path:** browser Web Speech API (Chrome only) — the fallback.
- **Flag-ON path:** MediaRecorder captures audio → POST to a **server transcription route** (e.g. OpenAI)
  → transcript returns → lands in the field via the single terminus.
- **The server route is product-owned, documented-not-built.** The house reference ships the CLIENT hook
  (`useVoiceInput`) that POSTs to a configured `transcribeUrl` (a documented seam in
  `.env.local.example`); each product wires its own `/api/transcribe` and provider key. Do NOT hand-roll a
  transcription route into the shared scaffold.
- **Guest lane:** non-signed-in users must reach transcription too (no auth wall on the core loop), gated
  by abuse controls not a 401. Because the POST is unauthenticated, the **route is the abuse boundary** —
  it MUST enforce, server-side: rate limiting (per-IP/session), a quota/provider-spend cap (transcription
  bills per second of audio), a body-size + audio-duration cap, and **fail-closed** behavior when a limit
  is hit or config is missing. Do not ship the seam as an open unauth POST — every product copying the
  scaffold would inherit the abuse/cost hole. (The `.env.local.example` seam repeats this as a REQUIRED
  pre-enable checklist.)
- **Permissions-Policy gotcha (flag-ON):** the app scaffold ships a strict `Permissions-Policy` header with
  `microphone=()` (fully disabled) in `next.config`. `getUserMedia` for the MediaRecorder path is BLOCKED
  until the product relaxes it to `microphone=(self)`. Flip it WITH the voice feature, or the mic silently
  fails in production while working in dev.
- **Dedup gotcha (Web Speech):** Chrome's continuous mode re-delivers cumulative `event.results` with a
  stale `resultIndex`, causing word repetition. Fix with a per-session high-water-mark dedup in `onresult`
  (the reference extracts this to a pure `dedup.ts` reducer). Test by firing consecutive CUMULATIVE
  events, not one-shot.

---

## 5. The gotchas (every one cost a review round on the source project — bake them in up front)

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| G-1 | Placeholder rides the TOP of the field | `<textarea>` top-aligns its text; box-center ≠ text-center | Vertically center the single line in the collapsed state (line-height == height, or flex/grid wrapper); keep top-align for the expanded multiline state |
| G-2 | Idle field renders 96px tall / cramped | base `Textarea` component hard-codes `min-h-[96px]`; autosize sets `style.height` but not min-height | Override `min-h-[40px]` (or `min-h-0`) at the CALL SITE — don't edit the shared base component (other consumers rely on 96px) |
| G-3 | Mobile placeholder wraps to two lines | collapsed field squeezed narrow by insets + pill + 3 circles | `whitespace-nowrap overflow-hidden` on the collapsed field; collapse the `[Now]` pill to icon-only below `sm` to reclaim width |
| G-4 | Awkward oversized left gap | a `pl-14`-style avatar-clearance inset carried forward after the avatar moved/left | RE-VERIFY the avatar still overlaps before keeping the inset; if not, symmetric padding; if yes, minimum clearance |
| G-5 | Circles look mismatched/sloppy | one control sized bigger for "prominence" | Uniform diameters; prominence via fill/color only (P-5) |
| G-6 | Composer glued to the nav / edge-to-edge | `fixed inset-x-0` + bottom offset == exactly nav height | Add side gutters + a vertical gap above the nav (P-3) |
| G-7 | Nav (z-50) occludes composer (z-40) controls | composer sits UNDER the fixed bottom nav | Offset the composer bottom to `navHeight + safe-area (+ gap)`; verify each control with `elementFromPoint` returns the control, not a nav link |
| G-8 | Morph "doesn't fire" on mobile | textarea conditionally mounted in two parents → focus lost | One persistent textarea, reflow via `order`/`basis` (P-1) |
| G-9 | Dev double-render inflates counts | React StrictMode double-invokes mount effects | In e2e assert `1 ≤ count ≤ 2` in dev, exact `=== 1` only in the component test |

---

## 6. What is statically testable vs deferred to a running browser

The reference implementation is a **template** — there is no running app in the framework repo, so the
review lanes split:

**Statically enforceable now (pure unit tests, node env — ship these with the component):**
- **Single-terminus seam** — drive typed-send + voice-then-send + transcript-edit-send through the pure
  `terminus.commit`; assert the save fn is called exactly once per commit (the enforcer for the
  "two save paths drift" bug class — it *rejects* a second write path).
- **Web Speech dedup** — fire consecutive CUMULATIVE `event.results` with a stale `resultIndex`; assert no
  word repetition (G-9 dedup gotcha).
- **Autosize clamp** — `clampHeight(scrollHeight, MIN, MAX)` bounds.

**Deferred to product integration (a real browser, Playwright — name them, do NOT fake them with
box-geometry checks):**
- morph fires on focus (P-1, G-8); placeholder vertical-center **by EYE** (G-1); `elementFromPoint`
  occlusion check per control (G-7); StrictMode double-render (G-9); and the §7 **taste gate** on the idle
  state. Asserting taste with box geometry is the exact false-green §7 warns about.

A `.skip`-ed Playwright spec ships alongside the component to *document* the deferred lane so a product
integrating the composer has the checklist ready.

---

## 7. The taste gate (the meta-deliverable)

A spec-conformance gauntlet measures **box geometry and spec conformance** — and is structurally blind to
resting-state taste. The fix is a **process** one: a review pass whose only job is

> "squint at the resting (**IDLE**) state against the reference; does anything look off, cheap, or
> unbalanced" — judged holistically, empowered to **fail on vibe alone**, with **NO checklist**.

**Design of the taste gate:**
- **What it judges:** the IDLE composer row, holistically, against reference screenshots (e.g. the ChatGPT
  composer) as the bar. Fit, balance, weight, spacing, "does it look designed or does it look assembled."
- **What it must NOT be:** a checklist. The moment it enumerates criteria it becomes the conformance lane
  that already passes G-1/G-4/G-5. It is a vibe verdict, and a REJECT needs no itemized justification
  beyond "it looks off here."
- **When it runs:** specifically on the **idle/resting state** — reviewers spend their budget on the hard
  states (occlusion, morph, recording) and idle fit-and-finish coasts through. Run it last, on idle,
  before ship.
- **What it needs:** reference screenshots as the bar, and a rendered idle composer to squint at (so it is
  a product-integration lane, run against the product's running app — not the framework template).
- **Where it lives (roster wiring — GATED):** the gate is realized as a no-checklist judgment pass in the
  `design-quality` / `visual-review` roster (a `.claude/agents/**` edit). That wiring is sequenced AFTER
  the dispatch-roster frontmatter migration and is tracked separately; this doc is the authoritative spec
  the wiring implements.

This is distinct from the design-system-conformance lane, which will keep passing things that "meet the
tokens" but look wrong.

### 7.1 MANDATORY adoption gates (not optional polish)

Because this composer is a **reusable reference many products copy**, a taste miss multiplies across every
adopter. So the following are **REQUIRED gates any adopting product MUST run against its own running app
before it ships the composer** — not a suggested nicety:

1. **Taste gate** — the no-checklist squint-at-IDLE-against-reference-screenshots verdict above. REQUIRED.
2. **By-eye IDLE check** — placeholder vertical-centering and overall resting-state fit judged **by eye,
   not by box geometry** (G-1). REQUIRED. Box-geometry assertions are the exact false-green this doc exists
   to close — they do not discharge this gate.
3. **`elementFromPoint` control check** — each interactive control (mic/attach/send/timestamp) verified to
   return the control itself, not an occluding nav link (G-7). REQUIRED.

A product that ships the composer without running all three has not met this pattern's bar.

### 7.2 OWED DEBT — the reference component's own IDLE taste pass

⚠️ The **house reference component** (`_mc/templates/app-scaffold/src/components/composer/`) has **not
itself cleared the taste gate** this sprint — there is no running app in the framework repo to squint at,
so the by-eye IDLE pass could not run against a live render. This is recorded as **OWED debt**, NOT a clean
pass: **the reference component's IDLE taste pass MUST be discharged (throwaway mount → screenshot →
eye-check against the ChatGPT-composer reference) before ANY product adopts it.** Shipping the taste-gate
as prose while the canonical artifact everyone copies never cleared it is the exact value-inversion this
pattern was written to prevent. Discharge condition: a recorded IDLE eye-check pass on the reference render.

---

## 8. Replication checklist (framework → new product)

1. One persistent `<textarea>` + `isExpanded` state; morph via `order`/`basis` (P-1, G-8).
2. Autosize hook, clamped, call-site `min-h` override (P-2, G-2).
3. Floating card: side gutters + gap above nav; borderless field (P-3, P-4, G-6).
4. Uniform circular controls, fill-not-size prominence, icon-only mic w/ `aria-label` (P-5, G-5).
5. Single parent-owned save terminus + a mutation-verified seam test (§3).
6. Voice pipeline behind a flag with a typing fallback; guest lane gated by abuse controls not auth; the
   transcription server route is yours to wire (documented `transcribeUrl` seam) (§4).
7. Point-of-use disclosure only in recording/transcribing (P-6).
8. **REQUIRED (§7.1):** verify each control with `elementFromPoint`; assert placeholder vertical-center by
   EYE, not box geometry (G-1, G-7).
9. **REQUIRED (§7.1):** run the no-checklist **taste gate** on the idle state against reference screenshots
   before shipping (§7) — and discharge the reference component's OWED IDLE taste pass (§7.2) before adopting.

---

_Source project: doogle (`src/components/capture/CaptureComposer.tsx`, `RecordingBar.tsx`,
`VoiceRecorder.tsx`). Every gotcha in §5 is a real review round that shipped a fix. The house reference
implementation lives in `_mc/templates/app-scaffold/src/components/composer/`. Keep this doc updated
when a new failure mode is found._
