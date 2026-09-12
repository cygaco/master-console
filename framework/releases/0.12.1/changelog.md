# WarpOS 0.12.1 — 2026-06-01

## What's new since 0.12.0

- **Guides skill suite** — completes the `_guides/` launch-guide system on top of the `/guides:write` anchor contract shipped in 0.12.0:
  - `/guides:organize` — audit + restructure the library, backfill the guide-anchor contract onto every guide, (re)generate `_guides/registry.json`. The `skills:cleanup` analog for guides.
  - `/guides:integrate` — wire each guide into the bootstrap pipeline (`bootstrap/spinup.md`, `bootstrap/lastmile.md`) at its declared anchor + shape; idempotent, read-before-write, with a `.claude/project/maps/guide-integration.jsonl` recording ledger.
  - `/guides:coverage` — fail-closed enforcer (6 invariants; runner-error ≠ pass). The `/scan:scan-coverage` + `/maps:coverage` analog for guides.
  - `scripts/guides/registry.js` — single frontmatter parser + deterministic registry I/O, shared by all three skills.
  - `scripts/checks/guides-coverage.js` — the enforcer engine.
  - The 7 launch guides (AUTH/DATABASE/DEV_SETUP/EMAIL/PAYMENTS/PRIVACY_GDPR/README) now carry anchor-contract frontmatter; `_guides/registry.json` indexes them; guides are wired into the bootstrap pipeline with an auditable ledger.

- **Marketing/growth refinement** — refined the corpus-fed agents (`copy-lead`, `growth-lead`, `research-insight-lead`) + 5 `growth:*` skills (`ad-images`, `advertorial`, `angles`, `message-brief`, `product-finder`) against the HIGH-confidence corpus of an external brand-building methodology (paid course, not redistributed).

## Breaking changes

- None.

## Schema changes

- New: `warpos/guides/registry/v1` (`_guides/registry.json`).

## Migrations

- None.

## Pinned commit

Captured at release-build time (recorded in release.json#commit after scripts/warpos/release-build.js runs).
