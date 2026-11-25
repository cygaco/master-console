# Changelog

All notable changes to Master Console are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

Where a capsule's notes were left as the generated placeholder at release time, the entry below says so rather than inventing content — the capsule and the commit history are the record. The engineering ledger, with the per-sprint release rows, is [RELEASES.md](RELEASES.md).

## [Unreleased]

## [2.3.0] — 2026-11-25

2.3.0 is the first public release since 2.1.0. Version 2.2.0 (below) was prepared but never published on its own; everything in it is included in 2.3.0.

### Added
- **Model presets with fallback lists.** Every role has an ordered list of models to try (the default preset, `.claude/agents/_org/presets/default.json`). Each list ends on Claude Opus 5.5, so a setup with only Claude still runs every role. Your own choice for a role is kept in `.claude/manifest.json`, never in the shipped role files.
- **Sign-in detection.** `/mc:health`, `/mc:setup` and the installer ask each tool's own status command whether you are signed in to Claude, Codex and Gemini. The answer is kept for 7 days.
- **Find and swap models (`/models:swap`).** `find` lists what each lab serves now and which configured models are gone; `swap` replaces one model with another across the shipped defaults or for one role; `undo` reverses the last swap and keeps later edits.
- **Security review models you can switch.** Each security review pass takes its provider, model and effort from your project's choice when you set one, checked against the model catalog; the shipped registry stays the default.
- **A Claude-only security fallback (opt-in, off by default).** When the other labs are known not to be signed in, a review read by Claude alone can be accepted, labelled as reviewed by Claude only and never counted as a multi-lab pass. See Known issues.
- **Session scorecard (`/session:scorecard`).** Reads what is already on disk (transcripts, git, the dispatch log) and prints wall and active time, idle time by cause, tokens by actor, review rounds and shipped units. Session start shows a short card; a wrap proposes one change when a threshold trips. Not in the public copy in this release: a fix to how its cache is protected is still under review.
- **One manifest command.** `node scripts/mc/manifest/regen-all.js` regenerates and verifies every manifest in one run.
- **A guard on agent spawns.** A hook refuses an Agent-tool spawn whose model is not a Claude model.
- **`/portfolio:new --parent <dir>`**, and an empty existing folder is accepted as the new product's home.
- **Plain words start the right skill (on by default).** Three plain-language hooks replace the old skill router: at session start Claude gets a map of the skills, and when a message matches one it gets one short line naming it and starts it with the Skill tool. A skill marked "~" (it deletes, deploys or spends) is never started by the model: the guard refuses it and you get the exact `/command` to type. `/plain` shows what the hooks add and whether routing is on; `/plain off` and `/plain on` switch routing (the guard stays on).

### Fixed
- **An install now copies every script its skills need.** The scripts behind `/models:check`, `/models:swap` and the growth skills, and `scripts/dispatch.js`, were missing from installed products, so those skills failed there. Update an existing product to get them.
- **The installer runs its own sign-in check**, never a sign-in script it finds in the target folder (`mc-setup.js` and `install.ps1`).
- **`/mc:update` conflict paths keep every copy.** `--save-conflicts` backs the live file up into the transaction, so a rollback restores it, and never overwrites an earlier saved copy; `--keep-local` never overwrites an earlier `.mc-new` or `.local-<version>` file.
- **The session scorecard cache no longer stores raw transcript bytes**, and its folder ignores itself, so a `git add -A` cannot commit it.
- **The launch-film scaffold stops before writing over existing files** in the folder you chose.

### Changed
- **Defaults.** GPT-6.2 Sol is the OpenAI default and the security panel's second pass. Gemini 4 Neon (High) is the default Google model for the security reviewer and the research lead. Claude Opus 5.5 is the default for alpha and the director of engineering; Fable 5.2 is opt-in.
- **Lighter review rules.** One review round sized to the risk; a finding holds only the unit it is about; only a security hole an outsider could use, data loss, or a false claim about a user's data holds anything else; two rounds is the ceiling. Small sprints skip the advisory plan pair and the release re-review.
- **Faster hooks.** Unused checks and advisory-only edit hooks are removed (see Removed); the commit-trailer guard and the inline-script write rule now advise instead of block; hooks write fewer log rows; the pre-commit check scans only the staged files.
- **`/session:end` runs the fast wrap by default.**
- **Turbo no longer grants pushes.** Claude Code's own safety check decides pushes, and it reads its trust rules only from your user settings. `node scripts/operator/trust-my-repos.js` is a script you run yourself (an agent never runs it). By default it only previews: it prints the lines it would add to the `autoMode` trust lists in your user settings file (`~/.claude/settings.json`) for this project's repository, and writes nothing. `--write` applies them, after saving a timestamped backup of the file next to it; every repository under your account is a separate choice, `--whole-account`; `--file <copy>` tries it on a copy. Non-force pushes to the trusted repository then stop being refused.

