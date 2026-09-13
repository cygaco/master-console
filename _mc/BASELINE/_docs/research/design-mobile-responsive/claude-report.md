# Mobile / Responsive — Claude Deep Research Report (3-round)

**Engine:** Claude multi-round WebSearch + WebFetch (Round 1 Landscape/Mechanics, Round 2 Failure Modes, Round 3 Contrarian/Verify).
**Date:** 2026-06-01

## Executive Summary
Mobile is the default surface for most products, and the principle floor is now codified: **WCAG 2.2 SC 2.5.8** requires interactive targets ≥ **24×24 CSS px** (or adequate spacing); **WCAG SC 1.4.10 Reflow** requires content to work at **320 CSS px** width with **no two-dimensional scrolling** and no loss of content/function. Platform guidance sets a more comfortable floor (Apple **44pt**, Material **48dp**). Mobile-first means base styles for small viewports then progressive enhancement up. The dominant failures — horizontal overflow, element overlap, clipped content, sub-floor tap targets, and **body/input type < 16px** (which triggers iOS auto-zoom) — are all mechanically detectable via DOM geometry and computed styles. Contrarian: pure mobile-first is wrong for genuinely desktop-primary, data-dense B2B tools; the reconciliation is content-parity responsive with the *priority* surface chosen by audience.

