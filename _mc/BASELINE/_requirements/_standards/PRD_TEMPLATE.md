# PRD Template

## Purpose

This template defines the mandatory structure for every Product Requirements Document in Pantry Pilot. PRDs define **what a feature is, what it does, and how to build it**. They do not contain user stories — those live in separate files written in subsequent passes.

## Resolution Cascade

PRDs are written top-down across all features before drilling into stories:

1. **PRDs** (all features) — full feature spec, context, implementation map
2. **High-Level Stories** (all features) — intent and outcomes
3. **Granular Stories** (all features) — atomic behaviors and acceptance criteria

## File Structure

```
_requirements/04-features/{feature-slug}/
  PRD.md          # Full feature spec
  COPY.md         # Microcopy companion (button labels, toasts, empty states, errors)
  HL-STORIES.md   # High-level stories (written in second pass)
  STORIES.md      # Granular stories (written in third pass)
```

## One-Shot Generation

PRDs serve dual purpose: planning context for us, and spec input for one-shot code generation.

Feature Description (Section 8) is written to stand entirely on its own — it describes the feature as if building from scratch, no references to "before" or "after." Planning-only sections (Current State, Improvements) have been permanently removed from the PRD format.

### One-shot payload assembly

```
PRD.md + HL-STORIES.md + STORIES.md + COPY.md
```

## Required Sections

Every PRD must include all of the following sections. Use `n/a` when a section does not apply.

### 1. Title + Classification

Feature name. MVP or Post-MVP.

### 2. Screen

Which step, screen, or phase this feature lives on. Include phase (Onboarding / PLAN / SHOP / STOCK) and step number(s).

Component filenames MUST match `_requirements/00-canonical/GLOSSARY.md`. When referencing composite pages (`OnboardingPage`, `PlanPage`, `ShopPage`), also list the step components hosted within them.

### 3. Context

Why this feature exists. The problem or gap it addresses. What prompted it. Who benefits and why it matters.

### 4. JTBD (Jobs To Be Done)

The core job(s) the user brings this feature in to do. Use the JTBD format:

> When [situation], I want to [motivation], so I can [expected outcome].

Multiple jobs are fine. Each job should capture a distinct motivation.

JTBDs must be **platform-neutral** — describe the outcome the user brings the feature in for, not the delivery mechanism. "I want my grocery list to build itself from the week I planned" not "I want to use the Chrome extension to build my list." Platform specifics belong in Feature Description.

### 5. Emotional Framing

How the user should **feel** at each stage of this feature. Design decisions, copy, animations, and pacing should all serve this emotional arc.

Describe:

- **Entry**: How the user feels arriving at this feature (anxious? eager? overwhelmed?)
- **During**: How the feature sustains engagement (progress? discovery? control?)
- **Exit**: How the user feels leaving this feature (confident? empowered? relieved?)

This section guides UX decisions — loading states should reduce anxiety, celebrations should amplify achievement, errors should preserve trust.

### 6. Goals

What success looks like for this feature. Concrete, measurable outcomes. Each goal should be verifiable — you can look at the shipped feature and say "yes, this goal was met" or "no, it wasn't."

Examples:

- "User can export the week's grocery list in under 3 seconds"
- "Zero Claude API calls required for this step"
- "User completes onboarding in under 5 minutes on average"

### 7. Assumptions

What we are taking as given without explicit validation. Includes:

- User behavior assumptions (e.g., "households shop at one primary store per week")
- Technical assumptions (e.g., "jsPDF renders all Unicode characters correctly")
- Business assumptions (e.g., "PDF and DOCX are sufficient — no other formats needed")
- Data assumptions (e.g., "recipe data always includes at least an ingredient list")

Assumptions that later prove false become bugs or scope changes. Documenting them now creates a traceable decision trail.

`n/a` if no assumptions are made (rare).

### 8. Feature Description

The complete target state of the feature. This is the meat of the PRD.

Write this as if building from scratch — no references to "current state," "before," or "what changed." A reader (or a generation model) should understand the entire feature from this section alone.

**This is where platform specifics live.** JTBD, Emotional Framing, Goals, and HL Stories describe intent platform-neutrally. Feature Description names concrete technologies, platforms, and delivery mechanisms (Chrome extension, Manifest V3, recipe-site structured-data scraping, etc.). During one-shot code generation, the model gets intent from stories and implementation specifics from this section.

Describe:

- What the feature does from the user's perspective
- The complete behavior — inputs, processing, outputs
- How it fits into the overall product flow
- Key interactions and state changes
- Edge cases and boundary conditions

It represents the final, complete feature as it should exist after implementation.

### 9. Dependencies / Blockers

