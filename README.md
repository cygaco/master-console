# Master Console

**Formerly WarpOS.** An AI operating system for Claude Code: it turns one assistant into an autonomous AI company — an architect that plans, a judge that second-guesses, builders that work in isolated branches, reviewers that check every build, and a memory that survives sessions.

**Version:** 1.2.0

**Skills:** 237 slash commands

**Hooks:** 75 automated hooks

**Platform:** Windows-first (PowerShell installer, Node.js hooks). Other platforms are untested.

**License:** [AGPL-3.0](LICENSE)

## Naming note

The brand is **Master Console**; the engine in this repository was built and released as **WarpOS** from March to July 2026. This rebrand is landing in two steps:

1. **Brand layer (this README, the docs, the story)** — done. Where history is referenced, it says "formerly WarpOS".
2. **Identifier layer** — not yet. The package name (`warpos`), the `warp:*` skill namespace, the `WARPOS_*` environment variables, the `_warpos/` directory, the `warpos@` release tags and the `WARPOS.md` gap register are all unchanged until the `2.0.0` release, which introduces the `mc` slug with one release of deprecated aliases. Until then, everything you type is still spelled `warp`.

The GitHub repository is still `cygaco/WarpOS`. It will be renamed; GitHub redirects the old clone URLs after a rename, and the runbook is in [docs/RENAME-RUNBOOK.md](docs/RENAME-RUNBOOK.md). The name was changed because "WarpOS" collides with an unrelated `warp-os/warpos` project (GitHub and PyPI) and with Warp, the terminal company. The story of what was built when, with reproducible receipts, is in [docs/PROVENANCE.md](docs/PROVENANCE.md).

## What is this?

You know how using Claude Code feels like talking to a smart colleague? Master Console turns that colleague into a company.

Instead of one assistant you get **Alex**, one identity shown in five faces depending on the work:

| Face | Symbol | What Alex is doing |
|------|--------|--------------------|
| Alpha | α | Running it — architect, spec creator, orchestrator, your main session |
| Beta | β | Checking it — independent judgment on decisions, read-only, cites precedent |
| Gamma | γ | Delivering a single feature (adhoc build) — dispatches builders and the review gauntlet |
| Delta | δ | Delivering a full skeleton build (oneshot) — runs standalone with a state machine |
| Epsilon | ε | Delivering a sprint — plan → design → build → gauntlet → release → retro |

Under Alex sit the **departments** — Product (with Quality), Engineering and Growth — as directors, leads and specialist workers: builders and fixers that write code in isolated git worktrees, code-quality reviewers, a QA reviewer (traceability, integrity and 13 failure-mode personas), a three-lab security panel, and design/visual reviewers. Roles, models and reporting lines come from one registry file, `.claude/agents/_org/role-registry.json`. See [AGENTS.md](AGENTS.md) and [AGENT-STRUCTURE.md](AGENT-STRUCTURE.md).

Around the agents:

- **237 skills** — slash commands such as `/fix:fast`, `/research:deep`, `/sprint:full`, `/sleep:deep`. They live under `.claude/commands/<namespace>/<name>.md` (230 live plus 7 deprecated aliases kept for one release).
- **75 hooks** — things that happen automatically around every prompt, edit and command: secret scanning, formatting, path guards, dispatch guards, tracker validation. Registered in `.claude/settings.json`; the scripts are under `scripts/hooks/`.
- **Memory** — an append-only events log, scored learnings with a validation lifecycle, reasoning traces, and a sleep/dream consolidation cycle that prunes and promotes what the system learned.
- **Enforcement** — every policy names an enforcer or logs the gap; `/scan:full` runs the whole enforcer suite; the sprint lifecycle refuses to close without real evidence.
- **Cross-provider dispatch** — reviewers and judges can run on a different AI lab than the one that wrote the code, through each lab's own CLI.

## Quick start

### What you need

1. **Claude Code** — the CLI from Anthropic
2. **Node.js 20+** — the hooks and scripts are JavaScript (`package.json` declares `engines.node >= 20`)
3. **Git** — for version control and builder isolation (builders work in worktrees)

### Install

Open your project in your editor, then in a fresh terminal:

