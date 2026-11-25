---
description: Push current branch to remote — with safety checks
---

# /commit:remote — Push to Remote

Push the current branch to the remote. A force push still needs the user's explicit confirmation.

## Input

`$ARGUMENTS` — Optional: `--force` (force push, still asks for confirmation)

## Procedure

### Step 1: Pre-push checks

Run in parallel:
- `git status` — confirm no uncommitted changes (warn if dirty)
- `git log origin/<branch>..HEAD --oneline` — show what will be pushed
- `git branch --show-current` — confirm current branch

If on `main` or `master` and force push requested: **WARN and ask for explicit confirmation. Do not proceed without it.**

### Step 2: Push

A push of green work to the operator's own repos does not ask (`CLAUDE.md` § Autonomy). If the remote is public, the zero-personal-content check and a security read of what is new come first.

```bash
git push -u origin <branch>
```

- Use `-u` to set upstream tracking
- NEVER use `--force` unless user explicitly requested AND confirmed
- NEVER skip hooks (`--no-verify`)

### Step 3: Verify

Run `git status` to confirm branch is up to date with remote.

Report: "Pushed <N> commits to `origin/<branch>`"
