---
guide: INTERACTION_FEEDBACK_STATES
anchor: none
shape: walkthrough
timing: reference
lead_time: "none"
tier: core
trains: [design-lead, conversion-lead, design-quality, visual-review]
maps_to: [component-usage, visual-hierarchy, console-error, regression, color]
sources:
  - "https://www.nngroup.com/articles/ten-usability-heuristics/"
  - "https://www.nngroup.com/articles/response-times-3-important-limits/"
  - "https://www.nngroup.com/articles/microinteractions/"
  - "https://lawsofux.com/doherty-threshold/"
  - "https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/status_role"
  - "https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/alert_role"
  - "https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22.html"
---

# Interaction Feedback & States

**Interaction feedback and state coverage is the discipline of making the system's status always visible — every user action produces visible feedback within the right time, and every component and screen designs *all* its states (default, hover, focus, active, disabled, loading, empty, error, success), not just the happy path.**

It is the difference between an interface that feels alive and trustworthy and one that feels frozen, broken, or silent. "No silent actions" is the one-line summary: the user should never wonder whether their click registered.

---

## 1. Why it matters

Nielsen's **#1 usability heuristic — Visibility of System Status** — says the system should always keep users informed about what's going on, through appropriate feedback within a reasonable time. When status is invisible, users fill the gap with the worst assumption: "it's broken," "did my click work?", "is it frozen?" — and then they re-click (double-submit), abandon, or lose trust.

Most real-world UI defects aren't in the happy path; they're in the *seams* — the loading moment, the empty list, the error branch, the disabled control, the keyboard focus. Designing only the populated, successful screen leaves the majority of the user's actual experience undesigned.

**Which agents and checks this governs:**

- **design-lead** — owns the **state-coverage lens** (are empty / loading / error / success states designed, not just the happy screen?) and the **start-path-fit lens** (does the screen work *cold* — first-time, empty — as well as *warm*?). Pairs with `clear-iconography`: state communicated with a consistent, legible vocabulary: no ambiguous loading indicators and no glitchy transitions.
- **conversion-lead** — feedback on the CTA (loading on submit, success confirmation) is part of not losing the conversion at the moment of action; a form that silently swallows a submit is a leak.
- **design-quality gauntlet** — feeds **`component-usage`** (library primitives expose their full state set per intended variant) and **`visual-hierarchy`** (status/feedback is surfaced where the eye is).
- **visual-review** — feeds **`console-error`** (errors that break render), **`regression`** (state-transition flicker / FOUC / layout shift), and **`color`** (state colors — paired with the never-color-alone rule).

---

## 2. Core principles & techniques

### 2.1 The response-time bands (when to give which feedback)

Feedback is calibrated to *latency*. The canonical thresholds:

- **< 0.1s** — feels instantaneous. No special feedback needed beyond showing the result.
- **~ 1.0s** — the limit for the user's flow of thought to stay uninterrupted. If a response will take longer, give feedback.
- **> ~10s** — the limit for keeping attention on the task. Use a **percent-done / progress indicator** for operations this long.
- **The Doherty Threshold: < 400ms** — productivity and engagement soar when the system responds inside ~400ms; treat 400ms as the "feels responsive" target.

**Practical mapping:**

| Latency | Feedback |
|---|---|
| < 100ms | none needed (just show the result) |
| 100ms – 1s | subtle inline cue (button pressed/active, micro-transition); **avoid a spinner** — a flashed spinner makes a fast action feel *slower* |
| 1s – 10s | explicit loading: spinner for indeterminate short, **skeleton** for content layout |
| > 10s | progress / percent-done; ideally background it and let the user continue |

### 2.2 The full state set (no undesigned states)

Every interactive component and every data-bearing screen must cover its states:

**Interactive states (per control):** default, **hover**, **focus** (visible ring), **active/pressed**, **disabled**. A control with no visible reaction to interaction is a *silent action*.

**Async / data states (per screen or data region):**
- **Loading** — shown while fetching; skeleton (preserves layout, best perceived performance) or spinner/progress per the latency band.
- **Empty** — when there's no data: not a blank screen, but guidance ("nothing here yet" + the next action). The empty state is a *designed* screen, often a first-time user's first impression.
- **Error** — when the operation fails: a styled error with what went wrong + how to recover (problem + fix), color **+ icon + text** (never color alone).
- **Success** — confirm the action landed (a confirmation, a state change, a toast for transient success).

### 2.3 Microinteractions — the trigger→feedback contract

