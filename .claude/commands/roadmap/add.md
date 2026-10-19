---
description: Append a new entry to ROADMAP.md — picks section, formats consistently, preserves existing content
says:
  - add to the roadmap
  - put this on the roadmap
  - roadmap add
  - add a roadmap entry
  - road map ad
says-args: free-text
---

# /roadmap:add — Add ROADMAP Entry

Append a new entry to `ROADMAP.md` at the project root. Picks the right section based on the entry's nature, formats it to match existing patterns, and appends without disrupting other content. Companion to `/roadmap:cleanup` which restructures and condenses.

## Input

`$ARGUMENTS` — free-form description of what to add, optionally including a pre-formatted markdown entry starting with `###`. The skill parses for:

- **Topic / title** *(required)* — what the entry is about
- **Section hint** *(optional)* — one of:
  - `--known-issues` — the current backlog (bugs, gaps, missing features)
  - `--epic <name>` — planned work under that epic in `## Epics`
  - `--later` — parked work, with the trigger that would revive it
  - `--queue` — a candidate for the next sprints, in `## Sprint Pickup Queue`
  - `--shipped <version>` — historical, already-shipped entry
  - `--new-section <name>` — only if no existing section fits (rare)
- **Status marker** *(optional)* — `DISCUSSED`, `DISCOVERED`, `REPORTED`, `DEFERRED`, `RESOLVED`, `FIXED` (default: `DISCUSSED`). Used in the `### Title (STATUS-YYYY-MM-DD)` heading.
- **Date** *(optional)* — defaults to today (UTC, `YYYY-MM-DD`).
- **Body** *(optional)* — if missing, write a one-line stub the user fills in later.

If `$ARGUMENTS` already contains a `###` markdown heading, treat the input as a pre-formatted entry. The skill's job becomes choosing the section and appending — no reformatting.

## Steps

1. Read `ROADMAP.md` at project root. If missing, error: `ROADMAP.md not found — run from project root or create a scaffold first.`
2. Parse `$ARGUMENTS` for topic, hints, status, date, body.
3. **Choose section** (state the choice explicitly before writing):
   - If a section hint flag is present, use it.
   - Else classify by signals:
     - Status `REPORTED` / `DISCOVERED` / `FIXED` → Known issues / current backlog.
     - Status `DEFERRED` / `DISCUSSED` of a research/exploration topic → Known issues with a clear "parked" framing.
     - Planned work → the matching epic under `## Epics` (name the epic; if more than one fits, say which and why).
     - Parked / trigger-gated → `## Later`.
     - Historical, already-shipped → `## Shipped`.
   - If nothing fits and no `--new-section` flag, fall back to Known issues with a clear status marker.
4. **Format** the entry to match the section's existing pattern:
   - Known issues / epic backlogs: `### Title (STATUS-YYYY-MM-DD)` heading + prose body. May include numbered hypotheses, bullet lists, cross-references.
   - Shipped sections: `- [x] **Title** — one-line summary` bullets.
   - Epic or Later items not under a status-style heading: prose paragraphs or `- [ ]` checklists.
5. **Append** at the END of the chosen section (just before the next `## ` heading or the `---` divider). Preserve a blank line before and after the new heading.
6. Echo: `Added to <Section>: <heading>. ROADMAP.md +<N> lines.`

## Anti-patterns

- **Don't rewrite existing entries.** This skill only appends. Consolidation belongs to `/roadmap:cleanup`.
- **Don't infer status from tone.** "We should think about this" → `DISCUSSED`, not `DEFERRED`. "Park this until later" → `DEFERRED`. "This was fixed in X" → `FIXED` or move to Shipped.
- **Don't create a new section unless `--new-section` is explicit.** Adding sections fragments the doc; `/roadmap:cleanup` handles structural changes.
- **Don't write a body the user didn't supply.** If only a topic is given, append a stub with a `<!-- TODO: body -->` marker the user can fill in.

## Related

- `/roadmap:cleanup` — periodic audit + condense + reclassify + surface stale items
- `_mc/templates/roadmap/ROADMAP-EXAMPLE.md` — the section shape this skill appends into
