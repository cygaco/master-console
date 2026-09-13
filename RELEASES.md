# MC Releases

The engineering release ledger for MC. See [`paths.sprintReference#ledger-discipline`](.claude/project/reference/sprint-workflow.md#ledger-discipline) for what qualifies.

Two sections — the Versions section reads cleanly in isolation for downstream consumer maintainers running `/mc:update --to X.Y.Z`; the Sprints section is engineering inventory.

## Versions

Every `version.json` bump that produced a capsule under `framework/releases/X.Y.Z/`. Summaries are written for downstream consumer maintainers — no engineering-internal artifact ids (`SP-`, `RL-`, `T-`).

| Version | Released | Capsule | Summary |
|---|---|---|---|
| `1.2.0` | 2026-07-29 | [1.2.0/release.json](framework/releases/1.2.0/release.json) | **Minor** bump. `/memory:verify` ships with its `--apply` executor **held fail-closed** — after five review rounds it still cannot guarantee that a successful delete leaves untouched bytes alone, or that a failed run leaves the store unchanged while reporting that it does; four findings remain open and there is no override. The read-only detector ships and is useful on its own. Also: two release gates that could not execute on a large working tree now bound their snapshot read, and the review process's finding-class definitions get a tracked ADR home. No breaking changes, no schema changes, no migrations. |
| `1.1.0` | 2026-07-23 | [1.1.0/release.json](framework/releases/1.1.0/release.json) | Patch bump to 1.1.0. Fill in via release notes. |
| `1.0.0` | 2026-07-22 | [1.0.0/release.json](framework/releases/1.0.0/release.json) | Patch bump to 1.0.0. Fill in via release notes. |
| `0.17.0` | 2026-06-28 | [0.17.0/release.json](framework/releases/0.17.0/release.json) | Patch bump to 0.17.0. Fill in via release notes. |
| `0.16.0` | 2026-06-12 | [0.16.0/release.json](framework/releases/0.16.0/release.json) | Patch bump to 0.16.0. Fill in via release notes. |
| `0.15.4` | 2026-06-08 | [0.15.4/release.json](framework/releases/0.15.4/release.json) | Patch bump to 0.15.4. Fill in via release notes. |
| `0.15.3` | 2026-06-07 | [0.15.3/release.json](framework/releases/0.15.3/release.json) | Patch bump to 0.15.3. Fill in via release notes. |
| `0.15.2` | 2026-06-07 | [0.15.2/release.json](framework/releases/0.15.2/release.json) | Patch bump to 0.15.2. Fill in via release notes. |
| `0.15.1` | 2026-06-06 | [0.15.1/release.json](framework/releases/0.15.1/release.json) | Patch bump to 0.15.1. Fill in via release notes. |
| `0.15.0` | 2026-06-06 | [0.15.0/release.json](framework/releases/0.15.0/release.json) | Patch bump to 0.15.0. Fill in via release notes. |
| `0.14.0` | 2026-06-06 | [0.14.0/release.json](framework/releases/0.14.0/release.json) | Patch bump to 0.14.0. Fill in via release notes. |
| `0.13.1` | 2026-06-01 | [0.13.1/release.json](framework/releases/0.13.1/release.json) | Patch bump to 0.13.1. Fill in via release notes. |
| `0.13.0` | 2026-06-01 | [0.13.0/release.json](framework/releases/0.13.0/release.json) | Patch bump to 0.13.0. Fill in via release notes. |
| `0.12.0` | 2026-05-31 | [0.12.0/release.json](framework/releases/0.12.0/release.json) | Patch bump to 0.12.0. Fill in via release notes. |
| `0.11.1` | 2026-05-30 | [0.11.1/release.json](framework/releases/0.11.1/release.json) | Patch bump to 0.11.1. Fill in via release notes. |
| `0.11.0` | 2026-05-30 | [0.11.0/release.json](framework/releases/0.11.0/release.json) | Patch bump to 0.11.0. Fill in via release notes. |
| `0.10.0` | 2026-05-25 | [0.10.0/release.json](framework/releases/0.10.0/release.json) | Patch bump to 0.10.0. Fill in via release notes. |
| `0.9.0` | 2026-05-23 | [0.9.0/release.json](framework/releases/0.9.0/release.json) | **Install pipeline reliability checkpoint.** Full install-reliability batch shipped: 5-scenario CI matrix, per-file status reporting (added/repaired/unchanged/conflict), idempotent applies, versioned migrations (skip already-applied on retry), userModified tracking, release-build refuses stale manifest, `.claude/manifest.json` always-present + 4-caller graceful absence, settings.json layered-compile flip. No breaking changes; pure additive. |
| `0.8.2` | 2026-05-20 | [0.8.2/release.json](framework/releases/0.8.2/release.json) | Patch bump to 0.8.2. Fill in via release notes. |
| `0.8.1` | 2026-05-20 | [0.8.1/release.json](framework/releases/0.8.1/release.json) | Patch bump to 0.8.1. Fill in via release notes. |
| `0.1.0` |  | [0.1.0/release.json](framework/releases/0.1.0/release.json) | Release 0.1.0. |
| `0.1.1` |  | [0.1.1/release.json](framework/releases/0.1.1/release.json) | Release 0.1.1. |
| `0.1.2` |  | [0.1.2/release.json](framework/releases/0.1.2/release.json) | Release 0.1.2. |
| `0.1.3` |  | (missing — known gap) | Historical release 0.1.3. |
| `0.1.4` |  | [0.1.4/release.json](framework/releases/0.1.4/release.json) | Release 0.1.4. |
| `0.2.0` |  | [0.2.0/release.json](framework/releases/0.2.0/release.json) | Release 0.2.0. |
| `0.2.1` |  | [0.2.1/release.json](framework/releases/0.2.1/release.json) | Release 0.2.1. |
| `0.2.2` |  | [0.2.2/release.json](framework/releases/0.2.2/release.json) | Release 0.2.2. |
| `0.3.0` |  | (missing — known gap) | Historical release 0.3.0. |
| `0.4.0` |  | [0.4.0/release.json](framework/releases/0.4.0/release.json) | Sprint Workflow v0.1 — four-command product workflow layer above existing modes |
| `0.4.1` |  | [0.4.1/release.json](framework/releases/0.4.1/release.json) | Update-path UX fix |
| `0.4.2` |  | [0.4.2/release.json](framework/releases/0.4.2/release.json) | Critical install bug fixes for 0.4.0/0.4.1 |
| `0.4.3` |  | [0.4.3/release.json](framework/releases/0.4.3/release.json) | Manifest-regen fix |
| `0.4.4` |  | [0.4.4/release.json](framework/releases/0.4.4/release.json) | Critical dispatch-stdin fix |
| `0.5.0` |  | [0.5.0/release.json](framework/releases/0.5.0/release.json) | Release 0.5.0. |
| `0.6.0` |  | [0.6.0/release.json](framework/releases/0.6.0/release.json) | Release 0.6.0. |
| `0.6.1` |  | [0.6.1/release.json](framework/releases/0.6.1/release.json) | Release 0.6.1. |
| `0.7.0` |  | [0.7.0/release.json](framework/releases/0.7.0/release.json) | Release 0.7.0. |
| `0.7.1` |  | [0.7.1/release.json](framework/releases/0.7.1/release.json) | Release 0.7.1. |
| `0.7.2` |  | [0.7.2/release.json](framework/releases/0.7.2/release.json) | Release 0.7.2. |
| `0.8.0` |  | [0.8.0/release.json](framework/releases/0.8.0/release.json) | Release 0.8.0. |
<!-- ledger:versions — auto-managed by scripts/sprint/ledger.js. Manual edits valid; may be overwritten on next /mc:release. -->

## Sprints

Every `RL-*` at status=prepared OR =deployed. Each row links to the full `RL-*.yaml` and `.changelog.md` under `.claude/project/sprint/releases/`. Engineering-facing — sprint ids and learning candidates are expected here.

| Release | Sprint | Status | Target | Deployed | Notes |
|---|---|---|---|---|---|
| [RL-20260611-045](.claude/project/sprint/releases/RL-20260611-045.yaml) | [S-PF-01](.claude/project/sprint/sprints/S-PF-01/) | deployed | internal-canary | 2026-06-12T05:00:00.037Z | S-PF-01 W0 telemetry seam |
| [RL-20260611-044](.claude/project/sprint/releases/RL-20260611-044.yaml) | [SP-20260611-002](.claude/project/sprint/sprints/SP-20260611-002/) | deployed | local | 2026-06-11T20:46:43.339Z | E-LIFECYCLE-001 close-out fix sprint |
| [RL-20260611-043](.claude/project/sprint/releases/RL-20260611-043.yaml) | [SP-20260610-008](.claude/project/sprint/sprints/SP-20260610-008/) | prepared | staging |  | Dreamteam verified-open guard batch — W-26 + W-14 (3 closed already-fixed) |
| [RL-20260610-042](.claude/project/sprint/releases/RL-20260610-042.yaml) | [SP-20260610-007](.claude/project/sprint/sprints/SP-20260610-007/) | prepared | staging |  | E-DISPATCH-SHAPE-001 W1 — make availability and fallback real |
| [RL-20260610-041](.claude/project/sprint/releases/RL-20260610-041.yaml) | [SP-20260610-006](.claude/project/sprint/sprints/SP-20260610-006/) | prepared | staging |  | E-DISPATCH-SHAPE-001 W0 — make the ids and clocks true |
| [RL-20260610-040](.claude/project/sprint/releases/RL-20260610-040.yaml) | [SP-20260610-005](.claude/project/sprint/sprints/SP-20260610-005/) | prepared | staging |  | E-DISPATCH-INTEGRITY-001 F-1+F-3 — coverage-honesty (kill telemetry-only false-greens) |
| [RL-20260610-039](.claude/project/sprint/releases/RL-20260610-039.yaml) | [SP-20260610-001](.claude/project/sprint/sprints/SP-20260610-001/) | prepared | staging |  | Lanes C+D — sprint-pipeline truth + research:deep runnability (MC.md sweep 2026-06-10) |
| [RL-20260610-038](.claude/project/sprint/releases/RL-20260610-038.yaml) | [SP-20260610-001](.claude/project/sprint/sprints/SP-20260610-001/) | prepared | staging |  | Lanes C+D — sprint-pipeline truth + research:deep runnability (MC.md sweep 2026-06-10) |
| [RL-20260610-037](.claude/project/sprint/releases/RL-20260610-037.yaml) | [SP-20260610-001](.claude/project/sprint/sprints/SP-20260610-001/) | prepared | staging |  | Lanes C+D — sprint-pipeline truth + research:deep runnability (MC.md sweep 2026-06-10) |
| [RL-20260610-036](.claude/project/sprint/releases/RL-20260610-036.yaml) | [SP-20260610-002](.claude/project/sprint/sprints/SP-20260610-002/) | prepared | staging |  | Lane B — dispatch/registry coherence (MC.md sweep 2026-06-10) |
| [RL-20260602-035](.claude/project/sprint/releases/RL-20260602-035.yaml) | [SP-20260602-001](.claude/project/sprint/sprints/SP-20260602-001/) | prepared | staging |  | Sealed-capsule executable consumer-contract gate (keystone) |
| [RL-20260531-034](.claude/project/sprint/releases/RL-20260531-034.yaml) | [SP-20260531-003](.claude/project/sprint/sprints/SP-20260531-003/) | prepared | staging |  | scan:mc-layer-diff — product-vs-dev-tooling layer diff report |
| [RL-20260531-033](.claude/project/sprint/releases/RL-20260531-033.yaml) | [SP-20260531-002](.claude/project/sprint/sprints/SP-20260531-002/) | prepared | staging |  | _guides product-layer shipping + _planning reorg + ship-boundary enforcer |
| [RL-20260529-032](.claude/project/sprint/releases/RL-20260529-032.yaml) | [SP-20260528-001](.claude/project/sprint/sprints/SP-20260528-001/) | prepared | staging |  | Rename check: namespace to scan: + scan:full system scan |
| [RL-20260525-031](.claude/project/sprint/releases/RL-20260525-031.yaml) | [SP-20260525-019](.claude/project/sprint/sprints/SP-20260525-019/) | prepared | staging |  | Install completeness: unify install.ps1 + warp-setup paths, scaffold PROJECT.md + product maps |
| [RL-20260525-030](.claude/project/sprint/releases/RL-20260525-030.yaml) | [SP-20260525-018](.claude/project/sprint/sprints/SP-20260525-018/) | prepared | staging |  | MC installer completeness: complete + sprint-capable fresh installs |
| [RL-20260525-029](.claude/project/sprint/releases/RL-20260525-029.yaml) | [SP-20260525-018](.claude/project/sprint/sprints/SP-20260525-018/) | prepared | staging |  | MC installer completeness: complete + sprint-capable fresh installs |
| [RL-20260523-028](.claude/project/sprint/releases/RL-20260523-028.yaml) | [SP-20260524-001](.claude/project/sprint/sprints/SP-20260524-001/) | prepared | staging |  | Install fixture CI matrix — 5-scenario regression test suite for /mc:setup + /mc:update |
| [RL-20260523-027](.claude/project/sprint/releases/RL-20260523-027.yaml) | [SP-20260523-003](.claude/project/sprint/sprints/SP-20260523-003/) | prepared | staging |  | Installer ownership manifest hook into /mc:setup — refuse writes to paths not in _mc/MANIFEST.json |
| [RL-20260523-026](.claude/project/sprint/releases/RL-20260523-026.yaml) | [SP-20260523-002](.claude/project/sprint/sprints/SP-20260523-002/) | prepared | staging |  | Three-layer settings compiler — _mc/settings/defaults.json source migration + wire compile.js into /mc:setup + /mc:update |
| [RL-20260523-025](.claude/project/sprint/releases/RL-20260523-025.yaml) | [SP-20260523-001](.claude/project/sprint/sprints/SP-20260523-001/) | prepared | staging |  | Fix current.yaml#status + active-sprints.yaml status lag after /sprint:full Phase 5 |
| [RL-20260523-024](.claude/project/sprint/releases/RL-20260523-024.yaml) | [SP-20260522-005](.claude/project/sprint/sprints/SP-20260522-005/) | prepared | staging |  | /mc:update --status wires manifest validator into per-file table |
| [RL-20260523-023](.claude/project/sprint/releases/RL-20260523-023.yaml) | [SP-20260522-004](.claude/project/sprint/sprints/SP-20260522-004/) | prepared | staging |  | Migration bootstrap script — convert existing MC installs to _mc/ architecture |
| [RL-20260522-022](.claude/project/sprint/releases/RL-20260522-022.yaml) | [SP-20260522-003](.claude/project/sprint/sprints/SP-20260522-003/) | prepared | staging |  | Maintainer &amp; Product Workflow — .vscode/tasks.json from portfolio registry, /portfolio:open --spawn VS Code preference, aiweb product-delivery ticket (cadence rule) |
| [RL-20260522-021](.claude/project/sprint/releases/RL-20260522-021.yaml) | [SP-20260522-003](.claude/project/sprint/sprints/SP-20260522-003/) | prepared | staging |  | Install &amp; Release Integrity — manifest coverage, dry-run + rollback, idempotent install, framework-views-fresh + framework-purity gates |
| [RL-20260522-020](.claude/project/sprint/releases/RL-20260522-020.yaml) | [SP-20260522-003](.claude/project/sprint/sprints/SP-20260522-003/) | prepared | staging |  | Framework Boundary &amp; Identity — _mc/ zone, MANIFEST.json, full purge of /warp:promote suite |
| [RL-20260522-019](.claude/project/sprint/releases/RL-20260522-019.yaml) | [SP-20260522-003](.claude/project/sprint/sprints/SP-20260522-003/) | prepared | staging |  | Maintainer &amp; Product Workflow — .vscode/tasks.json from portfolio registry, /portfolio:open --spawn VS Code preference, aiweb product-delivery ticket (cadence rule) |
| [RL-20260522-018](.claude/project/sprint/releases/RL-20260522-018.yaml) | [SP-20260522-003](.claude/project/sprint/sprints/SP-20260522-003/) | prepared | staging |  | Install &amp; Release Integrity — manifest coverage, dry-run + rollback, idempotent install, framework-views-fresh + framework-purity gates |
| [RL-20260522-017](.claude/project/sprint/releases/RL-20260522-017.yaml) | [SP-20260522-001](.claude/project/sprint/sprints/SP-20260522-001/) | prepared | staging |  | Sprint SP-20260522-001 |
| [RL-20260521-016](.claude/project/sprint/releases/RL-20260521-016.yaml) | [SP-20260521-001](.claude/project/sprint/sprints/SP-20260521-001/) | deployed | internal | 2026-05-21T22:06:41.666Z | /portfolio:* portfolio console — collapse /product:* into /portfolio:* with 12 verbs (bootstrap, clone, ponder, import, list, status, open, new, adopt, register, dispatch, sync) + portfolioRegistry (removed paths key) + multi-terminal --spawn launcher + parallel /portfolio:status dashboard + sequential /portfolio:sync + DEC-008 auto private gh repo create |
| [RL-20260521-015](.claude/project/sprint/releases/RL-20260521-015.yaml) | [SP-20260520-001](.claude/project/sprint/sprints/SP-20260520-001/) | deployed | internal | 2026-05-21T17:54:40.486Z | /product:clone — competitor-product intel skill (JTBDs, features, voice-of-customer, gaps, opportunities) |
| [RL-20260521-014](.claude/project/sprint/releases/RL-20260521-014.yaml) | [SP-20260520-002](.claude/project/sprint/sprints/SP-20260520-002/) | deployed | internal | 2026-05-21T17:50:08.196Z | /product:import — paste-friendly questionnaire generator for cross-AI product import |
| [RL-20260513-001](.claude/project/sprint/releases/RL-20260513-001.yaml) | [SP-20260512-001](.claude/project/sprint/sprints/SP-20260512-001/) | deployed | internal-canary | 2026-05-13T04:55:44.364Z | Multi-sprint parallelism (Sprint Workflow v0.2) [changelog](_docs/sprint/CHANGELOG_v0.2.md) |
| [RL-20260513-002](.claude/project/sprint/releases/RL-20260513-002.yaml) | [SP-20260513-001](.claude/project/sprint/sprints/SP-20260513-001/) | deployed | internal-canary | 2026-05-13T21:55:43.922Z | /product:bootstrap skill — guided product brief in MD/HTML/DOCX [changelog](_docs/sprint/CHANGELOG_0.5.1.md) |
| [RL-20260513-003](.claude/project/sprint/releases/RL-20260513-003.yaml) | [SP-20260513-002](.claude/project/sprint/sprints/SP-20260513-002/) | deployed | internal-canary | 2026-05-13T21:55:22.704Z | MC provider smoke + RCA + safe-only auto-fix [changelog](_docs/sprint/CHANGELOG_0.5.1.md) |
| [RL-20260513-004](.claude/project/sprint/releases/RL-20260513-004.yaml) | [SP-20260513-003](.claude/project/sprint/sprints/SP-20260513-003/) | deployed | internal-canary | 2026-05-13T21:55:20.375Z | Organic skill use — Hybrid (CLAUDE.md rule + smart-context ranker + telemetry) [changelog](_docs/sprint/CHANGELOG_0.5.1.md) |
| [RL-20260513-005](.claude/project/sprint/releases/RL-20260513-005.yaml) | [SP-20260513-004](.claude/project/sprint/sprints/SP-20260513-004/) | deployed | internal-canary | 2026-05-13T21:56:05.449Z | /sprint:retrospective skill — close-of-sprint reflection [changelog](_docs/sprint/CHANGELOG_0.5.1.md) |
| [RL-20260513-006](.claude/project/sprint/releases/RL-20260513-006.yaml) | [SP-20260513-005](.claude/project/sprint/sprints/SP-20260513-005/) | deployed | internal-canary | 2026-05-13T21:56:19.894Z | Hardened /mc:update — preflight + transactional apply + postflight [changelog](_docs/sprint/CHANGELOG_0.5.1.md) |
| [RL-20260514-007](.claude/project/sprint/releases/RL-20260514-007.yaml) | [SP-20260513-006](.claude/project/sprint/sprints/SP-20260513-006/) | deployed | internal | 2026-05-14T09:38:36.130Z | Turbo as mode argument [changelog](.claude/project/sprint/releases/RL-20260514-007.changelog.md) |
| [RL-20260514-008](.claude/project/sprint/releases/RL-20260514-008.yaml) | [SP-20260514-001](.claude/project/sprint/sprints/SP-20260514-001/) | deployed | production | 2026-05-14T09:48:59.624Z | MC 0.7.0 — Hardened update pipeline [changelog](.claude/project/sprint/releases/RL-20260514-008.changelog.md) |
| [RL-20260514-009](.claude/project/sprint/releases/RL-20260514-009.yaml) | [SP-20260514-002](.claude/project/sprint/sprints/SP-20260514-002/) | deployed | canonical-mc | 2026-05-14T21:59:33.690Z | Enforce sprint routing policy [changelog](.claude/project/sprint/releases/RL-20260514-009.changelog.md) |
| [RL-20260518-010](.claude/project/sprint/releases/RL-20260518-010.yaml) | [SP-20260518-001](.claude/project/sprint/sprints/SP-20260518-001/) | deployed | internal-canary | 2026-05-18T20:03:16.568Z | /sprint:full — autonomous sprint orchestrator [changelog](.claude/project/sprint/releases/RL-20260518-010.changelog.md) |
| [RL-20260519-013](.claude/project/sprint/releases/RL-20260519-013.yaml) | [SP-20260518-009](.claude/project/sprint/sprints/SP-20260518-009/) | deployed | internal-canary | 2026-05-19T03:10:20.680Z | Consolidate ROADMAP.md and WARPOS_ROADMAP.md into single canonical ROADMAP.md [changelog](.claude/project/sprint/requirements/SP-20260518-009/changelog.md) |
<!-- ledger:releases — auto-managed by scripts/sprint/ledger.js. -->
