# LAYOUT_GRID_SPACING — Claude 3-round research notes

**Engine:** Claude WebSearch + WebFetch (3 rounds). Date: 2026-06-01.

## Phase 1: Landscape
- A spatial system = rules for measuring, sizing, spacing UI elements; uniformity → consistency + fewer per-day decisions. (designsystems.com Space, Grids & Layouts.) HIGH.
- **8pt grid** dominant because 8 is highly divisible (4, 2), aligns with common screen sizes + pixel ratios; smaller bases (4/5/6) explode the variable count and break enforceability. Apple HIG + Material both recommend 8pt. HIGH.
- **4px half-step** widely allowed for tight relationships (label↔input, icon↔text). Material: 8pt component grid + 4pt baseline grid for typography (line-heights in increments of 4). HIGH.

## Phase 2: Mechanics
- Concrete scale: base 8 (with 4 half-step) → ramp 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 (token steps). Components consume steps, not magic numbers. HIGH.
- **Law of Proximity (Gestalt):** items close together are perceived as one group; proximity can OVERPOWER similarity of color/shape. (NN/g Proximity; Laws of UX.) → checkable rule: **space WITHIN a group < space BETWEEN groups.** An element with more space around it reads as its own group + gets more attention. HIGH.
- **Common Region:** a shared container (border/background/card) groups items even without proximity. (NN/g Common Region.)
- Alignment: related items share an alignment edge / sit on a common grid; consistent equal gaps between siblings. Optical vs mathematical alignment (icons/punctuation may need optical nudge).
- **Measure (line length):** optimal body ~50–60 chars/line (Ruder), up to ~75 acceptable; too long → eyes lose the line start; too short → rhythm breaks. (Baymard line-length.) HIGH.
- Whitespace drives hierarchy + grouping: heading sits closer to its section than to the preceding one; increased space between field chunks shows the hierarchical pattern. (NN/g form white space.) HIGH.

## Phase 3: Failure Modes (each with detection)
- Cramped / no breathing room → cluttered, high cognitive load. Detect: padding/gaps near 0 or far below scale on dense regions.
- Arbitrary/off-scale values (e.g., 7px, 13px, 23px) → inconsistent rhythm. Detect: computed margin/padding not a member of the spacing scale.
- Ambiguous grouping: equal space inside and between groups → eye can't parse relationships. Detect: intra-group gap ≈ inter-group gap.
- Misalignment / off-grid elements → sloppy, untrustworthy. Detect: sibling elements with differing left/top edges that should align.
- Horizontal overflow / overlap at mobile → content cut off or unreachable. Detect: scrollWidth > viewport width at 375px; overlapping bounding boxes.
- Over-long measure → fatigue, lost lines. Detect: text container line length > ~75ch.
- Uneven sibling gaps → broken rhythm. Detect: gaps between equivalent siblings differ.

## Phase 4: Contrarian
- A rigid 8pt grid can over-constrain: optical alignment sometimes needs sub-grid nudges; dense data tables/pro tools legitimately run tighter; fluid `clamp()` spacing scales between breakpoints rather than snapping to fixed steps. Hedge: allow disciplined exceptions (optical, density tier, fluid) but they must still be *systematic* (a named density tier / a clamp formula), never one-off magic numbers. MEDIUM-HIGH.

## Sources
- designsystems.com Space, Grids & Layouts — https://www.designsystems.com/space-grids-and-layouts/ (secondary, 4)
- NN/g Proximity — https://www.nngroup.com/articles/gestalt-proximity/ (primary-ish, 5)
- NN/g Common Region — https://www.nngroup.com/articles/common-region/ (5)
- NN/g Form white space — https://www.nngroup.com/articles/form-design-white-space/ (5)
- Laws of UX Proximity — https://lawsofux.com/law-of-proximity/ (4)
- Baymard line length — https://baymard.com/blog/line-length-readability (5)
- UX Planet 8pt grid — https://uxplanet.org/everything-you-should-know-about-8-point-grid-system... (3)
