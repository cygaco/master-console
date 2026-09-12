# Changelog

All notable changes to Master Console (formerly WarpOS) are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

Every released version has a capsule under `framework/releases/<version>/` (`release.json`, `changelog.md`, `framework-manifest.json`) and a git tag `warpos@<version>`. This file condenses those changelogs. Where a capsule's notes were left as the generated placeholder at release time, the entry below says so rather than inventing content — the capsule and the commit history are the record. The engineering ledger, with the per-sprint release rows, is [RELEASES.md](RELEASES.md).

## [Unreleased]

### Changed
- **Rebrand, brand layer (E-OPEN-SOURCE-001 S-OS-05).** The project is now **Master Console**; README, contributor docs and the provenance story say "formerly WarpOS" where history is referenced. Identifiers (`warpos` package name, `warp:*` skills, `WARPOS_*` env vars, `_warpos/`, `warpos@` tags) are unchanged until `2.0.0`.
- Root docs reorganised: the unbuilt cross-project design spec moved to `_planning/design/`, the tracker-system brief to `_planning/`, the memory-hygiene write-up to `_docs/`; the `GEMINI.md` sunset tombstone was removed per its ADR-0036 removal-trigger (Gemini routes through `ANTIGRAVITY.md`); an operator-notes file was removed.

### Added
- `CONTRIBUTING.md`, `SECURITY.md` (GitHub private vulnerability reporting, no e-mail), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), this `CHANGELOG.md`, `docs/PROVENANCE.md` (the receipts) and `docs/RENAME-RUNBOOK.md` (the pending GitHub repository rename).
- `LICENSE` (AGPL-3.0), a root `package.json` (`npm test` runs the node test suite) and a license-match check (landed on `main` 2026-09-02, S-OS-02).

### Removed
- **2026-09-03 targeted history rewrite (S-OS-03).** A `git filter-repo` pass over the public history removed 20 string rules (seven verbatim quotes and one personal e-mail address) and purged nine paths (a paid third-party course corpus, two files marked confidential, one raw AI transcript, three private planning documents). The rewrite was range-limited: every commit up to tag `warpos@0.1.4` (`de9ba8eb`, 2026-05-01) is byte-identical, including the GitHub-signed commit `db6292e2`. Later commits have new SHAs; the old → new map is `runtime/open-source/rewrite/commit-map.txt`. If you cloned before 2026-09-03, re-clone (`runtime/open-source/rewrite/DOWNSTREAM-NOTICE.md`).
- Front-page cleanup (S-OS-02): private product content replaced by a synthetic example product under `_warpos/BASELINE/`, per-run runtime artifacts untracked, raw judgment-mining output moved out of the tracked tree.

## [1.2.0] — 2026-07-29

### Changed
- `/memory:verify` ships with its `--apply` executor **held fail-closed**: after five review rounds it could not guarantee that a successful delete leaves untouched bytes alone (it rewrote line endings of retained lines) or that a failed run leaves the store unchanged while reporting so. Four findings stay open, recorded in `trackers/sprints/SP-20260725-002-memory-verify.md`; there is no override. The read-only detector (`scripts/checks/memory-integrity.js`) ships and is useful on its own: missing index targets, unindexed memory files, duplicates, invalid frontmatter, malformed index lines.
- Two release gates that were killed on hosts with a large working tree (untracked-file listing outgrew the buffer) now bound the read and name the error; they report an honest *incomplete* rather than an opaque failure.
- The review process's finding-class boundaries (byte-fidelity, transaction-honesty) and the no-relabelling rule now live in a tracked ADR.

No breaking changes, no schema changes, no migrations.

## [1.1.0] — 2026-07-23

Capsule cut from `main`; release notes were not written at the time (the capsule carries the generated placeholder). See the commit history between `warpos@1.0.0` and `warpos@1.1.0`.

## [1.0.0] — 2026-07-22

First major release, cut after the WarpOS 1.0 hardening plan (ratified 2026-07-17). The capsule's notes were left as the generated placeholder; the plan and its evidence live under `_planning/warpos-1.0-plan/`.

## [0.17.0] — 2026-06-28