```
# 1. Clone the engine next to your project
git clone https://github.com/cygaco/WarpOS.git

# 2. Run the installer from inside your project
cd <your-project>
node ../WarpOS/scripts/warp-setup.js .

# 3. Start Claude Code in your project and finish setup
/warp:setup     # completes any missing step: clone, install, CLAUDE.md merge, hooks
/warp:tour      # guided introduction
```

The PowerShell installer is equivalent: `..\WarpOS\install.ps1 -Target <your-project>` (add `-DryRun` to see the plan without writing). Both paths copy the agents, skills, hooks, schemas and templates enumerated in `.claude/framework-manifest.json`, detect your tech stack, write `.claude/manifest.json`, compile `.claude/settings.json`, and record an install snapshot so `/warp:update` can upgrade you later.

### Optional: provider CLIs

The role registry spreads roles across providers. Builders, fixers and the engineering leads run on Claude; the code-quality reviewers run on a different Claude model than the builders; Beta, the Product and Growth directors and leads, the ops analyst and the cabinet consult run on OpenAI through the Codex CLI; the security reviewer's Gemini lane and the research lead run through the Antigravity `agy` CLI. Dispatch is CLI-only — the engine never calls a provider API where a CLI exists.

```powershell
# OpenAI — Beta, Product and Growth judgment, ops analyst
npm i -g @openai/codex
codex login

# Gemini — through the Antigravity `agy` CLI (the standalone `gemini` CLI is not used)
# Install and authenticate per the Antigravity CLI setup; see ANTIGRAVITY.md.
```

A missing CLI degrades to the fallback declared for that role in the registry. The security panel is designed to refuse rather than review with a single lab. Run `/scan:environment` after install to see what is reachable. Full per-role chart: [AGENTS.md § Dispatch Topology](AGENTS.md).

### Verify

```
/warp:health    — checks every system, reports green / yellow / red with plain-English fixes
/warp:doctor    — the full-coverage diagnostic
```

Then read **[USER_GUIDE.md](USER_GUIDE.md)** — the daily-rhythm guide: modes, the terminal setup, skill sequences, and (most important) git discipline.

## Start here — five skills

| Skill | What it does |
|-------|--------------|
| `/fix:fast` | Quick diagnosis: read the error, find the cause, fix it, verify |
| `/fix:deep` | Deep fix: framework selection, five candidate solutions, root cause, prevention |
| `/scan:full` | Run every check in parallel and get one unified health report |
| `/session:handoff` | Write a rich handoff document for the next session |
| `/commit:land` | Commit, push the branch, merge into the default branch |

## Modes

| Mode | Who is in the room | When |
|------|--------------------|------|
| `/mode:solo` | You + Alpha | Quick edits, reading, skill management — most of the day |
| `/mode:adhoc` | Alpha + Beta + Gamma | One feature with oversight: plan, judge, build, gauntlet |
| `/mode:oneshot` | Delta alone | Rebuild a whole codebase from its specs, feature by feature |
| `/mode:sprint` | Epsilon conducting the org | Full lifecycle with plan contracts, tickets, release and retro |

Entering a mode only sets it up; nothing builds until you give an explicit task.

## Repository layout

```
.
├── CLAUDE.md               — Alex's identity and operating doctrine (merged into your project)
├── AGENTS.md               — agent system router; AGENT-STRUCTURE.md — the org tree
├── install.ps1             — PowerShell installer; scripts/warp-setup.js — Node installer
├── .claude/
│   ├── agents/             — president/ (the five faces), engineering/, product/, growth/, _org/ (role registry)
│   ├── commands/           — the 237 skills, one .md per slash command, grouped by namespace
│   ├── project/reference/  — reasoning frameworks, operational loop, sprint workflow reference
│   └── settings.json       — compiled hook wiring (75 hooks)
├── scripts/                — hooks/, dispatch/, sprint/, paths/, checks/, warpos/ (install + release engine)
├── framework/              — paths registry source (framework/paths.registry.json) + release capsules
├── _requirements/          — spec templates: canonical brief, design system, architecture, features, ops, security, testing
├── _warpos/                — framework zone: templates, settings defaults, ownership manifest, a synthetic example product
├── patterns/               — validated implementation patterns
├── trackers/               — the enforced tracker system (TRACKER.md + per-epic/sprint files + validator)
├── schemas/  migrations/  tests/
└── docs/                   — PROVENANCE.md, RENAME-RUNBOOK.md
```

