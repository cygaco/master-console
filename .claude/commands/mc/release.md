---
description: "Drive a full MC release of the canonical clone from this product repo — promote, bump, regen, build capsule, run gates, commit, brokered ff-merge to main, push, tag. One command, no cd into canonical."
user-invocable: true
---

# /mc:release — release MC from the product repo

The product-side wrapper around `scripts/mc/release-canonical.js`. Drives every step of a MC release of the canonical clone WITHOUT switching the caller's cwd. Default = dry-run; `--apply` executes.

> Ledger contract — the version-bump stage writes a `RELEASES.md` Versions row in the canonical clone via `scripts/sprint/ledger.js` (loaded from canonical, projectRoot override). See `paths.sprintReference#ledger-discipline` for what qualifies and the fail-open contract.

## Background

Pre-0.1.3 the only path to a release was: edit version.json in canonical → cd `../MC` → regen manifest → build capsule → run gates → commit → push → ff-merge to main. Every step required cd-ing into the canonical clone. This skill replaces that with a single product-rooted command. All canonical-side ops happen via `spawnSync({cwd: canonical})` and `git -C <canonical> ...`.

## Usage

| Invocation | Behavior |
|---|---|
| `/mc:release` | Dry-run: locate canonical, plan everything, no writes |
| `/mc:release --version patch --apply` | Bump patch + execute the chain |
| `/mc:release --version minor --apply` | Bump minor + execute |
| `/mc:release --version 0.2.0 --apply` | Explicit version + execute |
| `/mc:release --canonical /abs/path --apply` | Explicit canonical clone path |
| `/mc:release --no-promote --apply` | Skip the promote step (you've already promoted) |
| `/mc:release --no-tag --apply` | Skip git tag at the end |
| `/mc:release --resume-from 7 --apply` | Resume after a gate failure (or wherever) |
| `/mc:release --json` | Machine-readable receipts |

## Stages

The orchestrator runs 11 stages (0-10). Each emits a receipt `{stage, ok, what, where, rollback}`.

| # | Stage | Purpose |
|---|---|---|
| 0 | locate-canonical | Find the MC clone (--canonical → ../MC sibling → manifest hint) |
| 1 | promote | Push framework changes from product to canonical (skippable with --no-promote) |
| 2 | compute-version | Bump per --version (patch \| minor \| major \| <x.y.z>) |
| 3 | bump-version | Write new version.json in canonical |
| 4 | regen-manifest | Regenerate canonical's .claude/framework-manifest.json |
| 5 | create-capsule-skeleton | Create framework/releases/<v>/{release.json, changelog.md, upgrade-notes.md} |
| 6 | build-capsule | Run release-build.js — manifest snapshot + checksums |
| 7 | run-gates | release-gates.js (block on RED, warn on yellow/manual) |
| 8 | commit-release-branch | git -C <canonical> checkout -b release/<v> + commit |
| 9 | merge-to-main-and-push | **brokered** ff-merge to main + push origin main (`release-canonical.js` routes stage 9 through the broker's `integrateBranchMerge` / `syncMainFromOrigin` fetch+brokered-ff; a raw `git merge` / `git pull --ff-only origin main` works today via the logged fallback but is REFUSED by the reference-transaction hook post-flip) |
| 10 | tag-and-push | git tag mc@<v> + push (--no-tag skips) |

## How it differs from the canonical-side `/mc:release`

The canonical version (in the MC repo) is the original engine — when you're inside the MC clone editing it directly. This skill is the cross-repo wrapper: same end state, but you stay in the product repo. They don't compete; the canonical version is the deepest layer this skill ultimately reaches.

## Recommended flow

```
# 1. Make framework improvements in product (edit .claude/, scripts/, etc.)
# 2. Dry-run to see what would happen:
/mc:release --version patch

# 3. Read the receipts. If happy:
/mc:release --version patch --apply

# 4. If a stage fails, the report tells you which + how to recover. Resume:
/mc:release --resume-from <N> --apply
```

## Failure modes

- **Stage 0** can't find canonical → pass `--canonical <path>` explicitly.
- **Stage 1** finds Class C in promote → resolve TEMPLATE_REVIEW / SECRET_BLOCK in source, `--resume-from 1`.
- **Stage 7** RED gates → inspect with `node scripts/mc/release-gates.js` inside canonical, fix, `--resume-from 7`.
- **Stage 9** push blocked by harness permission gate → first run after a fresh session needs explicit user authorization, then re-run.
- **Stage 9** non-fast-forward → canonical main has commits this run hasn't seen; reconcile manually.

## Authorization expectation

Stages that mutate state (3-10 in apply mode) write to canonical. Stage 9 pushes to `origin/main`. If the operator hasn't authorized a push-to-main this session, the harness may block. Authorize once, then `--resume-from 9 --apply` continues the chain.

## See also

- `scripts/mc/release-canonical.js` — the orchestrator engine
- Stage 1 (promote) — RETIRED in SP-20260522-001; stage now no-ops to preserve `--resume-from` numbering. Canonical-only sync; no product→canonical channel.
- `scripts/mc/release-build.js` — Stage 6 (canonical-side, invoked via spawnSync)
- `scripts/mc/release-gates.js` — Stage 7 (canonical-side)
- `scripts/mc/update.js` — the inbound counterpart for product → 0.1.x install
