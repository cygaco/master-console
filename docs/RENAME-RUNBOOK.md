# GitHub repository rename — operator runbook

**Status: EXECUTED 2026-09-12** — `cygaco/MC` → `cygaco/master-console` (Settings → General → Rename; verified via `gh repo view` and the 301 redirect). Kept as the record of the procedure. The rename is an operator action (public URL change, epic E-OPEN-SOURCE-001 gate); nothing in this repository performs it.

## Recommended slug: `cygaco/master-console`

Reasons, briefly:

- **Readable and searchable.** Two words, hyphenated, is GitHub's own convention (`github/docs`, `anthropics/claude-code`) and reads correctly in a URL, a badge and a search result. `masterconsole` as one word looks like a typo next to the domain-style spelling and is harder to scan.
- **Matches the brand, not the slug.** The brand is "Master Console"; the identifier slug `mc` (commands, env vars, directories, `mc@` tags — decided for `2.0.0`) is deliberately short and would be a poor repository name (`cygaco/mc` says nothing).
- **Distinct from the collisions.** `warp-os/mc` (GitHub, PyPI) and Warp / warp.dev were the reason for the rename; `master-console` shares no token with them.
- **The domain is separate.** `masterconsole.ai` is the operator's; a hyphen-free domain and a hyphenated repo name coexist fine (the README links both).

Alternative considered: `cygaco/masterconsole` (mirrors the domain exactly). Acceptable, but loses on readability; pick it only if a hyphen causes a real problem somewhere.

Check the name is free before renaming: `gh repo view cygaco/master-console` must return "not found".

## Before you rename

1. Land S-OS-05 (this rebrand branch) on `main` so the README already carries the naming note.
2. Confirm the private mirror `cygaco/MC-pre-cleanup-mirror` stays untouched — do not rename it; it is the pre-rewrite evidence and its name is recorded in `runtime/open-source/anchor/mirror-repo.json`.
3. Note the current remote on every clone you care about: `git remote -v`.

## The rename (GitHub UI)

1. Open `https://github.com/cygaco/MC/settings` (repository **Settings → General**).
2. In **Repository name**, replace `MC` with `master-console` and click **Rename**.
3. GitHub re-checks that the new name is free and renames in place. Issues, pull requests, releases, tags, stars, watchers, wiki, the Security tab (private vulnerability reporting) and the advisory database entries all move with the repository.

Equivalent CLI: `gh repo rename master-console --repo cygaco/MC`.

## What GitHub redirects after the rename

- **Web URLs** — `https://github.com/cygaco/MC/...` → `https://github.com/cygaco/master-console/...`.
- **Git over HTTPS and SSH** — `git clone`, `fetch`, `pull`, `push` against the old URL keep working through the redirect. Old clones do not break.
- **REST/GraphQL API** — requests to the old name return a redirect to the new one.

The redirect lives **only as long as nobody creates a new repository named `cygaco/MC`.** Never create one; if the old name must be reserved, keep the redirect instead (that is what GitHub recommends). Release asset download URLs under the old name also redirect, and the `mc@*` tags keep their names.

## What does NOT change by itself — update afterwards

Do these in one follow-up commit on `main`, in this order.

| Where | What to change | Note |
|---|---|---|
| `package.json` | `repository.url`, `homepage`, `bugs.url` → `https://github.com/cygaco/master-console` | The `name` stays `mc` until `2.0.0` (S-OS-06) |
| `README.md` | The clone URL in Quick start; the issues link in Support; the naming note's "still `cygaco/MC`" sentence | Keep one line saying the old URL redirects |
| `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md` (the compare/tag links at the bottom), `docs/PROVENANCE.md` (clone + `gh api` lines) | Same URL swap | `runtime/open-source/anchor/*.json` and `runtime/open-source/rewrite/*` are frozen records — do not edit |
| `.claude/commands/mc/setup.md` | The clone URL the `/mc:setup` skill uses for Step A | Otherwise a fresh install clones through the redirect (works, but say the real name) |
| `scripts/warp-setup.js` | The clone URL / repo name in the installer's prerequisite messages | Same |
| `scripts/mc/update.js` (and `install.ps1` messages) | The canonical-clone auto-discovery walks sibling dirs `../MC/` and `../mc/`; add `../master-console/` **ahead of** them so a freshly cloned canonical is found | Keep the old names for one release; S-OS-06 removes them |
| `ROADMAP.md`, `TRACKER.md`, `trackers/epics/E-OPEN-SOURCE-001-master-console-open-source.md` | Repoint the repository links; record the rename date and the old → new URL in the epic's evidence log | Run `node scripts/trackers/validate.js` after |
| `.claude/project/sprint/**` (plan contracts, requirements that cite the URL) | Leave as-is | Frozen per-sprint artifacts; the redirect covers them |
| Local clones | `git remote set-url origin https://github.com/cygaco/master-console.git` | The redirect works without it, but every clone should stop relying on it |
| `.claude/portfolio/registry.yaml` (`paths.portfolioRegistry`, per machine, gitignored) | If it records the canonical clone by URL or by sibling directory name, update it; if the local directory is renamed, update the path | `/portfolio:list` shows what each product points at |
| Downstream products (the 8 in the portfolio registry) | Their installed copies pin releases by content hash, not by URL — nothing to do for `/mc:update`. Their `.claude/framework-installed.json#source` and `.claude/manifest.json#mc.source` record a **local path** to the canonical clone; if you rename the local directory, run `/mc:update` with `--source <new path>` once, or edit those two fields | Ship a one-line note through `runtime/open-source/rewrite/DOWNSTREAM-NOTICE.md` or `/session:write` |
| GitHub repository **About** panel | Description, website `https://masterconsole.ai`, topics (`claude-code`, `ai-agents`, `agent-framework`, `agpl`); social preview image | UI only |
| Announcement (S-OS-07) | Use the new URL everywhere; mention that old links redirect | — |

Do **not** rename the `mc@*` tags, the `_mc/` directory, the `MC_*` environment variables or the `warp:*` skills here — that is the identifier-layer migration (S-OS-06, `mc@2.0.0`) with aliases for one release.

## Verify

```bash
gh repo view cygaco/master-console --json name,url,isPrivate
git ls-remote https://github.com/cygaco/MC.git HEAD          # must still answer, via redirect
curl -sI https://github.com/cygaco/MC | grep -i '^location'  # 301 → /cygaco/master-console
git clone https://github.com/cygaco/master-console.git /tmp/mc-verify
node scripts/open-source/assert-evidence.js --repo /tmp/mc-verify    # headline SHAs + tag + gpgsig unchanged
```

The last line is the S-OS-07 gate: every hash on `docs/PROVENANCE.md` must resolve on `origin/main` after the rename.

## Rollback

A rename can be reversed the same way (Settings → General → rename back to `MC`) as long as the old name is still free. Redirects then flip the other way. Nothing in git changes either way; only the URL does.