Capsule cut from `main`; notes left as the generated placeholder. See the commit history between `warpos@0.16.0` and `warpos@0.17.0`.

## [0.16.0] — 2026-06-12

### Added
- **Product Foundation seams (E-PRODUCT-FOUNDATION-001, S-PF-01…08):** every app scaffold ships a telemetry seam (`src/lib/telemetry/`, pluggable sink, fail-open); spinup intake captures the tech stack into a parseable `## Tech Stack` table; a founder-allowlist `/admin` route with HMAC-signed session cookies; a machine-readable `FOUNDERS_CHECKLIST.md`; new `_guides/` (analytics, deployment, admin tooling) and `_knowledge/` domains; five situational playbooks; a mobile billing policy (in-app digital goods route to platform billing by default).
### Fixed
- Dispatch and lifecycle hardening (SP-20260611-001/002): epsilon-runtime spawn-grace race, review-fallback enforcement, registry-derived build-chain roles, spoofed-timestamp window clamp, sprint-id correlation; team-guard/mode-guard bypass classes; turbo spend and authorization integrity; dispatch wrappers thread live mode into contract validation.

## [0.15.4] — 2026-06-08 · [0.15.3] — 2026-06-07 · [0.15.2] — 2026-06-07 · [0.15.1] — 2026-06-06 · [0.15.0] — 2026-06-06

Rapid capsules during the E-LIFECYCLE-001 sprints (epic tracking suite `/epic:*`, `_planning/` lifecycle store, planning-principles enforcer, turbo hardening, `bootstrap:spinup`). Notes were left as the generated placeholder in each capsule; the sprint trackers under `trackers/` carry the detail.

## [0.14.0] — 2026-06-05

### Changed
- **From a developer tool to a company (ADR-0007).** The mode-shaped agent folders are replaced by a department tree — `president/`, `product/`, `engineering/`, `growth/`, `_system/`, `_org/` — with mode-agnostic workers: 33 real agent specs (directors, leads, and the builder/reviewer/fixer roster).
- **`role-registry.json` keystone** — one source of truth for role identity, model, authority, dispatch route and reporting lines; dispatch consumers and the parity enforcers derive from it (ADR-0008, ADR-0010).
### Added
- **`_knowledge/`** — a shared institutional brain with library and store domains; `/knowledge:integrate` wires domains into consumer specs, `/knowledge:coverage` enforces it.
- **Sprint mode (`/mode:sprint`)** — ε conducts plan → design → build → gauntlet → release → retro from a declarative hook-point registry; β judges the four phase boundaries.
- **ε sprint runtime with real dispatch (ADR-0009)** — CLI-routable roles dispatch through the node runtime, the in-process roster through the harness with evidence-bound completion records; `recordAgentDispatch` refuses to write a record without a real outcome (the fake-green guard).
- Enforcers wired into `/scan:full`: `scan:cutover-completeness`, `scan:role-parity`, `scan:knowledge-coverage`, `scan:skill-hook-coverage`, `scan:sprint-hook-coverage`.
### Breaking
- Agent-folder paths changed; consumers receive the new tree via `/warp:update`. Backup branch `backup/pre-cutover-2026-06-04` preserves the old layout.

## [0.13.1] — 2026-06-01

### Fixed
- Release orchestrator (RI-003): `release-canonical.js` regenerates the framework manifest, the installed snapshot and `_warpos/MANIFEST.json` right after the capsule is built.

## [0.13.0] — 2026-06-01

### Added
- **`models:` skill suite** — `/models:check` (audit the dispatch catalog against vendor catalogs), `/models:update`, `/models:route`, `/models:router` (the dispatch console panel).
- Model catalog audited across all three providers; a new enforcer asserts the primary Gemini model agrees across every dispatch pin-point.
### Fixed
- Gemini key precedence (an interactive login no longer loses to an env key) and the auth prerequisite surfaced as a day-zero step.

## [0.12.1] — 2026-06-01

### Added
- **Guides skill suite** — `/guides:organize`, `/guides:integrate`, `/guides:coverage` on top of the `/guides:write` anchor contract; seven launch guides indexed in `_guides/registry.json` (schema `warpos/guides/registry/v1`).
- Growth agents and the five `growth:*` skills refined.

