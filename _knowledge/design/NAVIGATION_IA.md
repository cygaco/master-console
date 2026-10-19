---
guide: NAVIGATION_IA
anchor: none
shape: walkthrough
timing: reference
lead_time: "none"
tier: standard
trains: [design-lead, design-quality, visual-review]
maps_to: [visual-hierarchy, component-usage, layout, copy]
sources:
  - "https://www.nngroup.com/articles/menu-design/"
  - "https://www.nngroup.com/articles/breadcrumbs/"
  - "https://www.nngroup.com/articles/navigation-you-are-here/"
  - "https://www.nngroup.com/articles/match-system-real-world/"
  - "https://lawsofux.com/jakobs-law/"
  - "https://www.nngroup.com/articles/local-navigation/"
---

# Navigation & Information Architecture

**Navigation & IA** is the structure of a product's content and the system that lets users answer three questions at every moment: *Where am I? Where can I go? How do I get back?* — organized so the structure matches how users think (their mental model), follows familiar conventions, and makes the right places findable.

## Why it matters

Information architecture is the skeleton; navigation is the nervous system that lets users move through it. Get the structure wrong and no amount of visual polish saves it — users can't find what they came for, can't tell where they are, and can't get back. NN/g's research is consistent: "Where am I?" and "Where can I go?" are the fundamental navigation questions, and failing to answer them is one of the most common, most damaging usability failures because it's invisible in a static mockup — it only bites when a user is *lost mid-journey*.

