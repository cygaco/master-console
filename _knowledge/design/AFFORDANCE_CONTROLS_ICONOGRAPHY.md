---
guide: AFFORDANCE_CONTROLS_ICONOGRAPHY
anchor: none
shape: walkthrough
timing: reference
lead_time: "none"
tier: standard
trains: [design-lead, design-quality, visual-review]
maps_to: [component-usage, accessibility, mobile-responsive, a11y, layout]
sources:
  - "https://ixdf.org/literature/topics/signifiers"
  - "https://lawsofux.com/laws/fittss-law/"
  - "https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html"
  - "https://www.nngroup.com/articles/ten-usability-heuristics/"
  - "https://www.nngroup.com/articles/icon-usability/"
  - "https://refactoringui.com/"
---

# Affordance, Controls & Iconography

**Affordance & signifiers** is the practice of making interactive elements *look* interactive (and non-interactive ones look inert), making targets easy and safe to hit (Fitts's Law, tap-target size), making iconography read unambiguously (label over clever), and giving users control to prevent and recover from errors (constraints, undo, exit).

## Why it matters

A control the user can't *recognize* as a control might as well not exist; a target they can't reliably hit is a control that fights them; an icon they have to guess at is a riddle. These are not polish issues — they are the difference between a usable and an unusable interface, and they fall heaviest on exactly the cohorts the design-lead is sworn to serve (older users, low-literacy users, motor-impaired users, one-handed/situational users — `build-for-audience-incl-limitations`).

Don Norman's framing is the spine here: an **affordance** is what an object *can do* (a button can be pressed); a **signifier** is the perceptible cue that *tells the user* it can (the button's fill, border, shadow, hover state). Flat design's great regression was stripping signifiers — making clickable things indistinguishable from text — so this guide is partly a corrective: signal interactivity, don't hide it.

For the MC designer agents:

- **design-lead** explicitly owns **`clear-iconography`**: "an icon that needs a caption to be understood has failed; prefer a labeled icon to a clever-but-opaque one." This guide is the deep version of that owned principle, plus the affordance and target-size craft that makes controls usable for the real cohort.
- **design-quality** judges `component-usage` (controls are the right interactive primitive, with real affordance and state), `accessibility` (accessible names, focus, target size), and `mobile-responsive` (tap targets hold at mobile). A control with no hover/focus signifier, or a 16px icon-button tap target, is a finding.
- **visual-review** judges `a11y` (target size, accessible names, focus visibility) and `layout` (controls reachable, not crammed). It catches the icon-only button with no label/tooltip and the mystery-meat nav.

## Core principles / techniques

### 1. Signal interactivity — affordance via signifiers

Every interactive element must carry a perceptible signal that it's interactive, and the *same* role must carry the *same* signal everywhere (similarity, from `GESTALT_GROUPING`).

- **Buttons look pressable.** Fill, contrast, padding, a subtle shadow, a clear shape — something that distinguishes the button from surrounding text. A "button" that's just colored text with no boundary is under-signified.
- **Links look like links.** Distinct from body text (color and/or underline) and consistently so. Crucially, **don't signal interactivity where there is none**: body text styled like a link, or a non-interactive card with a hover lift, makes false promises (this is the false-affordance failure).
- **Interactive states are part of the signifier.** A control needs a `:hover` change (cursor + visual), an `:active`/pressed state, a `:focus-visible` ring, and a `disabled` look — the full vocabulary that says "you can act here, here's what's happening, here's why you can't." Missing states make a control feel dead or broken. (State *behavior* lives in `INTERACTION_FEEDBACK_STATES`; the *signifier* lives here.)
- **Don't rely on hover alone.** Hover doesn't exist on touch and isn't discoverable; an affordance that's *only* revealed on hover is invisible to touch users and to anyone who doesn't happen to mouse over it. The signifier must be present at rest.

### 2. Targets: Fitts's Law and tap-target size

**Fitts's Law:** the time to acquire a target is a function of its *distance* and *size* — bigger and closer targets are faster and more reliable to hit. This is not preference; it's motor reality, and it's amplified for users with tremor, limited dexterity, or thumbs on a phone.