## [0.12.0] — 2026-05-31

Capsule cut from `main`; notes left as the generated placeholder. The `/guides:write` anchor contract, `_reports/` ELI5 reporting, and `scan:warpos-layer-diff` landed in this window.

## [0.11.1] — 2026-05-30

### Added
- **`/scan:version-coherence`** — one enforcer for version and schema-label drift across every manifest (including `.claude/manifest.json` and `install.ps1`); wired into `/scan:full` and the release gates.
### Fixed
- The release engine now bumps `.claude/manifest.json#warpos.version` and `install.ps1` along with `version.json`.

## [0.11.0] — 2026-05-30

Capsule cut from `main`; notes left as the generated placeholder. The Wave 0B lanes (untrusted-content ingest firewall, `/etc` authoring + eval harness, component-library scaffold wiring, role-parity enforcer) landed in this window.

## [0.10.0] — 2026-05-25

Capsule cut from `main`; notes left as the generated placeholder. The new-product on-ramp (`bootstrap:spinup`, `bootstrap:lastmile`), `/session:turbo`, `/permissions:authorized` and the install-completeness sprint landed in this window.

## [0.9.0] — 2026-05-23

### Added
- **Install pipeline reliability checkpoint:** a five-scenario install/update CI matrix (18 s) with regression injection, per-file status reporting (`added` / `repaired` / `unchanged` / `conflict`), idempotent applies, versioned migrations that skip already-applied steps, `userModified` tracking, `release-build` refusing a stale manifest, `.claude/manifest.json` always present. Purely additive.

## [0.8.2] — 2026-05-20

### Added
- `version-bump-guard.js` (refuses commits that stage framework files when the capsule for the current version already exists), `ledger-presence-guard.js`, `lint-hook-output.js`.
- Skills since 0.8.0: `/sprint:full` (autonomous plan → design → execute → release-prep → retro), `/check:ac-coverage`, `/check:node-procs`, `/enforcement:log` and `/enforcement:list`.
- Rolls in the notes 0.8.1 never received.

## [0.8.1] — 2026-05-20

Patch capsule; notes carried by 0.8.2.

## [0.8.0] — 2026-05-14 · [0.7.2] — 2026-05-14 · [0.7.1] — 2026-05-14 · [0.7.0] — 2026-05-14 · [0.6.1] — 2026-05-14 · [0.6.0] — 2026-05-14 · [0.5.0] — 2026-05-13

The hardened update pipeline (preflight + transactional apply + postflight; sprint SP-20260514-001 "WarpOS 0.7.0"), turbo as a mode argument, the sprint routing-policy enforcer, the Sprint Workflow v0.2 multi-sprint parallelism (`_docs/sprint/CHANGELOG_v0.2.md`) and the `/portfolio:bootstrap` brief skill (`_docs/sprint/CHANGELOG_0.5.1.md`). Capsule notes were left as the generated placeholder; the RELEASES.md sprint rows link the per-sprint changelogs.

## [0.4.4] — 2026-05-12

### Fixed
- **Critical dispatch-stdin fix.** The 0.3.0 `spawnSync` conversion passed the prompt as a string on Windows and silently broke every cross-provider review; restored.

## [0.4.3] — 2026-05-11

### Fixed
- `install.ps1` regenerates `framework-manifest.json` against the target tree instead of copying the canonical snapshot, so `/warp:doctor` stops reporting a permanently stale manifest in product repos.

## [0.4.2] — 2026-05-11

### Fixed
- Three install bugs in 0.4.0/0.4.1: `scripts/sprint/` and `scripts/dispatch/` missing from the manifest allowlist (sprint commands shipped without their engine), plus two manifest/snapshot defects. Products on 0.4.0/0.4.1 re-bootstrap once.

## [0.4.1] — 2026-05-11

### Changed
- `update.js` auto-discovers a canonical clone (sibling `../WarpOS/`, `../warpos/`, `manifest.json#warpos.source`, `framework-installed.json#source`) so `/warp:update --to <v>` works without `--source`.

## [0.4.0] — 2026-05-11

