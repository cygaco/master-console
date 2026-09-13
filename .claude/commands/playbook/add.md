---
description: Append a play to the Playbook (.claude/project/reference/playbook.md) — a named, example-anchored operating principle. Picks the right section, formats to match, appends without disturbing other plays.
---

# /playbook:add — Add a Play

Append a new **play** to `.claude/project/reference/playbook.md` — the living collection of operating principles for taking products to PMF. A play is a reusable judgment: a named belief + the reasoning + an example. Companion to the Playbook the Director of Product and Director of QA consult.

## Input

`$ARGUMENTS` — free-form description of the play, optionally a pre-formatted entry starting with `###`. Parse for:

- **Title** *(required)* — the play's name (becomes the `### Title` heading).
- **Section hint** *(optional)* — `--qa` · `--product` · `--gtm` · `--engineering`, or `--new-section <name>` (only when no existing section fits).
- **Body** — the play itself. If absent, write a one-line stub the user fills in later.

If `$ARGUMENTS` already contains a `###` heading, treat it as pre-formatted: choose the section and append, no reformatting.

## Steps

1. Read `.claude/project/reference/playbook.md`. If missing, error: `Playbook not found at .claude/project/reference/playbook.md`.
2. Parse `$ARGUMENTS` for title, section hint, body.
3. **Choose the section** (state the choice before writing). Existing sections: **QA & Testing**, **Product**, **GTM, Launch & Community**, **Engineering**. Classify by signal:
   - testing / bugs / severity / coverage / release-gating → **QA & Testing**
   - what-to-build / sequencing / audience / scope → **Product**
   - launch / marketing / community / growth / monetization → **GTM, Launch & Community**
   - how-to-build / architecture / build-vs-buy / tooling → **Engineering**
   - nothing fits + `--new-section` given → create a new `## <name>` section before the final one.
4. **Format** to match existing plays: `### Title` heading, a **bold one-line thesis**, then the reasoning, a **worked example**, and a `*(source / lineage / date)*` line. Keep it short and opinionated.
5. **Append** at the END of the chosen section — just before the next `## ` heading or the `---` divider — preserving the placeholder line for that section if present (replace a `*(plays about … — add via /playbook:add)*` stub with the real play; otherwise append after the last play).
6. Convert any relative date to absolute (UTC `YYYY-MM-DD`).
7. After writing, **regenerate the framework manifests** (the Playbook is framework-tracked): `node scripts/generate-framework-manifest.js && node scripts/mc/manifest/build.js`, so the regression-seed enforcer (BC-02/BC-05) stays green. (See `project_regen_manifests_after_framework_edit`.)
8. Echo: `Added to <Section>: <heading>. playbook.md +<N> lines.`

## Anti-patterns

- **Don't rewrite existing plays.** Append-only — consolidation is a separate, deliberate edit.
- **Don't write a body the user didn't supply.** Stub it with `<!-- TODO: body -->`.
- **Don't invent a section.** Reuse an existing one unless `--new-section` is explicit.
- **Don't skip the manifest regen** (Step 7) — an un-regenerated Playbook edit reds the enforcer.

## Related

- The Playbook itself — `.claude/project/reference/playbook.md`
- `director-of-product` / `quality-lead` agents — the primary consumers
- `/roadmap:add` — the structural sibling this mirrors
- `.claude/project/reference/product-lifecycle.md`, `product-robustness.md` — adjacent canon
