---
description: Design system compliance check - scans UI code for raw colors, raw primitives, missing design docs, and component-library drift
---

# /scan:design-system

Read-only audit for UI design-system compliance.

## Usage

```bash
node scripts/checks/design-system.js
node scripts/checks/design-system.js --strict
node scripts/checks/design-system.js --json
```

Default mode reports findings and exits 0 so existing products can adopt the checker incrementally. `--strict` exits non-zero when violations remain and is the mode generated apps should use before production release.

## Checks

1. Required design docs exist under `_requirements/01-design-system/`.
2. JSX/TSX does not use raw hex color literals in UI styling.
3. JSX/TSX does not use raw Tailwind theme color utilities for product theme colors.
4. Feature components use local UI primitives instead of raw `button`, `input`, `select`, or `textarea` controls.
5. Component prop signatures avoid `any`.

## Allow-list

Intentional exceptions live in `scripts/checks/design-system.allowlist.json`. Each entry must name a file, rule, and reason.

## Related

- `_requirements/03-architecture/ACCESSIBILITY_BASELINE.md`
- `_requirements/03-architecture/PRODUCTION_BASELINE.md`
- `scripts/hooks/ui-lint.js`
