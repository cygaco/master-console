# S-OS-05 — Rebrand brand layer — build report (2026-09-12)

**Branch:** `worktree-agent-a0266d2211f5bc474` (worktree off `open-source/S-OS-04-05` @ `6e974c47`) · **Commits:** `1327e764` (rebrand + docs + root cleanup), `4e9b7630` (coordinator-authorized enforcer edits), plus this report's commit.

## Deliverables

| # | Deliverable | Status |
|---|---|---|
| 1 | `README.md` full rewrite as Master Console (formerly WarpOS) | DONE — contract lines verbatim on their own lines (`**Version:** 1.2.0`, `**Skills:** 237 slash commands`, `**Hooks:** 75 automated hooks`; 237 = `.claude/commands/**/*.md`, 75 = `.claude/settings.json` hook entries); install flow re-verified against `install.ps1` + `scripts/warp-setup.js`; provider spread re-verified against `role-registry.json` (code-quality reviewers are on Claude Opus 5 now, not OpenAI — the old README claim was stale); `/warp:promote`, `/hooks:sync`, `/skills:list` dropped (do not exist); hand-dates dropped; Naming note + all requested links |
| 2 | `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1, contact = issues / `@cygaco`, no e-mail), `CHANGELOG.md` (Keep a Changelog, 0.1.0 → 1.2.0 reverse-chronological from RELEASES.md + `framework/releases/*/changelog.md`; placeholder capsules disclosed as such; `[Unreleased]` = rebrand + 2026-09-03 rewrite) | DONE |
| 3 | `docs/PROVENANCE.md` | DONE — 48 receipt SHAs cited (7 headline + 41 in the full table + anchor); **48/48 verified** `git merge-base --is-ancestor <sha> origin/main` after `git fetch origin` (origin/main = `6e974c47`). Rewrite disclosure, anchor, reproduce pointers (tracked files under `runtime/open-source/rewrite/` + `anchor/`), industry analogs as footnotes only; no "stole"/"copied" |
| 4 | Root clutter | DONE (see table below) |
| 5 | `scripts/checks/brand-leak-scan.js` | CHANGED (header/doc-comment only): it never scanned README/PROVENANCE (scope = `_warpos/templates/app-scaffold` visible surfaces), so it would not have flagged them; the header now states the 2026-09-02 ruling (one shared brand; the scanner protects a scaffolded product's own surface from the engine slug). Mechanics + test unchanged: `tests/regression/SP-20260614-001/brand-leak.test.js` 1/1, exit 0. The frozen docs that describe it (`_reports/E-MC-READINESS-*`, sprint requirement docs) were not edited |
| 6 | `docs/RENAME-RUNBOOK.md` | DONE — recommends `cygaco/master-console`; UI + `gh repo rename` steps, what redirects, the after-rename update table (package.json, README/docs URLs, `warp/setup.md`, `warp-setup.js`, `update.js` sibling-dir walk, trackers, portfolio registry, downstream products), verify + rollback. **Rename NOT performed** |

## Root clutter — dispositions and repointed references

| File | Disposition | Refs repointed |
|---|---|---|
| `INTERESTING.md` | `git rm` | 3 — `scripts/warpos/manifest/build.js` (root-doc allowlist), `scripts/checks/warpos-ship-coverage.js` (stale KNOWN_NOT_SHIPPED row; coordinator-authorized), `_warpos/MANIFEST.json` (generated; clears on regen). Epic/plan mentions left (they describe the scope) |
| `GEMINI.md` | `git rm` (ADR-0036 removal-trigger) | 7 — `build.js`, `scripts/generate-framework-manifest.js` (FRAMEWORK_DOCS row), `AGENTS.md` L10, `.claude/project/reference/entry-preamble.md` L5, `scripts/checks/entry-preamble-parity.js` (row) + `.test.js` (4 cases retargeted to CODEX.md) — coordinator-authorized; `authority-pollution-scan.js` keeps the basename in its set but only scans existing files (verified green). Historical ADR-0036/INDEX, frozen sprint docs, `_planning/warpos-1.0-plan`, `runtime/warpos-v1-discovery`, `.claude/kernel/role-binding.json` prose left as-is |
| `WARP.md` → `_planning/design/WARP-cross-project-nervous-system.md` | `git mv` | 1 — `build.js` runtime-working-doc rule (`_planning/` is walk-skipped). The other `WARP.md` grep hits were `NEXT-WARP.md` (a different file) and a frozen runtime diagnostic |
| `HOW2CLEANMEMORY.md` → `_docs/HOW2CLEANMEMORY.md` | `git mv` | 1 — `scripts/warpos/manifest/walk-skip.js` (entry removed; `_docs/` is classified by the project-docs rule) |
| `agentic_os_tracker_system_improvements.md` → `_planning/tracker-system-improvements.md` | `git mv` | 27 occurrences across 15 files — ROADMAP.md (1), TRACKER.md (7), UNTRACKED_WORK.md (3), trackers/README.md (1), 4 epic trackers + 1 sprint tracker (10), `.claude/commands/scan/full.md` (2), `trackers/init.md` + `validate.md` (5), 3 hook/validator comments (3), `build.js` rule (1). Generated maps (`.claude/project/maps/*`) and the frozen prior-art sweep left for regen |
| `REPORT-JULY-18.md`, `CODEX-LOG.md` | **Nothing to move** — both are gitignored (`.gitignore` L55, L165) and untracked; they exist only on the maintainer's disk. Their mentions (walk-skip.js, ROADMAP/tracker evidence lines) are citations of a local file and were left alone. Adding them to the tracked tree would publish deliberately-excluded content; flagging for the orchestrator instead |

Paths registry: no key points at any moved file (checked `framework/paths.registry.json`); no `build.js` (paths) run needed. `_warpos/MANIFEST.json`, `.claude/framework-manifest.json`, `.claude/framework-installed.json` NOT regenerated (orchestrator does it after merge); `node scripts/warpos/manifest/build.js --dry-run` → 4052 paths, 0 unclassified, exit 0 (new `repo-community-doc` rule covers the four root community docs + `docs/` as owner=project, never shipped).

## Provenance SHAs

Verified ancestors of `origin/main` (48): `c7db0a2b afd31592 cd37d410 f504decf 25ce1750 29908188 bb06646d e0f25200 d39661a8 e44b78ad 38d771bf db6292e2 6779f6e6 de9ba8eb 318971ff b3a5ab06 d460de4b e37620d3 92c0cece` (pre-rewrite range, original SHAs) and `b1547463 f3cedda8 96da9aae de8707e1 d0363daa d02e310b 7d97f34a d6a7c07d 6a46719a 2dfbf75a cab32175 73cc5d21 13b1e0b1 560434ce e4d00a87 1b70dec6 408d0bbb 1578d527 2c29ffd9 ec6b2042 6802a5c3 3719ad4d` (post-rewrite SHAs, marked † on the page with the commit-map pointer).

**Not on public main** (cited in `runtime/prior-art/*` as pre-rewrite SHAs; NOT cited on the page — their post-rewrite equivalents are, via `commit-map.txt`): `91d38d39 fcaaa242 e386d70a 4c3bc3f9 392ed50b c305b555 bf894984 39acab5a 6f5b7f07 615e718d 9f0c6d90 a74ed329 03cf48cd 4a134933 06409e86 dc6b3c73 56c71f63 b57aa406 d86eee75 ac566028 7e2834d8 fd2fb7c2 d6e158d2 4a3a3c59 a97d2f76` plus ~60 further post-2026-05-13 SHAs in the prior-art files (all rewritten; the frozen evidence files were not edited).

## Gates

| Check | Result |
|---|---|
| `node scripts/trackers/validate.js` | 20/20 PASS, **exit 0** (31 report-only anti-deixis advisories, pre-existing) |
| `node scripts/checks/doc-ref-integrity.js` | exit 0 (report-only); 3 broken refs, all pre-existing and none from this sprint (`beta.md`, `beta/integrate.md`, `E-LIFECYCLE-001`) |
| `node scripts/checks/entry-preamble-parity.js` | OK, 5 entry files, exit 0 (was exit 1 between the deletion and the authorized row removal) |
| `node --test scripts/checks/entry-preamble-parity.test.js` | 1/1, exit 0 |
| `node --test tests/regression/SP-20260614-001/brand-leak.test.js` | 1/1, exit 0 |
| `node --test scripts/checks/license-match.test.js` | pass, exit 0 |
| `node scripts/checks/authority-pollution-scan.js` | OK, exit 0 |
| `node scripts/checks/test-warpos-ship-coverage.js` | 27/30 — the 3 failures are case (d), the live run against the stale `_warpos/MANIFEST.json`: `LICENSE`, `scripts/open-source/assert-evidence.js`, `scripts/open-source/remap-notes.js` were never allowlisted (pre-existing since S-OS-02/03 — the base allowlist had no such rows) and `INTERESTING.md` clears on manifest regen. Adding a reviewed KNOWN_NOT_SHIPPED row for LICENSE + `scripts/open-source/` is outside my grant — for the enforcers owner |
| pre-commit hook (steps-check + check-lib) | OK on both commits |

`git diff --stat 6e974c47 HEAD` (before this report): **36 files changed, 927 insertions(+), 390 deletions(-)**; the seven new/rewritten docs account for 834(+) / 262(−).

## Left for the orchestrator

- Regenerate the three manifests after merge (`generate-framework-manifest.js`, `snapshot-installed.js`, `warpos/manifest/build.js`); `generate-framework-manifest.js --check` is stale by construction (FRAMEWORK_DOCS lost GEMINI.md).
- `USER_GUIDE.md` still titles itself "WarpOS User Guide" — not in this sprint's deliverable list; brand-level prose there is a one-line follow-up if wanted before announce.
- `scripts/checks/warpos-ship-coverage.js`: LICENSE + `scripts/open-source/` allowlist rows (pre-existing gap, see above).
- `.claude/project/maps/{skills.jsonl,skills.md,inventory-skills.json}` carry the old brief name in the `trackers:validate` description — regenerated by `/maps:skills`.
