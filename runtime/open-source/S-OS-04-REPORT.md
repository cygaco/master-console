# S-OS-04 — Leak enforcers (ED-417) — build report

**Branch:** `worktree-agent-a760cbcc7211dd4cd` (branched from `open-source/S-OS-04-05`) · **Commit:** `cd07638e` (+ this report commit) · **Date:** 2026-09-12

## Deliverables

| # | Deliverable | Status | Test file |
|---|---|---|---|
| 1 | `scripts/check/privacy.js` — exit 1 on HIGH+MED by default; `--advisory` = old HIGH-only; `--strict` = any; placeholder emails via `scripts/check/privacy.allowlist.json` | DONE | `scripts/check/privacy.test.js` (9/9) |
| 2 | `scripts/checks/framework-purity.js` — FULL-TREE default over `git ls-files`, slugs fail-closed, pending-scrub allow-list entries removed (EXAMPLES, `_docs/{briefs,clones,imports,research}`, portfolio scripts, `_index`); abs-path rule extended to the current home form + msys form and SCOPED to `.js .mjs .cjs .ps1 .sh .cmd .bat .json` under `scripts/` + `.claude/`; `root_leak` demoted from silent-off to visible advisory; exit 2 on unreadable tree | DONE | `framework-purity-gate.test.js` (7/7), `framework-purity.test.js` (8/8), `test-framework-purity-staged.js` (4/4) |
| 3 | `scripts/checks/warpos-tracked-transients.js` — extended: `runtime/**/*.{jsonl,log,diff,err,out}`, `runtime/**/*.txt` > 200 KB, β mining dir; reasoned allowlist `warpos-tracked-transients.allowlist.json` (empty); fail-closed loader | DONE | `warpos-tracked-transients.test.js` (7/7) |
| 4 | `scripts/checks/leak-denylist.js` + `.json` — sliding k-word window, sha256 over normalised phrase (kind=phrase) or raw lowercased token (kind=token), `chars` pre-filter, `--add`, never prints matched text, 0-entry list = exit 2. Seeded from the operator's LOCAL rules (`_private/rewrite/replace-rules.clean.txt`, 20/20 rules: 14 literal + 6 regex expanded — alternation/optional groups, open-ended tail → literal prefix) = 26 entries + 1 fixture | DONE | `leak-denylist.test.js` (9/9) |
| 5 | `.gitignore` — β mining dir re-asserted (confirmed untracked: `git ls-files` = 0), rewrite originals (`_private/` + `runtime/open-source/rewrite/{*.orig,*unredacted*,originals/}`), untracked private trees | DONE | covered by #3 test |
| 6 | `.github/workflows/leak-gate.yml` (push + PR, checkout fetch-depth 0, Node 20, npm ci/install, each gate its own step, then `npm test`) + `npm run leak-gate` → `scripts/checks/leak-gate.js` | DONE | `leak-gate.test.js` (2/2, asserts CI ≡ runner) |
| 7 | `scripts/checks/readme-drift.js` — three exact fact lines vs package.json / tracked `.claude/commands/**/*.md` / settings hook count | DONE | `readme-drift.test.js` (8/8, fixtures `fixtures/readme-drift/{pass,fail}.md`) |
| 8 | Residual A — `_warpos/EXAMPLES/` (33 files) `git rm -r --cached` + gitignored; describing docs repointed to `_warpos/BASELINE/_requirements/` (Pantry Pilot): `maps/steps.md`, `scan/architecture.md`, `warpos-ship-coverage.js`, `manifest/test-build.js`, `framework-purity.js`. Historical mentions in TRACKER/ROADMAP/epic left as history. No script reads EXAMPLES at runtime (only a path-classification rule, retained so a re-tracked copy can never ship) | DONE | — |
| 9 | Residual B — paid-course author name: 19 files → 0 tree hits; maps (`.claude/project/maps/*` ×5) HAND-EDITED (regen-maps rewrites all 7 maps with fresh timestamps — too noisy for this branch); `/trackers:validate` 20/20 | DONE | — |
| 10 | `/scan:leak-gate` skill (`.claude/commands/scan/leak-gate.md`) registered in `/scan:full` Tier 3; ED-417 CLOSURE row appended to `paths.enforcementDebt` (per-machine gitignored ledger in the main checkout — the worktree has no copy) | DONE | scan-coverage green for the new entry |

## Real exit codes

| Gate | Clean tree | Planted fixture |
|---|---|---|
| privacy | 0 | 1 |
| framework-purity --full | 0 | 1 |
| tracked-transients | 0 | 1 |
| leak-denylist | 0 | 1 |
| readme-drift | **1** (current README says 0.8.0 and lacks the Skills/Hooks lines — expected and correct; S-OS-05 rewrites README) | 1 (fail fixture) / 0 (pass fixture) |
| `npm run leak-gate` | 1 (readme-drift only) | — |

New tests: 43/43 under `node --test`. `scripts/checks/*.test.js` subset: 260/269 pass; the 8 failures are pre-existing / environment-only (record-trust CONTROL, G3 ×3, cutover-completeness, and `contract-lint` + `doc-ref-integrity` which need the gitignored ledger / mined / ingest files absent in a fresh worktree). Also pre-existing: scan-coverage flags a dangling `/scan:full-ONLY` token in `full.md` (present at the base commit).

## Also cleared while getting framework-purity green (index-only removals, files stay on disk)

`_docs/research/*-staffing-layer/` + its `_warpos/BASELINE` mirror (5+5), the product-clone postmortem + mirror (1+1), `scripts/delta-*.txt` origin-product onboarding specs (5), `scripts/write-mr-fix1-brief.js` (hardcoded operator home path, origin-product brief) — all gitignored with wildcard patterns that do not spell the slug. One surviving quoted operator fragment in `judgement-model.md` (P-024) rewritten by position. 39 slug mentions in shipped content neutralised (`the origin product`, `product-a`, `pantry-pilot`).

## Not done / notes for the orchestrator

- Manifests NOT regenerated (per constraint) — `_warpos/MANIFEST.json` still lists the untracked paths; regen after merge.
- `root_leak` (66 `_requirements/` + 113 `_docs/` files at canonical root) is an advisory, not a gate — scope decision outside S-OS-04.
- INTERESTING.md and WARP.md received one-word edits each (slug removal) — coordinate with the root-.md owner.
- Regex rewrite rules seeded as literal expansions; an open-ended-tail rule is seeded by its literal prefix only (documented in the denylist `_comment`).

## Files changed (`git diff --stat 6e974c47..cd07638e`)

135 files changed, 2084 insertions(+), 34713 deletions(-) — 16 added, 67 modified, 52 removed from the index.