### Removed
- `scripts/checks/assert-mc-templates-shipped.js`, `file-usage-trace.js`, `reader-discipline.js`, `taste-gate-presence.js` (and their tests), the inert judge-consult hook `beta-gate.js`, the old skill router (`skill-router.js`, its catalog and its telemetry) and `/scan:voice-routing` (skills no longer carry `says:` phrase lists), and the edit hooks `region-marker-guard.js`, `save-session-lint.js`, `spec-test-staleness.js`, `step-hardcode-suggester.js`, `template-fillability.js`.

### Known issues
- **The Claude-only security fallback cannot accept a real review yet.** It needs a live Claude review lane with a signed record, and the security panel's only Claude lane runs inside the conductor, not in the script that decides; so it declines, and the review stays blocked rather than passing.
- **A saved "signed out" answer is used without a live re-check.** Anything that can already edit your project could forge it to move a role to a later model on its list; each such move is recorded, and security-review roles refuse instead of moving.
- **A full security panel run does not pass its final check yet.** It ends blocked rather than passing; a fix is planned.
- **No in-place update from public 2.1.0.** The public copy does not carry the release capsules the updater reads; install 2.3.0 fresh.
- **`--save-conflicts` and `--keep-local` rollbacks are incomplete.** A rollback does not put back a file that `--save-conflicts` replaced (your original stays in the saved-conflicts folder), and a `--keep-local` rollback deletes whatever is at a side file it wrote, even a newer file you saved there. Take a version-control checkpoint before an update with either flag.
- **`--rollback` does not undo a migration's renames** take a version-control checkpoint first).

## [2.2.0] — 2026-11-05

Prepared but never published on its own; it reaches the public copy as part of 2.3.0. 2.2.0 ships the 2.1.0 fix rounds that never reached the public tree, the additions below, and the portfolio-update fixes that let installed products update to the current framework. The per-sprint engineering ledger is [RELEASES.md](RELEASES.md); the capsule and commit history are the record for the individual fix-round changes.

### Added
- **`/growth:launch-film` — a workflow skill for producing a launch film.** Scaffolds a Remotion project into the user's own chosen video folder (never a product dependency) and documents the render, assemble and release-encode steps, with a matching `_guides/LAUNCH_FILM_GUIDE.md` and ADR-0043. Workflow only — it carries no creative or content rules. Remotion's licence is stated as in ADR-0043 (free for individuals and organisations of up to 3 people; a paid Company License from 4 people) with no cost-free claim.

### Changed
- **The removal of the pre-2.0.0 names moves to 3.0.0.** The `warp:*` command aliases, the `.warpos/` / `_warpos/` directory fallbacks, and the `WARPOS_*` environment and settings names were announced for removal in 2.2.0 (itself moved there from 2.1.0). They are **NOT removed in 2.2.0** — they keep working as deprecated aliases and read-fallbacks. The removal moves to the **3.0.0** major. The rename-partition compat windows, the alias map (`removeIn` / `expiryVersion`), and every deprecation notice now state 3.0.0; nothing is removed in this release.
- **A new release gate, `published_emit_drift`, refuses a release whose source would drop content already present in the published public tree.**
- **`/portfolio:sync` now drives real per-product updates.** It passes `--to` (the target version), `--source` (the MC clone) and `--target` (each product) to the update engine and applies with `--apply`; previously it ran the engine with no arguments, so every product exited with "Missing --to." The `/mc:update` skill documents the explicit `--source` form for a canonical clone that is not a `master-console`/`MC`/`mc` sibling.
- **Lean-gauntlet narrowing is on by default.** `scripts/sprint/gauntlet-decision.js` now defaults `leanAuto` on, so a sprint runs the gauntlet package its change trailer and touched files call for instead of the full roster every time. A release, an unclassifiable change, a security-surface touch, a Golden-path entry file, and a size or stale-map escalation still widen the package to full. The R-5 seeded-defect differential gates the change: lean shows **zero misses on the seeded corpus** (`missed_by_lean = 0` in every column, with a per-column green control). The corpus's consumer cases are all name-siblings, so generality beyond the seeded corpus rests on the selector's unit tests rather than the differential alone; a non-sibling consumer case is tracked for the next corpus revision.

