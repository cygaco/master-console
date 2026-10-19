---
description: Push current branch to remote — with safety checks
says:
  - push it
  - push the branch
  - push to remote
  - commit remote
says-confirm: always
---

# /commit:remote — Push to Remote

Push the current branch to the remote. Requires user confirmation.

## Input

`$ARGUMENTS` — Optional: `--force` (force push, still asks for confirmation)

## Procedure

### Step 1: Pre-push checks

Run in parallel:
- `git status` — confirm no uncommitted changes (warn if dirty)
- `git log origin/<branch>..HEAD --oneline` — show what will be pushed
- `git branch --show-current` — confirm current branch

If on `main` or `master` and force push requested: **WARN and ask for explicit confirmation. Do not proceed without it.**

### Step 2: Confirm

Show the user:
```
Pushing to: origin/<branch>
Commits: <N> new commits
  <hash> <message>
  <hash> <message>
```

Ask: "Push these commits?" (Even in dark mode — pushing is visible to others.)

### Step 3: Push

```bash
git push -u origin <branch>
```

- Use `-u` to set upstream tracking
- NEVER use `--force` unless user explicitly requested AND confirmed
- NEVER skip hooks (`--no-verify`)

### Step 4: Verify

Run `git status` to confirm branch is up to date with remote.

Report: "Pushed <N> commits to `origin/<branch>`"