A microinteraction (Saffer's model) is **trigger → rules → feedback → loops/modes**: a trigger (user action or system state change) produces a small, contextual, usually-visual feedback. The teachable invariant:

> **Every trigger has a feedback. No silent actions.** A click, a toggle, a submit, a drag — each produces an immediate, visible acknowledgment within the response-time band, then resolves to its end state.

### 2.4 Status for assistive technology

Visible feedback isn't enough — async status must reach screen-reader users via **live regions**:

- **`role="status"`** (implicit `aria-live="polite"`) — advisory updates that aren't urgent ("Saved," "3 results"). Announced when the user is idle.
- **`role="alert"`** (implicit `aria-live="assertive"`) — errors and important, time-sensitive messages; interrupts to announce.

A loading→loaded or submit→error transition that updates only pixels (no live-region text) is invisible to a screen reader. Pair the visual cue with the appropriate live region.

### 2.5 Disabled, optimistic, and motion

- **Disabled** must be signified by more than color — reduced opacity **and** `disabled`/`aria-disabled` **and** a non-interactive cursor — and must still be perceivable. A disabled control that looks enabled invites dead clicks; an enabled control that looks disabled is abandoned.
- **Optimistic UI** — for high-likelihood-success actions, assume success and reconcile on the response (instant feedback) rather than blocking on a spinner. Roll back visibly on failure.
- **Motion-based feedback** must honor `prefers-reduced-motion` with a reduced/none variant — feedback must not depend solely on animation a user has opted out of.

### 2.6 No console errors, no flicker

Two failure classes that are pure feedback/regression issues:

- **Console errors that break render** (hydration mismatch, missing prop, failed fetch) produce partial or broken UI — a feedback failure the user experiences as "it didn't load."
- **State-transition flicker / FOUC / layout shift** — content flashing or jumping between states reads as jank and instability; transitions should be smooth and reserve space (no layout shift on load-in).

---

## 3. Concrete examples (build terms — Next/Tailwind/Radix/shadcn substrate)

**Do — full async state coverage with feedback + a11y:**
```tsx
function SaveButton() {
  const [state, setState] = useState<'idle'|'saving'|'saved'|'error'>('idle');
  return (
    <>
      <Button disabled={state==='saving'} onClick={save}>
        {state==='saving' ? <><Spinner aria-hidden/> Saving…</> : 'Save'}
      </Button>
      {state==='saved' && <p role="status" className="flex gap-1 items-center text-success"><CheckIcon aria-hidden/> Saved</p>}
      {state==='error' && <p role="alert" className="flex gap-1 items-center text-destructive"><AlertIcon aria-hidden/> Couldn’t save — try again</p>}
    </>
  );
}
```
Every trigger → feedback; loading disables to prevent double-submit; success/error each carry icon + text + live region.

**Don't — silent action / undesigned states:**
```tsx
<button onClick={save}>Save</button>   // no pressed/loading/disabled state; click → nothing visible → user re-clicks
```

**Do — designed empty + loading state for a list:**
```tsx
if (loading) return <SkeletonList rows={5} />;            // skeleton preserves layout
if (items.length === 0) return (
  <EmptyState icon={<InboxIcon/>} title="No projects yet" action={<Button>Create one</Button>} />
);
return <List items={items} />;
```

**Don't — blank screen on empty / frozen on load:**
```tsx
return <List items={items} />;   // empty → blank container (looks broken); loading → nothing (looks frozen)
```

**Do — visible focus:** rely on `:focus-visible` ring tokens on all interactive primitives (Radix/shadcn provide these) so keyboard users can see where they are.

**Don't — `outline: none` with no replacement** — invisible focus; keyboard users are lost (also an a11y failure).

---

## 4. Common failure modes

| Failure | How it reads to the user | How to detect |
|---|---|---|
| Silent action (no feedback on interaction) | "Did it work?" → re-click → double-submit | Interact with control; observe zero DOM/visual/route delta |
| Missing loading state on async | UI appears frozen / broken | Trigger async path; no loading node appears before result |
| Missing empty state | Blank container; looks broken | Zero-data region with no empty-state element/guidance |
| Absent / unstyled error state | Failure silently swallowed or raw | Force error path; no styled error surfaced |
| No visible focus ring | Keyboard users can't tell where they are | Tab through; no `:focus-visible` outline |
| Color-only state | Ambiguous for color-blind / grayscale | State differentiator is hue only (no icon/text) |
| Disabled looks enabled (or vice versa) | Dead clicks / abandoned live control | Disabled element full-opacity + interactive cursor |
| Console error breaks render | "It didn't load" / partial UI | Browser console error count > 0 on the path |
| State-transition flicker / FOUC / layout shift | Jank, instability | Visible flash or measurable CLS on transition |
| Over-feedback (toast/spinner spam) | Noise; spinner on fast action feels slower | Spinner on < 400ms action; many simultaneous toasts |

---

## 5. ✅ Agent-applicable RULES (the payoff)

PASS/FAIL rules the **design-quality** / **visual-review** gauntlet can mechanically apply. Severity convention: `critical` = breaks the page / makes the primary task unusable; `high` = a gate failure; `medium`/`low` = degraded/cosmetic. **Any `critical` or `high` finding = FAIL.**

| # | Rule (assertion) | Axis / Category | Detection (observed vs expected) | Severity if violated |
|---|---|---|---|---|
| F1 | **No silent actions.** Every interactive trigger produces visible feedback (pressed/loading/route/content change) within the response-time band. | component-usage / regression | Interact with control; no DOM/visual/route delta. Observed: click CTA → nothing; Expected: pressed/loading/result. | high (critical for primary action / submit) |
| F2 | **Async shows a loading state.** Operations > ~1s show loading (skeleton/spinner/progress) before the result. | component-usage / regression | Trigger async; no loading node before result. Observed: frozen UI for 3s; Expected: skeleton/spinner. | high |
| F3 | **Empty state is designed.** Zero-data regions render a guidance empty state, not a blank container. | component-usage / layout | Data region with 0 items and no empty-state element. Observed: blank `<div>`; Expected: empty-state with next action. | high |
| F4 | **Error state is present and styled.** Failure paths surface a styled error (problem + recovery), color + icon + text. | component-usage / color | Force error; no styled error, or color-only. Observed: silent failure / red text only; Expected: icon + message + role=alert. | high (critical if action lost silently) |
| F5 | **Success is confirmed.** Successful actions give explicit confirmation (state change / confirmation / toast). | component-usage | Submit succeeds with no acknowledgment. Observed: nothing changes; Expected: visible success cue. | medium–high |
| F6 | **Visible focus on all interactive elements.** A `:focus-visible` indicator is present (≥3:1 vs adjacent). | accessibility / a11y | Tab through; no focus ring, or `outline:none` with no replacement. Observed: invisible focus; Expected: visible ring. | high |
| F7 | **State not by color alone.** Error/success/selected/disabled states carry a non-color signifier (icon/text/shape/weight) in addition to color. | accessibility / color | State differentiated by hue only. Observed: green text, no icon/text; Expected: color + non-color cue. | high |
| F8 | **Disabled is honest and perceivable.** Disabled controls are visibly non-interactive (opacity + `disabled`/`aria-disabled` + cursor) and not mistakable for enabled. | component-usage / a11y | Disabled element full-opacity/interactive cursor, or enabled control styled as disabled. Observed: dead-looking live button; Expected: clear disabled affordance. | medium–high |
| F9 | **No console errors that break render.** The reviewed path produces no JS console errors. | console-error | `browser_console_messages` shows error-level entries. Observed: hydration mismatch error; Expected: clean console. | high (critical if render broken) |
| F10 | **No state-transition flicker / layout shift.** Transitions between states are smooth; no FOUC, no content jump (reserve space). | regression / layout | Visible flash or measurable layout shift on state change/load-in. Observed: content jumps on hydrate; Expected: stable. | medium–high |
| F11 | **Async status reaches assistive tech.** Loading/success/error transitions announce via `role="status"` (polite) or `role="alert"` (assertive). | accessibility / a11y | Status updates pixels only, no live region. Observed: no aria-live on async result; Expected: status/alert region. | medium–high |
| F12 | **Feedback is calibrated, not noisy.** No spinner on sub-400ms actions; no toast/notification spam. | component-usage / regression | Spinner flashes on a fast action, or many simultaneous toasts. Observed: spinner on 120ms action; Expected: subtle inline / none. | low–medium |

> **Hedging note (contrarian-grounded):** more feedback is not always better. A spinner on a < 400ms action makes it feel *slower*; over-notification becomes noise. Calibrate to latency (F12) and prefer **optimistic UI** / **skeletons** over blocking spinners where success is likely. And feedback that relies on motion must have a `prefers-reduced-motion` variant — don't fail an interface for "missing animation" when a reduced-motion static cue is the correct choice.

---

## 6. Sources (provenance / evidence only)

- Nielsen Norman Group — 10 Usability Heuristics (Visibility of System Status). https://www.nngroup.com/articles/ten-usability-heuristics/
- Nielsen Norman Group — Response Time Limits (0.1s / 1s / 10s). https://www.nngroup.com/articles/response-times-3-important-limits/
- Nielsen Norman Group — Microinteractions in User Experience. https://www.nngroup.com/articles/microinteractions/
- Laws of UX — Doherty Threshold (< 400ms). https://lawsofux.com/doherty-threshold/
- MDN — ARIA: status role (live region, polite). https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/status_role
- MDN — ARIA: alert role (live region, assertive). https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/alert_role
- W3C WAI — ARIA22: Using role=status to present status messages. https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22.html
