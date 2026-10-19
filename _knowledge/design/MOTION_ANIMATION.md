---
guide: MOTION_ANIMATION
anchor: none
shape: walkthrough
timing: reference
lead_time: "none"
tier: standard
trains: [design-lead, design-quality, visual-review]
maps_to: [accessibility, mobile-responsive, regression, a11y]
sources:
  - "https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html"
  - "https://www.w3.org/WAI/WCAG21/Techniques/css/C39"
  - "https://www.w3.org/WAI/WCAG21/Techniques/client-side-script/SCR40"
  - "https://www.nngroup.com/articles/animation-duration/"
  - "https://m3.material.io/styles/motion/easing-and-duration"
  - "https://m1.material.io/motion/duration-easing.html"
  - "https://web.dev/articles/vitals"
  - "https://lawsofux.com/doherty-threshold/"
---

# Motion & Animation

**Motion is information, not decoration.** Purposeful animation orients the user (where did this come from, where did it go), maintains continuity across state changes, and confirms that an action registered — while staying short, smooth, interruptible, and fully removable for users who request reduced motion.

## Why it matters

For the **user**, motion answers questions the static frame cannot: *Did my tap do anything? Where did this panel come from? Is the system working or stuck?* Good motion makes an interface feel responsive and direct; bad motion makes it feel slow, jittery, or — for a user with a vestibular disorder — physically sick. Excessive or non-removable motion is an accessibility failure that can cause dizziness, nausea, headaches, and migraines (WCAG SC 2.3.3, vestibular-disorder population).

For the **designer agents**, motion is a cross-cutting concern with two checkable faces:

