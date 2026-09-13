# ACCESSIBILITY_WCAG — Claude Deep Research Report (3-round WebSearch+WebFetch)

**Engine:** Claude (Opus) iterative search — 3 rounds. Date: 2026-06-01.
**Topic:** WCAG 2.2 POUR requirements as mechanically-checkable rules for an AI front-end builder (Next/Tailwind/Radix/shadcn).

## Executive Summary
WCAG 2.2 (Oct 2023) is the de-facto baseline; Level AA is the target. Conformance is organized under POUR (Perceivable, Operable, Understandable, Robust). The highest-leverage, most-checkable criteria for a visual builder are contrast (1.4.3 4.5:1 / 3:1; 1.4.11 3:1 non-text), accessible names/roles (4.1.2), focus visibility (2.4.7 + 2.4.13), keyboard operability (2.1.1/2.1.2), target size (2.5.8 24×24px, new in 2.2), reflow (1.4.10 320px), not-color-alone (1.4.1), and status messages (4.1.3). The WebAIM Million 2025 audit shows 94.8% of top pages fail, with six issue families (led by low contrast at 79.1%) accounting for 96% of detected errors — all introduced in markup/CSS and all preventable at build time.

## Phase 1: Landscape — WCAG 2.2 structure & new criteria
- **POUR + levels A/AA/AAA.** AA is the practical/legal baseline (ADA, EN 301 549, Section 508, EU Accessibility Act). [HIGH] — w3.org/TR/WCAG22
- **New in 2.2 (9 added, 1 removed):** 2.4.11 Focus Not Obscured (Min, AA), 2.4.12 Focus Not Obscured (Enhanced, AAA), 2.4.13 Focus Appearance (AAA), 2.5.7 Dragging Movements (AA), 2.5.8 Target Size Minimum (AA), 3.2.6 Consistent Help (A), 3.3.7 Redundant Entry (A), 3.3.8 Accessible Authentication Minimum (AA), 3.3.9 Accessible Authentication Enhanced (AAA). 4.1.1 Parsing was removed. [HIGH] — w3.org/WAI/standards-guidelines/wcag/new-in-22
- Source confirmed 2.4.13 is AAA and 3.3.7 is A (not AA) — corrected in the guide.

## Phase 2: Mechanics — exact thresholds
- **1.4.3 Contrast (AA):** 4.5:1 normal text; 3:1 large text (≥18pt/≈24px reg or ≥14pt/≈18.66px bold). Ratio = (L1+0.05)/(L2+0.05), 1:1..21:1. Exceptions: incidental/inactive/decorative, logotypes. [HIGH] — w3.org Understanding 1.4.3 (verified via WebFetch)
- **1.4.11 Non-text Contrast (AA):** 3:1 for UI component boundaries/states + meaningful graphics. Focus indicators fall under both 1.4.11 and 2.4.7. [HIGH] — w3.org Understanding 1.4.11
- **2.5.8 Target Size Minimum (AA):** 24×24 CSS px OR 24px-diameter-circle non-intersection spacing exception. Other exceptions: inline-in-sentence, equivalent control elsewhere, UA-determined, essential. (MIT Touch Lab: fingertip 16–20mm; small-target error rates up to 75% higher.) [HIGH] — w3.org Understanding 2.5.8 + TestParty
- **2.4.7 Focus Visible (AA):** visible indicator on focus. **2.4.13 Focus Appearance (AAA target):** ≥2px thick, ≥3:1 contrast focused-vs-unfocused, not obscured. [HIGH] — w3.org Understanding 2.4.7/2.4.13
- **1.4.10 Reflow (AA):** reflow to 320 CSS px (=400% zoom on 1280) with no 2D scrolling (exceptions: tables/maps/code). **1.4.4 Resize Text (AA):** 200% without loss. **1.4.12 Text Spacing (AA):** survive line-height 1.5 / letter 0.12em / word 0.16em / para 2em overrides. [HIGH] — w3.org Understanding 1.4.10
- **Error wiring:** aria-invalid="true" (only after validation, not on pristine required), aria-describedby → message, role="alert"/aria-live for dynamic errors. [HIGH] — w3.org ARIA21, MDN aria-invalid

## Phase 3: Failure Modes — WebAIM Million 2025
Six most common (% of home pages): low-contrast text 79.1%; missing alt text 55.5%; missing form input labels 48.2%; empty links 45.4%; empty buttons 29.6%; missing document language 15.8%. These six = 96% of all errors; same top errors 5 years running. 94.8% of pages fail; ~51 detectable errors/page; avg 29.6 low-contrast instances/page (down 14.4% YoY). [HIGH] — webaim.org/projects/million/2025 (verified via WebFetch)
Other high-frequency build defects: div-as-button (no keyboard/role), outline:none with no replacement, color-only state, placeholder-as-label, skipped heading levels, fixed-width no-reflow, tiny tap targets, motion ignoring prefers-reduced-motion, async status with no live region, focus hidden behind sticky header (2.4.11).

## Phase 4: Contrarian — limits of automated/contrast-only thinking
- **Automated tools catch only ~20–40% of WCAG issues** (~30% commonly cited; only ~15–16 of ~50 SC are meaningfully machine-testable). The other ~60–80% (meaningful focus order, accurate alt text, helpful errors, logical reading order) need human/judgment review. [HIGH] — Deque coverage report; a11yproof; assistivlabs
- **WCAG 2.x contrast math has perceptual blind spots** — relative-luminance ratio can pass hard-to-read combos (thin fonts, dark mode) and fail readable ones. **APCA (Lc value, ~−108..+108)** is the WCAG 3 draft perceptual model factoring polarity/luminance/typography. Guidance: conform to 2.2's 4.5:1/3:1 as the hard floor now; raise marginal-but-passing combos. [HIGH] — humbldesign; accessibilitychecker APCA
- **First Rule of ARIA:** don't use ARIA if native HTML will do; bad/excess ARIA is worse than none. [HIGH]

## Source Registry (selected, credibility 1–5)
- w3.org/TR/WCAG22 + Understanding docs — primary, 5/5, current
- webaim.org/projects/million/2025 — primary research, 5/5, 2025
- deque.com automated-accessibility-coverage-report — primary vendor research, 4/5
- MDN aria-invalid — primary docs, 5/5
- TestParty / DigitalA11Y / AllAccessible — secondary explainers, 3/5 (used to locate primary, thresholds verified against W3C)