### Known issues
- **`--rollback` does not undo a migration's renames.** Upgrading a pre-2.0.0 install across the WarpOS→MC rename runs file moves the transaction does not reverse, so `--rollback` leaves a hybrid tree (restored legacy roots plus the new `_mc/` roots). Take a version-control checkpoint before a cross-rename upgrade and reset to it for a clean revert.

### Fixed
- **A refused gauntlet selection now halts instead of silently falling back to unchecked review conduct.** Inside `/sprint:full` the gauntlet step resolves a forced-full decision and halts (`gauntlet_resolution_refused`) when even that yields no decision, rather than conducting a 2.0.0 legacy review that does not verify the reviews ran yet reports success.
- **A gauntlet close is now bound to the commit its reviews ran on.** The close records and compares the review head against the selection head and refuses a close whose asserted head does not match, so a full set of reviews recorded at an older commit can no longer close a newer one.

## [2.1.0] — 2026-10-09

### Added
- **Lean gauntlet (E-LEAN-GAUNTLET-001).** During an active sprint each commit carries a change trailer (`change`, `blast`, `risks`); a commit-message guard checks it, fails open on its own errors and has a kill switch. A package selector, `scripts/sprint/gauntlet-package.js`, picks the gauntlet package from the trailer and the files a change touches, so a small change no longer pays for the whole suite. A differential oracle checks the selector's choice against the full suite and subtracts the quarantine register. A review conducted on the verified path is scoped to the change's Focused and Touchpoint files; the unchecked fallback under Known issues runs it unscoped.
- **Operator message contract (E-SELF-MONITOR-001).** Status messages use fixed headers and an executive register. A Stop-hook lint checks them; it is on by default and can be switched off per install.
- **Voice skill routing (E-VOICE-SKILLS-001).** Skills declare the sentences that should reach them (`says:` in their frontmatter), and a deterministic prompt-time router maps a dictated sentence to its skill. Irreversible skills always ask before running. Permission-widening skills also always ask, however exactly they are named: a skill whose name has a word starting with `turbo` or `authoriz` (for example `/session:turbo`, `/permissions:authorized`, `/scan:turbo-spend`), and any skill suggested with a `--turbo` flag. Skills whose file marks them confirm-first on a fuzzy match (`/mode:sprint`, `/mode:adhoc`, `/mode:solo`, `/sprint:full`) run when named exactly and ask otherwise. When a catalog is present but its generator is missing or cannot be read, the router treats the catalog as untrusted and asks before every skill.

### Changed
- **Model refresh (2026-10-03).** The model catalog is refreshed. Builders and other doers move to Claude Sonnet 5.5, and the OpenAI lanes default to the GPT-6 family. The Claude provider default and the in-process roles stay on Claude Opus 4.8 until a later release proves what the harness serves. Reviewer defaults stay where they were until a replay proof lands. The codex resolver prefers the newest npm `@openai/codex` over an older bundled binary, and never runs a candidate binary before it passes the path guards.
- **Deprecation window extended.** The pre-2.0.0 skill aliases, environment variables and directory fallbacks named in the 2.0.0 deprecation policy below were announced for removal in 2.1.0. They now stay through 2.1.x and are removed in 2.2.0.
- **Deprecated command aliases hidden.** The 33 deprecated alias forwarders no longer appear in the skill menu or the skill catalog, and Claude Code no longer lists them as slash commands. Claude can still run one when asked for it by name. They are removed in 2.2.0.

### Fixed
- A close whose differential fails writes a refusal, not a closed event. Before, a close could report the full package with no reviews dispatched.
- A failed gauntlet stage now halts the sprint and shows the stage's output, instead of stopping silently.
- The codex resolver no longer runs binaries found on PATH before validating them, and no longer passes a path through `cmd.exe`.
- The voice router no longer reaches a confident match from a negated or past-tense mention ("disable turbo mode", "I already ran the full scan"), and a skill with a missing confirm class asks instead of running.
- The operator-contract lint accepts text after a header, needs a real command signal before it calls a line a command, and classifies code fences by what they hold.
- Test runs no longer write fixture rows into the real events log.
- The sprint audits (beta honesty, hook coverage, manager consult) no longer drop rows through a quarantine filter: no `events-quarantined` row, and no listed fixture id, can hide a sprint from them. The audits keep their own static exemptions (see Known issues); historical test-fixture rows outside them now show up as findings on their own fixture sprint ids.
- Every gauntlet package close is held to the release-class rules (no skipped review stage, no `--lenient`), and no stage is satisfied by the selection's own word: a stage needs its record or evidence.
- The codex path guards compare native real paths on both sides, and an npm-installed codex now runs as `node` with the package's own entry script instead of through its `.cmd` shim.

