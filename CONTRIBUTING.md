# Contributing to Master Console

Thanks for looking. Master Console is a single-maintainer project that is being opened up; the process below is what keeps it honest, and it applies to the maintainer's own changes too.

## Ground rules

- **License.** The project is licensed under the [GNU AGPL-3.0](LICENSE). By opening a pull request you agree that your contribution is licensed under the same terms (inbound = outbound). There is no CLA.
- **Conduct.** See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- **Security.** Do not open public issues for vulnerabilities — see [SECURITY.md](SECURITY.md).
- **No private data.** Never commit secrets, personal e-mail addresses, transcripts of AI sessions, or per-run artifacts. Per-run output belongs under `runtime/` (gitignored, never shipped).
- **Windows-first.** The installer is PowerShell and the scripts are exercised on Windows. Contributions that make other platforms work are welcome; contributions that break Windows are not.

## Getting set up

```
git clone https://github.com/cygaco/master-console.git
cd MC
node --version                                    # 20 or newer
```

There are no npm dependencies. Everything is plain Node.js and markdown.

## Where things live

| You want to change | Look in |
|--------------------|---------|
| A skill (slash command) | `.claude/commands/<namespace>/<name>.md` — frontmatter + procedure; `/skills:create` and `/skills:edit` scaffold and validate |
| An agent spec | `.claude/agents/<department>/...` — the role → spec → model map is `.claude/agents/_org/role-registry.json` (the keystone; adding an agent is a registry row) |
| A hook | `scripts/hooks/<name>.js`, wired through `.claude/settings.json`; `/hooks:add` scaffolds one, `/hooks:test` exercises them |
| An enforcer / check | `scripts/checks/<name>.js` with a sibling `<name>.test.js`; wire it into `/scan:full` (`.claude/commands/scan/full.md`) |
| A project path | `framework/paths.registry.json` (the **source**), then `node scripts/paths/build.js`. Never hand-edit `.claude/paths.json` — it is generated and your edit is discarded on the next build. Refer to paths in prose as `paths.<key>` |
| The installer / updater / release engine | `scripts/warp-setup.js`, `install.ps1`, `scripts/mc/` |
| The sprint lifecycle runtime | `scripts/sprint/` (`epsilon-runtime.js` and the hook-point registry under `.claude/agents/_org/`) |
| Spec templates | `_requirements/` and `_mc/templates/` |

## Running the tests

```
npm test                                    # node --test "scripts/**/*.test.js"
node --test scripts/checks/<name>.test.js   # one suite
```

The full suite is large (well over two hundred files) and a few tests exercise provider CLIs; run the suites next to what you touched, and the full run before you open a PR. A test that passes when the thing it guards is broken is a bug — every enforcer here ships with a planted-failure fixture that must go red.

## The gates

Run these before you push. They are the same gates CI runs (the workflow is landing alongside this rebrand).

| Gate | Command | What it refuses |
|------|---------|-----------------|
| Tests | `npm test` | Regressions |
| Leak gate | `npm run leak-gate` | Private product names, personal e-mail addresses, confidential markers, verbatim operator prompts, tracked per-run artifacts. Being added in the current open-source epic (S-OS-04); if the script is missing on your checkout, pull `main`. |
| License match | `npm run check:license` | `package.json#license` disagreeing with `LICENSE` |
| Tracker validator | `npm run trackers:validate` | A `TRACKER.md` / `trackers/**` that drifted from reality (20 checks, fail-closed) |
| Paths build | `npm run paths:build` | A registry edit whose generated views were not rebuilt |
| Full scan | `/scan:full` in Claude Code | Everything above plus the enforcer suite |

If you edit anything hash-tracked (`scripts/**`, `.claude/commands/**`, `ROADMAP.md`, the framework docs), regenerate the manifests **last**, before the commit: `node scripts/generate-framework-manifest.js`, `node scripts/mc/snapshot-installed.js`, `node scripts/mc/manifest/build.js`. A stale manifest fails the release gates.

## Branches, commits, pull requests

- `main` is always shippable. Nothing lands on it without a green gauntlet; direct pushes are fenced by a reference-transaction hook.
- Branch per change: `feat/<topic>`, `fix/<topic>`, `spike/<topic>`, or `sprint/<id>` for lifecycle work.
- Commit messages: `type(scope): what and why` — `feat`, `fix`, `docs`, `chore`, `refactor`, `test`. The body states what was verified and how (a test run, a diff, a fixture that went red).
- One PR per change. The description says what the change enforces, which gate proves it, and what it deliberately does not do. Never claim done without proof.
- A policy without an enforcer is not finished: if your change introduces a rule, name the hook, test, schema or gate that makes a violation self-detecting — or log the gap with `/enforcement:log`.

## Refactor and rename hygiene

Three rules with a bug history behind each, from [CLAUDE.md](CLAUDE.md):

1. Before deleting a file, `git grep` its basename across every `.md`, `.json` and `.js` and repoint the references.
2. Before finishing a rename, grep for **every** occurrence of the old literal; the file you forgot is the whole bug.
3. A fix that lives only inside a helper is not a fix — pair it with a guard that flags the raw pattern at write time.

## The rebrand

The brand is Master Console and, from `2.0.0`, the identifiers use the `mc` slug (`mc:*` skills, `MC_*` environment variables, `_mc/`, `.mc/`). The previous identifiers remain as deprecated aliases and read-fallbacks through 2.0.x and are removed in 2.1.0 (policy in [CHANGELOG.md](CHANGELOG.md)); please do not add new uses of them. Brand-level prose (READMEs, docs) should say Master Console.

## Questions

Open a [GitHub discussion or issue](https://github.com/cygaco/master-console/issues). Run `/mc:health` first — it usually names the fix.
