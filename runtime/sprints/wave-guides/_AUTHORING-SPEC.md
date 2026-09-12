# Design-guide authoring contract (ALL author agents follow this)

You author one or more UI/UX design-principle guides that TRAIN WarpOS's AI designer agents
(`product-designer`, `web-conversion-designer`, `design-quality`, `visual-review`). Read this
contract + `TAXONOMY.md` (your topics' scope, tier, sources, agent/axis mapping) +
`_seed-visual-hierarchy-example.md` (the depth benchmark) before writing.

## Output
- One file per topic: `_guides/design/<SLUG>.md` (create the `_guides/design/` dir if needed).
- Use the EXACT slug from TAXONOMY.md (e.g. `VISUAL_HIERARCHY.md`).
- Write each guide as soon as it's drafted (crash-safe checkpoint). One topic at a time.
- Do NOT touch other topics' files, the registry, or any agent spec — that's the later integration pass.

## Frontmatter (required — keeps /guides:coverage happy + carries design metadata)
```yaml
---
guide: <SLUG>
anchor: none            # design guides are agent-grounding refs, NOT bootstrap-pipeline-anchored
shape: walkthrough
timing: reference
lead_time: "none"
tier: core | standard
trains: [product-designer, web-conversion-designer, design-quality, visual-review]   # the ones this topic serves
maps_to: [<design-quality axis(es)>, <visual-review category(ies)>]   # e.g. [visual-hierarchy, layout]
sources: ["<url1>", "<url2>", ...]   # provenance only (NOT "go use this")
---
```

## Required structure (each guide — be EXTREMELY thorough, research-backed)
1. **# <Title>** + one-sentence definition.
2. **Why it matters** — for the product/user AND specifically for which designer agent(s) + which
   design-quality axis / visual-review category it governs.
3. **Core principles / techniques** — the substance, deep. Sub-principles, the *why* (perception/
   cognition/usability research), trade-offs. This is the bulk; ground it in the sources.
4. **Concrete examples** — do / don't pairs, described in build terms (Next/Tailwind/Radix/shadcn
   substrate), NOT screenshots and NOT "use tool X".
5. **Common failure modes** — what breaks, how it reads to the user, how to detect it.
6. **✅ Agent-applicable RULES (the payoff)** — a checklist of PASS/FAIL rules the design-quality /
   visual-review gauntlet can mechanically apply. Each rule: a checkable assertion + which axis/
   category it maps to + how to detect a violation. Phrase like the gauntlet's own findings
   (severity + observed-vs-expected). This section is mandatory and is the reason the guide exists.
7. **Sources** — citation list (provenance/evidence only).

## HARD constraints (operator-directed — non-negotiable)
1. **NO external-product/tool recommendations.** Never say "use Canva/Figma/<SaaS>." Teach the
   principle so the agent applies it DIRECTLY. (See the seed's ⚠️ anti-example.)
2. **Self-contained** — the agent learns the principle from the guide alone.
3. **Generic framework knowledge** — NOT product-specific (no origin-product colors/decisions).
4. **End in agent-checkable rules** (§6) mirroring the design-quality 6 axes
   (design-tokens, component-usage, visual-hierarchy, mobile-responsive, accessibility, design-handoff)
   and visual-review categories (color, layout, typography, copy, a11y, console-error, regression).

## Research method (by tier — from TAXONOMY.md)
- **tier: core** → real deep research. FOLLOW `.claude/commands/research/deep.md`: load keys
  (`export $(grep -E "^(OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY)=" .env.local | xargs)`), run the
  **OpenAI o3-deep-research** 4-phase curl + do your OWN 3-round WebSearch+WebFetch as the Claude
  engine. **GEMINI IS DOWN — skip the Gemini engine, do not error on it.** Save research artifacts under
  the research base (resolve `paths.research`) in a `design-<slug>` folder. Windows-safe temp paths,
  `tr -d '\r'` on node output. Synthesize, then author.
- **tier: standard** → NO paid deep run. Author from the TAXONOMY.md cited sources for the topic +
  light WebSearch/WebFetch to verify/flesh out. Same depth of WRITING, sourced not deep-crawled.

## Report back (final message)
List the guide files you wrote (paths), each one's tier + maps_to, any topic that needs follow-up,
and (for core) which engines succeeded + rough cost. Checkpoint as you go.
