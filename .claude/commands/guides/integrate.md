---
description: Wire each _guides/ guide into the bootstrap pipeline (spinup/lastmile) at its declared anchor in its declared shape, and record every placement in .claude/project/maps/guide-integration.jsonl — idempotent, read-before-write, with prior-integration conflict detection.
---

# /guides:integrate — Place guides into the bootstrap pipeline

Read the guide-anchor contract (frontmatter + `_guides/registry.json`) and **surface each guide at the right moment in the founder's journey**: long-lead day-zero items at `spinup` start, integrations at their `lastmile` module, legal/approval items at `lastmile` gates. Every placement is recorded so the operation is **idempotent** and **auditable**, and re-running detects + resolves conflicts instead of duplicating pointers.

> Like `bootstrap:spinup`/`lastmile`, the guides ship to products; this skill wires the **dev-tooling pipeline that surfaces them**. It mutates `.claude/commands/bootstrap/*.md` (reversible) and writes the recording store. Run `/guides:organize` first so anchors exist.

## Input

`$ARGUMENTS` (all optional):
- `--dry-run` — compute + report the placements and conflicts; write nothing.
- `--guide <STEM>` — integrate just one guide.
- `--rebuild` — re-derive all placements from the registry, superseding stale records (use after anchors change in `/guides:organize`).

## The recording system (the heart of this skill)

`.claude/project/maps/guide-integration.jsonl` (`paths.maps`/guide-integration.jsonl) — **append-only**, one record per guide×anchor placement:

```json
{"guide":"AUTH","anchor":"lastmile:module/auth","shape":"walkthrough","plugin_spot":"lastmile.md","marker":"guide-anchor:AUTH","inserted_at":"YYYY-MM-DDTHH:MM:SSZ","status":"active","conflicts_resolved":[]}
```

- `status`: `active` (currently wired) | `superseded` (anchor changed; left for audit trail).
- `conflicts_resolved`: list of what re-integration had to reconcile (e.g. `"moved AUTH from lastmile:module/auth to lastmile:module/email"`).

**READ THIS FILE FIRST, every run.** It is the idempotency + conflict-detection ledger — never blind-append a placement you already made.

## The anchor → plugin-spot map

| anchor | plugin spot (bootstrap file + region) |
|---|---|
| `spinup:preflight` | `spinup.md` — Phase 0 Preflight (long-lead day-zero items) |
| `spinup:intent` | `spinup.md` — Phase 1 Intent |
| `lastmile:audit` | `lastmile.md` — Phase 1 Product Readiness Audit |
| `lastmile:module/<name>` | `lastmile.md` — the matching Phase-2 module (database/auth/payments/crm/website/security/…); an unlisted `<name>` (e.g. `email`) is placed in the modules region with a labelled pointer |
| `lastmile:gate/<name>` | `lastmile.md` — the matching approval gate / pre-launch check |
| `none` | not wired (index/meta guide) |

## Procedure

### Step 1 — Load contract + ledger
Read `_guides/registry.json` (rebuild via `/guides:organize` if stale) and the full `guide-integration.jsonl`. Build the current placement state from `status:active` records.

### Step 2 — Compute the desired placement set
For each registry guide with `anchor != none`, resolve its plugin spot via the map above. Compare to the active ledger:
- **new** — no active record → insert.
- **unchanged** — active record + marker already present → skip (idempotent).
- **moved** — active record exists but anchor changed → supersede the old record (`status:superseded`), remove the old marker, insert at the new spot, log the move in `conflicts_resolved`.
- **conflict** — two guides resolve to the exact same insertion line → keep both, stack the pointers (a module can surface multiple guides); never silently drop one.

### Step 3 — Insert markers + pointers (unless `--dry-run`)
At each plugin spot, insert a machine-readable marker immediately followed by a human-visible pointer:

```markdown
<!-- guide-anchor:AUTH anchor:lastmile:module/auth shape:walkthrough -->
> 📘 **Launch guide — AUTH (walkthrough):** wiring sign-in? See [`_guides/AUTH_GUIDE.md`](../../../_guides/AUTH_GUIDE.md). Day-zero note: Google sensitive-scope OAuth verification can take days–weeks.
```

The marker is the contract `/guides:coverage` greps for; the pointer is what a reader sees. Match the shape: `notice` → a short ⚠️/📘 callout; `checklist`/`walkthrough` → a "see the guide" pointer at the module.

### Step 4 — Record
Append/supersede records in `guide-integration.jsonl` so it reflects the new active set. Set `inserted_at`, fill `conflicts_resolved` for any move/conflict.

### Step 5 — Verify + report
Run `node scripts/checks/guides-coverage.js`. Report: placements made (new/moved/skipped), conflicts resolved, and the coverage result. A green coverage is the done-gate.

## Reuses / does not duplicate
- `scripts/guides/registry.js` — registry read (shared parser).
- `scripts/checks/guides-coverage.js` — the verify step + the standing enforcer.
- Companions: `/guides:organize` (must run first — anchors), `/guides:coverage` (enforce).

## Anti-patterns
- Don't blind-append — READ the ledger first; re-running must be idempotent.
- Don't silently drop a guide when two resolve to one spot — stack the pointers.
- Don't insert a pointer without its marker — `/guides:coverage` keys off the marker (an unmarked pointer is invisible to enforcement).
- Don't wire an `anchor: none` guide.
