---
description: Refuse product-content leaks in canonical — full-tree, fail-closed scan for private product slugs, maintainer abs paths in executables, and promote-relic reintroduction (S-OS-04 / ED-417).
---

# /scan:framework-purity

The canonical-side last line of defense against leaking product-specific content into the public framework repo. Since S-OS-04 (ED-417) it is **full-tree and fail-closed by default**: every git-tracked file is scanned and any hard finding exits 1. It is one of the five gates `/scan:leak-gate` runs.

```bash
node scripts/checks/framework-purity.js            # default = --full: every git-tracked file (the leak gate)
node scripts/checks/framework-purity.js --staged   # staged tree only — the commit gate (WI-23)
node scripts/checks/framework-purity.js --diff     # staged + unstaged change-set
node scripts/checks/framework-purity.js --json     # programmatic consumption
```

Hard detectors (each one fails the gate):

| Detector | What it catches |
|---|---|
| `client_slug` | Any of the private product slugs in `CLIENT_SLUGS` (defined once, in the script) in tracked file content. The only exemptions are planning/history **records** (`trackers/`, `_planning/epics/`, `ROADMAP.md`, `RELEASES.md`, release changelogs, the dream journal, historical sprint/decision/learning records) and the derived `_mc/MANIFEST.json`. There is no pending-scrub allow-list any more — the private trees were untracked instead. |
| `abs_path` | Maintainer-home absolute paths — the old and the current Windows home forms, `/home/<u>/Desktop/`, `/Users/<u>/Desktop/` — **scoped to executable/config files** (`.js .mjs .cjs .ps1 .sh .cmd .bat .json`) under `scripts/` and `.claude/`. Docs, logs and markdown are deliberately out of scope: the operator is a public figure and an old path in prose is fine; in a script it is a portability bug and a leak. |
| `promote_relic` | Reintroduction of any purged promote-suite path or token (see `PROMOTE_RELIC_FILES` / `PROMOTE_RELIC_REGEX` in the script). |

Report-only advisories (never affect the exit code):

| Advisory | Why it is not a gate |
|---|---|
| `root_leak` | `_requirements/` or `_docs/` at canonical root. The canonical repo dogfoods its own product canon there; relocating it is a scope decision, so this is reported (visible) rather than the previous silent-off switch. |
| `domain_vocab` | Narrow origin-product identifiers on framework-neutral surfaces — surfaced for cleanup, not a gate (E-DISPATCH-PERFECT-001 W4). |

Modes:
- `--full` (default) — `git ls-files`: tracked + staged files. Gitignored local state can never false-RED the gate; a leak that is `git add`ed is caught before the commit.
- `--staged` — `git diff --cached` only. What the pre-commit guard (`scripts/hooks/framework-purity-guard.js`) runs (WI-23).
- `--diff` — staged + unstaged change-set.

Exit codes: `0` clean · `1` violations · `2` git/CLI error (fail-closed — an unreadable tree never reads green).

Enforcers of this skill's own contract: `scripts/checks/framework-purity.test.js` (detector units), `scripts/checks/framework-purity-gate.test.js` (planted-leak RED proof on a throwaway repo), `scripts/checks/test-framework-purity-staged.js` (WI-23 scoping). CI: `.github/workflows/leak-gate.yml`.
