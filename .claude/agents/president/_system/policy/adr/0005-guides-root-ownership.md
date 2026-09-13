# ADR-0005 — Root-level `_guides/` as `owner=framework`, shipped + `/warp:update`-managed

**Date:** 2026-05-31
**Status:** accepted
**Sprint:** SP-20260531-002
**Decision class:** B (Beta DECIDE 0.87 — `EVT-sp20260531-002-guides-owner-model-beta-001`)

## Context

MC needs a home for **product-facing launch guides** (the first being `DEV_SETUP_GUIDE.md` — the newbie Google-SSO + Apple/Google-Play launch playbook) that **ship to consumer products** so vibecoders receive them when they scaffold/install.

The ownership model (SP-20260522-001, `_mc/MANIFEST.json` built by `scripts/mc/manifest/build.js`) classifies every path as `framework | generated | project | runtime` and **fails loudly on any unclassified path**. Its rule-6 default sends root-level content to `owner=project`. But `scan:mc-ship-coverage`'s model treats project-owned root content as *not shipped from canonical* (e.g. `_requirements/00-canonical/` is allowlisted as "consumers generate their own"). So a root-level `_guides/` that **must ship** needed a deliberate ownership call rather than falling through to `project`.

## Decision

Classify `_guides/**` as **`owner=framework`, `managed=true`** via a named `framework-guides-dir` rule in `build.js#buildRules()`, ordered before the rule-6 catch-all, and add `_guides` to `scripts/generate-framework-manifest.js#ASSET_DIRS` so it ships.

- **`owner=framework`** — MC-authored documentation that ships to consumers is framework content, even though it lives at the repo root (this is the new precedent — see Consequences).
- **`managed=true`** — `/warp:update` propagates guide updates downstream (a guide that ships but never updates would defeat the purpose).
- The fail-closed **ship boundary** is enforced by `scan:mc-ship-coverage` (extended this sprint): `MUST_SHIP` prefix `_guides/` and `MUST_NOT_SHIP` prefixes `_planning/`, `_reports/`. The check exits non-zero (not warn-only) on either a missing must-ship or a present must-not-ship, and is surfaced in `scan:full`.
- `DEV_SETUP_GUIDE.md` was removed from `walk-skip.js#WALK_SKIP_FILES` (it previously was "not framework, not shipped") so it is enumerated and shipped.

## Consequences

- **First root-level `owner=framework` directory** — a new ownership-model precedent. Prior framework content lived under `framework/`, `schemas/`, `patterns/`, `.claude/commands|agents/`. This documents that MC-authored, ships-to-consumer, update-managed documentation may live at a root `_guides/`.
- Operator scratch (`_planning/`) and per-project output (`_reports/`) remain **walk-skipped** AND are now **asserted to never ship** (fail-closed), closing enforcement-debt **ED-012** (the framework/product ship boundary was previously convention-only).
- **Reversible**: if `_guides/` ever needs to become project-owned, it is a one-rule edit in `build.js` + a manifest regen.

## Alternatives rejected

- **(B) `owner=project` + ship via ASSET_DIRS anyway** — semantically contradictory; project-owned content shipping from canonical breaks the `scan:mc-ship-coverage` model.
- **(C) Seeded-template model** (guide source under `framework/templates/guides/`, seeding a product-side `_guides/`) — solves a different problem, adds complexity the operator did not ask for ("a `_guides` folder that ships").

## References

- Sprint: `SP-20260531-002` · Plan Contract `PC-20260531-0059`
- Enforcer: `scripts/checks/mc-ship-coverage.js` (MUST_SHIP / MUST_NOT_SHIP)
- Classifier: `scripts/mc/manifest/build.js#framework-guides-dir`
- Shipper: `scripts/generate-framework-manifest.js#ASSET_DIRS` (`_guides`)
- Closes: ED-012
