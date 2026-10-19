---
description: Audit ROADMAP.md — detect completed items, stale entries, duplicates, hidden urgencies; propose a cleanup plan
says:
  - clean up the roadmap
  - tidy the roadmap
  - condense the roadmap
  - roadmap cleanup
says-flags:
  apply: --apply
---

# /roadmap:cleanup — ROADMAP Audit + Condense

Audit `ROADMAP.md` against project ground truth (sprints, commits, on-disk artifacts, shipped sections), then propose structural cleanup: reclassify completed items, group related entries, condense duplicates, surface buried urgencies. Default dry-run; `--apply` writes changes.

## Why

ROADMAPs rot. Items get shipped without being moved to "Shipped." Entries duplicate across sections. An epic's backlog grows into a flat 80-item list with no internal grouping. Real urgencies sit buried in Later. This skill is the periodic re-tidying that keeps ROADMAP honest as a working document, not a backlog graveyard.

## Input

`$ARGUMENTS` — optional flags:

- `--apply` — write changes to ROADMAP.md (default: dry-run, prints plan only).
- `--scope <section>` — limit audit to one section (e.g. `--scope "Later"`).
- `--age <days>` — flag items older than N days as stale (default: `30`).
- `--no-condense` — skip near-duplicate consolidation; only run completion detection.
- `--surface-only` — skip all proposed changes; just output Section "Surface important" (top 3–5 things to look at NOW).

## Phase 1: Load ground truth

Read in parallel:

- `ROADMAP.md` at project root.
- `paths.sprintActiveRegistry` — what sprints exist, their status (`closed` / `retrospected` → likely shipped).
- Last 30 days of commits (`git log --since="30 days ago" --oneline --no-merges`) — what actually shipped.
- `paths.eventsFile` events of type `release.*` or matching `sprint.*released` in last 30 days.
- The `## Shipped` section's bullets — what's already documented as shipped.
- `paths.systemsFile` — for cross-checking entries that name systems.

## Phase 2: Detection passes (run in parallel)

Each detector collects findings independently. Don't act yet — gather first.

**A. Completed-but-not-moved.** For each item under Known issues, an epic, the Sprint Pickup Queue or Later:
- Does a retrospected sprint title match the entry's topic? (Fuzzy match on key nouns.)
- Does the corresponding artifact (file, hook, skill, check, path key) exist on disk?
- Does a commit message in the last 30 days reference the entry's title or key noun?
- If yes to any: candidate for move → `## Shipped`. Record evidence.

**B. Partial completion.** For each item with a checkbox list:
- Count `- [x]` vs `- [ ]`. If ≥50% checked: candidate for split — done items move to Shipped, open items stay backlog.

**C. Stale.** Item heading dated > `--age` days ago, AND no related sprint, AND no commits referencing it, AND no Shipped-section reference. Surface for retire-or-revive decision (don't auto-retire).

**D. Duplicate / near-duplicate.** Two entries with >70% string overlap on title OR shared key noun + overlapping body topic. Propose consolidated wording.

**E. Contradictions.** Entry marked DEFERRED in one place, RESOLVED elsewhere (same topic). Or an entry in Known issues that's also listed in a Shipped section. Surface — don't auto-resolve.

**F. Reference rot.** Entries name file paths, skills, hooks, or path keys that no longer exist. Cross-check against actual fs + `paths.json` keys.

**G. Hidden urgency.** Entries containing "blocking", "broken", "regression", "fails today", "broken since", "leak", "data loss" in a non-urgent section (an epic's backlog, Later). Propose promotion → Known issues.

**H. Section imbalance.** A section with >40 entries while a sibling has <5. Propose subsectioning (don't auto-restructure).

**I. Version drift.** Entries referencing a specific version that has already shipped (e.g., "for v0.2.0" when current is v0.3+). Propose either move-to-shipped or update.

**J. Sprint-absorbed but unmarked.** Entry whose topic matches an active or closed sprint id, but the entry itself doesn't reference the sprint. Propose cross-reference annotation.

## Phase 3: Propose cleanup plan

Generate a markdown report with sections (skip a section if empty):

- **🚢 Move to Shipped** — list of items + evidence (sprint id / commit sha / artifact path).
- **🔀 Consolidate** — pairs/groups of duplicates + proposed merged wording.
- **🗑️ Retire** — stale items proposed for removal + last-modified date + why.
- **🚨 Promote urgency** — items to move from an epic's backlog or Later → Known issues, with quoted urgency signal.
- **💀 Reference rot** — entries with dead paths/keys; propose update or removal.
- **📐 Section restructure** — proposed sub-headings for oversize sections, with item-count diff.
- **🔗 Sprint cross-reference** — entries that should link to their sprint id.
- **📅 Version drift** — entries with stale version anchors.
- **⭐ Surface important** — top 3–5 items the audit thinks the user should look at NOW (newly-detected urgencies, contradictions, or stale-but-load-bearing items). Always present; this is the highest-value section.

If dry-run (default): print plan, end. Echo `Run /roadmap:cleanup --apply to execute.` Show counts per section.

If `--apply`: execute each proposed change in ROADMAP.md. Preserve formatting (blank lines around headings). Echo summary: `Applied: M moved, K consolidated, R retired, P promoted, S restructured, X cross-referenced.`

## Phase 4: Inline reasoning for ambiguous cases

If detection surfaces ambiguity (item could plausibly be "completed" or "still in progress" — evidence mixed), invoke `/reasoning:run` inline scoped to that specific item rather than auto-deciding. Log the trace to `paths.tracesFile` with `source: "roadmap:cleanup"`. Surface the resolution in the plan.

## Anti-patterns

- **Don't delete entries silently.** Every removal goes through the cleanup plan with cited evidence.
- **Don't merge unlike items.** "Near-duplicate" means same topic AND same scope — not "both mention paths."
- **Don't move items to Shipped without evidence.** A sprint title match alone is not enough — verify the actual artifact exists or a release event fired.
- **Don't restructure when `--no-condense`.** That flag is for "just tell me what's done."
- **Don't reword aggressively.** Preserve the original entry's voice when consolidating; readers came back for the entry they remember writing.

## Related

- `/roadmap:add` — append new entries (paired skill; consumes section hints)
- `/discover:orphaned` — find work that fell through cracks (complementary; works on NEXT.md / TODOs / branches, not ROADMAP)
- `/scan:references` — surfaces dead-path issues at code level
- `/sprint:retrospective` — sprints retrospected here are the canonical "completed" signal for detector A
