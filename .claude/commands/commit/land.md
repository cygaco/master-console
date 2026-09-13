---
description: Land the working branch — commit locally, push the branch, then merge it into the repo's default branch and push that too. The full commit→push→merge flow.
---

# /commit:land — Land the working branch to the default branch

Commits the working branch, pushes it, then completes the merge into the repo's default
integration branch (e.g. `main`). Successor to `/commit:both`, which stopped at push.

## Input

`$ARGUMENTS` — optional commit message hint (passed to the local commit step).

## Procedure

### Step 1 — Commit locally
Follow the full `/commit:local` procedure: assess state, stage, draft message, commit.
- If nothing to commit, check for unpushed commits / an unmerged branch — if there's still something to push or merge, continue; otherwise report "Nothing to do" and stop.

### Step 2 — Detect the default branch (never assume "master")
Resolve the integration branch from the remote, in order:
1. `git symbolic-ref --short refs/remotes/origin/HEAD` → strip `origin/` (e.g. `main`).
2. Fallback: `git remote show origin` → "HEAD branch".
3. Fallback: `main`.
Call it `$DEFAULT`. Record the current branch as `$BRANCH`.

### Step 3 — Push the working branch
Follow `/commit:remote`: pre-push checks, show what will be pushed, push `$BRANCH` to origin. Invoking `/commit:land` is the confirmation — no second prompt.
- If `$BRANCH == $DEFAULT`, there is no branch to merge: the push already updated the default branch. Skip Step 4, go to Step 5.

### Step 4 — Merge into the default branch (brokered)
Route the merge through the broker. A raw local `refs/heads/$DEFAULT` write — `git merge $BRANCH`, or `git pull --ff-only origin $DEFAULT` (which fast-forwards the checked-out `$DEFAULT` directly) — is REFUSED by the `reference-transaction` hook once the Seam-E fence is armed. It works today unbrokered via the LOGGED fallback; post-flip the raw form is REFUSED by the reference-transaction hook, and only the brokered path lands.
1. Sync `$DEFAULT` from origin WITHOUT moving the local ref: `git fetch origin $DEFAULT` (a fetch is never a protected-ref write). Do NOT `git pull --ff-only origin $DEFAULT` — that is an un-brokered `$DEFAULT` ref-move; the broker re-resolves the live `$DEFAULT` head and lands onto it (fetch + brokered-ff, the F2 pattern).
2. Broker the merge: `node scripts/dispatch/broker-merge.js $BRANCH --sp-id <sprint-id> [--bundle-manifest <promoted>]` (`--sp-id` defaults to `$MC_SP_ID`). It holds the conductor lease, raises the fence, and performs the SINGLE fenced ref move — no `git checkout $DEFAULT`, no raw `git merge`; the working tree is never touched, so you stay on `$BRANCH`. Exit 0 = landed (brokered, or the logged pre-flip fallback); exit 1 = refused/failed (classify + STOP); exit 2 = usage.
3. **Conflict / refusal → STOP.** If the broker reports a merge conflict or a security/usage refusal, do NOT force or auto-resolve: report its classification + detail and hand back to the operator.
4. Before pushing the default branch, ensure the gate is green — the commit hooks already ran in Step 1; if the repo has a `/scan:full` (or equivalent) gate and this is a substantial change, run it. **Never push a broken default branch.**
5. `git push origin $DEFAULT` — pushing the REMOTE ref is not a local-`$DEFAULT` write (the fence covers `refs/heads/$DEFAULT`), so it stays as-is (still autonomy-gated per Notes).
6. No checkout dance: the broker moved `$DEFAULT` without touching your working tree, so you are already on `$BRANCH` — the session continues where it was.

### Step 5 — Report
```
Committed: <hash> <message>
Pushed:    <N> commits → origin/$BRANCH
Merged:    $BRANCH → $DEFAULT (<ff|no-ff>)
Pushed:    origin/$DEFAULT @ <hash>
```
If a conflict halted Step 4, report the conflicted files and the resume path instead.

## Notes
- Pushing `$DEFAULT` is the one irreversible step. Per CLAUDE.md autonomy, push is "ask first" — **invoking `/commit:land` IS that authorization**.
- Does **not** delete `$BRANCH` (backup-branch safety; CLAUDE.md forbids deleting backup branches). Prune manually if desired.
- Supersedes `/commit:both`. The granular building blocks `/commit:local` and `/commit:remote` remain.
