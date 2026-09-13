# Accessibility Baseline

Generated apps must be usable with a keyboard, readable by assistive technology, and stable across common viewport sizes.

## Minimum Checks

| Area | Requirement |
|---|---|
| Keyboard navigation | Every interactive control is reachable and operable by keyboard. Focus order follows visual order. |
| Focus states | Focus-visible styles are present, visible against the background, and not hidden by custom outlines. |
| Semantic labels | Buttons, inputs, menus, tabs, dialogs, and icon-only controls have accessible names. |
| Contrast | Text, focus rings, form borders, disabled states, and status colors meet WCAG AA contrast. |
| Form errors | Errors are associated with fields and announced through accessible descriptions or live regions. |
| Screen-reader state | Loading, success, failure, modal open/close, route changes, and async result changes are announced when they are not visually obvious. |
| Motion | Animated or moving UI respects reduced-motion preferences. |
| Layout | Text does not overlap, clip, or become unreadable at mobile and desktop widths. |

## Review Hook

UI reviewers and visual-review agents must fail critical or high findings when these checks are violated. Generated apps may defer a check only with an ADR and a dated remediation plan.