- **Minimum target size.** WCAG 2.2 SC 2.5.8 sets a floor of **24×24 CSS px** (with a spacing exception: an undersized target passes if a 24px-diameter circle centered on it doesn't intersect other targets). The *enhanced* SC 2.5.5 and the long-standing platform guidance set **44×44 CSS px** as the practical, comfortable touch target. **Design to 44×44 for primary touch controls; never go below the 24×24 floor.**
- **Hit area ≥ visual area.** A 16px icon can still be a 44px target by giving its button generous padding — the *clickable* region is what matters, not the glyph. Tiny visual icon, big invisible tap zone.
- **Spacing between targets.** Adjacent targets need enough gap that the user doesn't mis-tap a neighbor — the WCAG spacing exception formalizes this, and Fitts implies it: crowded controls are error generators.
- **Exploit edges and corners (Fitts at screen scale).** Screen edges/corners are "infinitely deep" targets (the pointer stops there), and on mobile the thumb arc favors the bottom and the reachable side. Place frequent/important controls where they're easy to reach; don't bury the primary action in a hard-to-hit corner of the thumb zone.

### 3. Iconography: clarity over cleverness

Icons are a compression of meaning — efficient when universal, a guessing game when not.

- **Label the icon** unless it is genuinely universal (a tiny set: close ✕, search 🔍, the platform's back/menu, play/pause). NN/g's finding is blunt: most icons are ambiguous without a text label, and "universally recognized icons are rare." A text label removes the ambiguity; an icon-plus-label is the safest default.
- **If icon-only is unavoidable** (space-constrained toolbar), it MUST have an accessible name (`aria-label`) *and* a visible tooltip on hover/focus — never a bare glyph. An icon-only button with no accessible name is invisible to screen readers and ambiguous to everyone.
- **Use conventional icons conventionally.** A magnifying glass means search, a trash can means delete, a gear means settings. Repurposing a conventional icon for a different action is a clarity bug (the `clear-iconography` violation). Don't invent a clever icon for a common action.
- **Consistent icon system.** One style (outline vs. filled), one weight, one grid size, consistent metaphor for the same action everywhere. Mixed icon styles read as inconsistency.
- **Icon ≠ the only signal for critical actions.** Don't encode meaning in icon *alone* where getting it wrong is costly (color + icon + label for destructive actions; never color-alone — cross-ref `COLOR_AND_CONTRAST`).

### 4. Error prevention via constraints (better than error messages)

The best error message is the one never needed. Norman's constraints prevent invalid actions before they happen.

- **Disable/hide what doesn't apply.** A submit button that stays disabled until required fields are valid prevents a failed submission with no error message at all. Greying out inapplicable options narrows the choice space safely.
- **Constrain the input.** Date pickers instead of free-text dates; numeric keypads for numeric fields; format masks; min/max — make the wrong input *impossible* rather than *caught*. (Mobile: set the right `inputmode`/`type` so the right keyboard appears.)
- **Confirm destructive/irreversible actions.** Norman's "forcing function": a delete/irreversible action needs a deliberate confirmation step so it can't happen by a single mis-tap. But pair this with the next point — confirmation is friction; undo is often better.
- **Caveat: a disabled button must say *why*.** A perpetually-disabled control with no hint is its own usability failure — the user can't tell what unlocks it. Provide an inline reason or validation hint.

### 5. User control & freedom — undo, exit, recovery

Users make mistakes and change their minds; the interface must give them a way out (NN/g heuristic #3).

- **Undo over confirm where possible.** A reversible action with a prominent "Undo" (the snackbar pattern) is lower-friction and more forgiving than a confirm dialog on every action — the user acts fast, and recovers if wrong.
- **Always offer an exit.** Modals, multi-step flows, and "wizards" need a clear, ever-present way to cancel/close/go back — a marked exit, not a trap (the "roach motel" anti-pattern; see `ETHICS_NO_DARK_PATTERNS`). Esc closes dialogs; the back affordance is always reachable.
- **Make the close target findable and hittable.** A modal close (✕) must be a real 44px target in a conventional spot (top-right), with an accessible name — not a 12px glyph the user has to chase.

## Concrete examples (build terms — Next/Tailwind/Radix/shadcn substrate)

**Affordance / signifiers + states**
- ❌ DON'T: a "button" rendered as `<div className="text-primary cursor-default">Continue</div>` — no boundary, no hover, no focus ring, no keyboard, no role.
- ✅ DO: a shadcn `<Button>` (real `<button>`, fill/contrast, `:hover` change, `focus-visible:ring`, `:disabled` style, `:active`); links as `<a>`/`<Link>` visibly distinct from body text. Non-interactive cards do NOT get a hover lift.

**Tap-target size**
- ❌ DON'T: `<button className="h-4 w-4"><XIcon className="h-4 w-4"/></button>` — a 16px target, well under the floor, brutal on touch.
- ✅ DO: a 16–20px glyph inside a padded button (`h-10 w-10` / `p-2.5`, min `min-h-11 min-w-11` for primary touch) so the *hit area* is ≥44px even when the icon is small; adjacent icon buttons get `gap-1`+ so circles don't intersect (WCAG spacing).

**Icon clarity**
- ❌ DON'T: an icon-only toolbar of bespoke glyphs with no labels/tooltips/`aria-label`; a "gear" used for *share*.
- ✅ DO: icon + visible text label for non-trivial actions; where space forces icon-only, add `aria-label="Delete"` *and* a Radix `Tooltip`; use conventional metaphors (trash=delete, gear=settings) consistently from one icon set (e.g., one Lucide weight/style throughout).

**Error prevention via constraints**
- ❌ DON'T: an always-enabled Submit that posts, fails server-side, and returns a generic error.
- ✅ DO: `<Button disabled={!isValid}>` with the disabled reason shown inline ("Enter a valid email to continue"); `type="email"` / `inputMode="numeric"` to summon the right keyboard and constrain input; a confirm dialog (or better, an undo snackbar) for destructive actions.

**User control / exit**
- ❌ DON'T: a Radix `Dialog` with no close button and `onEscapeKeyDown` disabled (a trap).
- ✅ DO: a `DialogClose` ✕ as a real 44px target top-right with `aria-label="Close"`, `Esc`-to-close left enabled, and a destructive action that fires immediately with a "Deleted — Undo" snackbar (`toast` with an action) instead of a blocking confirm where reversibility allows.

## Common failure modes

- **Under-signified controls.** Clickable things that look like text/inert content; no hover/focus/active/disabled states. Reads as "dead" or "is this even a button?" *Detect:* interactive element with no `:hover`/`:focus-visible` style change and no button affordance (fill/border/shadow).
- **False affordances.** Non-interactive elements that look clickable (link-styled text that isn't a link, cards with hover lifts that do nothing). Users click and nothing happens — eroded trust. *Detect:* hover/cursor:pointer/link styling on an element with no handler/href/role.
- **Sub-floor tap targets.** Controls under 24×24 (let alone 44×44), or crammed adjacent targets. Mis-taps, especially on touch and for motor-impaired users. *Detect:* compute control bounding box; flag < 24px any dimension, or < 44px for primary touch controls; check inter-target spacing.
- **Mystery-meat / ambiguous icons.** Icon-only controls with no label, no tooltip, no accessible name; non-conventional or repurposed icons. Users guess and get it wrong. *Detect:* `<button>` whose only content is an icon, with no `aria-label`/`title`/visible label/tooltip; an icon whose metaphor doesn't match its action.
- **Hover-only affordance.** Action revealed only on mouse hover. Invisible on touch, undiscoverable. *Detect:* control or affordance with `opacity:0` at rest revealed on `:hover` with no touch-equivalent.
- **No-reason disabled control.** A disabled button with no hint why or what unlocks it. User stuck. *Detect:* `disabled` control with no associated explanatory text/validation message.
- **No exit / trap.** Modal or flow with no visible close/cancel/back, Esc disabled. *Detect:* dialog/flow without a reachable, labeled close/cancel affordance.
- **Inconsistent icon system.** Mixed outline/filled, mixed weights/sizes, same action different icon across screens. *Detect:* compare icon style/size/metaphor for the same action across surfaces.

## ✅ Agent-applicable RULES (the payoff)

| # | Rule (PASS condition) | Maps to | How to detect a violation | Severity if violated |
|---|---|---|---|---|
| A1 | **Interactive elements are signified.** Every interactive control has a resting affordance (button: fill/border/shadow; link: distinct from body text) AND visible `:hover` + `:focus-visible` + `disabled` states. | design-quality `component-usage`, `accessibility`; visual-review `layout`, `a11y` | Inspect computed styles across states; check for focus ring on Tab. Observed: control identical to inert text / no focus ring. Expected: resting affordance + full state set. | high |
| A2 | **No false affordances.** Non-interactive elements do not carry interactive signifiers (link styling, `cursor:pointer`, hover lift) without an actual action/href/role. | design-quality `component-usage`; visual-review `layout` | Find hover/pointer/link styling on elements lacking handler/href/`role`. Observed: dead "clickable." Expected: signifiers only on real controls. | medium |
| A3 | **Tap targets meet the floor.** Every interactive target is ≥24×24 CSS px (WCAG 2.5.8 floor); primary/touch controls are ≥44×44; adjacent targets are spaced so 24px circles don't intersect. | design-quality `accessibility`, `mobile-responsive`; visual-review `a11y`, `layout` | `getBoundingClientRect()` per control at mobile viewport; flag < 24px any side, < 44px for primary touch; measure inter-target gaps. Observed: 16px icon button. Expected: ≥44px hit area. | critical (mobile primary) / high |
| A4 | **Icon-only controls have an accessible name + tooltip.** Any control whose visible content is only an icon carries an `aria-label`/accessible name AND a visible tooltip on hover/focus. | design-quality `accessibility`, `component-usage`; visual-review `a11y` | a11y-tree name check + presence of `title`/tooltip. Observed: bare icon button, no name. Expected: accessible name + tooltip. | high |
| A5 | **Icons are conventional & consistent.** Common actions use their conventional metaphor (trash=delete, gear=settings, magnifier=search); icon style/weight/size is consistent across the app; no repurposed conventional icon. | design-quality `component-usage`; visual-review `layout` | Compare icon metaphor to action and icon style across screens. Observed: gear used for share / mixed icon styles. Expected: conventional + consistent. | medium |
| A6 | **Meaning isn't icon-/color-only for critical actions.** Destructive or critical actions are conveyed by label (and/or color) in addition to icon; never icon-alone or color-alone. | design-quality `accessibility`, `component-usage`; visual-review `a11y`, `copy` | Check destructive controls for a text label + non-color signal. Observed: bare red trash icon as the only signal. Expected: icon + label (+ color). | high |
| A7 | **Error prevention via constraints.** Inputs constrain to valid values (right `type`/`inputmode`, pickers/masks, min/max); submit is gated on validity; destructive actions require confirmation OR offer undo. | design-quality `component-usage`, `accessibility`; visual-review `a11y`, `copy` | Inspect input types/inputmode, submit-disabled-on-invalid, destructive-action guard. Observed: free-text where constrained input fits / ungated destructive action. Expected: constrained + guarded. | medium |
| A8 | **Disabled controls explain themselves.** Any disabled control has an associated reason/hint (what unlocks it); no perpetually-disabled control with no explanation. | design-quality `accessibility`; visual-review `copy`, `a11y` | Find `disabled` controls; check for adjacent explanatory text/validation. Observed: dead disabled button, no hint. Expected: visible reason. | medium |
| A9 | **Always an exit.** Every modal/dialog/flow has a reachable, labeled close/cancel/back affordance; Esc closes dialogs; no trap. | design-quality `accessibility`, `component-usage`; visual-review `a11y`, `layout` | Check dialog for labeled close target + Esc behavior; check flows for back/cancel. Observed: no close / Esc disabled. Expected: clear marked exit. | high |

**Verdict guidance:** A3 (sub-44px primary touch target), A4 (icon-only with no accessible name), A6, or A9 at `critical`/`high` is a FAIL (the control is unusable, inaccessible, or trapping). A1 missing focus ring is an `accessibility`/`a11y` FAIL. A2/A5/A7/A8 at `low`/`medium` are fixes unless they compound.

## Sources

- Interaction Design Foundation — *Signifiers* (Norman: affordance vs. signifier): https://ixdf.org/literature/topics/signifiers
- Laws of UX — *Fitts's Law*: https://lawsofux.com/laws/fittss-law/
- W3C — *Understanding SC 2.5.8 Target Size (Minimum)* (24×24 floor, spacing exception) + 2.5.5 enhanced (44×44): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- Nielsen Norman Group — *10 Usability Heuristics* (#3 user control & freedom, #5 error prevention): https://www.nngroup.com/articles/ten-usability-heuristics/
- Nielsen Norman Group — *Icon Usability* (label icons; few are universal): https://www.nngroup.com/articles/icon-usability/
- Refactoring UI (Wathan & Schoger) — signaling interactivity, states: https://refactoringui.com/
