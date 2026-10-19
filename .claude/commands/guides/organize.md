---
description: Audit and restructure the _guides/ launch-guide library — backfill the guide-anchor contract onto every guide, (re)generate _guides/registry.json, and flag structural drift — WITHOUT rewriting guide prose (that's /guides:write). The skills:cleanup analog for guides.
---

# /guides:organize — Audit + restructure the guide library

Take the whole `_guides/` library and make it **contract-complete and consistent**: every guide carries valid guide-anchor frontmatter, the machine-readable `_guides/registry.json` index is fresh, the README index agrees with what's on disk, and structural drift (duplicate coverage, wrong shape, an un-anchored guide) is surfaced. This is the `skills:cleanup` analog for guides.

> `_guides/` is **`owner=framework`, shipped** (ADR-0005). These guides install into every product. Organize touches **structure + frontmatter**, never the human-facing prose — rewriting a guide's content is `/guides:write`.

## Input

`$ARGUMENTS` (all optional):
- `--check` — report only; make no edits (dry run). Good for CI / pre-commit.
- `--guide <STEM>` — scope the audit to one guide (e.g. `--guide AUTH`).
- `--no-registry` — skip the `_guides/registry.json` rebuild (audit + frontmatter only).

## The contract this skill enforces (defined by `/guides:write`)

Every guide (except the README index) carries flat-scalar frontmatter:

```yaml
---
guide: <TOPIC>          # stable id, matches the filename stem (AUTH, PAYMENTS, …)
anchor: <pipeline spot> # spinup:preflight | spinup:intent | lastmile:audit
                        #   | lastmile:module/<name> | lastmile:gate/<name> | none
shape: walkthrough|checklist|notice
timing: project-start | at-module | at-gate | reference
lead_time: "<real-world wait>" | "none"
---
```

The README is the **index** — it carries `anchor: none`, `shape: notice`, `timing: reference`.

## Procedure

### Step 1 — Inventory + audit
Read every `_guides/*.md`. For each, classify:
- **contract-complete** — valid frontmatter (all 5 keys, anchor matches the namespace, shape/timing in the enum).
- **missing/partial frontmatter** — needs backfill (Step 2).
- **structural drift** — duplicate coverage with another guide, a shape that contradicts the content (e.g. a long-lead account-signup guide marked `walkthrough` instead of `checklist`/`notice`), or an anchor that doesn't match the README's "when to do it".

Ground the anchor/shape/timing decision in the **README's "When to do it" + "Recommended order of operations" tables** — those encode the operator-intended placement. Do not invent placement; derive it.

### Step 2 — Backfill the contract (unless `--check`)
For each guide missing valid frontmatter, prepend (or correct) the frontmatter block. Derive each field:
- **anchor** — from the guide's role in the journey. Long-lead external account setup → `spinup:preflight`. An integration the user wires → `lastmile:module/<name>`. A legal/approval item → `lastmile:gate/<name>`. The index → `none`.
- **shape** — `walkthrough` (interactive integration), `checklist` (readiness/coverage with a done-gate), `notice` (short heads-up at a moment).
- **timing** — `project-start` (long lead), `at-module` (when wiring it), `at-gate` (approval/legal), `reference` (index).
- **lead_time** — the real-world wait, verbatim from the guide/README (Apple/Play review, DNS propagation, Stripe verify). `"none"` when there is no external clock.

Editing frontmatter is in scope. Rewriting prose is NOT — if a guide's CONTENT needs work, note it and hand to `/guides:write`.

### Step 3 — Regenerate the registry (unless `--no-registry`/`--check`)
Run the deterministic builder:

```bash
node scripts/guides/registry.js
```

It reads frontmatter → writes `_guides/registry.json` (the byte-stable index that `/guides:integrate` and `/guides:coverage` consume). `--check` mode (`node scripts/guides/registry.js --check`) exits 1 if the registry is stale.

### Step 4 — Reconcile the README index
Ensure the README's guide table lists every non-index guide with a "when to do it" consistent with its `timing`/`anchor`. Fix table drift; do not rewrite the prose sections.

### Step 5 — Report
Emit: per-guide status (complete / backfilled / drift-noted), the registry result, and a short list of anything handed off to `/guides:write` (content) or flagged for `/guides:integrate` (anchored-but-not-wired). Then suggest `/guides:integrate` (wire the anchors) and `/guides:coverage` (verify green).

## Reuses / does not duplicate
- `scripts/guides/registry.js` — the single frontmatter parser + registry I/O (shared with integrate + coverage).
- Companions: `/guides:write` (author/rewrite one guide's content), `/guides:integrate` (place anchors into bootstrap), `/guides:coverage` (enforce).

## Anti-patterns
- Don't rewrite guide prose under the banner of "organize" — that's `/guides:write`.
- Don't invent an anchor — derive it from the README's timing map + the guide's journey role.
- Don't hand-edit `_guides/registry.json` — it's generated; edit frontmatter and rebuild.
- Don't leave a guide un-anchored — `/guides:coverage` will (correctly) fail on it.
