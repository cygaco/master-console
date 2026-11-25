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
- Manifests: once per landing, if any hash-tracked file changed since the last landing, run `node scripts/mc/manifest/regen-all.js` (regenerates the three manifests in order, then runs the four checks; it must exit 0) and include its output in this commit. Commits before the landing do not regenerate them.
- Records: the tracker line for this landing rides in this same commit — no separate records commit before or after it. Run records under `runtime/` stay local (gitignored); do not force-add them.

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
When `origin` itself is a public repository, Step 5's two conditions apply before any push in this step.
Route the merge through the broker. A raw local `refs/heads/$DEFAULT` write — `git merge $BRANCH`, or `git pull --ff-only origin $DEFAULT` (which fast-forwards the checked-out `$DEFAULT` directly) — is REFUSED by the `reference-transaction` hook once the fence is armed; only the brokered path lands.
1. Sync `$DEFAULT` from origin WITHOUT moving the local ref: `git fetch origin $DEFAULT` (a fetch is never a protected-ref write). Do NOT `git pull --ff-only origin $DEFAULT` — that is an un-brokered `$DEFAULT` ref-move; the broker re-resolves the live `$DEFAULT` head and lands onto it (fetch + brokered fast-forward).
2. Broker the merge: `node scripts/dispatch/broker-merge.js $BRANCH --sp-id <sprint-id> [--bundle-manifest <promoted>]` (`--sp-id` defaults to `$MC_SP_ID`). It holds the conductor lease, raises the fence, and performs the SINGLE fenced ref move — no `git checkout $DEFAULT`, no raw `git merge`; the working tree is never touched, so you stay on `$BRANCH`. Exit 0 = landed (brokered, or the logged fallback); exit 1 = refused/failed (classify + STOP); exit 2 = usage.
3. **Conflict / refusal → STOP.** If the broker reports a merge conflict or a security/usage refusal, do NOT force or auto-resolve: report its classification + detail and hand back to the operator.
4. Before pushing the default branch, ensure the gate is green — the commit hooks already ran in Step 1; if the repo has a `/scan:full` (or equivalent) gate and this is a substantial change, run it. **Never push a broken default branch.**
5. `git push origin $DEFAULT` — pushing the REMOTE ref is not a local-`$DEFAULT` write (the fence covers `refs/heads/$DEFAULT`), so it stays as-is (still autonomy-gated per Notes).
6. No checkout dance: the broker moved `$DEFAULT` without touching your working tree, so you are already on `$BRANCH` — the session continues where it was.

### Step 5 — Update the public copy (repos with a public emit only)
Skip this step when the repo has no `scripts/public-repo/generate.js`. Otherwise the public copy is kept current on every landing; it is one step with two conditions, and nothing is published until both hold.
1. **Emit** from the landed default-branch commit onto a fresh clone of the public repo, outside this checkout: `node scripts/public-repo/generate.js --ref <40-hex landed sha> --out <clone> --append` (run it with `--dry-run` first). It writes one commit, `Master Console <version>`, with the generator's neutral identity and the source commit's date in UTC. "no changes" means there is nothing to publish; stop here.
2. **Condition 1 — zero personal content on exactly what goes public.** The emit runs the content check on the staged files and then, with `--history`, on every commit's message, author and committer, and refuses on any hit. Before trusting its pass, show the check catching one planted item: copy the emitted tree, add one line holding a home-directory path to any shipped text file, run the copy's `ci/no-personal-content.js --root <copy> --fingerprints <file>`, and confirm it exits 1 on that line (a check whose lists failed to load passes everything). Its `GENERATION.json` must also show `negative_control.code` 1. A hit is fixed by rewording the source line and landing it, never by an exemption.
3. **Condition 2 — one security read** of what is new since the public repo's last state (`git diff <public head> <new head>` in the emitted repo), by the security reviewer, one round, with a second focus on personal and instance content. Run it with the emitted repo as the reader's working directory, never this checkout. A FAIL holds the publish; fix forward and emit again.
4. **Push** the clone's `main` to the public repo as a fast-forward (never `--force`), then, when the version changed, tag `v<version>` and push the tag. If Claude Code's safety check refuses the push, stop and send the lead one line; never reshape the command.

### Step 6 — Report
```
Committed: <hash> <message>
Pushed:    <N> commits → origin/$BRANCH
Merged:    $BRANCH → $DEFAULT (<ff|no-ff>)
Pushed:    origin/$DEFAULT @ <hash>
Public:    <public head> (or: no public emit / no changes / held: <one plain sentence>)
```
If a conflict halted Step 4, report the conflicted files and the resume path instead.

## Notes
- Pushing `$DEFAULT` is the one irreversible step. A push of green work to the operator's own repos is the lead's call, and invoking `/commit:land` makes it; the public copy (Step 5) is part of the same landing once its two conditions hold, because the operator approved keeping it current; any other public surface still asks.
- Does **not** delete `$BRANCH` (backup-branch safety; CLAUDE.md forbids deleting backup branches). Prune manually if desired.
- Supersedes `/commit:both`. The granular building blocks `/commit:local` and `/commit:remote` remain.
