# Changelog

All notable changes to Master Console are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

Where a capsule's notes were left as the generated placeholder at release time, the entry below says so rather than inventing content.

## [2.1.0] — Unreleased

### Added
- **Lean gauntlet.** During an active sprint each commit carries a change trailer (`change`, `blast`, `risks`); a commit-message guard checks it, fails open on its own errors and has a kill switch. A package selector, `scripts/sprint/gauntlet-package.js`, picks the gauntlet package from the trailer and the files a change touches, so a small change no longer pays for the whole suite. A differential oracle checks the selector's choice against the full suite and subtracts the quarantine register.
- **Operator message contract.** Status messages use fixed headers and an executive register. A Stop-hook lint checks them; it is on by default and can be switched off per install.
- **Voice skill routing.** Skills declare the sentences that should reach them (`says:` in their frontmatter), and a deterministic prompt-time router maps a dictated sentence to its skill. The router runs on every prompt by default and can match any routable skill by its name, not only the 71 that declare `says:`. Irreversible skills always ask before running, and permission-widening skills run only when named exactly.

### Changed
- **Model refresh (2026-10-03).** The model catalog is refreshed. Builders and other doers move to Claude Sonnet 5.5, and the OpenAI lanes default to the GPT-6 family. The Claude provider default and the in-process roles stay on Claude Opus 4.8 until a later release proves what the harness serves. Reviewer defaults stay where they were until a replay proof lands. The codex resolver prefers the newest npm `@openai/codex` over an older bundled binary, and never runs a candidate binary before it passes the path guards.
- **Deprecation window extended.** The pre-2.0.0 skill aliases, environment variables and directory fallbacks named in the 2.0.0 deprecation policy below were announced for removal in 2.1.0. They now stay through 2.1.x and are removed in 2.2.0.
- **Deprecated command aliases hidden.** The 33 deprecated alias forwarders no longer appear in the skill menu or the skill catalog, and Claude Code no longer lists them as slash commands. Claude can still run one when asked for it by name. They are removed in 2.2.0.

### Fixed
- A gauntlet package close now refuses unless every scheduled stage has a signed completion record or an explicit skip with a reason; skipping a review stage also needs an operator acknowledgement, and every skip is stamped on the closed event. A close whose differential fails writes a refusal, not a closed event. Before, a close could report the full package with no reviews dispatched.
- A failed gauntlet stage now halts the sprint and shows the stage's output, instead of stopping silently.
- The codex resolver no longer runs binaries found on PATH before validating them, and no longer passes a path through `cmd.exe`.
- The voice router no longer reaches a confident match from a negated or past-tense mention ("disable turbo mode", "I already ran the full scan"), and a skill with a missing confirm class asks instead of running.
- The operator-contract lint accepts text after a header, needs a real command signal before it calls a line a command, and classifies code fences by what they hold.
- Test runs no longer write fixture rows into the real events log.

### Known issues
- **GPT-6 default lanes need codex 0.160 or newer** (npm `@openai/codex`). The desktop-bundled codex 0.146 returns HTTP 400 on every GPT-6 lane. The resolver prefers the newer npm binary, and `models:check` warns whenever the codex it finds is older than 0.160, but a machine with only the bundled binary gets errors on those lanes.
- **Codex runs cannot prove which model served them.** The dispatch smoke checks that codex itself reports running the requested model; there is no server-attested served id, and the model's own answer about its id is not reliable.
- **A package close checks that each review ran, not what it concluded.** A failing review still counts as a completed stage at close; the release decision reads the verdicts separately. Test and mechanical stages are recorded from evidence the caller commits to.
- **The operator-contract lint fails open by design.** A crash or malformed input lets the turn end normally; the lint shapes messages and is not a security control.
- **Older event logs still hold test fixture rows.** Rows that test runs wrote before this release stay in the logs, which are append-only. Readers can recognise them by sprint or unit id: `SP-CLI2`, `SP-DIFF`, `SP-GAP7-CLI`, `SP-POISON`, `SP-R3STRICT-*`, `SP-R3LENIENT-*` and `SP-DIFFQ-*` on gauntlet-package events; `SP-T` and `SP-GP-*` on manager-consult events; `SP-TEST-*` sprints and beta-consult rows that cite an `SP-J<n>` rubric; and the `ROADMAP.md` ledger receipt.
- **Migrated alias skills still name 2.1.0.** Alias skills that the 1.2.0 → 2.0.0 migration wrote into a product say "Removed in mc@2.1.0". The removal is in 2.2.0.