The `.claude/` directory in this repository **is** the framework; the installer copies it into your project's `.claude/`. Paths inside agent specs are written for the installed location.

Project paths are never hard-coded in skills, agents or hooks; they are `paths.X` keys resolved from `framework/paths.registry.json` (the source) into `.claude/paths.json` (generated by `node scripts/paths/build.js`).

## Skills by namespace

Browse `.claude/commands/`. The namespaces:

| Namespace | Purpose |
|-----------|---------|
| `fix`, `qa`, `redteam`, `ui` | Diagnose and fix; QA personas; security red-team; design-system review |
| `scan` | Enforcers and health checks — `/scan:full` runs them all |
| `mode`, `session`, `turbo`, `permissions` | Modes, checkpoints, handoffs, resume, speed levers |
| `sprint`, `epic`, `trackers`, `roadmap`, `issues`, `report` | The planning and tracking lifecycle |
| `oneshot`, `karpathy`, `etc` | Autonomous skeleton builds; closed-loop artifact optimization; skill authoring with eval packs |
| `learn`, `sleep`, `beta`, `memory`, `reasoning` | Learning extraction, consolidation, judgment model, memory verification |
| `research`, `discover`, `maps`, `docs` | Multi-provider research; system discovery; relationship maps |
| `agents`, `models`, `hooks`, `skills`, `paths`, `manifest`, `enforcement`, `events` | Managing the engine itself |
| `bootstrap`, `portfolio`, `admin`, `cockpit`, `panel`, `guides`, `knowledge`, `playbook` | Product on-ramps, multi-product operation, founder panels, guide and knowledge libraries |
| `growth`, `content` | Message briefs, angles, landing pages, ad creative, posts |
| `warp` | Install, update, release, health, diagnostics of the engine (renamed to `mc:*` in 2.0.0) |
| `commit`, `linters`, `fav`, `check` | Landing work; linters; favourites; deprecated `check:*` aliases for `scan:*` |

## Requirements system

Templates for every document a product needs, under `_requirements/`:

| Folder | What |
|--------|------|
| `00-canonical` | Product brief, model, glossary, golden paths |
| `01-design-system` | UX principles, colours, components |
| `03-architecture` | Stack, data flow, security |
| `04-features` | Feature specs (PRD, stories, inputs) |
| `05-operations` … `10-contracts` | Operations, security review, testing, automation, integrations, contracts |

Templates carry `<!-- GUIDANCE: -->` comments explaining what to write.

## Your project

The installer creates `.claude/manifest.json` in your project. It tells Alex what framework you use, where your source lives and what you are building. Edit `CLAUDE.md` to describe your project, edit the manifest to configure hooks and guards, write feature specs in `_requirements/04-features/`, and use `/skills:create` to add your own skills.

## Documentation

- [USER_GUIDE.md](USER_GUIDE.md) — how to actually use it day to day
- [AGENTS.md](AGENTS.md) · [AGENT-STRUCTURE.md](AGENT-STRUCTURE.md) · [CLAUDE.md](CLAUDE.md) — the agent system and doctrine
- [CHANGELOG.md](CHANGELOG.md) · [RELEASES.md](RELEASES.md) — what changed, release by release
- [docs/PROVENANCE.md](docs/PROVENANCE.md) — formerly WarpOS: what was built when, with receipts
- [docs/RENAME-RUNBOOK.md](docs/RENAME-RUNBOOK.md) — the pending GitHub repository rename
- [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## Support

- Run `/warp:health` first; it names the failing system and the fix.
- Bugs and questions: [GitHub issues](https://github.com/cygaco/WarpOS/issues). Security reports: see [SECURITY.md](SECURITY.md) — private vulnerability reporting on the repository, no email.

## License

Master Console is free software under the [GNU Affero General Public License v3.0](LICENSE). The engine in this repository is fully open; a hosted **Master Console UI** may later be offered separately (open core). Contributions are accepted under the same license — see [CONTRIBUTING.md](CONTRIBUTING.md).