## Phase 1: Landscape
- **WCAG 2.2 SC 2.5.8 Target Size (Minimum), Level AA** — *verified against w3.org primary*: "The size of the target for pointer inputs is at least **24 by 24 CSS pixels**." Refers to the interactive hit area. Five exceptions: **Spacing** (a 24px-diameter circle centered on each undersized target's bounding box does not intersect another target), **Equivalent** (another conforming control does the same job), **Inline** (target within a sentence / constrained by line-height), **User Agent Control**, **Essential**. — Confidence HIGH.
- **WCAG SC 1.4.10 Reflow, Level AA** — *verified against w3.org primary*: content presented "without loss of information or functionality, and without requiring scrolling in two dimensions" for vertical content at **320 CSS px** width (and horizontal content at 256 CSS px height). 320px ≡ 1280px @ 400% zoom. Exception: content needing 2D layout (maps, diagrams, data tables, games) — and the exception does NOT extend to surrounding content. — Confidence HIGH.
- **Platform target floors:** Apple HIG **44×44 pt**; Material **48×48 dp** (~9mm physical). dp/pt are density-independent. — Confidence HIGH (developer.apple.com HIG, m3.material.io; secondary aggregators).
- **Mobile-first** = design for the smallest/constrained viewport first, then progressively enhance up — forces prioritization of core content. — Confidence HIGH.

## Phase 2: Mechanics
- **Mobile-first breakpoints (Tailwind model):** unprefixed utilities are the mobile base; `sm:`/`md:`/`lg:` apply min-width *up*. Write base, override upward. — Confidence HIGH (principle source).
- **Overflow prevention:** flex/grid children need `min-w-0` (flex/grid items default `min-width:auto`, refusing to shrink → overflow); wrap with `flex-wrap`; cap text measure with `max-w-*`/`max-w-prose`; avoid fixed px widths > 320 and `100vw` (ignores scrollbar width). — Confidence HIGH (Smashing, CSS-Tricks, Polypane).
- **Overflow detection (mechanical):** `document.documentElement.scrollWidth > window.innerWidth` ⇒ horizontal overflow; iterate elements where `el.getBoundingClientRect().right > innerWidth` to find the culprit. `scrollWidth > clientWidth` detects per-element overflow regardless of scrollbars. — Confidence HIGH (MDN, CSS-Tricks).
- **Readable mobile type:** body/input computed `font-size ≥ 16px` — below 16px iOS Safari auto-zooms on input focus (threshold is the *rendered* size after transforms). Disabling zoom (`maximum-scale=1`/`user-scalable=no`) "violates accessibility best practices and WCAG." Use `@media (pointer: coarse)` to give touch devices ≥16px. — Confidence HIGH (CSS-Tricks).
- **Tap-target sizing:** size via `min-h`/`min-w` (e.g. the scaffold Button default `h-10` = 40px; the `icon` size `size-10`); ensure spacing so the 24px-circle rule holds; `viewport` meta present (`width=device-width, initial-scale=1`); `env(safe-area-inset-*)` for notches. — Confidence HIGH.

## Phase 3: Failure Modes
- **Horizontal overflow / two-dimensional scroll** — fixed-px element wider than viewport, `100vw`, unwrapped flex row, long unbroken string. Reads as: page scrolls sideways, content cut off. Detect: `scrollWidth > innerWidth`. — Confidence HIGH.
- **Element overlap / clipped content** — absolute positioning or negative margins that collide at small widths; content disappears behind another element. Detect: overlapping bounding rects. — Confidence HIGH.
- **Sub-floor tap targets / too close together** — fat-finger errors, mis-taps. Detect: computed box < 24×24 (prefer 44×44) or 24px circles intersect. — Confidence HIGH (WCAG 2.5.8).
- **Body/input type < 16px** — iOS zooms on focus, layout jumps, text hard to read. Detect: computed `font-size < 16px` on inputs. — Confidence HIGH.
- **Desktop-only hover affordance with no touch equivalent** — control only revealed on `:hover`; on touch there is no hover, so it's unreachable. — Confidence HIGH.
- **Layout shift (CLS) on load** — images without dimensions, late-loading fonts/banners push content; user taps the wrong thing. — Confidence HIGH (web.dev).
- **Disabled zoom** (`user-scalable=no`) — blocks low-vision users; WCAG failure. — Confidence HIGH.

## Phase 4: Contrarian
- **Mobile-first is wrong for desktop-primary products:** B2B dashboards, analytics, financial portals are information-dense and live on large screens; responsive (fluid) beats forcing a mobile-first column. The 2026 consensus: "adaptive design with mobile as the priority platform" — pick the priority surface by audience, but keep content parity. — Confidence MEDIUM (blendb2b, cleveroad, careernexus — opinion/secondary).
- **Responsive vs adaptive:** responsive = fluid grids + media queries (one codebase); adaptive = discrete templates per breakpoint (more maintenance). Responsive is the default; adaptive only when surfaces genuinely diverge. — Confidence MEDIUM.
- **Beyond the minimum (Fitts's Law):** the 24px floor is a *minimum*; primary/frequent actions should be larger (44–48px) — meeting the minimum is not the same as good. — Confidence HIGH (Fitts's Law, Apple/Material).

## Source Registry
- w3.org/WAI/WCAG22/Understanding/target-size-minimum.html — SC 2.5.8 — primary — 5/5 — VERIFIED
- w3.org/WAI/WCAG21/Understanding/reflow — SC 1.4.10 — primary — 5/5 — VERIFIED
- developer.apple.com HIG / m3.material.io — 44pt / 48dp — primary(platform) — 5/5
- css-tricks.com/16px-or-larger-text-prevents-ios-form-zoom — iOS 16px — secondary — 4/5
- developer.mozilla.org Element.scrollWidth — overflow detection — primary — 5/5
- smashingmagazine.com css-overflow-issues / polypane.app — overflow causes — secondary — 4/5
- web.dev/articles/vitals — CLS — primary — 5/5

## Confidence Matrix
| Finding | Confidence | Counter-evidence |
|---|---|---|
| Tap target ≥ 24×24 CSS px (prefer 44/48) | HIGH | exceptions in 2.5.8 |
| Reflow at 320px, no 2D scroll | HIGH | 2D-layout content excepted |
| Input/body ≥ 16px prevents iOS zoom | HIGH | none |
| Overflow detectable via scrollWidth>innerWidth | HIGH | scrollbar-width edge cases |
| Mobile-first wrong for desktop-primary B2B | MEDIUM | opinion-weighted |

## Gaps Remaining
- Thumb-zone reachability had thin primary sourcing (handled as a soft ergonomic principle, not a hard rule).
- Exact CLS numeric threshold (0.1) is web.dev's — referenced as principle, owned by the PERFORMANCE topic.
