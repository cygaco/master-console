---
description: Design system compliance audit — read-only check of components against the project's design-system docs
---

# /ui:review — Design System Compliance Audit

Read-only audit of component(s) against the project's design system. Reports violations without fixing them.

## Input

`$ARGUMENTS` — file path(s) or glob pattern to audit. If empty, audit all component files in the project's primary source directory (resolve via `manifest.source_dirs`).

## Process

### 1. Resolve design-system location

Read `.claude/paths.json` for `requirements` base. Then try:
- `_requirements/01-design-system/COMPONENT_LIBRARY.md`
- `_requirements/01-design-system/COLOR_SEMANTICS.md`
- `_requirements/01-design-system/FEEDBACK_PATTERNS.md` (optional)
- `_requirements/01-design-system/UX_PRINCIPLES.md` (optional)

Legacy fallback: `_requirements/01-design-system/...` (same filenames).

If none exist, report "No design system docs found — `/ui:review` requires at least `COMPONENT_LIBRARY.md` and `COLOR_SEMANTICS.md` under `_requirements/01-design-system/`." and exit.

### 2. Read the target files from `$ARGUMENTS`

If `$ARGUMENTS` is empty, use `manifest.source_dirs[0]` or fall back to `src/components/`.

### 3. Check each file for violations

The exact rules depend on what the design-system docs say. Below are the **common categories** — match them against the actual rules in the design-system docs.

### Color compliance
- Hardcoded hex values in style objects (should use `var(--token)` or the project's equivalent)
- Framework-native color utility classes when the design system mandates custom properties
- References to CSS custom properties that don't exist in the global stylesheet

### Component usage
- Raw HTML primitives where the design system mandates a wrapper (e.g., in the app scaffold, `<button>` → `<Button>`, `<input>` → `<Input>`)
- Missing variants that the design system requires
- Modal/dialog patterns that don't match the project's chosen primitive

### Accessibility (WCAG 2.1 AA baseline)
- Interactive elements without accessible names (missing aria-label, aria-labelledby, or visible text)
- Images/SVGs without alt text or `role="presentation"`
- Color as sole state indicator (needs icon/text pair)
- Missing focus management for dynamic content
- onClick on non-interactive elements (`<div onClick>` instead of `<button>`)

### Theme compliance
- Visual effects prohibited by the project's theme (e.g., gradients, glassmorphism — check COMPONENT_LIBRARY.md)
- Emoji in UI text (unless explicitly allowed)
- Generic placeholder copy ("Lorem ipsum", "Click here")
- Spacing or border-radius values outside the documented scale

### Pattern compliance
- JS-based hover patterns (onMouseEnter/onMouseLeave) when CSS would suffice
- Inconsistent padding vs. the documented component standards
- Missing loading states for async operations
- Missing error states for fallible operations
- Toast/notification patterns that bypass the project's Toast primitive

## Output

Print a structured report:

```
=== UI REVIEW: {filename} ===

COLOR: {count} violations
  - Line {N}: hardcoded hex '#ff0000' → use var(--error)
  - ...

COMPONENTS: {count} violations
  - Line {N}: raw <button> → use <Button variant="default">
  - ...

ACCESSIBILITY: {count} violations
  - Line {N}: <div onClick> without aria-label → use <Button> or add role="button" + aria-label
  - ...

THEME: {count} violations
  - Line {N}: gradient background → remove, use solid var(--surface)
  - ...

PATTERNS: {count} violations
  - Line {N}: onMouseEnter hover → use CSS :hover
  - ...

SUMMARY: {total} violations ({critical} critical, {warning} warning)
```

Do NOT fix any violations. Report only. This is a read-only audit.
