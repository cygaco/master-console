---
description: Run a skill against another portfolio product in a fresh Claude subprocess — never retargets the current session.
---

# /portfolio:run — Run a skill against another product (cross-repo dispatch)

`/portfolio:run <slug> /<namespace>:<skill> [args...]` — Run any skill against a registered product's working tree without leaving MC. Spawns a fresh Claude subprocess with `CLAUDE_PROJECT_DIR` set to the target's `repo_path`. The current MC Claude session is never retargeted.

## Input

`$ARGUMENTS` — `<slug> /<namespace>:<skill> [args...]`

- **slug** — registered product slug. Exits 1 with C-16 if not found.
- **/<namespace>:<skill>** — fully qualified skill path. Must match `^/[a-z][a-z0-9_-]*(:[a-z][a-z0-9_-]*)?$`. The leading `/` is required.
- **args...** — passed through to the target skill. Each arg must match `^[A-Za-z0-9_\-./:=@,+]+$` — semicolons, backticks, ampersands, `$`, and other shell metacharacters are refused at the input gate (redteam SCENARIO-6 / Beta IN-7-style addendum).

## Output

C-12 banner before spawn:

```
dispatching /portfolio:list against myapp (../myapp)...
```

Target subprocess stdout/stderr is piped to the caller's terminal. Exit code is propagated.

## Hard non-goal

**Never retargets the current Claude session.** The subprocess receives `CLAUDE_PROJECT_DIR=<repo_path>` via its child-process environment. The parent MC session's `CLAUDE_PROJECT_DIR` is never mutated (AC-7.2 invariant — observable in the trace payload via `parent_cpd_preserved: true`).

## Procedure

```bash
node scripts/portfolio/dispatch.js $ARGUMENTS
```

Under the hood the helper invokes:

```bash
claude -p --agent general-purpose "<skill> <args>"
```

— with `cwd: <repo_path>` and the overridden `CLAUDE_PROJECT_DIR` in the spawn env. Argv-array form everywhere (`shell: false`); no string concatenation reaches a shell.

## Exit codes

- `0` — target subprocess exited 0
- `1` — unknown slug, `repo_path` missing on disk, or spawn failure
- `2` — input gate rejected the skill name or args (shell metacharacter, missing `/`, etc.)
- _other_ — propagated from target subprocess

## TRACE

Emits `portfolio_dispatch` (TR-10) to `paths.eventsFile`:

```
{type: "portfolio_dispatch", slug, skill, args_hash, target_claude_project_dir, exit_code, duration_ms, parent_cpd_preserved}
```

`args_hash` = first 12 chars of `sha256(JSON.stringify(args))` — stable per arg list, no leakage of literal arg values. Fail-open.

## Acceptance criteria covered

- AC-7.1 — `CLAUDE_PROJECT_DIR` of the subprocess equals `slug.repo_path`, not canonical MC
- AC-7.2 — subprocess exit captured in TR-10; parent MC session retains its original `CLAUDE_PROJECT_DIR`
