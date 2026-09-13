# INTERACTION_FEEDBACK_STATES — Claude 3-round research notes

**Engine:** Claude WebSearch + WebFetch (3 rounds). Date: 2026-06-01.

## Phase 1: Landscape
- **Nielsen #1 heuristic — Visibility of system status:** the system should always keep users informed about what's going on, through appropriate feedback within reasonable time. HIGH.
- **Nielsen's 3 response-time limits:** 0.1s = feels instantaneous (no special feedback needed); 1.0s = limit for uninterrupted flow of thought (show feedback if longer); 10s = limit for keeping attention → use a percent-done indicator for operations > ~10s. (NN/g Response Time Limits.) HIGH.
- **Doherty Threshold:** productivity soars when system responds < **400ms**. (Laws of UX; Doherty & Thadani 1982.) HIGH.
- **Canonical UI states:** default/content, loading, empty, error, success — plus interactive states hover/focus/active/disabled. (The "5 states of UI" canon.) HIGH.
- **Microinteractions (Dan Saffer, 2014):** trigger → rules → feedback → loops/modes. Trigger = user action or system state change; feedback = small, contextual, usually visual change. (NN/g Microinteractions.) HIGH.

## Phase 2: Mechanics
- Every interactive element exposes hover/focus/active/disabled visually; a control with no visible state change on interaction = a silent action (failure).
- Async action: show loading (skeleton for content layout, spinner for short, percent/progress for >10s), then resolve to success OR error — never leave the user uncertain. Skeletons preferred for content placeholders (perceived performance). HIGH.
- Lists/data: design the EMPTY state (guidance / next action), not a blank screen.
- Forms: inline validation stating the requirement; error = color + icon + text (never color alone).
- **No silent action rule:** every user-initiated action produces visible feedback within the appropriate time band.
- **Assistive tech:** announce async status via live regions — `role="status"` (implicit `aria-live="polite"`) for advisory updates; `role="alert"` (assertive) for errors/important. (MDN status/alert role; W3C ARIA22.) HIGH.
- Disabled control: signify with more than color (reduced opacity + `aria-disabled`/`disabled` + non-interactive cursor); must still be perceivable.

## Phase 3: Failure Modes (each with detection)
- Silent action: click a control, no DOM/visual/route change, no loading → user re-clicks (double-submit). Detect: interact → observe zero delta.
- Missing loading state on async → UI appears frozen; user assumes it's broken. Detect: trigger async path, no loading node appears before result.
- Missing empty state → blank container, looks broken. Detect: zero-data container with no empty-state element/text.
- Absent/unstyled error state → failure path silently swallowed or raw. Detect: force error path, no styled error surfaced.
- No visible focus ring → keyboard users lost. Detect: Tab through; no :focus-visible outline. (Also a11y.)
- Color-only state (red/green, no icon/text) → ambiguous for color-blind. Detect: state differentiator is hue only.
- Disabled control looks enabled (or vice versa) → user clicks a dead control. Detect: disabled element with full-opacity, interactive cursor.
- Console errors that break render (hydration mismatch, missing prop, fetch fail) → partial/broken UI. Detect: browser console error count > 0 on the path.
- State-transition flicker / FOUC / layout shift → jank, perceived instability. Detect: visible flash or CLS on transition.

## Phase 4: Contrarian
- Over-feedback is real harm: too many toasts/spinners = noise; a spinner on a <400ms action makes it feel SLOWER (flash of spinner). Calibrate feedback to latency: <100ms none needed; 100ms–1s subtle inline; >1s explicit loading; >10s progress. HIGH.
- Spinner vs skeleton vs optimistic: optimistic UI (assume success, reconcile on response) beats a blocking spinner for known-likely-success actions; skeletons beat spinners for content layout. Don't block on a spinner when you can show structure.
- Feedback animation must honor `prefers-reduced-motion` — motion-based feedback needs a reduced/none variant. MEDIUM-HIGH.

## Sources
- NN/g Response Time Limits — https://www.nngroup.com/articles/response-times-3-important-limits/ (primary, 5)
- NN/g Visibility of system status (10 heuristics) — https://www.nngroup.com/articles/ten-usability-heuristics/ (5)
- NN/g Microinteractions — https://www.nngroup.com/articles/microinteractions/ (5)
- Laws of UX Doherty Threshold — https://lawsofux.com/doherty-threshold/ (4)
- MDN ARIA status role — https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/status_role (5)
- MDN ARIA alert role — https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/alert_role (5)
- W3C ARIA22 (role=status) — https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22.html (primary, 5)
