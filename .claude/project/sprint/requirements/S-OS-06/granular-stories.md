<!-- requirement-format-legacy -->
# Granular Stories — Rebrand identifier layer: Master Console slug mc, mc@2.0.0 with one-release aliases + downstream migration

**Sprint:** `S-OS-06`
**High-level stories:** `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\project\sprint\requirements\S-OS-06\high-level-stories.md`

> Granular stories use the `S-N` id convention enforced by
> `scripts/hooks/requirement-format-guard.js`. Each granular story
> should produce roughly one ticket during `/sprint:design`.

## S-1 — Build an idempotent rename-mc.js codemod with a dry-run plan + per-category counts and a committed rule ledger

**As** the user
**I want** Build an idempotent rename-mc.js codemod with a dry-run plan + per-category counts and a committed rule ledger
**So that** Master Console ships as `mc` end-to-end: a fresh clone, the CLI, the skill namespace, the env vars and the on-disk directories all say mc, version 2.0.0, with no dangling `warpos` identifiers in the live surface (only the evidence tags, the single 'formerly WarpOS' line, CHANGELOG history, deprecated-alias shims and allow-listed historical records remain). Existing installs and downstream products upgrade through one release of aliases without a manual step. This is the last rebrand chunk before the public announcement (phase 7).

Acceptance criteria:
- AC-1: (set by design step)

Linked: `H-1`, `R-1`.
COPY: see `copy.md`.
INPUTS: see `inputs.md`.
TRACE: see `trace.md`.

## S-2 — Ship warp:*->mc:* and scan:warpos-*->scan:mc-* deprecated-alias skills for one release

**As** the user
**I want** Ship warp:*->mc:* and scan:warpos-*->scan:mc-* deprecated-alias skills for one release
**So that** Master Console ships as `mc` end-to-end: a fresh clone, the CLI, the skill namespace, the env vars and the on-disk directories all say mc, version 2.0.0, with no dangling `warpos` identifiers in the live surface (only the evidence tags, the single 'formerly WarpOS' line, CHANGELOG history, deprecated-alias shims and allow-listed historical records remain). Existing installs and downstream products upgrade through one release of aliases without a manual step. This is the last rebrand chunk before the public announcement (phase 7).

Acceptance criteria:
- AC-1: (set by design step)

Linked: `H-1`, `R-2`.
COPY: see `copy.md`.
INPUTS: see `inputs.md`.
TRACE: see `trace.md`.

## S-3 — Ship a WARPOS_*->MC_* read-both env helper and _warpos//.warpos/ fallback read

**As** the user
**I want** Ship a WARPOS_*->MC_* read-both env helper and _warpos//.warpos/ fallback read
**So that** Master Console ships as `mc` end-to-end: a fresh clone, the CLI, the skill namespace, the env vars and the on-disk directories all say mc, version 2.0.0, with no dangling `warpos` identifiers in the live surface (only the evidence tags, the single 'formerly WarpOS' line, CHANGELOG history, deprecated-alias shims and allow-listed historical records remain). Existing installs and downstream products upgrade through one release of aliases without a manual step. This is the last rebrand chunk before the public announcement (phase 7).

Acceptance criteria:
- AC-1: (set by design step)

Linked: `H-1`, `R-3`.
COPY: see `copy.md`.
INPUTS: see `inputs.md`.
TRACE: see `trace.md`.

## S-4 — Keep warpos-tracked-transients.js as an alias shim so the leak-gate workflow needs no edit

**As** the user
**I want** Keep warpos-tracked-transients.js as an alias shim so the leak-gate workflow needs no edit
**So that** Master Console ships as `mc` end-to-end: a fresh clone, the CLI, the skill namespace, the env vars and the on-disk directories all say mc, version 2.0.0, with no dangling `warpos` identifiers in the live surface (only the evidence tags, the single 'formerly WarpOS' line, CHANGELOG history, deprecated-alias shims and allow-listed historical records remain). Existing installs and downstream products upgrade through one release of aliases without a manual step. This is the last rebrand chunk before the public announcement (phase 7).

Acceptance criteria:
- AC-1: (set by design step)

Linked: `H-1`, `R-4`.
COPY: see `copy.md`.
INPUTS: see `inputs.md`.
TRACE: see `trace.md`.

## S-5 — Rename the 19 paths-registry keys via /paths:rename + build.js and verify they survive the generated views

**As** the user
**I want** Rename the 19 paths-registry keys via /paths:rename + build.js and verify they survive the generated views
**So that** Master Console ships as `mc` end-to-end: a fresh clone, the CLI, the skill namespace, the env vars and the on-disk directories all say mc, version 2.0.0, with no dangling `warpos` identifiers in the live surface (only the evidence tags, the single 'formerly WarpOS' line, CHANGELOG history, deprecated-alias shims and allow-listed historical records remain). Existing installs and downstream products upgrade through one release of aliases without a manual step. This is the last rebrand chunk before the public announcement (phase 7).

Acceptance criteria:
- AC-1: (set by design step)

Linked: `H-1`, `R-5`.
COPY: see `copy.md`.
INPUTS: see `inputs.md`.
TRACE: see `trace.md`.

## S-6 — Author + fixture-test migrations/1.2.0-to-2.0.0/ for the 8 downstream products

**As** the user
**I want** Author + fixture-test migrations/1.2.0-to-2.0.0/ for the 8 downstream products
**So that** Master Console ships as `mc` end-to-end: a fresh clone, the CLI, the skill namespace, the env vars and the on-disk directories all say mc, version 2.0.0, with no dangling `warpos` identifiers in the live surface (only the evidence tags, the single 'formerly WarpOS' line, CHANGELOG history, deprecated-alias shims and allow-listed historical records remain). Existing installs and downstream products upgrade through one release of aliases without a manual step. This is the last rebrand chunk before the public announcement (phase 7).

Acceptance criteria:
- AC-1: (set by design step)

Linked: `H-1`, `R-1`.
COPY: see `copy.md`.
INPUTS: see `inputs.md`.
TRACE: see `trace.md`.

## S-7 — Flip framework-purity to fail on warpos in LIVE dirs with a historical allow-list; cut 2.0.0; regen both manifests last

**As** the user
**I want** Flip framework-purity to fail on warpos in LIVE dirs with a historical allow-list; cut 2.0.0; regen both manifests last
**So that** Master Console ships as `mc` end-to-end: a fresh clone, the CLI, the skill namespace, the env vars and the on-disk directories all say mc, version 2.0.0, with no dangling `warpos` identifiers in the live surface (only the evidence tags, the single 'formerly WarpOS' line, CHANGELOG history, deprecated-alias shims and allow-listed historical records remain). Existing installs and downstream products upgrade through one release of aliases without a manual step. This is the last rebrand chunk before the public announcement (phase 7).

Acceptance criteria:
- AC-1: (set by design step)

Linked: `H-1`, `R-2`.
COPY: see `copy.md`.
INPUTS: see `inputs.md`.
TRACE: see `trace.md`.

