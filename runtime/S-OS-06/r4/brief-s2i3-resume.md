# BUILD BRIEF — S-OS-06 r4, lane I3: RESUME the capture rewrite (your work is already on disk)

WORKTREE: `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\worktrees\S-OS-06-s2i-capture`
**RESUME on branch `s-os-06/s2i-capture`. Do NOT rebuild. Do NOT start over.**

## Read this first — the state of your own worktree

Your predecessor dispatch ran against `runtime/S-OS-06/r4/brief-s2i2-capture-corrected.md` and **died with
the orchestrating session**, not on a finding. Its output file is 0 bytes, so at the dispatch ledger it looks
like it produced nothing. That is false. It left substantial work UNCOMMITTED in your worktree:

```
scripts/checks/run-tests.js | 721 +++++++++---
tests/quarantine.json       | 668 +++++++++++-
```

plus `runtime/S-OS-06/r4/s2i2/` containing `build-register.js`, `observe-register.js`, and
`observe-register-3.summary.json`.

**Your FIRST action is to commit that work**, so it can never be lost again, before you evaluate anything.
Commit it as-is, describing it as the predecessor's uncommitted work being preserved. Then continue.

## Your specification is UNCHANGED

`runtime/S-OS-06/r4/brief-s2i2-capture-corrected.md`, in full, is your spec. Read it. β's multiset ruling
(verdict id `2d7f5b83`, ledger row 479) governs: **the lock is the unordered multiset of cause lines, keeping
duplicates, not the ordered sequence.** Everything in that brief — I1 through I11, the six falsifiers, the
out-of-scope list — still stands exactly as written.

## What is NOT yours to redo

- The six-pass stability data at `runtime/S-OS-06/r4/s2i/stability-6.summary.json` and the findings at
  `s2i/findings.md`. Already measured. Do not re-measure them.
- The predecessor's 3-pass run at `s2i2/observe-register-3.summary.json`. It exists; read it.

## What you must decide for yourself, and I am deliberately not telling you my read

I have looked at both summaries. I am NOT giving you my conclusion, because a lane that is handed a verdict
confirms it rather than testing it, and your predecessor's most valuable output was a refusal.

Evaluate, from the artifacts:

1. **Every one of the six falsifiers in the corrected brief** — state each one's real status: green, red, or
   not-yet-evaluated. Do not report a falsifier as green because a summary file contains an encouraging
   number; run it or say plainly that you did not.
2. **The relationship between the 6-pass and the 3-pass runs.** They are different sample sizes over the same
   population. If they disagree on anything, say which is the better evidence and why. If your conclusion
   rests on an ABSENCE (something never observed), **state the population that absence covers** — how many
   passes, how many entries, which platform, which reporter. An absence over a thin sample is not a property
   of the system.
3. **Whether the work on disk actually implements the spec**, as opposed to being in an intermediate state.
   You are reading a dead builder's half-finished desk. Verify; do not assume it was done.

## You must author your own report

There is no first-person verdict from the predecessor and **nobody will write one for you.** The conductor
will not fill this gap, and neither should you invent what your predecessor concluded. Report what YOU
verified, in your own voice, and mark anything you could not reach as `cannot-assess` with the reason.

## TIME BOX

**100 minutes from your start record.** Budget so that you ALWAYS emit your report — a partial-but-honest
report beats a complete one nobody receives. If you are running out of time, stop and write up what is
genuinely established.

## Out of scope

`partition-loader.js`. The two sprint-authored test files. `.github/workflows/**`. Manifest regeneration.
Do not touch `.claude/settings.json`.

## Report

What you committed, every falsifier's true state, the declared normalizer with its stated ceiling, your
reading of the 6-pass vs 3-pass evidence with the population named, and anything you refused.
**If a premise in this brief is false, prove it and STOP** — that is how this lane's first dispatch produced
its most valuable result.