Two laws govern this:
- **Jakob's Law:** users spend most of their time on *other* products, so they expect yours to work like the ones they already know. Their mental model of "where the nav goes" and "what a breadcrumb does" is pre-installed; matching it is free usability, defying it is a tax you make every user pay.
- **Match between system and the real world** (NN/g heuristic #2): the structure and labels should speak the user's language and follow real-world/logical order — not the org chart, not internal jargon, not the database schema.

For the MC designer agents:

- **design-lead** owns the **start-path** and journey lens (`map-user-journey`, `cold-vs-warm-start`/`ftue-nux`). Navigation is how a first-time user gets oriented and how a returning user gets to their goal fast. A buried entry point or a confusing IA breaks the cold-start experience the design-lead is responsible for. Labels are also a `clear-iconography`/clarity concern — a navigation label is a signifier.
- **design-quality** judges `visual-hierarchy` (the primary nav and current-location cue are prominent and clear) and `component-usage` (nav is built from real, consistent primitives). A nav where you can't tell which item is active is a hierarchy finding.
- **visual-review** judges `layout` (nav placement, current-location highlight, breadcrumb rendering) and `copy` (nav labels — wrong, jargony, or ambiguous text). It catches the menu with no active-state indicator and the mystery label.

## Core principles / techniques

### 1. Structure matches the user's mental model (IA before chrome)

The hierarchy of sections/categories must reflect how *users* group the content, not how the company is organized internally.

- **Organize by user task/expectation, not internal structure.** A label like "Solutions" or an org-named section forces users to translate; categories named for the user's goals don't. Match between system and real world: use the words and groupings the audience already has.
- **Breadth vs. depth.** Flat-and-wide menus reduce clicks-to-target but raise per-screen choice (Hick's Law — see `COGNITIVE_LOAD_SIMPLICITY`); deep-and-narrow reduces choice per screen but adds steps and risks burying content. Tune to the content and audience; avoid both the overwhelming mega-everything and the endless-drill-down.
- **Group with categories that are mutually clear.** Ambiguous or overlapping categories ("where would this go?") are an IA smell. If users can't predict which bucket holds a thing, the buckets are wrong.

### 2. "Where am I?" — current-location cues are mandatory

Users frequently arrive mid-site (deep links, search) with no idea where they landed. The interface must answer "where am I" *passively*, without the user hunting.

- **Highlight the active nav item.** The current section's nav entry is visibly distinct (weight, color, an indicator bar/background) — and that distinction is *not color-alone* (cross-ref `ACCESSIBILITY_WCAG`): use weight/underline/indicator too, and `aria-current="page"`.
- **Breadcrumbs for hierarchy ≥3 levels.** Breadcrumbs are **location-based, not history-based** — they show the path through the *site structure* to the current page, not the pages the user visited. Rules: start at home, each ancestor is a link, the **current page is the last item and is NOT a link** (it's a label, visually distinguished), `>` separators, placed just below the global nav, never a *replacement* for primary nav (supplementary). Skip them on flat (1–2 level) or linear structures — they'd be noise.
- **The page itself should say where you are** — a clear page title/H1 that matches the nav label the user clicked (label consistency closes the loop: clicked "Billing" → landed on a page titled "Billing").

### 3. "Where can I go?" — visible, conventional navigation

- **Don't hide primary navigation when there's room.** On desktop, an exposed nav also communicates *scope* ("here's everything this product does"); collapsing it into a hamburger when space allows hides that context and adds a click. Reserve the hamburger for genuinely space-constrained (mobile) contexts.
- **Put nav where users expect it (Jakob's Law).** Top header / left sidebar for apps, header + footer for sites. A novel nav location is a discoverability gamble that rarely pays off.
- **Make nav targets real and reachable.** Nav links are adequately sized and spaced (Fitts / target size — see `AFFORDANCE_CONTROLS_ICONOGRAPHY`); important/frequent destinations are near the launcher and easy to hit.
- **Local navigation aids orientation.** Section-level (local) nav showing siblings and children helps users understand *this area* and move within it without bouncing to the global nav and back.
- **Mark expandable items.** A submenu/expandable carries a caret/arrow signifier; click (not hover-only) to open, for touch and keyboard.

### 4. "How do I get back?" — reversible wayfinding & a stable home

- **A persistent, conventional home affordance.** The logo links home (a near-universal convention — Jakob's Law); back/up paths are always available.
- **No traps.** Every drill-down has a path back up (breadcrumb, back, parent link); a flow you can enter but not exit is the "roach motel" anti-pattern (see `ETHICS_NO_DARK_PATTERNS`).
- **Consistent nav across pages (NN/g #4 consistency-and-standards).** The global nav stays in the same place with the same items page-to-page; it doesn't reshuffle, vanish, or rename between screens. A nav that changes shape per page destroys the mental map the user is building.

### 5. Labels: the words *are* the navigation

A navigation label is a promise about what's behind the link; mismatched or vague labels are findability killers.

- **Plain, specific, user-language labels.** "Pricing," not "Investment options"; "Settings," not a clever brand word. Front-load the distinguishing term so vertical menus scan fast.
- **Label = destination.** The link label matches the destination page's title; clicking "Reports" must not land on a page titled "Analytics Dashboard."
- **Consistent terminology everywhere.** The same thing is called the same name across nav, page titles, and body — synonyms ("Account" here, "Profile" there) make users wonder if they're different things.
- **No jargon / no mystery-meat.** Icon-only nav with non-universal icons (see iconography guide), or internal-jargon labels, force guessing.

### 6. Search complements, doesn't replace, navigation

For content-rich products, search is a parallel findability path (some users are "search-dominant"), but it doesn't excuse bad IA — users still need to browse, orient, and understand scope. Provide both; don't make search the *only* way to find things.

## Concrete examples (build terms — Next/Tailwind/Radix/shadcn substrate)

**Current-location cue**
- ❌ DON'T: a top nav where every item looks identical regardless of route — no active state; user can't tell which section they're in.
- ✅ DO: compare the item's `href` to the current pathname; the active item gets a distinct treatment (`font-medium` + an underline/indicator bar + `aria-current="page"`), not color-alone. The page renders an `<h1>` matching the clicked nav label.

**Breadcrumbs (≥3 levels)**
- ❌ DON'T: a breadcrumb that lists the user's click history, or makes the current page a link, or replaces the top nav.
- ✅ DO: a location-based trail `Home > Reports > Q3 Summary` where Home + Reports are `<Link>`s, "Q3 Summary" is plain text (`aria-current="page"`), `>` separators, placed below the global nav, present only on 3+-level pages; on mobile, truncate to `… > Reports > Q3 Summary`. Render in a `<nav aria-label="Breadcrumb">`.

**Don't over-hide nav**
- ❌ DON'T: a desktop layout that collapses a 5-item primary nav into a hamburger purely for minimalism — hiding scope and adding a click.
- ✅ DO: exposed top/sidebar nav on desktop (`md:flex`), hamburger only at `< md` where space is constrained; the Radix/shadcn `Sheet` drawer for the mobile menu, with click-to-open submenus (carets) — not hover-only.

**Labels = destinations, user-language**
- ❌ DON'T: nav reading "Solutions / Resources / Synergy"; clicking "Resources" lands on a page titled "Knowledge Hub."
- ✅ DO: "Pricing / Docs / Support"; clicking "Docs" lands on a page whose `<title>`/H1 is "Docs"; the same feature is named identically in nav, page title, and body.

**Consistency + home**
- ❌ DON'T: the header nav has 4 items on the home page and 6 (reordered) on an inner page; the logo isn't a link.
- ✅ DO: one shared `<Header>` layout component so nav is byte-identical across routes; the logo is a `<Link href="/">` with an accessible name (Jakob's Law home convention).

## Common failure modes

- **No "you are here."** No active-state highlight, no breadcrumb, page title doesn't match the nav label. User is lost on deep-link arrival. *Detect:* navigate to a deep route; is the current section visibly indicated in nav AND is there an `aria-current="page"`? Does the H1 match the nav label clicked?
- **Color-only active state.** Active item differs only by color — invisible to color-blind users and weak as a signal. *Detect:* active item's only difference from siblings is `color`; no weight/indicator/`aria-current`.
- **Breadcrumb misuse.** History-based instead of location-based; current page is a link; breadcrumb replaces primary nav; present on a flat site. *Detect:* last crumb is a link; crumbs reflect visit order; no separate global nav.
- **Over-hidden navigation.** Hamburger on desktop where space allows; primary nav buried. Scope hidden, extra clicks. *Detect:* primary nav collapsed at wide viewports without a space justification.
- **Inconsistent nav.** Items/placement/labels change page-to-page; logo not linking home. Mental map destroyed. *Detect:* diff the nav region across routes; flag reordering/renaming/disappearing items; check logo `href`.
- **Jargon / mismatched labels.** Internal-language labels; label ≠ destination title; synonyms for the same thing across surfaces. *Detect:* compare nav label text to the destination's H1/title; scan for org-jargon and synonym drift.
- **Trap (no way back/up).** A drill-down or flow with no breadcrumb/back/parent path. *Detect:* on a deep page, is there a reachable up/back/home affordance?
- **Tiny/crowded nav targets.** Nav links below target-size floor or too tightly packed (especially mobile). *Detect:* measure nav-link bounding boxes/spacing at mobile viewport (cross-ref `AFFORDANCE_CONTROLS_ICONOGRAPHY`).

## ✅ Agent-applicable RULES (the payoff)

| # | Rule (PASS condition) | Maps to | How to detect a violation | Severity if violated |
|---|---|---|---|---|
| N1 | **Current location is indicated.** The active nav item is visibly distinct AND carries `aria-current="page"`; the page H1/title matches the nav label that leads to it. | design-quality `visual-hierarchy`, `accessibility`; visual-review `layout`, `copy`, `a11y` | Navigate a deep route; snapshot a11y tree for `aria-current`; compare active item styling to siblings and H1 to nav label. Observed: no active indicator / H1 ≠ label. Expected: distinct active + matching title. | high |
| N2 | **Active state is not color-only.** The active/current nav item differs by weight/underline/indicator/background (and `aria-current`), not color alone. | design-quality `accessibility`, `visual-hierarchy`; visual-review `a11y`, `layout` | Compare active vs. inactive computed styles. Observed: only `color` differs. Expected: a non-color distinction too. | medium |
| N3 | **Breadcrumbs are location-based & correct (when used).** On 3+-level hierarchies: trail reflects site structure (not history), in a `<nav aria-label="Breadcrumb">`, ancestors are links, the current page is the last item and is NOT a link, and it supplements (never replaces) primary nav. Absent on flat/linear structures. | design-quality `component-usage`, `accessibility`; visual-review `layout`, `a11y` | Inspect breadcrumb markup: last item link? reflects hierarchy? separate global nav present? Observed: current page linked / history-based / replaces nav. Expected: location-based, last item plain, supplementary. | medium |
| N4 | **Navigation is conventionally placed & not over-hidden.** Primary nav sits where users expect (top/left); it is exposed on desktop (not hamburger-collapsed where space allows). | design-quality `visual-hierarchy`, `component-usage`; visual-review `layout` | Check nav placement and whether it's collapsed at wide viewports. Observed: desktop hamburger hiding a small nav / novel placement. Expected: conventional, exposed on desktop. | medium |
| N5 | **Nav is consistent across pages.** The global nav has the same items, order, and placement on every route; the logo links home with an accessible name. | design-quality `component-usage`; visual-review `layout`, `regression` | Diff the nav region across ≥2 routes; check logo `href`/name. Observed: items reorder/rename/vanish / logo not linked. Expected: stable nav, home-linked logo. | high |
| N6 | **Labels are user-language and match destinations.** Nav labels are plain, specific, jargon-free; each label matches the destination page's title; terminology is consistent across nav/title/body. | design-quality `design-handoff`; visual-review `copy` | Compare label text to destination H1/title; scan for jargon/synonym drift. Observed: "Resources" → "Knowledge Hub" / synonyms for one thing. Expected: label = destination, consistent terms. | medium |
| N7 | **There is always a way back/up.** Every deep page/flow has a reachable home/back/parent affordance (logo-home, breadcrumb, or back); no trap. | design-quality `component-usage`, `accessibility`; visual-review `a11y`, `layout` | On a deep page, look for a labeled up/back/home affordance. Observed: no path back up. Expected: at least one reachable. | high |
| N8 | **Nav targets are reachable.** Nav links meet target-size/spacing minimums, especially at mobile (≥24px floor, primary ≥44px; adequate spacing). | design-quality `accessibility`, `mobile-responsive`; visual-review `a11y`, `layout` | Measure nav-link bounding boxes/gaps at mobile viewport. Observed: cramped/sub-floor links. Expected: ≥ floor, spaced. | medium |
| N9 | **Expandable items are signified & non-hover.** Items with submenus carry a caret/arrow and open on click (keyboard/touch operable), not hover-only. | design-quality `component-usage`, `accessibility`; visual-review `a11y`, `layout` | Inspect expandable nav: caret present? opens on click + keyboard? Observed: hover-only submenu, no signifier. Expected: caret + click/keyboard. | medium |

**Verdict guidance:** N1, N5, or N7 at `high` is a FAIL (the user can be lost, the mental map breaks, or they're trapped — task-impacting). N3 misuse that *misleads* (current page linked, or breadcrumb replacing nav) escalates to `high`. The rest are fixes unless they compound into a "can't find / can't orient" pattern.

## Sources

- Nielsen Norman Group — *Menu Design: 17 UX Guidelines* (visibility, current-location cues, labels, signifiers, click-not-hover): https://www.nngroup.com/articles/menu-design/
- Nielsen Norman Group — *Breadcrumbs: 11 Design Guidelines* (location-based, last item not a link, supplementary, mobile): https://www.nngroup.com/articles/breadcrumbs/
- Nielsen Norman Group — *Navigation: You Are Here* (the "where am I?" question): https://www.nngroup.com/articles/navigation-you-are-here/
- Nielsen Norman Group — *Match Between the System and the Real World* (heuristic #2; user language, logical order): https://www.nngroup.com/articles/match-system-real-world/
- Laws of UX — *Jakob's Law* (users expect familiar conventions): https://lawsofux.com/jakobs-law/
- Nielsen Norman Group — *Local Navigation Is a Valuable Orientation and Wayfinding Aid*: https://www.nngroup.com/articles/local-navigation/