## [2.0.0] — 2026-10-06

### Deprecation policy
- warp:* / scan:warpos-* skill aliases, WARPOS_* env, and _warpos//.warpos/ directory fallbacks are supported through 2.0.x and REMOVED in 2.1.0. **Moved on 2026-10-06:** the removal is now in 2.2.0, and 2.1.0 keeps them working (see [2.1.0]).

### Changed
- **Identifier layer.** The engine's identifiers move to the `mc` slug: `mc:*` skills and `scan:mc-*` scans, `MC_*` environment variables (read through one read-both helper that prefers the new name), the `_mc/` and `.mc/` directories, the `MC.md` gap register, and `mc@` release tags from this release on. Installs at 1.2.0 upgrade through `migrations/1.2.0-to-2.0.0/` (directory layout, settings and hook wiring, skill references). Home-directory state is read from the new location first and the old one second; nothing is moved automatically.
- **Rebrand, brand layer.** The project is now **Master Console**.
- Root docs reorganised: the `GEMINI.md` sunset tombstone was removed per its ADR-0036 removal-trigger (Gemini routes through `ANTIGRAVITY.md`).

### Added
- `CONTRIBUTING.md`, `SECURITY.md` (GitHub private vulnerability reporting, no e-mail), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), this `CHANGELOG.md`.
- `LICENSE` (AGPL-3.0), a root `package.json` (`npm test` runs the node test suite) and a license-match check.

### Removed
- Per-run runtime artifacts untracked.

## [1.2.0] — 2026-07-29

### Changed
- `/memory:verify` ships with its `--apply` executor **held fail-closed**: it could not guarantee that a successful delete leaves untouched bytes alone (it rewrote line endings of retained lines) or that a failed run leaves the store unchanged while reporting so. There is no override. The read-only detector (`scripts/checks/memory-integrity.js`) ships and is useful on its own: missing index targets, unindexed memory files, duplicates, invalid frontmatter, malformed index lines.
- Two release gates that were killed on hosts with a large working tree (untracked-file listing outgrew the buffer) now bound the read and name the error; they report an honest *incomplete* rather than an opaque failure.
- The review process's finding-class boundaries (byte-fidelity, transaction-honesty) and the no-relabelling rule now live in a tracked ADR.

No breaking changes, no schema changes, no migrations.

## [1.1.0] — 2026-07-23

Capsule cut from `main`; release notes were not written at the time (the capsule carries the generated placeholder).

## [1.0.0] — 2026-07-22

The capsule's notes were left as the generated placeholder.

## [0.17.0] — 2026-06-28

Capsule cut from `main`; notes left as the generated placeholder.

## [0.16.0] — 2026-06-12

### Added
- **Product Foundation seams:** every app scaffold ships a telemetry seam (`src/lib/telemetry/`, pluggable sink, fail-open); spinup intake captures the tech stack into a parseable `## Tech Stack` table; a founder-allowlist `/admin` route with HMAC-signed session cookies; a machine-readable `FOUNDERS_CHECKLIST.md`; new `_guides/` (analytics, deployment, admin tooling) and `_knowledge/` domains; five situational playbooks; a mobile billing policy (in-app digital goods route to platform billing by default).
### Fixed
- Dispatch and lifecycle hardening: epsilon-runtime spawn-grace race, review-fallback enforcement, registry-derived build-chain roles, spoofed-timestamp window clamp, sprint-id correlation; team-guard/mode-guard bypass classes; turbo spend and authorization integrity; dispatch wrappers thread live mode into contract validation.

## [0.15.4] — 2026-06-08 · [0.15.3] — 2026-06-07 · [0.15.2] — 2026-06-07 · [0.15.1] — 2026-06-06 · [0.15.0] — 2026-06-06