What must exist before this feature can be built. Other features, API integrations, data prerequisites, third-party services. `n/a` if none.

### 10. Plan Tier

Which subscription tiers unlock this feature — Free, Plus, or Family — and the per-tier limits that apply (e.g., planned meals per week, number of lists, household member seats). Include the breakdown if limits differ per operation. `n/a` if the feature is available on every tier with no limit.

Tier tables MUST cross-reference the canonical implementation file (e.g., `src/lib/plans.ts`). If PRD and code disagree, update the PRD -- code is the source of truth for runtime values.

### 11. Week Readiness Impact

Whether this feature affects the household's 0-100 week-readiness score, and how. Describe which scoring factors change and in what direction. `n/a` if no impact.

### 12. UI Reference

ASCII wireframe, screenshot link, or mockup reference showing the intended layout. For complex features, include multiple views (default state, loading state, error state, empty state).

### 13. Implementation Map

Table of files that change, what changes in each, and what existing code is reused. Call out new files only if truly needed.

### 14. Test Plan

Numbered steps to verify the feature end-to-end. Cover:

- Happy path (primary use case)
- Edge cases (empty states, boundary values)
- Error recovery (failures, retries)
- Integration points (data flow between components)

### 15. Out of Scope

What this PRD explicitly does NOT cover. Prevents scope creep. Names specific features, behaviors, or enhancements that are intentionally excluded. `n/a` if boundaries are obvious.

### 16. Open Questions

Unresolved decisions that need input before or during implementation. Each question should include the options being considered and a recommended default if no answer comes. `n/a` if all decisions are made.

### 17. UI Requirements

Design system guidance for builders. This section ensures generated UI matches the project's visual language and accessibility standards. `n/a` for features with no UI (API-only, background jobs).

**Components** — Which `src/components/ui/` components this feature uses. Note any missing variants that need to be created (builders will flag these rather than inventing ad-hoc replacements).

**Layout** — The layout pattern: viewport structure, flex direction, scroll behavior. Reference `COMPONENT_LIBRARY.md` viewport layout rules if applicable (outer `height: 100vh` + `overflow: hidden`, flex container with fixed chrome, main content `flex: 1` + `minHeight: 0` + `overflowY: auto`).

**Tokens** — Which color tokens from `COLOR_SEMANTICS.md` apply. Spacing scale values (8/12/16/20/32px). Border radius tokens (`--radius`, `--radius-lg`, `--radius-full`).

**Accessibility** — Interactive elements and their accessible names. Keyboard navigation requirements. Screen reader announcements for dynamic content (aria-live regions). Focus management for modals/overlays.

**States** — Loading states (Spin, skeleton, progress text). Error states (inline, toast, modal). Empty states. Disabled/locked states.

**Anti-Slop** — What this feature should NOT look like. No gradients, no frosted glass, no emoji in UI text, no decorative icons without function. Dark corporate theme: muted restraint, every element earns its place.

## Rules

- All 17 sections must be present. No section may be omitted.
- Use `n/a` rather than removing a section.
- PRDs do not contain user stories. Stories are written in separate passes.
- Copy/microcopy lives in the companion `COPY.md`, not in the PRD.
- File paths in Implementation Map must be relative to project root.
- PRDs reference existing code — they do not propose architecture.
- Feature Description must be self-contained — the complete target state, no "before/after" language.
- Feature Description = Current State (what stays) + Improvements (what's new), merged into one standalone spec.
- Assumptions must be documented even if they seem obvious.
- JTBD must use the standard "When/I want to/So I can" format.
- Emotional Framing must cover Entry, During, and Exit states.
- Goals must be concrete and verifiable.
- JTBD, Emotional Framing, and Goals must be platform-neutral — no browser, extension, or device-specific language.
- Feature Description is the single home for platform and technology specifics.

## Review Checklist

A PRD is acceptable only if:

1. All 17 sections are present
2. Classification (MVP / Post-MVP) is explicit
3. Current State includes file paths to existing code
4. Goals are concrete and measurable
5. JTBD uses the standard format with situation, motivation, outcome
6. Feature Description is self-contained and describes the complete target state
7. Feature Description does not reference "current state" or use before/after language
8. Improvements clearly describe the delta from current state
9. Emotional Framing covers entry, during, and exit states
10. Assumptions are documented
11. Implementation Map identifies files to change and code to reuse
12. Test Plan covers happy path + at least one error case
13. No user stories are embedded in the PRD
14. JTBD, Emotional Framing, and Goals are platform-neutral
15. Platform specifics appear only in Feature Description, Implementation Map, and Test Plan
16. UI Requirements specify components, tokens, accessibility, and anti-slop rules (or `n/a` for non-UI features)