### Added
- **Sprint Workflow v0.1** — `/sprint:plan`, `/sprint:design`, `/sprint:execute`, `/sprint:release` as a product workflow layer above the modes, with plan contracts, tickets, crash-safe progress and an approval-aware stop condition.
- **Phase 0 reliability prerequisites** (source landed as 0.3.0 at `b3a5ab06`, never capsule-released): the dispatch-route guard (blocks raw `codex exec` / `gemini -p` / piped `claude` from Bash), dispatch telemetry, and nine further workstreams.

## [0.3.0] — 2026-05-11 (source only, no capsule)

Phase 0 framework-reliability prerequisites at commit `b3a5ab06`; released with 0.4.0.

## [0.2.2] — 2026-05-04

### Fixed
- The migrations loader walks the semver chain (wildcard `from` patterns), so 0.1.x installs upgrade in one `/warp:update` call instead of silently skipping every migration.

## [0.2.1] — 2026-05-04

Capsule cut from `main`; notes left as the generated placeholder.

## [0.2.0] — 2026-05-03

### Changed (breaking)
- Structural rename pass: `requirements/` → `_requirements/`, `docs/` → `_docs/`, `warpos/` → `framework/`; requirements chapters renumbered; `docs/*` framework dirs merged back into `_requirements/*`.
### Added
- Six `paths.json` keys for the most-hardcoded literals; ten `/check:warpos-*` regression-prevention skills; `.gitignore` template additions distributed via the framework.

## [0.1.4] — 2026-05-02

Capsule cut from `main` (tag commit `de9ba8eb`, 2026-05-01 local time / 2026-05-02 UTC); notes left as the generated placeholder. This is the public pre-announcement artifact referenced in [docs/PROVENANCE.md](docs/PROVENANCE.md).

## [0.1.3] — (no capsule; known gap)

## [0.1.2] — 2026-05-01

### Changed
- Product-repo promotion made generic (the source slug is read from the manifest, not hard-coded); `/warp:promote` rewritten as a source-to-canonical reconciler; the recommended next action no longer auto-pushes.

## [0.1.1] — 2026-05-01

### Added
- Phase 4–6 quality-gate hardening: the 14-gate release-gates suite (`scripts/warpos/release-gates.js`), production-baseline and contract-versioning gates, session telemetry rollup, and the third Refactor & Rename Hygiene rule in `CLAUDE.md`.

## [0.1.0] — 2026-04-30

### Added
- **First versioned baseline.** `paths.registry.json` as the single source of truth for path keys with `scripts/paths/build.js` generating every view; framework-manifest schema v2 (stable ids, hashes, merge strategies, ownership); `framework-installed.json` v2; the path-coherence gate and the write-time `path-guard` / `path-registry-guard` hooks.

Before 0.1.0 the framework lived unversioned in this repository from 2026-03-02 (first hooks and skills synced 2026-03-19; full extraction as "v0.1.0" on 2026-04-12, commit `cd37d410`). See [docs/PROVENANCE.md](docs/PROVENANCE.md).

[Unreleased]: https://github.com/cygaco/WarpOS/compare/warpos@1.2.0...main
[1.2.0]: https://github.com/cygaco/WarpOS/releases/tag/warpos@1.2.0
[1.1.0]: https://github.com/cygaco/WarpOS/releases/tag/warpos@1.1.0
[1.0.0]: https://github.com/cygaco/WarpOS/releases/tag/warpos@1.0.0
[0.17.0]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.17.0
[0.16.0]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.16.0
[0.14.0]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.14.0
[0.13.1]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.13.1
[0.13.0]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.13.0
[0.12.1]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.12.1
[0.12.0]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.12.0
[0.11.1]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.11.1
[0.11.0]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.11.0
[0.10.0]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.10.0
[0.9.0]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.9.0
[0.8.2]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.8.2
[0.8.1]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.8.1
[0.4.4]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.4.4
[0.4.3]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.4.3
[0.4.2]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.4.2
[0.4.1]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.4.1
[0.4.0]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.4.0
[0.2.2]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.2.2
[0.2.1]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.2.1
[0.2.0]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.2.0
[0.1.4]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.1.4
[0.1.2]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.1.2
[0.1.1]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.1.1
[0.1.0]: https://github.com/cygaco/WarpOS/releases/tag/warpos@0.1.0