Rapid capsules during the lifecycle sprints (epic tracking suite `/epic:*`, lifecycle store, planning-principles enforcer, turbo hardening, `bootstrap:spinup`). Notes were left as the generated placeholder in each capsule.

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
- Agent-folder paths changed; consumers receive the new tree via `/warp:update`.

## [0.13.1] — 2026-06-01

### Fixed
- Release orchestrator: `release-canonical.js` regenerates the framework manifest, the installed snapshot and `_warpos/MANIFEST.json` right after the capsule is built.

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

Capsule cut from `main`; notes left as the generated placeholder. The lanes (untrusted-content ingest firewall, `/etc` authoring + eval harness, component-library scaffold wiring, role-parity enforcer) landed in this window.

## [0.10.0] — 2026-05-25

Capsule cut from `main`; notes left as the generated placeholder. The new-product on-ramp (`bootstrap:spinup`, `bootstrap:lastmile`), `/session:turbo`, `/permissions:authorized` and the install-completeness sprint landed in this window.

## [0.9.0] — 2026-05-23

### Added
- **Install pipeline reliability checkpoint:** a five-scenario install/update test matrix (18 s) with regression injection, per-file status reporting (`added` / `repaired` / `unchanged` / `conflict`), idempotent applies, versioned migrations that skip already-applied steps, `userModified` tracking, `release-build` refusing a stale manifest, `.claude/manifest.json` always present. Purely additive.

## [0.8.2] — 2026-05-20

### Added
- `version-bump-guard.js` (refuses commits that stage framework files when the capsule for the current version already exists), `ledger-presence-guard.js`, `lint-hook-output.js`.
- Skills since 0.8.0: `/sprint:full` (autonomous plan → design → execute → release-prep → retro), `/check:ac-coverage`, `/check:node-procs`, `/enforcement:log` and `/enforcement:list`.
- Rolls in the notes 0.8.1 never received.

## [0.8.1] — 2026-05-20

Patch capsule; notes carried by 0.8.2.

## [0.8.0] — 2026-05-14 · [0.7.2] — 2026-05-14 · [0.7.1] — 2026-05-14 · [0.7.0] — 2026-05-14 · [0.6.1] — 2026-05-14 · [0.6.0] — 2026-05-14 · [0.5.0] — 2026-05-13

The hardened update pipeline (preflight + transactional apply + postflight), turbo as a mode argument, the sprint routing-policy enforcer, the Sprint Workflow v0.2 multi-sprint parallelism and the `/portfolio:bootstrap` brief skill. Capsule notes were left as the generated placeholder; the RELEASES.md sprint rows link the per-sprint changelogs.

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
- **Reliability prerequisites** (source landed as 0.3.0, never capsule-released): the dispatch-route guard (blocks raw `codex exec` / `gemini -p` / piped `claude` from Bash), dispatch telemetry, and nine further workstreams.

## [0.3.0] — 2026-05-11 (source only, no capsule)

Framework-reliability prerequisites; released with 0.4.0.

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

Capsule cut from `main` (2026-05-01 local time / 2026-05-02 UTC); notes left as the generated placeholder.

## [0.1.3] — (no capsule; known gap)

## [0.1.2] — 2026-05-01

### Changed
- Product-repo promotion made generic (the source slug is read from the manifest, not hard-coded); `/warp:promote` rewritten as a source-to-canonical reconciler; the recommended next action no longer auto-pushes.

## [0.1.1] — 2026-05-01

### Added
- Quality-gate hardening: the 14-gate release-gates suite, production-baseline and contract-versioning gates, session telemetry rollup, and the third Refactor & Rename Hygiene rule in `CLAUDE.md`.

## [0.1.0] — 2026-04-30

### Added
- **First versioned baseline.** `paths.registry.json` as the single source of truth for path keys with `scripts/paths/build.js` generating every view; framework-manifest schema v2 (stable ids, hashes, merge strategies, ownership); `framework-installed.json` v2; the path-coherence gate and the write-time `path-guard` / `path-registry-guard` hooks.

Before 0.1.0 the framework was unversioned.