- **`design-lead`** owns the *purpose* of motion — does each animation earn its place (orientation/continuity/feedback) or is it gratuitous, and does the build honor `prefers-reduced-motion`.
- **`design-quality`** judges it on the **`accessibility`** axis (reduced-motion respected, no motion-only signifier) and the **`mobile-responsive`** axis (animation that's smooth on desktop but janks/overflows on a mid-tier phone is a mobile defect).
- **`visual-review`** catches it on the **`regression`** category (FOUC, content flash, transition flicker, layout shift during animation) and the **`a11y`** category (motion that ignores the user's reduced-motion setting).

Motion sits at the seam of *feel* and *floor*: it can lift an experience, but the floor — reduced-motion support, no flicker, no layout shift, no seizure risk — is non-negotiable and mechanically checkable.

## Core principles & techniques

### 1. Every animation must have a job

Before adding motion, name its purpose. There are three legitimate jobs and one illegitimate one:

- **Orientation** — show spatial/causal relationships. A menu that *slides down from the button that opened it* tells the user where it came from and where it will return; the same menu appearing instantly (or fading in over the whole screen) loses that relationship.
- **Continuity** — preserve the user's mental model across a state change. When a list item expands into a detail view, animating the transition (the card growing into the panel) keeps "this is the same object" intact; a hard cut forces the user to re-orient.
- **Feedback** — confirm an action registered. A button that depresses, a toggle that slides, a checkbox that fills — these are micro-interactions: a *trigger* (the user acts) and a *feedback* response (the UI acknowledges) in one short bit of motion.
- **Decoration (illegitimate)** — motion with no informational job: a hero headline that swoops in letter-by-letter, an icon that perpetually pulses, parallax for "delight." Decorative motion adds cognitive load, delays content, risks jank, and is the first thing to fail reduced-motion review. **If you can't name the job, remove the motion.**

### 2. Duration: short, and scaled to the change

Human perception sets the budget. NN/g's synthesis of the research:

- **~100 ms** — the threshold where motion becomes *perceptible* yet still feels *immediate*. Use for simple feedback: checkboxes, toggles, hover/press states. The user perceives direct manipulation.
- **200–300 ms** — substantial on-screen changes: a modal opening, a panel sliding in, a card expanding.
- **up to ~400 ms** — large movements that cross a big area of the screen.
- **> 500 ms** — too long; "starts to feel like a real drag." NN/g's blunt finding: *it is far more common for animations to be too long than too short.*

Two refinements from Material's motion system:

- **Scale duration to distance and area.** Small movements over a small area get short durations; transitions that traverse large areas get longer ones — so the *perceived velocity* stays consistent. A constant duration makes small things feel sluggish and big things feel frantic.
- **Exits are faster than entrances.** Transitions that dismiss/collapse/exit use *shorter* durations (they need less of the user's attention — they're getting out of the way). Transitions that enter or persist use *longer* durations to draw attention to what's new.

### 3. Easing: never linear

Real objects accelerate and decelerate; linear motion (constant velocity) reads as mechanical and robotic. Use easing curves:

- **ease-out** (decelerate) — starts fast, slows to rest. The default for elements *entering* the screen or responding to a user action: the fast start makes the UI feel responsive, the soft landing feels natural. This is the most-recommended curve for UI.
- **ease-in** (accelerate) — starts slow, speeds up as it leaves. For elements *exiting* the screen — they accelerate away and don't need to decelerate because they're gone.
- **ease-in-out** (standard) — slow-fast-slow. For elements *moving between two on-screen positions* (a reorder, a tab indicator sliding).

In the Tailwind/CSS substrate: `transition-* duration-200 ease-out` for entrances; reserve `ease-in` for exits; never ship `ease-linear` for organic UI motion (it's acceptable only for true loops like a constant-speed spinner).

### 4. Honor `prefers-reduced-motion` — the accessibility floor

The OS-level "reduce motion" setting is exposed to the web as the `prefers-reduced-motion` media query. **Respecting it is not optional** and is the single most important checkable rule in this guide (WCAG SC 2.3.3, technique C39 for CSS / SCR40 for JS).

- **CSS animations/transitions:** wrap non-essential motion so it is reduced or removed when the user opts out.

  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
  ```

  Prefer a *targeted* version over the global sledgehammer when you can — but a project that ships **no** reduced-motion handling at all is an automatic accessibility failure.

- **JS-driven animation:** gate it on the query so motion libraries don't override the user's choice.

  ```js
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) startParallax();
  // also listen for changes: mql.addEventListener('change', ...)
  ```

- **Reduce ≠ delete the meaning.** When you remove motion, keep the *information* the motion carried. A success animation becomes a static success state with a checkmark + color + text; a slide-in becomes an instant (or cross-fade) appearance. The user still learns what happened — they just don't get the movement. (Opacity/cross-fades are generally vestibular-safe; large positional movement, zoom, and parallax are the risky kinds.)

- **Essential motion is exempt** — animation genuinely required to convey information (e.g. a loading indicator that *is* the status, an animation that's the content itself) may remain, per SC 2.3.3's "essential" carve-out. But "we think it looks nice" is never essential.

### 5. Don't trigger seizures or vestibular reactions

- **No flashing > 3 times per second** (WCAG SC 2.3.1, seizure floor). Strobing, rapid flashing, and high-contrast flicker can induce seizures.
- **Parallax, large zooms, auto-playing background motion, and "page-turn" effects** are the classic vestibular triggers — scrolling that makes elements move at different rates than the scroll itself. Make all of these opt-out via reduced-motion, and prefer not to ship them at all in core flows.

### 6. Motion must not break the frame (no flicker, no layout shift)

This is where motion collides with performance and becomes a `regression`/`console-error` problem:

- **No FOUC / content flash.** Content must not appear, then jump to its styled/animated position. Set the starting state in CSS (e.g. `opacity-0` as the initial class) so the element is never visible in its un-animated state, then transition to the end state. A flash of unstyled or pre-animation content reads as a broken render.
- **No layout shift from animation.** Animate only **compositor-friendly** properties — `transform` (translate/scale/rotate) and `opacity`. Animating `width`, `height`, `top`, `left`, or `margin` forces layout recalculation, janks on mobile, and contributes to **Cumulative Layout Shift (CLS — good ≤ 0.1)**. A panel that animates `height` and shoves the page content down each frame is both a jank source and a CLS hit.
- **Reserve space for animated-in content.** If content animates in after load (e.g. a deferred card), reserve its box so surrounding content doesn't reflow when it lands.
- **Respect the response budget.** The Doherty Threshold says interaction feedback under **~400 ms** keeps the user engaged; an entrance animation that *delays* the user's access to content (a 1.2s hero reveal before the CTA is usable) trades feel for friction. Motion should never gate the user's task behind a timeline.

### Trade-offs

- **Feel vs. speed:** more/longer motion feels richer but slows perceived task completion. Default short; lengthen only with a named reason.
- **Delight vs. inclusion:** signature decorative motion can be a brand asset — but only if it's fully removable under reduced-motion *and* never the sole carrier of meaning.
- **Continuity vs. cost:** shared-element transitions are powerful for continuity but expensive to build correctly; a clean cross-fade often buys 80% of the benefit at 20% of the risk.

## Concrete examples (build terms)

**DO — purposeful, scaled, eased, reduced-motion-safe**

```tsx
// Modal entrance: 200ms, ease-out, transform+opacity only, initial state in class
// so there is no flash of the un-animated state.
<div className="opacity-0 scale-95 data-[open]:opacity-100 data-[open]:scale-100
                transition duration-200 ease-out
                motion-reduce:transition-none motion-reduce:scale-100" />
```
Tailwind's `motion-reduce:` variant maps to `@media (prefers-reduced-motion: reduce)` — use it (or the global CSS block) on every non-essential animation. Radix/shadcn primitives expose `data-[state=open]`/`data-[state=closed]` hooks designed exactly for this entrance/exit pattern.

**DON'T — decorative, long, layout-thrashing, no opt-out**

```tsx
// Hero headline letters fly in over 1.5s, animating `margin-left`, no reduced-motion guard.
<h1 className="animate-[fly_1500ms_linear]" />   // ✗ linear, ✗ >500ms, ✗ animates layout,
                                                 // ✗ delays content, ✗ ignores reduced-motion
```
This janks on mobile (layout-property animation), delays the value prop, reads as a drag (1.5s linear), and makes a reduced-motion user wait through motion they asked to disable.

**DO — feedback that survives reduced motion**

```tsx
// Toggle: animated knob slide (100ms) for motion users; under reduced-motion the knob
// still moves to the ON position instantly AND the track color + aria-checked convey state.
// State is never carried by the animation alone.
```

**DON'T — meaning carried only by motion**

```tsx
// "Saved!" is communicated ONLY by a fade-pulse that's suppressed under reduced-motion,
// leaving reduced-motion users with no confirmation at all.  ✗ a11y failure
```

## Common failure modes

| Failure | How it reads to the user | How to detect |
|---|---|---|
| No `prefers-reduced-motion` handling anywhere | Vestibular users get dizzy/nauseous; the OS setting is silently ignored | Grep CSS/components for `prefers-reduced-motion` / `motion-reduce:`; toggle OS "reduce motion" and re-render — motion still plays = FAIL |
| Animations too long (>500 ms) on common interactions | UI feels sluggish, "a drag" | Read declared durations; anything >500 ms on a routine transition is suspect |
| Linear easing on organic motion | Mechanical, robotic, cheap | Look for `ease-linear`/`linear` on non-loop transitions |
| Animating `width/height/top/left/margin` | Jank, stutter on mobile; page content jumps (CLS) | Inspect computed transition-property; check CLS / observe reflow during the animation |
| FOUC / flash of un-animated content | Element pops in then jumps to final spot | Watch first paint; element visible before its entrance transition = flicker regression |
| Decorative motion with no job | Distraction, slower task, accessibility liability | For each animation ask "orientation, continuity, or feedback?" — none = remove |
| Flashing >3×/sec | Seizure risk | Count flashes per second in any strobing/flicker effect |
| Meaning carried by motion alone | Reduced-motion users miss state changes entirely | With reduced motion ON, confirm every state (success/error/selected) is still conveyed by color/text/icon |

## ✅ Agent-applicable RULES (the payoff)

Each rule is a PASS/FAIL assertion the design-quality / visual-review gauntlet can mechanically apply. Format: severity + mapped axis/category + detection.

- **MA-1 — Reduced motion respected (the floor).** Non-essential animation MUST be reduced/removed when `prefers-reduced-motion: reduce` is set.
  *Maps:* design-quality `accessibility`; visual-review `a11y`. *Severity:* **critical** if no reduced-motion handling exists at all; **high** if some animations honor it but identifiable ones don't.
  *Detect:* search source for `prefers-reduced-motion` / Tailwind `motion-reduce:`; then set the OS/browser reduce-motion flag and re-render — if observable non-essential motion still plays, FAIL.
  *Finding shape:* `observed: parallax + modal scale still animate with reduce-motion ON; expected: motion suppressed or near-instant under prefers-reduced-motion (WCAG 2.3.3 / C39)`.

- **MA-2 — Meaning never carried by motion alone.** Every state conveyed via animation (success/error/selected/loading) MUST also be conveyed by a static, reduced-motion-safe cue (color + icon + text/aria).
  *Maps:* design-quality `accessibility`; visual-review `a11y`. *Severity:* **high**.
  *Detect:* with reduced motion ON, trigger each state and confirm a non-motion signifier remains. Missing = FAIL.

- **MA-3 — No layout-shifting / non-compositor animation.** Animations MUST use `transform` and `opacity` only; animating `width/height/top/left/margin/padding` is a FAIL.
  *Maps:* design-quality `mobile-responsive`; visual-review `regression`. *Severity:* **high** (mobile jank + CLS).
  *Detect:* inspect computed `transition-property`/keyframes for layout properties; observe CLS or visible reflow during the animation.
  *Finding shape:* `observed: panel animates height:0→320px, content below shifts each frame; expected: animate transform/opacity, reserve space (CLS ≤ 0.1)`.

- **MA-4 — No flash of un-animated content (FOUC).** An animated-in element MUST NOT be visible in its pre-animation/final-jump state before the transition runs.
  *Maps:* visual-review `regression`. *Severity:* **high** if content visibly flashes/jumps on load.
  *Detect:* watch first paint; element appearing then snapping to its animated position = FAIL. Initial state must be set in the class (e.g. `opacity-0`) not applied post-mount.

- **MA-5 — Duration within budget.** Routine-interaction animations MUST be ≤ ~500 ms (feedback ~100 ms, transitions 200–300 ms, large moves ≤ ~400 ms). Entrance motion MUST NOT gate the user's task.
  *Maps:* design-quality `mobile-responsive` (perceived perf); visual-review `regression`. *Severity:* **medium** (>500 ms routine); **high** if motion delays access to the primary action.
  *Detect:* read declared durations; flag any routine transition >500 ms or a hero/intro animation that blocks the CTA from being usable.

- **MA-6 — Easing is non-linear for organic motion.** Entrances/transitions MUST use eased curves (ease-out for entrances, ease-in for exits, ease-in-out for moves); `linear` is allowed only for true constant loops (spinners).
  *Maps:* visual-review `regression` (motion-quality). *Severity:* **low**.
  *Detect:* find `ease-linear`/`linear` on non-loop transitions.

- **MA-7 — No seizure-inducing flashing.** Nothing flashes more than 3 times per second.
  *Maps:* design-quality `accessibility`; visual-review `a11y`. *Severity:* **critical**.
  *Detect:* count flashes/sec in any strobing or rapid-flicker effect; >3/s = FAIL (WCAG 2.3.1).

- **MA-8 — Motion is purposeful.** Each animation serves orientation, continuity, or feedback; purely decorative motion in core flows is flagged.
  *Maps:* design-quality `design-handoff` (intent fidelity) / `accessibility`. *Severity:* **low** (escalates to **medium** if the decorative motion also fails MA-1/MA-3).
  *Detect:* enumerate animations; any that can't be assigned one of the three jobs is a candidate for removal.

## Sources

- W3C/WAI — *Understanding SC 2.3.3: Animation from Interactions* (https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html)
- W3C/WAI — *Technique C39: Using the CSS prefers-reduced-motion query to prevent motion* (https://www.w3.org/WAI/WCAG21/Techniques/css/C39)
- W3C/WAI — *Technique SCR40: prefers-reduced-motion in JavaScript* (https://www.w3.org/WAI/WCAG21/Techniques/client-side-script/SCR40)
- Nielsen Norman Group — *Executing UX Animations: Duration and Motion Characteristics* (https://www.nngroup.com/articles/animation-duration/)
- Material Design 3 — *Easing and duration* (https://m3.material.io/styles/motion/easing-and-duration)
- Material Design — *Duration & easing / Speed* (https://m1.material.io/motion/duration-easing.html)
- web.dev — *Web Vitals (LCP/INP/CLS)* (https://web.dev/articles/vitals)
- Laws of UX — *Doherty Threshold* (https://lawsofux.com/doherty-threshold/)
