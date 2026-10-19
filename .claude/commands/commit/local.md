---
description: Stage and commit changes locally — smart message, no push
says:
  - commit this
  - commit locally
  - save a commit
  - commit local
  - make a commit
---

# /commit:local — Commit Changes Locally

Stage changed files and create a well-formed commit. Does NOT push.

## Input

`$ARGUMENTS` — Optional commit message hint. If omitted, message is auto-generated from diff.

## Procedure

### Step 1: Assess state

Run in parallel:
- `git status` — see what's changed (never use `-uall`)
- `git diff --staged` and `git diff` — see actual changes
- `git log --oneline -5` — match repo's commit message style

If nothing to commit, report "Nothing to commit" and stop.

### Step 2: Stage files

- Stage relevant files by name (`git add <file> <file>...`)
- Do NOT use `git add -A` or `git add .` — risk of including secrets or large binaries
- Do NOT stage `.env`, `.env.local`, credentials, or files in `.gitignore`
- If unsure about a file, ask

### Step 3: Draft commit message

Analyze all staged changes and draft a message:
- Summarize the nature: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:` prefix
- Focus on WHY not WHAT — the diff shows what
- 1-2 sentences max
- Match the style from Step 1's git log

### Step 4: Commit

```bash
git commit -m "$(cat <<'EOF'
<commit message>

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@example.com>
EOF
)"
```

- Use HEREDOC for proper formatting
- NEVER use `--no-verify` — if hooks fail, fix the issue
- NEVER amend unless explicitly asked — always create NEW commits
- If pre-commit hook fails: fix the issue, re-stage, create a NEW commit

### Step 5: Verify

Run `git status` to confirm clean state. Report: "Committed: `<short hash>` <message>"