### Known issues
- **GPT-6 default lanes need codex 0.160 or newer** (npm `@openai/codex`). The desktop-bundled codex 0.146 returns HTTP 400 on every GPT-6 lane. The resolver prefers the newer npm binary, and `models:check` warns whenever the codex it finds is older than 0.160, but a machine with only the bundled binary gets errors on those lanes.
- **Codex and agy runs cannot prove which model served them.** The dispatch smoke checks that codex itself reports running the requested model; there is no server-attested served id, agy reports none at all, and the model's own answer about its id is not reliable. Tracked as ED-230.
- **A refused gauntlet selection falls back to unchecked review conduct.** When `/sprint:full` conducts a sprint and the gauntlet selection cannot be resolved, the gauntlet step falls back to 2.0.0's review conduct, which does not verify that the reviews ran and reports success. That happens on a commit with no change trailer while the sprint is active, an invalid trailer, a commit trailer lower than the ticket's classification, a sprint registry that cannot be read at either the merge base or the commit's parent, no merge base with the default branch, a HEAD that equals its merge base (nothing to diff yet), any error while selecting, and a sprint hook-point registry with no gauntlet reviewer row for a release-class change (the shipped registry has them). An error thrown while the gauntlet step is being conducted is also reported as success. Pending a product decision; tracked as ED-489.
- **The in-process gauntlet close can be satisfied by another run's records.** Inside `/sprint:full`, the stage check counts a review from any completion record for that role in the time window, signed or not and from any sprint. The signed, sprint-scoped CLI close (`gauntlet-package.js close`) is not part of the release path. Tracked as ED-488.
- **A gauntlet close is not bound to the commit its reviews ran on.** A full set of reviews recorded at an older commit can close a newer one. Tracked as ED-490.
- **A package close checks that each review ran, not what it concluded.** A failing review still counts as a completed stage at close; the release decision reads the verdicts separately. Test and mechanical stages (including the full-suite stage) pass on any non-empty evidence file the caller names with exit 0, or on a skip with any reason; the close cannot tell whether a runner wrote the file. Tracked as ED-466.
- The constant full-package obligation names qa-reviewer and security-reviewer only, so a CLI close does not demand the frontend, backend or visual reviewers that `/sprint:full` conducts for a code sprint's full roster.
- **The operator-contract lint fails open by design.** A crash or malformed input lets the turn end normally; the lint shapes messages and is not a security control.
- **Older event logs still hold test fixture rows.** Rows that test runs wrote before this release stay in the logs, which are append-only, and the sprint audits report those outside their static exemptions as findings on their fixture sprint ids. Readers can recognise them by sprint or unit id: `SP-CLI2`, `SP-DIFF`, `SP-GAP7-CLI`, `SP-POISON`, `SP-R3STRICT-*`, `SP-R3LENIENT-*` and `SP-DIFFQ-*` on gauntlet-package events; `SP-T` and `SP-GP-*` on manager-consult events; `SP-TEST-*` sprints and beta-consult rows that cite an `SP-J<n>` rubric; and the `ROADMAP.md` `[S-PF-01]` ledger receipt.
- **A permission-widening skill without `turbo` or `authoriz` in its name relies on stale-catalog detection.** The router decides "permission-widening" from those two name stems; any other skill is held to confirm-first only by its catalog entry, so a stale catalog with a readable generator relies on the router's stale-catalog check alone.
- An install made with `scripts/mc-setup.js` ships neither `scripts/generate-skill-catalog.js` nor a skill catalog, so the router has nothing to route and suggests nothing; the voice skill routing above works only where the generator and a catalog exist. If installs ever carry a catalog, they must also carry a way to check that it is current (the generator or a stamped hash), or the stale-catalog bypass returns; until then the router treats such a catalog as untrusted and asks before every skill. Tracked as ED-492.
- **The sprint audits keep static exemptions.** Hook coverage also skips sprint ids that start with `SP-J` or `SP-TEST`, and manager consult skips those that start with `SP-J`; beta honesty audits `SP-J` sprints but skips some of its checks for them.
- **Migrated alias skills still name 2.1.0.** Alias skills that the 1.2.0 → 2.0.0 migration wrote into a product say "Removed in mc@2.1.0". The removal is in 2.2.0.
- **2.0.0 and 2.1.0 ship without a release capsule.** `framework/releases/` holds capsules through 1.2.0 only. Tracked as ED-495.

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
