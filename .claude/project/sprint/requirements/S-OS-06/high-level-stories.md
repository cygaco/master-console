<!-- requirement-format-legacy -->
# High-Level Stories — Rebrand identifier layer: Master Console slug mc, mc@2.0.0 with one-release aliases + downstream migration

**Sprint:** `S-OS-06`
**PRD:** `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\project\sprint\requirements\S-OS-06\prd.md`

> High-level stories use the `H-N` id convention enforced by
> `scripts/hooks/requirement-format-guard.js`.

## H-1 — As Master Console, my entire live identifier surface says mc and I ship as mc@2.0.0, with no dangling warpos identifier outside evidence tags, the one 'formerly WarpOS' line, CHANGELOG history and alias shims

**As** the user
**I want** As Master Console, my entire live identifier surface says mc and I ship as mc@2.0.0, with no dangling warpos identifier outside evidence tags, the one 'formerly WarpOS' line, CHANGELOG history and alias shims
**So that** Master Console ships as `mc` end-to-end: a fresh clone, the CLI, the skill namespace, the env vars and the on-disk directories all say mc, version 2.0.0, with no dangling `warpos` identifiers in the live surface (only the evidence tags, the single 'formerly WarpOS' line, CHANGELOG history, deprecated-alias shims and allow-listed historical records remain). Existing installs and downstream products upgrade through one release of aliases without a manual step. This is the last rebrand chunk before the public announcement (phase 7).

Linked granular stories: see `granular-stories.md`.
Linked requirements: `R-1`.

## H-2 — As an existing install or downstream product, I keep working across the rename via one-release aliases and read-both env, and I upgrade to mc via a migration with no manual step

**As** the user
**I want** As an existing install or downstream product, I keep working across the rename via one-release aliases and read-both env, and I upgrade to mc via a migration with no manual step
**So that** Master Console ships as `mc` end-to-end: a fresh clone, the CLI, the skill namespace, the env vars and the on-disk directories all say mc, version 2.0.0, with no dangling `warpos` identifiers in the live surface (only the evidence tags, the single 'formerly WarpOS' line, CHANGELOG history, deprecated-alias shims and allow-listed historical records remain). Existing installs and downstream products upgrade through one release of aliases without a manual step. This is the last rebrand chunk before the public announcement (phase 7).

Linked granular stories: see `granular-stories.md`.
Linked requirements: `R-2`.
